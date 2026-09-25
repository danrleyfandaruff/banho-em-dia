import { createClient } from '@supabase/supabase-js';

function supabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada');
  return value;
}

function publicKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error('Chave pública do Supabase não configurada');
  return value;
}

function serviceRoleKey() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return value;
}

const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function createSupabaseAuthClient() {
  return createClient(supabaseUrl(), publicKey(), authOptions);
}

export function createSupabaseAdmin() {
  return createClient(supabaseUrl(), serviceRoleKey(), authOptions);
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
