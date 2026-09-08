import { env } from 'cloudflare:workers';

export type UserRole = 'admin' | 'staff';

export type Identity = {
  userId: string;
  email: string;
  name: string;
};

export type AuthorizedUser = Identity & {
  id: string;
  role: UserRole;
};

type UserRow = {
  id: string;
  chatgpt_user_id: string | null;
  email: string;
  name: string;
  role: string;
  active: number;
  last_login_at: string | null;
};

const OWNER_USER_ID = '1bf06280-7750-403d-98c0-5b97b31c3b48';
const OWNER_EMAIL = 'programador.vff@gmail.com';
const OWNER_NAME = 'Danrley Fandaruff';

function decodeName(request: Request) {
  const encoded = request.headers.get('oai-authenticated-user-full-name');
  if (!encoded || request.headers.get('oai-authenticated-user-full-name-encoding') !== 'percent-encoded-utf-8') {
    return '';
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

export function getIdentity(request: Request): Identity | null {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  if (userId && email) {
    return { userId, email: email.trim().toLowerCase(), name: decodeName(request) || email };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { userId: OWNER_USER_ID, email: OWNER_EMAIL, name: OWNER_NAME };
  }

  return null;
}

export async function ensureSecuritySchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      chatgpt_user_id TEXT,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'staff',
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_login_at TEXT
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_chatgpt_user_id ON app_users(chatgpt_user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_app_users_active ON app_users(active)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)'),
    db.prepare(`INSERT OR IGNORE INTO app_users (
      id, chatgpt_user_id, email, name, role, active, created_by, created_at
    ) VALUES (?, ?, ?, ?, 'admin', 1, 'system', ?)`)
      .bind('owner', OWNER_USER_ID, OWNER_EMAIL, OWNER_NAME, new Date().toISOString()),
  ]);
}

export async function writeAudit(
  user: AuthorizedUser,
  action: string,
  entityType: string,
  entityId: string,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  await env.DB.prepare(`INSERT INTO audit_logs (
    id, actor_user_id, actor_email, actor_name, action, entity_type, entity_id,
    description, metadata, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(), user.id, user.email, user.name, action, entityType,
      entityId, description, JSON.stringify(metadata), new Date().toISOString(),
    )
    .run();
}

export async function authorize(request: Request): Promise<AuthorizedUser | null> {
  await ensureSecuritySchema();
  const identity = getIdentity(request);
  if (!identity) return null;

  let row = await env.DB.prepare(
    'SELECT * FROM app_users WHERE chatgpt_user_id = ? AND active = 1 LIMIT 1',
  ).bind(identity.userId).first<UserRow>();

  if (!row) {
    row = await env.DB.prepare(
      'SELECT * FROM app_users WHERE lower(email) = ? AND active = 1 LIMIT 1',
    ).bind(identity.email).first<UserRow>();
    if (row && !row.chatgpt_user_id) {
      await env.DB.prepare('UPDATE app_users SET chatgpt_user_id = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?')
        .bind(identity.userId, identity.name, row.id)
        .run();
    }
  }

  if (!row) return null;

  const user: AuthorizedUser = {
    id: row.id,
    userId: identity.userId,
    email: row.email,
    name: row.name || identity.name || row.email,
    role: row.role === 'admin' ? 'admin' : 'staff',
  };

  const today = new Date().toISOString().slice(0, 10);
  if (!row.last_login_at || row.last_login_at.slice(0, 10) !== today) {
    await env.DB.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), row.id)
      .run();
    await writeAudit(user, 'login', 'session', row.id, 'Entrou no sistema');
  }

  return user;
}

export async function requireAuthorized(request: Request) {
  const identity = getIdentity(request);
  if (!identity) {
    return { user: null, response: Response.json({ error: 'signed_out' }, { status: 401 }) };
  }
  const user = await authorize(request);
  if (!user) {
    return {
      user: null,
      response: Response.json({ error: 'access_denied', email: identity.email }, { status: 403 }),
    };
  }
  return { user, response: null };
}

export async function requireAdmin(request: Request) {
  const result = await requireAuthorized(request);
  if (result.response || !result.user) return result;
  if (result.user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'admin_only' }, { status: 403 }) };
  }
  return result;
}
