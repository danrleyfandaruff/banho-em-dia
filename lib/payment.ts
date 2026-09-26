export type PaymentBreakdown = {
  baseCents: number;
  rateBps: number;
  surchargeCents: number;
  totalCents: number;
  receipt?: { id: string; date: string; recordedAt: string; method: 'pix' | 'cash' | 'debit' | 'credit'; batchId?: string };
};

export type CardRates = { credit: number; debit: number };
export const defaultCardRates: CardRates = { credit: 308, debit: 87 };

export function cardRateBps(method: string, rates: CardRates = defaultCardRates): number {
  return method === 'credit' ? rates.credit : method === 'debit' ? rates.debit : 0;
}

export function calculatePayment(baseCents: number | null, method: string, rates: CardRates = defaultCardRates): PaymentBreakdown | null {
  if (baseCents === null) return null;
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || baseCents > 100_000_000) {
    throw new Error('invalid_amount');
  }
  const rateBps = cardRateBps(method, rates);
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps >= 10_000) throw new Error('invalid_rate');
  // The processor deducts its percentage from the final charge, not from the net price.
  // Round up to a cent so that the merchant's net never falls below the base price.
  const totalCents = Math.ceil(baseCents * 10_000 / (10_000 - rateBps));
  return { baseCents, rateBps, surchargeCents: totalCents - baseCents, totalCents };
}
