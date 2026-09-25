import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { createSupabaseAdmin, createSupabaseAuthClient, isSupabaseConfigured } from './supabase';

export type UserRole = 'admin' | 'staff';

export type AuthorizedUser = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
};

type ProfileRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  can_access: boolean;
  last_login_at: string | null;
};

const ACCESS_COOKIE = 'hein-access-token';
const REFRESH_COOKIE = 'hein-refresh-token';

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

export async function setSessionCookies(accessToken: string, refreshToken: string, expiresIn = 3600) {
  const store = await cookies();
  store.set(ACCESS_COOKIE, accessToken, cookieOptions(expiresIn));
  store.set(REFRESH_COOKIE, refreshToken, cookieOptions(60 * 60 * 24 * 30));
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.set(ACCESS_COOKIE, '', cookieOptions(0));
  store.set(REFRESH_COOKIE, '', cookieOptions(0));
}

async function readAuthUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!accessToken && !refreshToken) return null;

  const authClient = createSupabaseAuthClient();
  if (accessToken) {
    const { data } = await authClient.auth.getUser(accessToken);
    if (data.user) return data.user;
  }

  if (!refreshToken) return null;
  const { data, error } = await authClient.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) return null;
  await setSessionCookies(
    data.session.access_token,
    data.session.refresh_token,
    data.session.expires_in,
  );
  return data.user;
}

export async function getSessionIdentity() {
  const authUser = await readAuthUser();
  if (!authUser) return { authUser: null, profile: null };

  const admin = createSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('id,email,name,role,can_access,last_login_at')
    .eq('id', authUser.id)
    .maybeSingle<ProfileRow>();
  return { authUser, profile: profile ?? null };
}

function authorizedUser(authUser: User, profile: ProfileRow): AuthorizedUser {
  return {
    id: profile.id,
    userId: authUser.id,
    email: profile.email || authUser.email || '',
    name: profile.name || profile.email || authUser.email || 'Usuário',
    role: profile.role === 'admin' ? 'admin' : 'staff',
  };
}

export async function authorize(): Promise<AuthorizedUser | null> {
  const { authUser, profile } = await getSessionIdentity();
  if (!authUser || !profile?.can_access) return null;
  return authorizedUser(authUser, profile);
}

export async function writeAudit(
  user: AuthorizedUser,
  action: string,
  entityType: string,
  entityId: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('audit_logs').insert({
    actor_user_id: user.id,
    actor_email: user.email,
    actor_name: user.name,
    action,
    entity_type: entityType,
    entity_id: entityId,
    description,
    metadata,
  });
  if (error) throw error;
}

export async function requireAuthorized(_request?: Request) {
  if (!isSupabaseConfigured()) {
    return {
      user: null,
      response: Response.json({ error: 'supabase_not_configured' }, { status: 503 }),
    };
  }
  const { authUser, profile } = await getSessionIdentity();
  if (!authUser) {
    return { user: null, response: Response.json({ error: 'signed_out' }, { status: 401 }) };
  }
  if (!profile?.can_access) {
    return {
      user: null,
      response: Response.json({ error: 'access_denied', email: authUser.email ?? '' }, { status: 403 }),
    };
  }
  return { user: authorizedUser(authUser, profile), response: null };
}

export async function requireAdmin(request?: Request) {
  const result = await requireAuthorized(request);
  if (result.response || !result.user) return result;
  if (result.user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'admin_only' }, { status: 403 }) };
  }
  return result;
}
