export type PaymentBreakdown = {
  baseCents: number;
  rateBps: number;
  surchargeCents: number;
  totalCents: number;
};

export function cardRateBps(method: string): number {
  return method === 'credit' ? 308 : method === 'debit' ? 87 : 0;
}

export function calculatePayment(baseCents: number | null, method: string): PaymentBreakdown | null {
  if (baseCents === null) return null;
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || baseCents > 100_000_000) {
    throw new Error('invalid_amount');
  }
  const rateBps = cardRateBps(method);
  // The processor deducts its percentage from the final charge, not from the net price.
  // Round up to a cent so that the merchant's net never falls below the base price.
  const totalCents = Math.ceil(baseCents * 10_000 / (10_000 - rateBps));
  return { baseCents, rateBps, surchargeCents: totalCents - baseCents, totalCents };
}
