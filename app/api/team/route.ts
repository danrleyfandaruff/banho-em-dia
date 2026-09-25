import { requireAdmin, writeAudit } from '@/lib/auth';
import { createSupabaseAdmin } from '@/lib/supabase';

type TeamRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  can_access: boolean;
  created_at: string;
  last_login_at: string | null;
};

function mapUser(row: TeamRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'staff',
    active: row.can_access,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

async function listUsers() {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('profiles')
    .select('id,email,name,role,can_access,created_at,last_login_at')
    .order('role')
    .order('name')
    .returns<TeamRow[]>();
  if (error) throw error;
  return (data ?? []).map(mapUser).sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return (a.name || a.email).localeCompare(b.name || b.email, 'pt-BR');
  });
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  return Response.json({ users: await listUsers() });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const password = String(body.password ?? '');
  const role = body.role === 'admin' ? 'admin' : 'staff';

  if (!email || !email.includes('@')) return Response.json({ error: 'email_required' }, { status: 400 });
  if (password.length < 6) return Response.json({ error: 'password_too_short' }, { status: 400 });

  const admin = createSupabaseAdmin();
  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) return Response.json({ error: 'email_exists' }, { status: 409 });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) {
    const duplicate = error?.message.toLowerCase().includes('already') || error?.message.toLowerCase().includes('registered');
    return Response.json({ error: duplicate ? 'email_exists' : 'user_create_failed' }, { status: duplicate ? 409 : 400 });
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id,
    email,
    name,
    role,
    can_access: true,
    created_by: auth.user.id,
  }, { onConflict: 'id' });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw profileError;
  }

  await writeAudit(
    auth.user,
    'user_created',
    'user',
    data.user.id,
    `Criou o acesso de ${name || email} como ${role === 'admin' ? 'administrador' : 'equipe'}`,
    { email, role },
  );
  return Response.json({ users: await listUsers() });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const id = String(body.id ?? '');
  const active = Boolean(body.active);
  const role = body.role === 'admin' ? 'admin' : 'staff';
  if (!id || id === auth.user.id) return Response.json({ error: 'cannot_change_self' }, { status: 400 });

  const admin = createSupabaseAdmin();
  const { data: target } = await admin.from('profiles').select('email,name').eq('id', id).maybeSingle();
  if (!target) return Response.json({ error: 'not_found' }, { status: 404 });
  const { error } = await admin.from('profiles').update({ can_access: active, role }).eq('id', id);
  if (error) throw error;

  await writeAudit(
    auth.user,
    'user_updated',
    'user',
    id,
    `${active ? 'Ativou' : 'Desativou'} o acesso de ${target.name || target.email}`,
    { email: target.email, active, role },
  );
  return Response.json({ users: await listUsers() });
}
