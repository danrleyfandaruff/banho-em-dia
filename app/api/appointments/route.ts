import { env } from 'cloudflare:workers';
import { requireAuthorized, writeAudit } from '@/lib/auth';
import { calculatePayment, cardRateBps, type PaymentBreakdown } from '@/lib/payment';
import { getCardRates } from '@/lib/payment-rates';

type AppointmentRow = {
  id: string;
  group_id: string;
  customer_pet_name: string;
  owner_name: string;
  dog_name: string;
  whatsapp: string;
  cpf: string;
  payment_method: string;
  payment_details: string | null;
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
  cpf: string;
  paymentMethod: '' | 'pix' | 'cash' | 'debit' | 'credit';
  paymentDetails: PaymentBreakdown | null;
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

function parsePaymentDetails(value: string | null): PaymentBreakdown | null {
  if (!value) return null;
  try { return JSON.parse(value) as PaymentBreakdown; }
  catch { return null; }
}

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
    cpf: row.cpf || '',
    paymentMethod: (row.payment_method || '') as Appointment['paymentMethod'],
    paymentDetails: parsePaymentDetails(row.payment_details),
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
      cpf TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT '',
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
  if (!columnNames.has('cpf')) alterations.push(db.prepare("ALTER TABLE appointments ADD COLUMN cpf TEXT NOT NULL DEFAULT ''"));
  if (!columnNames.has('payment_method')) alterations.push(db.prepare("ALTER TABLE appointments ADD COLUMN payment_method TEXT NOT NULL DEFAULT ''"));
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

async function rescheduleStatements(target: AppointmentRow, scheduledDate: string, recalculateFutureDates = true) {
  const later = await futureSessions(target);
  const intervalDays = intervalForPlan(target.plan_type);
  return [
    env.DB.prepare('UPDATE appointments SET scheduled_date = ? WHERE id = ?')
      .bind(scheduledDate, target.id),
    ...(recalculateFutureDates ? later.results.map((session) =>
      env.DB.prepare('UPDATE appointments SET scheduled_date = ? WHERE id = ?')
        .bind(addDays(scheduledDate, intervalDays * (session.session_number - target.session_number)), session.id),
    ) : []),
  ];
}

function appointmentName(row: Pick<AppointmentRow, 'dog_name' | 'owner_name' | 'customer_pet_name'>) {
  return row.dog_name || row.owner_name || row.customer_pet_name || 'agendamento sem nome';
}

async function findPlanRenewal(previousGroupId: string) {
  return env.DB.prepare(
    `SELECT entity_id AS renewal_group_id, created_at
     FROM audit_logs
     WHERE action = 'plan_renewed'
       AND json_extract(metadata, '$.previousGroupId') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).bind(previousGroupId).first<{ renewal_group_id: string; created_at: string }>();
}

export async function GET(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response) return auth.response;
  await ensureSchema();
  return Response.json({ appointments: await listAppointments(), rates: await getCardRates() });
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
    const requestedSessionDates = Array.isArray(body.sessionDates) ? body.sessionDates.map(String) : [];
    const sessionDates = Array.from({ length: totalSessions }, (_, index) =>
      /^\d{4}-\d{2}-\d{2}$/.test(requestedSessionDates[index] ?? '')
        ? requestedSessionDates[index]
        : addDays(startDate, intervalDays * index));
    const amountCents = body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents);
    const sessionServices = Array.isArray(body.sessionServices) ? body.sessionServices : [];
    const sessionCompleted = Array.isArray(body.sessionCompleted) ? body.sessionCompleted.map(Boolean) : [];
    const ownerName = String(body.ownerName ?? '');
    const dogName = String(body.dogName ?? '');
    const whatsapp = String(body.whatsapp ?? '');
    const cpf = String(body.cpf ?? '');
    const paymentMethod = body.paid ? String(body.paymentMethod ?? '') : '';
    const rates = await getCardRates();
    if (body.paid && ['credit', 'debit'].includes(paymentMethod)
      && body.expectedRateBps !== undefined
      && body.expectedRateBps !== cardRateBps(paymentMethod, rates)) {
      return Response.json({ error: 'rates_changed', rates }, { status: 409 });
    }
    if (body.paid && ['credit', 'debit'].includes(paymentMethod) && amountCents === null) {
      return Response.json({ error: 'card_amount_required' }, { status: 400 });
    }
    let paymentDetails: PaymentBreakdown | null;
    try { paymentDetails = body.paid ? calculatePayment(amountCents, paymentMethod, rates) : null; }
    catch { return Response.json({ error: 'invalid_amount' }, { status: 400 }); }
    const storedAmountCents = paymentDetails?.totalCents ?? amountCents;
    const legacyName = [ownerName, dogName].filter(Boolean).join(' + ');
    const statements = Array.from({ length: totalSessions }, (_, index) =>
      db.prepare(
        `INSERT INTO appointments (
          id, group_id, customer_pet_name, owner_name, dog_name, whatsapp, cpf, payment_method, plan_type, amount_cents, paid,
          scheduled_date, scheduled_time, status, services, session_number,
          total_sessions, created_at, payment_details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        groupId,
        legacyName,
        ownerName,
        dogName,
        whatsapp,
        cpf,
        paymentMethod,
        planType,
        storedAmountCents,
        body.paid ? 1 : 0,
        sessionDates[index],
        String(body.scheduledTime ?? '09:00'),
        sessionCompleted[index] ? 'completed' : 'scheduled',
        JSON.stringify(
          Array.isArray(sessionServices[index])
            ? sessionServices[index]
            : Array.isArray(body.services) ? body.services : [],
        ),
        index + 1,
        totalSessions,
        createdAt,
        paymentDetails ? JSON.stringify(paymentDetails) : null,
      ),
    );
    await db.batch(statements);
    await writeAudit(
      auth.user, 'appointment_created', 'appointment_group', groupId,
      `Criou ${totalSessions === 1 ? 'um banho avulso' : `um plano com ${totalSessions} sessões`} para ${dogName || ownerName || 'cliente sem nome'}`,
      {
        planType, totalSessions, startDate, paymentMethod, paymentDetails,
        sessionDates,
        completedSessions: sessionCompleted.filter(Boolean).length,
      },
    );
  }

  if (action === 'complete_day') {
    const date = String(body.scheduledDate ?? '');
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string'))] : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ids.length) {
      return Response.json({ error: 'invalid_selection' }, { status: 400 });
    }
    // Scope the update by both date and status, even if a selection has become stale.
    const completed = await db.prepare(`UPDATE appointments SET status = 'completed'
      WHERE scheduled_date = ? AND status = 'scheduled'
      AND id IN (SELECT value FROM json_each(?)) RETURNING id`)
      .bind(date, JSON.stringify(ids)).all<{ id: string }>();
    await writeAudit(auth.user, 'appointments_completed', 'appointment_day', date,
      `Concluiu ${completed.results.length} banho(s) do dia ${date}`,
      { scheduledDate: date, ids: completed.results.map((item) => item.id) });
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

  if (action === 'paid' || action === 'payment_method') {
    const row = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    if (row) {
      const paid = action === 'payment_method' ? Boolean(row.paid) : Boolean(body.paid);
      const paymentMethod = paid ? String(body.paymentMethod ?? row.payment_method ?? '') : '';
      const previousPaymentDetails = parsePaymentDetails(row.payment_details);
      const rates = await getCardRates();
      if (paid && ['credit', 'debit'].includes(paymentMethod)
        && body.expectedRateBps !== undefined
        && body.expectedRateBps !== cardRateBps(paymentMethod, rates)) {
        return Response.json({ error: 'rates_changed', rates }, { status: 409 });
      }
      if (paid && !['pix', 'cash', 'debit', 'credit'].includes(paymentMethod)) {
        return Response.json({ error: 'invalid_payment_method' }, { status: 400 });
      }
      const baseCents = paid
        ? body.amountCents !== undefined
          ? body.amountCents === null ? null : Number(body.amountCents)
          : previousPaymentDetails?.baseCents ?? row.amount_cents
        : null;
      if (paid && ['credit', 'debit'].includes(paymentMethod) && baseCents === null) {
        return Response.json({ error: 'card_amount_required' }, { status: 400 });
      }
      let paymentDetails: PaymentBreakdown | null;
      try { paymentDetails = paid ? calculatePayment(baseCents, paymentMethod, rates) : null; }
      catch { return Response.json({ error: 'invalid_amount' }, { status: 400 }); }
      const storedAmountCents = paid
        ? paymentDetails?.totalCents ?? baseCents
        : previousPaymentDetails?.baseCents ?? row.amount_cents;
      await db.prepare('UPDATE appointments SET paid = ?, payment_method = ?, payment_details = ?, amount_cents = ? WHERE group_id = ?')
        .bind(paid ? 1 : 0, paymentMethod, paymentDetails ? JSON.stringify(paymentDetails) : null, storedAmountCents, row.group_id)
        .run();
      await writeAudit(
        auth.user, 'payment_updated', 'appointment_group', row.group_id,
        `${paid ? 'Confirmou' : 'Desmarcou'} o pagamento ${row.plan_type === 'single' ? 'do banho avulso' : 'do plano'} de ${appointmentName(row)}${paymentDetails ? ` · total ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(paymentDetails.totalCents / 100)}${paymentDetails.rateBps ? ` (Stone ${paymentDetails.rateBps / 100}%)` : ''}` : ''}`,
        {
          paid,
          paymentMethod,
          baseCents,
          amountCents: storedAmountCents,
          paymentDetails,
          appliesToEntirePlan: row.plan_type !== 'single',
        },
      );
    }
  }

  if (action === 'paid_multiple') {
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string'))]
      : [];
    const paymentMethod = String(body.paymentMethod ?? '');
    if (ids.length < 2 || !['pix', 'cash', 'debit', 'credit'].includes(paymentMethod)) {
      return Response.json({ error: 'invalid_batch_selection' }, { status: 400 });
    }

    const selectedRows = await db.prepare(
      'SELECT * FROM appointments WHERE id IN (SELECT value FROM json_each(?))',
    ).bind(JSON.stringify(ids)).all<AppointmentRow>();
    const plans = Array.from(
      new Map(selectedRows.results.map((row) => [row.group_id, row])).values(),
    );
    if (plans.length < 2 || plans.some((row) => row.plan_type === 'single')) {
      return Response.json({ error: 'invalid_batch_selection' }, { status: 400 });
    }
    if (plans.some((row) => Boolean(row.paid))) {
      return Response.json({ error: 'batch_already_paid' }, { status: 409 });
    }
    if (plans.some((row) => row.amount_cents === null)) {
      return Response.json({
        error: 'batch_amount_required',
        missing: plans.filter((row) => row.amount_cents === null).map(appointmentName),
      }, { status: 400 });
    }

    const rates = await getCardRates();
    if (['credit', 'debit'].includes(paymentMethod)
      && body.expectedRateBps !== undefined
      && body.expectedRateBps !== cardRateBps(paymentMethod, rates)) {
      return Response.json({ error: 'rates_changed', rates }, { status: 409 });
    }

    const baseTotalCents = plans.reduce((sum, row) => sum + Number(row.amount_cents), 0);
    let combinedPayment: PaymentBreakdown | null;
    try { combinedPayment = calculatePayment(baseTotalCents, paymentMethod, rates); }
    catch { return Response.json({ error: 'invalid_amount' }, { status: 400 }); }
    if (!combinedPayment) return Response.json({ error: 'invalid_amount' }, { status: 400 });

    let allocatedTotalCents = 0;
    const statements = plans.map((row, index) => {
      const baseCents = Number(row.amount_cents);
      const totalCents = index === plans.length - 1
        ? combinedPayment.totalCents - allocatedTotalCents
        : baseTotalCents === 0 ? 0 : Math.floor(combinedPayment.totalCents * baseCents / baseTotalCents);
      allocatedTotalCents += totalCents;
      const paymentDetails: PaymentBreakdown = {
        baseCents,
        rateBps: combinedPayment.rateBps,
        surchargeCents: totalCents - baseCents,
        totalCents,
      };
      return db.prepare(
        'UPDATE appointments SET paid = 1, payment_method = ?, payment_details = ?, amount_cents = ? WHERE group_id = ?',
      ).bind(paymentMethod, JSON.stringify(paymentDetails), totalCents, row.group_id);
    });
    await db.batch(statements);
    await writeAudit(
      auth.user, 'payments_updated', 'appointment_groups', crypto.randomUUID(),
      `Confirmou o pagamento conjunto de ${plans.length} planos · total ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(combinedPayment.totalCents / 100)}${combinedPayment.rateBps ? ` (Stone ${combinedPayment.rateBps / 100}%)` : ''}`,
      {
        groupIds: plans.map((row) => row.group_id),
        customers: plans.map(appointmentName),
        paymentMethod,
        paymentDetails: combinedPayment,
      },
    );
  }

  if (action === 'move') {
    const target = await db.prepare('SELECT * FROM appointments WHERE id = ?')
      .bind(String(body.id ?? ''))
      .first<AppointmentRow>();
    if (target) {
      const scheduledDate = String(body.scheduledDate ?? target.scheduled_date);
      const recalculateFutureDates = body.recalculateFutureDates !== false;
      const statements = await rescheduleStatements(target, scheduledDate, recalculateFutureDates);
      await db.batch(statements);
      await writeAudit(
        auth.user, 'appointment_moved', 'appointment', target.id,
        `Moveu o atendimento de ${appointmentName(target)} de ${target.scheduled_date} para ${scheduledDate}`,
        { from: target.scheduled_date, to: scheduledDate, futureSessionsUpdated: statements.length - 1, recalculateFutureDates },
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
      const recalculateFutureDates = body.recalculateFutureDates !== false;
      const dateStatements = await rescheduleStatements(row, scheduledDate, recalculateFutureDates);
      const amountCents = body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents);
      await db.batch([
        db.prepare(
          'UPDATE appointments SET customer_pet_name = ?, owner_name = ?, dog_name = ?, whatsapp = ?, cpf = ?, payment_method = ? WHERE group_id = ?',
        ).bind(
          [ownerName, dogName].filter(Boolean).join(' + '),
          ownerName,
          dogName,
          String(body.whatsapp ?? ''),
          String(body.cpf ?? ''),
          String(body.paymentMethod ?? ''),
          row.group_id,
        ),
        db.prepare(
          'UPDATE appointments SET scheduled_time = ?, services = ? WHERE id = ?',
        ).bind(
          String(body.scheduledTime ?? '09:00'),
          JSON.stringify(Array.isArray(body.services) ? body.services : []),
          id,
        ),
        db.prepare('UPDATE appointments SET amount_cents = ? WHERE group_id = ?')
          .bind(amountCents, row.group_id),
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
          recalculateFutureDates,
          paymentMethod: String(body.paymentMethod ?? ''),
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

  if (action === 'renew_info') {
    const previousGroupId = String(body.groupId ?? '');
    const previousPlan = await db.prepare(
      'SELECT * FROM appointments WHERE group_id = ? ORDER BY session_number ASC',
    ).bind(previousGroupId).all<AppointmentRow>();
    const previousSessions = previousPlan.results;
    const previous = previousSessions.at(-1);
    if (!previous) return Response.json({ error: 'not_found' }, { status: 404 });
    if (previous.plan_type === 'single') {
      return Response.json({ error: 'single_cannot_renew' }, { status: 409 });
    }
    const pendingCount = previousSessions.filter((session) => session.status === 'scheduled').length;
    if (pendingCount) {
      return Response.json({ error: 'plan_incomplete', pendingCount }, { status: 409 });
    }
    const existingRenewal = await findPlanRenewal(previousGroupId);
    const totalSessions = previous.plan_type === 'monthly' ? 4 : 2;
    const intervalDays = previous.plan_type === 'monthly' ? 7 : 14;
    const nextStart = addDays(previous.scheduled_date, intervalDays);
    return Response.json({
      alreadyRenewed: Boolean(existingRenewal),
      renewalGroupId: existingRenewal?.renewal_group_id ?? null,
      renewedAt: existingRenewal?.created_at ?? null,
      dogName: appointmentName(previous),
      planType: previous.plan_type,
      sessionDates: Array.from({ length: totalSessions }, (_, index) => addDays(nextStart, intervalDays * index)),
    });
  }

  if (action === 'renew') {
    const previousGroupId = String(body.groupId ?? '');
    const previousPlan = await db.prepare(
      'SELECT * FROM appointments WHERE group_id = ? ORDER BY session_number ASC',
    ).bind(previousGroupId).all<AppointmentRow>();
    const previousSessions = previousPlan.results;
    const previous = previousSessions.at(-1);
    if (!previous) return Response.json({ error: 'not_found' }, { status: 404 });
    if (previous.plan_type === 'single') {
      return Response.json({ error: 'single_cannot_renew' }, { status: 409 });
    }
    const pendingCount = previousSessions.filter((session) => session.status === 'scheduled').length;
    if (pendingCount) {
      return Response.json({ error: 'plan_incomplete', pendingCount }, { status: 409 });
    }
    const existingRenewal = await findPlanRenewal(previousGroupId);
    if (existingRenewal) {
      return Response.json({
        error: 'plan_already_renewed',
        renewalGroupId: existingRenewal.renewal_group_id,
      }, { status: 409 });
    }
    const totalSessions = previous.plan_type === 'monthly' ? 4 : 2;
    const intervalDays = previous.plan_type === 'monthly' ? 7 : 14;
    const nextStart = addDays(previous.scheduled_date, intervalDays);
    const requestedSessionDates = Array.isArray(body.sessionDates) ? body.sessionDates.map(String) : [];
    const sessionDates = Array.from({ length: totalSessions }, (_, index) =>
      /^\d{4}-\d{2}-\d{2}$/.test(requestedSessionDates[index] ?? '')
        ? requestedSessionDates[index]
        : addDays(nextStart, intervalDays * index));
    const groupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const renewalAmountCents = parsePaymentDetails(previous.payment_details)?.baseCents ?? previous.amount_cents;
    await db.batch(Array.from({ length: totalSessions }, (_, index) =>
      db.prepare(
        `INSERT INTO appointments (
          id, group_id, customer_pet_name, owner_name, dog_name, whatsapp, cpf, payment_method, plan_type, amount_cents, paid,
          scheduled_date, scheduled_time, status, services, session_number,
          total_sessions, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'scheduled', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), groupId, previous.customer_pet_name, previous.owner_name, previous.dog_name,
        previous.whatsapp, previous.cpf, previous.payment_method, previous.plan_type,
        renewalAmountCents, sessionDates[index], previous.scheduled_time,
        previousSessions[index]?.services ?? previous.services, index + 1, totalSessions, createdAt,
      ),
    ));
    await writeAudit(
      auth.user, 'plan_renewed', 'appointment_group', groupId,
      `Renovou o plano de ${appointmentName(previous)}`,
      { previousGroupId: previous.group_id, planType: previous.plan_type, totalSessions, sessionDates },
    );
  }

  await db.prepare('PRAGMA optimize').run();
  return Response.json({ appointments: await listAppointments() });
}
