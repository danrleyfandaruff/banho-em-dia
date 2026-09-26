import type { PaymentBreakdown } from './payment';

export type ExtraService = {
  id: string;
  name: string;
  amountCents: number;
  paid: boolean;
  paymentMethod: '' | 'pix' | 'cash' | 'debit' | 'credit';
  paymentDetails: PaymentBreakdown | null;
  createdAt: string;
  updatedAt: string;
};
export type ServiceRecord = {
  version: 1;
  revision: number;
  included: string[];
  extras: ExtraService[];
};
export type StoredServices = string[] | ServiceRecord | string;

export function readServices(value: unknown): ServiceRecord {
  let data: unknown = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('Invalid stored services');
    }
  }
  if (Array.isArray(data))
    return {
      version: 1,
      revision: 0,
      included: data.filter((item): item is string => typeof item === 'string'),
      extras: [],
    };
  if (data && typeof data === 'object') {
    const record = data as Partial<ServiceRecord>;
    if (
      record.version === 1 &&
      Number.isSafeInteger(record.revision) &&
      record.revision! >= 0 &&
      Array.isArray(record.included) &&
      Array.isArray(record.extras)
    ) {
      return record as ServiceRecord;
    }
  }
  // Fail closed instead of overwriting unrecognized financial records.
  throw new Error('Invalid stored services');
}
export function serviceNames(value: unknown) {
  const record = readServices(value);
  return [...record.included, ...record.extras.map((extra) => extra.name)];
}
export function extraTotal(extra: ExtraService) {
  return extra.paid
    ? (extra.paymentDetails?.totalCents ?? extra.amountCents)
    : extra.amountCents;
}

export function normalizeServiceName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
