import { requireAdmin, requireAuthorized, writeAudit } from '@/lib/auth';
import { getCardRates } from '@/lib/payment-rates';
import { createSupabaseAdmin } from '@/lib/supabase';

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
  if (typeof credit !== 'number' || typeof debit !== 'number'
    || !Number.isInteger(credit) || !Number.isInteger(debit)
    || credit < 0 || debit < 0 || credit >= 10_000 || debit >= 10_000) {
    return Response.json({ error: 'invalid_rates' }, { status: 400 });
  }
  const previous = await getCardRates();
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('payment_settings').upsert({
    id: 'stone',
    credit_bps: credit,
    debit_bps: debit,
    updated_at: new Date().toISOString(),
    updated_by: auth.user.id,
  });
  if (error) throw error;
  await writeAudit(
    auth.user,
    'payment_rates_updated',
    'payment_settings',
    'stone',
    `Alterou as taxas Stone: crédito ${(credit / 100).toLocaleString('pt-BR')}% e débito ${(debit / 100).toLocaleString('pt-BR')}%`,
    { previous, rates: { credit, debit } },
  );
  return Response.json({ rates: { credit, debit } });
}
