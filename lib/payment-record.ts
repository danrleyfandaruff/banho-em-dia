import {
  calculatePayment,
  type CardRates,
  type PaymentBreakdown,
} from './payment';
import { businessDate, validDate } from './finance-date';

export class PaymentInputError extends Error {}
export function paymentDate(value: unknown, fallback = businessDate()): string {
  const date = value === undefined ? fallback : value;
  if (!validDate(date) || date > businessDate())
    throw new PaymentInputError('invalid_payment_date');
  return date;
}
export function recordPayment({
  amount,
  method,
  rates,
  date,
  previous,
  batchId,
}: {
  amount: number | null;
  method: string;
  rates: CardRates;
  date?: unknown;
  previous?: PaymentBreakdown | null;
  batchId?: string;
}): PaymentBreakdown {
  if (!['pix', 'cash', 'debit', 'credit'].includes(method))
    throw new PaymentInputError('invalid_payment_method');
  if (amount === null) throw new PaymentInputError('payment_amount_required');
  const paidOn = paymentDate(date, previous?.receipt?.date);
  let details: PaymentBreakdown | null;
  try {
    details = calculatePayment(amount, method, rates);
  } catch {
    throw new PaymentInputError('invalid_amount');
  }
  if (!details) throw new PaymentInputError('payment_amount_required');
  const unchanged =
    previous?.receipt?.method === method &&
    previous.baseCents === details.baseCents &&
    previous.rateBps === details.rateBps;
  return {
    ...(unchanged ? previous : details),
    receipt: {
      id: previous?.receipt?.id ?? crypto.randomUUID(),
      date: paidOn,
      recordedAt: previous?.receipt?.recordedAt ?? new Date().toISOString(),
      method: method as 'pix' | 'cash' | 'debit' | 'credit',
      ...(batchId || (unchanged && previous?.receipt?.batchId)
        ? { batchId: batchId || previous?.receipt?.batchId }
        : {}),
    },
  };
}
