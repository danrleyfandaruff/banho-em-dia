import { env } from 'cloudflare:workers';
import { requireAdmin, requireAuthorized, writeAudit } from '@/lib/auth';
import { getCardRates } from '@/lib/payment-rates';

export async function GET(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response) return auth.response;
  return Response.json({ rates: await getCardRates() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json() as { credit?: unknown; debit?: unknown };
  const { credit, debit } = body;
  if (typeof credit !== 'number' || typeof debit !== 'number' ||
      !Number.isInteger(credit) || !Number.isInteger(debit) ||
      credit < 0 || debit < 0 || credit >= 10_000 || debit >= 10_000) {
    return Response.json({ error: 'invalid_rates' }, { status: 400 });
  }
  const previous = await getCardRates();
  await env.DB.prepare(`INSERT INTO payment_settings (id, credit_bps, debit_bps) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET credit_bps = excluded.credit_bps, debit_bps = excluded.debit_bps`)
    .bind('stone', credit, debit).run();
  await writeAudit(auth.user, 'payment_rates_updated', 'payment_settings', 'stone',
    `Alterou as taxas Stone: crédito ${(credit / 100).toLocaleString('pt-BR')}% e débito ${(debit / 100).toLocaleString('pt-BR')}%`,
    { previous, rates: { credit, debit } });
  return Response.json({ rates: { credit, debit } });
}
