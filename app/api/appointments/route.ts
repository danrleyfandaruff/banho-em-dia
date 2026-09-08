import { env } from 'cloudflare:workers';
import { requireAuthorized, writeAudit } from '@/lib/auth';

type AppointmentRow = {
  id: string;
  group_id: string;
  customer_pet_name: string;
  owner_name: string;
  dog_name: string;
  whatsapp: string;
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
  ownerName: string;
  dogName: string;
  whatsapp: string;
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
  const legacyNames = row.customer_pet_name.split(/\s*\+\s*/);
  const ownerName = row.owner_name || (legacyNames.length > 1 ? legacyNames[0] : '');
  const dogName = row.dog_name || (legacyNames.length > 1 ? legacyNames.slice(1).join(' + ') : row.customer_pet_name);
  return {
    id: row.id,
    groupId: row.group_id,
    customerPetName: row.customer_pet_name,
    ownerName,
    dogName,
    whatsapp: row.whatsapp || '',
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
      owner_name TEXT NOT NULL DEFAULT '',
      dog_name TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
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

  const columns = await db.prepare('PRAGMA table_info(appointments)').all<{ name: string }>();
  const columnNames = new Set(columns.results.map((column) => column.name));
  const alterations = [];
  if (!columnNames.has('owner_name')) alterations.push(db.prepare("ALTER TABLE appointments ADD COLUMN owner_name TEXT NOT NULL DEFAULT ''"));
  if (!columnNames.has('dog_name')) alterations.push(db.prepare("ALTER TABLE appointments ADD COLUMN dog_name TEXT NOT NULL DEFAULT ''"));
  if (!columnNames.has('whatsapp')) alterations.push(db.prepare("ALTER TABLE appointments ADD COLUMN whatsapp TEXT NOT NULL DEFAULT ''"));
  if (alterations.length) await db.batch(alterations);
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function listAppointments() {
  const results = await env.DB.prepare(
    `SELECT * FROM appointments
     ORDER BY scheduled_date ASC, scheduled_time ASC`,
  ).all<AppointmentRow>();
  return results.results.map(mapRow);
}

function intervalForPlan(planType: string) {
  return planType === 'monthly' ? 7 : planType === 'fortnightly' ? 14 : 0;
}

async function futureSessions(target: AppointmentRow) {
  return env.DB.prepare(
    'SELECT id, session_number FROM appointments WHERE group_id = ? AND session_number > ? ORDER BY session_number ASC',
  ).bind(target.group_id, target.session_number).all<{ id: string; session_number: number }>();
}

async function rescheduleStatements(target: AppointmentRow, scheduledDate: string) {
  const later = await futureSessions(target);
  const intervalDays = intervalForPlan(target.plan_type);
  return [
    env.DB.prepare('UPDATE appointments SET scheduled_date = ? WHERE id = ?')
      .bind(scheduledDate, target.id),
    ...later.results.map((session) =>
      env.DB.prepare('UPDATE appointments SET scheduled_date = ? WHERE id = ?')
        .bind(addDays(scheduledDate, intervalDays * (session.session_number - target.session_number)), session.id),
    ),
  ];
}

function appointmentName(row: Pick<AppointmentRow, 'dog_name' | 'owner_name' | 'customer_pet_name'>) {
  return row.dog_name || row.owner_name || row.customer_pet_name || 'agendamento sem nome';
}

export async function GET(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  return Response.json({ appointments: await listAppointments() });
}

export async function POST(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response || !auth.user) return auth.response;
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
    const ownerName = String(body.ownerName ?? '');
    const dogName = String(body.dogName ?? '');
    const whatsapp = String(body.whatsapp ?? '');
    const legacyName = [ownerName, dogName].filter(Boolean).join(' + ');
    const statements = Array.from({ length: totalSessions }, (_, index) =>
      db.prepare(
        `INSERT INTO appointments (
          id, group_id, customer_pet_name, owner_name, dog_name, whatsapp, plan_type, amount_cents, paid,
          scheduled_date, scheduled_time, status, services, session_number,
          total_sessions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        groupId,
        legacyName,
        ownerName,
        dogName,
        whatsapp,
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
    await writeAudit(
      auth.user, 'appointment_created', 'appointment_group', groupId,
      `Criou ${totalSessions === 1 ? 'um banho avulso' : `um plano com ${totalSessions} sessões`} para ${dogName || ownerName || 'cliente sem nome'}`,
      { planType, totalSessions, startDate },
    );
  }

  if (action === 'status') {
    const target = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    await db.prepare('UPDATE appointments SET status = ? WHERE id = ?')
      .bind(String(body.status ?? 'scheduled'), String(body.id ?? ''))
      .run();
    if (target) {
      const statusLabels: Record<string, string> = {
        scheduled: 'Reabriu', completed: 'Concluiu', absent: 'Registrou falta em',
      };
      const status = String(body.status ?? 'scheduled');
      await writeAudit(
        auth.user, 'appointment_status', 'appointment', target.id,
        `${statusLabels[status] ?? 'Alterou'} o atendimento de ${appointmentName(target)}`,
        { from: target.status, to: status, scheduledDate: target.scheduled_date },
      );
    }
  }

  if (action === 'paid') {
    const row = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    if (row) {
      await db.prepare('UPDATE appointments SET paid = ? WHERE group_id = ?')
        .bind(body.paid ? 1 : 0, row.group_id)
        .run();
      await writeAudit(
        auth.user, 'payment_updated', 'appointment_group', row.group_id,
        `${body.paid ? 'Confirmou' : 'Desmarcou'} o pagamento de ${appointmentName(row)}`,
        { paid: Boolean(body.paid), amountCents: row.amount_cents },
      );
    }
  }

  if (action === 'move') {
    const target = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    if (target) {
      const scheduledDate = String(body.scheduledDate ?? target.scheduled_date);
      const statements = await rescheduleStatements(target, scheduledDate);
      await db.batch(statements);
      await writeAudit(
        auth.user, 'appointment_moved', 'appointment', target.id,
        `Moveu o atendimento de ${appointmentName(target)} de ${target.scheduled_date} para ${scheduledDate}`,
        { from: target.scheduled_date, to: scheduledDate, futureSessionsUpdated: statements.length - 1 },
      );
    }
  }

  if (action === 'edit') {
    const ownerName = String(body.ownerName ?? '');
    const dogName = String(body.dogName ?? '');
    const id = String(body.id ?? '');
    const row = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(id)
      .first<AppointmentRow>();
    if (row) {
      const scheduledDate = String(body.scheduledDate ?? row.scheduled_date);
      const dateStatements = await rescheduleStatements(row, scheduledDate);
      await db.batch([
        db.prepare(
          'UPDATE appointments SET customer_pet_name = ?, owner_name = ?, dog_name = ?, whatsapp = ? WHERE group_id = ?',
        ).bind(
          [ownerName, dogName].filter(Boolean).join(' + '),
          ownerName,
          dogName,
          String(body.whatsapp ?? ''),
          row.group_id,
        ),
        db.prepare(
          'UPDATE appointments SET scheduled_time = ?, services = ?, amount_cents = ? WHERE id = ?',
        ).bind(
          String(body.scheduledTime ?? '09:00'),
          JSON.stringify(Array.isArray(body.services) ? body.services : []),
          body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents),
          id,
        ),
        ...dateStatements,
      ]);
      await writeAudit(
        auth.user, 'appointment_edited', 'appointment', id,
        `Editou o atendimento de ${dogName || ownerName || appointmentName(row)}`,
        {
          previousDate: row.scheduled_date,
          scheduledDate,
          sessionNumber: row.session_number,
          futureSessionsUpdated: dateStatements.length - 1,
        },
      );
    }
  }

  if (action === 'delete') {
    const target = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    if (!target) return Response.json({ error: 'not_found' }, { status: 404 });

    const plan = await db.prepare(
      'SELECT * FROM appointments WHERE group_id = ? ORDER BY session_number ASC',
    ).bind(target.group_id).all<AppointmentRow>();
    const completedCount = plan.results.filter((session) => session.status === 'completed').length;
    const isPaid = plan.results.some((session) => Boolean(session.paid));
    const blockers: string[] = [];
    if (completedCount) {
      blockers.push(`${completedCount} ${completedCount === 1 ? 'banho concluído' : 'banhos concluídos'}`);
    }
    if (isPaid) blockers.push('pagamento marcado como pago');

    if (blockers.length) {
      return Response.json({ error: 'delete_blocked', blockers }, { status: 409 });
    }

    await db.prepare('DELETE FROM appointments WHERE group_id = ?')
      .bind(target.group_id)
      .run();
    await writeAudit(
      auth.user, 'appointment_deleted', 'appointment_group', target.group_id,
      `Apagou ${target.plan_type === 'single' ? 'o banho avulso' : `o plano com ${plan.results.length} banhos`} de ${appointmentName(target)}`,
      { planType: target.plan_type, sessionsDeleted: plan.results.length },
    );
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
            id, group_id, customer_pet_name, owner_name, dog_name, whatsapp, plan_type, amount_cents, paid,
            scheduled_date, scheduled_time, status, services, session_number,
            total_sessions, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'scheduled', ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), groupId, previous.customer_pet_name, previous.owner_name, previous.dog_name,
          previous.whatsapp, previous.plan_type,
          previous.amount_cents, addDays(nextStart, intervalDays * index), previous.scheduled_time,
          previousSessions[index]?.services ?? previous.services, index + 1, totalSessions, createdAt,
        ),
      ));
      await writeAudit(
        auth.user, 'plan_renewed', 'appointment_group', groupId,
        `Renovou o plano de ${appointmentName(previous)}`,
        { previousGroupId: previous.group_id, planType: previous.plan_type, totalSessions },
      );
    }
  }

  await db.prepare('PRAGMA optimize').run();
  return Response.json({ appointments: await listAppointments() });
}
