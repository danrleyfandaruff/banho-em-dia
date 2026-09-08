import { env } from 'cloudflare:workers';

type AppointmentRow = {
  id: string;
  group_id: string;
  customer_pet_name: string;
  plan_type: string;
  amount_cents: number | null;
  paid: number;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  services: string;
  session_number: number;
  total_sessions: number;
  created_at: string;
};

type Appointment = {
  id: string;
  groupId: string;
  customerPetName: string;
  planType: 'monthly' | 'fortnightly' | 'single';
  amountCents: number | null;
  paid: boolean;
  scheduledDate: string;
  scheduledTime: string;
  status: 'scheduled' | 'completed' | 'absent';
  services: string[];
  sessionNumber: number;
  totalSessions: number;
};

function mapRow(row: AppointmentRow): Appointment {
  let services: string[] = [];
  try {
    services = JSON.parse(row.services);
  } catch {
    services = [];
  }
  return {
    id: row.id,
    groupId: row.group_id,
    customerPetName: row.customer_pet_name,
    planType: row.plan_type as Appointment['planType'],
    amountCents: row.amount_cents,
    paid: Boolean(row.paid),
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    status: row.status as Appointment['status'],
    services,
    sessionNumber: row.session_number,
    totalSessions: row.total_sessions,
  };
}

async function ensureSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      customer_pet_name TEXT NOT NULL DEFAULT '',
      plan_type TEXT NOT NULL,
      amount_cents INTEGER,
      paid INTEGER NOT NULL DEFAULT 0,
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL DEFAULT '09:00',
      status TEXT NOT NULL DEFAULT 'scheduled',
      services TEXT NOT NULL DEFAULT '[]',
      session_number INTEGER NOT NULL DEFAULT 1,
      total_sessions INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_appointments_group_id ON appointments(group_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_appointments_status_date ON appointments(status, scheduled_date)'),
  ]);
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function listAppointments() {
  const results = await env.DB.prepare(
    `SELECT * FROM appointments
     WHERE scheduled_date >= date('now', '-45 days')
     ORDER BY scheduled_date ASC, scheduled_time ASC`,
  ).all<AppointmentRow>();
  return results.results.map(mapRow);
}

export async function GET() {
  await ensureSchema();
  return Response.json({ appointments: await listAppointments() });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? 'create');
  const db = env.DB;

  if (action === 'create') {
    const planType = String(body.planType ?? 'monthly') as Appointment['planType'];
    const totalSessions = planType === 'monthly' ? 4 : planType === 'fortnightly' ? 2 : 1;
    const intervalDays = planType === 'monthly' ? 7 : planType === 'fortnightly' ? 14 : 0;
    const groupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const startDate = String(body.scheduledDate ?? createdAt.slice(0, 10));
    const amountCents = body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents);
    const sessionServices = Array.isArray(body.sessionServices) ? body.sessionServices : [];
    const statements = Array.from({ length: totalSessions }, (_, index) =>
      db.prepare(
        `INSERT INTO appointments (
          id, group_id, customer_pet_name, plan_type, amount_cents, paid,
          scheduled_date, scheduled_time, status, services, session_number,
          total_sessions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        groupId,
        String(body.customerPetName ?? ''),
        planType,
        amountCents,
        body.paid ? 1 : 0,
        addDays(startDate, intervalDays * index),
        String(body.scheduledTime ?? '09:00'),
        JSON.stringify(
          Array.isArray(sessionServices[index])
            ? sessionServices[index]
            : Array.isArray(body.services) ? body.services : [],
        ),
        index + 1,
        totalSessions,
        createdAt,
      ),
    );
    await db.batch(statements);
  }

  if (action === 'status') {
    await db.prepare('UPDATE appointments SET status = ? WHERE id = ?')
      .bind(String(body.status ?? 'scheduled'), String(body.id ?? ''))
      .run();
  }

  if (action === 'paid') {
    const row = await db.prepare('SELECT group_id FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<{ group_id: string }>();
    if (row) {
      await db.prepare('UPDATE appointments SET paid = ? WHERE group_id = ?')
        .bind(body.paid ? 1 : 0, row.group_id)
        .run();
    }
  }

  if (action === 'move') {
    await db.prepare('UPDATE appointments SET scheduled_date = ? WHERE id = ?')
      .bind(String(body.scheduledDate ?? ''), String(body.id ?? ''))
      .run();
  }

  if (action === 'edit') {
    await db.prepare(
      'UPDATE appointments SET customer_pet_name = ?, scheduled_time = ?, services = ?, amount_cents = ? WHERE id = ?',
    ).bind(
      String(body.customerPetName ?? ''),
      String(body.scheduledTime ?? '09:00'),
      JSON.stringify(Array.isArray(body.services) ? body.services : []),
      body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents),
      String(body.id ?? ''),
    ).run();
  }

  if (action === 'renew') {
    const previousPlan = await db.prepare(
      'SELECT * FROM appointments WHERE group_id = ? ORDER BY session_number ASC',
    ).bind(String(body.groupId ?? '')).all<AppointmentRow>();
    const previousSessions = previousPlan.results;
    const previous = previousSessions.at(-1);
    if (previous) {
      const totalSessions = previous.plan_type === 'monthly' ? 4 : previous.plan_type === 'fortnightly' ? 2 : 1;
      const intervalDays = previous.plan_type === 'monthly' ? 7 : previous.plan_type === 'fortnightly' ? 14 : 0;
      const nextStart = addDays(previous.scheduled_date, intervalDays || 7);
      const groupId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await db.batch(Array.from({ length: totalSessions }, (_, index) =>
        db.prepare(
          `INSERT INTO appointments (
            id, group_id, customer_pet_name, plan_type, amount_cents, paid,
            scheduled_date, scheduled_time, status, services, session_number,
            total_sessions, created_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'scheduled', ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), groupId, previous.customer_pet_name, previous.plan_type,
          previous.amount_cents, addDays(nextStart, intervalDays * index), previous.scheduled_time,
          previousSessions[index]?.services ?? previous.services, index + 1, totalSessions, createdAt,
        ),
      ));
    }
  }

  await db.prepare('PRAGMA optimize').run();
  return Response.json({ appointments: await listAppointments() });
}
