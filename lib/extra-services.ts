import { createSupabaseAdmin } from './supabase';
import { getCardRates } from './payment-rates';
import { cardRateBps } from './payment';
import { recordPayment, PaymentInputError } from './payment-record';
import {
  readServices,
  normalizeServiceName,
  type ExtraService,
  type ServiceRecord,
  type StoredServices,
} from './appointment-services';

type SessionRow = {
  id: string;
  services: StoredServices;
  dog_name: string;
  group_id: string;
};
export class ExtraServiceError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';
const uuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export async function saveExtraService(body: Record<string, unknown>) {
  const action = text(body.action);
  if (
    !['extra_create', 'extra_edit', 'extra_remove', 'extra_unpay'].includes(
      action,
    )
  )
    throw new ExtraServiceError('invalid_extra_action');
  const id = text(body.id);
  const extraId = text(body.extraId);
  if (!uuid(extraId) || !id) throw new ExtraServiceError('invalid_extra');
  const admin = createSupabaseAdmin();
  const { data: row, error } = await admin
    .from('appointments')
    .select('id,services,dog_name,group_id')
    .eq('id', id)
    .maybeSingle<SessionRow>();
  if (error) throw error;
  if (!row) throw new ExtraServiceError('not_found', 404);
  const record = readServices(row.services);
  const previous = record.extras.find((extra) => extra.id === extraId);
  if (action === 'extra_create' && previous) {
    // A repeated request after a lost response must not create another charge.
    if (
      previous.name === text(body.name) &&
      previous.amountCents === body.amountCents &&
      previous.paid === body.paid &&
      (!previous.paid ||
        (previous.paymentMethod === body.paymentMethod &&
          previous.paymentDetails?.receipt?.date === body.paymentDate))
    )
      return { row, previous, extra: previous, changed: false };
    throw new ExtraServiceError('extra_conflict', 409);
  }
  if (body.revision !== record.revision)
    throw new ExtraServiceError('extra_conflict', 409);
  if (action !== 'extra_create' && !previous)
    throw new ExtraServiceError('extra_not_found', 404);
  if (action === 'extra_remove' && previous?.paid)
    throw new ExtraServiceError('extra_paid_delete_blocked', 409);
  let extra: ExtraService | undefined;
  if (action === 'extra_unpay') {
    extra = {
      ...previous!,
      paid: false,
      paymentMethod: '',
      paymentDetails: null,
      updatedAt: new Date().toISOString(),
    };
  } else if (action !== 'extra_remove') {
    const name = text(body.name);
    const amountCents = body.amountCents;
    if (
      !name ||
      name.length > 100 ||
      typeof amountCents !== 'number' ||
      !Number.isSafeInteger(amountCents) ||
      amountCents < 0 ||
      amountCents > 100_000_000 ||
      typeof body.paid !== 'boolean'
    )
      throw new ExtraServiceError('invalid_extra');
    if (
      record.included.some(
        (service) =>
          normalizeServiceName(service) === normalizeServiceName(name),
      )
    )
      throw new ExtraServiceError('extra_already_included', 409);
    if (
      record.extras.some(
        (service) =>
          service.id !== extraId &&
          normalizeServiceName(service.name) === normalizeServiceName(name),
      )
    )
      throw new ExtraServiceError('extra_duplicate', 409);
    if (previous?.paid && !body.paid)
      throw new ExtraServiceError('extra_use_unpay');
    const paid = body.paid;
    const method = paid ? text(body.paymentMethod) : '';
    let paymentDetails = null;
    if (paid) {
      const currentRates = await getCardRates();
      const keepRate =
        previous?.paid &&
        previous.paymentDetails &&
        previous.paymentMethod === method;
      const rates = keepRate
        ? { ...currentRates, [method]: previous.paymentDetails!.rateBps }
        : currentRates;
      if (
        !keepRate &&
        ['credit', 'debit'].includes(method) &&
        body.expectedRateBps !== cardRateBps(method, rates)
      )
        throw new ExtraServiceError('rates_changed', 409);
      try {
        paymentDetails = recordPayment({
          amount: amountCents,
          method,
          rates,
          date: body.paymentDate,
          previous: previous?.paid ? previous.paymentDetails : null,
        });
      } catch (error) {
        if (error instanceof PaymentInputError)
          throw new ExtraServiceError(error.message);
        throw error;
      }
    }
    const now = new Date().toISOString();
    extra = {
      id: extraId,
      name,
      amountCents,
      paid,
      paymentMethod: method as ExtraService['paymentMethod'],
      paymentDetails,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
  }
  const next: ServiceRecord = {
    ...record,
    revision: record.revision + 1,
    extras:
      action === 'extra_remove'
        ? record.extras.filter((item) => item.id !== extraId)
        : action === 'extra_create'
          ? [...record.extras, extra!]
          : record.extras.map((item) => (item.id === extraId ? extra! : item)),
  };
  // Compare the full JSON snapshot so another session edit cannot erase an extra or its payment.
  const snapshot = JSON.stringify(row.services);
  const result = await admin
    .from('appointments')
    .update({ services: next })
    .eq('id', id)
    .eq('services', snapshot)
    .select('id');
  if (result.error) throw result.error;
  if (!result.data?.length) throw new ExtraServiceError('extra_conflict', 409);
  return { row, previous, extra, changed: true };
}
