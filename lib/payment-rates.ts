import { env } from 'cloudflare:workers';
import { defaultCardRates, type CardRates } from './payment';

export async function getCardRates(): Promise<CardRates> {
  const row = await env.DB.prepare('SELECT credit_bps, debit_bps FROM payment_settings WHERE id = ?')
    .bind('stone').first<{ credit_bps: number; debit_bps: number }>();
  return row ? { credit: row.credit_bps, debit: row.debit_bps } : { ...defaultCardRates };
}
