import {
  clearSessionCookies,
  getSessionIdentity,
  setSessionCookies,
  writeAudit,
  type AuthorizedUser,
} from '@/lib/auth';
import { createSupabaseAdmin, createSupabaseAuthClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json({ status: 'configuration_missing' }, { status: 503 });
  }
  const { authUser, profile } = await getSessionIdentity();
  if (!authUser) return Response.json({ status: 'signed_out' }, { status: 401 });
  if (!profile?.can_access) {
    return Response.json({ status: 'forbidden', email: authUser.email ?? '' }, { status: 403 });
  }
  return Response.json({
    status: 'authorized',
    user: {
      id: profile.id,
      name: profile.name || profile.email,
      email: profile.email,
      role: profile.role === 'admin' ? 'admin' : 'staff',
    },
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  const body = await request.json() as { email?: unknown; password?: unknown };
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return Response.json({ error: 'credentials_required' }, { status: 400 });

  const authClient = createSupabaseAuthClient();
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    return Response.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id,email,name,role,can_access')
    .eq('id', data.user.id)
    .maybeSingle();
  if (!profile?.can_access) {
    return Response.json({ error: 'access_denied', email }, { status: 403 });
  }

  await setSessionCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
  const now = new Date().toISOString();
  await admin.from('profiles').update({ last_login_at: now }).eq('id', profile.id);
  const user: AuthorizedUser = {
    id: profile.id,
    userId: data.user.id,
    email: profile.email || email,
    name: profile.name || profile.email || email,
    role: profile.role === 'admin' ? 'admin' : 'staff',
  };
  await writeAudit(user, 'login', 'session', profile.id, 'Entrou no sistema');

  return Response.json({ status: 'authorized', user });
}

export async function DELETE() {
  await clearSessionCookies();
  return Response.json({ status: 'signed_out' });
}
