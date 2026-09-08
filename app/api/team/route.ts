import { env } from 'cloudflare:workers';
import { requireAdmin, writeAudit } from '@/lib/auth';

type TeamRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
};

function mapUser(row: TeamRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'staff',
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

async function listUsers() {
  const results = await env.DB.prepare(
    "SELECT id, email, name, role, active, created_at, last_login_at FROM app_users ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name, email",
  ).all<TeamRow>();
  return results.results.map(mapUser);
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  return Response.json({ users: await listUsers() });
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response || !auth.user) return auth.response;
  const body = (await request.json()) as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').trim();
  const role = body.role === 'admin' ? 'admin' : 'staff';

  if (!email || !email.includes('@')) {
    return Response.json({ error: 'email_required' }, { status: 400 });
  }

  const existing = await env.DB.prepare('SELECT id FROM app_users WHERE lower(email) = ?')
    .bind(email)
    .first<{ id: string }>();
  if (existing) return Response.json({ error: 'email_exists' }, { status: 409 });

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO app_users (
    id, chatgpt_user_id, email, name, role, active, created_by, created_at
  ) VALUES (?, NULL, ?, ?, ?, 1, ?, ?)`)
    .bind(id, email, name, role, auth.user.id, new Date().toISOString())
    .run();
  await writeAudit(
    auth.user, 'user_created', 'user', id,
    `Criou o acesso de ${name || email} como ${role === 'admin' ? 'administrador' : 'equipe'}`,
    { email, role },
  );
  return Response.json({ users: await listUsers() });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response || !auth.user) return auth.response;
  const body = (await request.json()) as Record<string, unknown>;
  const id = String(body.id ?? '');
  const active = Boolean(body.active);
  const role = body.role === 'admin' ? 'admin' : 'staff';

  if (!id || id === auth.user.id) {
    return Response.json({ error: 'cannot_change_self' }, { status: 400 });
  }
  const target = await env.DB.prepare('SELECT email, name FROM app_users WHERE id = ?')
    .bind(id)
    .first<{ email: string; name: string }>();
  if (!target) return Response.json({ error: 'not_found' }, { status: 404 });

  await env.DB.prepare('UPDATE app_users SET active = ?, role = ? WHERE id = ?')
    .bind(active ? 1 : 0, role, id)
    .run();
  await writeAudit(
    auth.user, 'user_updated', 'user', id,
    `${active ? 'Ativou' : 'Desativou'} o acesso de ${target.name || target.email}`,
    { email: target.email, active, role },
  );
  return Response.json({ users: await listUsers() });
}
