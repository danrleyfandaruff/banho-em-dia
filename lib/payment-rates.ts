import { defaultCardRates, type CardRates } from './payment';
import { createSupabaseAdmin } from './supabase';

export async function getCardRates(): Promise<CardRates> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('payment_settings')
    .select('credit_bps,debit_bps')
    .eq('id', 'stone')
    .maybeSingle<{ credit_bps: number; debit_bps: number }>();
  if (error) throw error;
  return data ? { credit: data.credit_bps, debit: data.debit_bps } : { ...defaultCardRates };
}
