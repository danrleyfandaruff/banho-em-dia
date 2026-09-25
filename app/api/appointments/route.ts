import { requireAuthorized, writeAudit } from '@/lib/auth';
import { calculatePayment, cardRateBps, type PaymentBreakdown } from '@/lib/payment';
import { getCardRates } from '@/lib/payment-rates';
import { createSupabaseAdmin } from '@/lib/supabase';

type AppointmentRow = {
  id: string;
  group_id: string;
  customer_pet_name: string;
  owner_name: string;
  dog_name: string;
  whatsapp: string;
  cpf: string;
  payment_method: string;
  payment_details: PaymentBreakdown | string | null;
  plan_type: string;
  amount_cents: number | null;
  paid: boolean;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  services: string[] | string;
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

function parsePaymentDetails(value: AppointmentRow['payment_details']): PaymentBreakdown | null {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value) as PaymentBreakdown; } catch { return null; }
}

function parseServices(value: AppointmentRow['services']) {
  if (Array.isArray(value)) return value.map(String);
  try { return JSON.parse(value) as string[]; } catch { return []; }
}

function mapRow(row: AppointmentRow): Appointment {
  const legacyNames = row.customer_pet_name.split(/\s*\+\s*/);
  return {
    id: row.id,
    groupId: row.group_id,
    customerPetName: row.customer_pet_name,
    ownerName: row.owner_name || (legacyNames.length > 1 ? legacyNames[0] : ''),
    dogName: row.dog_name || (legacyNames.length > 1 ? legacyNames.slice(1).join(' + ') : row.customer_pet_name),
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
    services: parseServices(row.services),
    sessionNumber: row.session_number,
    totalSessions: row.total_sessions,
  };
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function intervalForPlan(planType: string) {
  return planType === 'monthly' ? 7 : planType === 'fortnightly' ? 14 : 0;
}

function appointmentName(row: Pick<AppointmentRow, 'dog_name' | 'owner_name' | 'customer_pet_name'>) {
  return row.dog_name || row.owner_name || row.customer_pet_name || 'agendamento sem nome';
}

function assertNoError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function listAppointments() {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('appointments')
    .select('*')
    .order('scheduled_date')
    .order('scheduled_time')
    .returns<AppointmentRow[]>();
  assertNoError(error);
  return (data ?? []).map(mapRow);
}

async function findAppointment(id: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.from('appointments').select('*').eq('id', id).maybeSingle<AppointmentRow>();
  assertNoError(error);
  return data;
}

async function findPlan(groupId: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('appointments')
    .select('*')
    .eq('group_id', groupId)
    .order('session_number')
    .returns<AppointmentRow[]>();
  assertNoError(error);
  return data ?? [];
}

async function reschedule(target: AppointmentRow, scheduledDate: string, recalculateFutureDates = true) {
  const admin = createSupabaseAdmin();
  const { error } = await admin.from('appointments').update({ scheduled_date: scheduledDate }).eq('id', target.id);
  assertNoError(error);
  if (!recalculateFutureDates) return 0;

  const { data: later, error: laterError } = await admin
    .from('appointments')
    .select('id,session_number')
    .eq('group_id', target.group_id)
    .gt('session_number', target.session_number)
    .order('session_number');
  assertNoError(laterError);
  const intervalDays = intervalForPlan(target.plan_type);
  await Promise.all((later ?? []).map(async (session) => {
    const result = await admin.from('appointments').update({
      scheduled_date: addDays(scheduledDate, intervalDays * (session.session_number - target.session_number)),
    }).eq('id', session.id);
    assertNoError(result.error);
  }));
  return later?.length ?? 0;
}

async function findPlanRenewal(previousGroupId: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from('plan_renewals')
    .select('renewal_group_id,created_at')
    .eq('original_group_id', previousGroupId)
    .maybeSingle<{ renewal_group_id: string; created_at: string }>();
  assertNoError(error);
  return data;
}

export async function GET(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response) return auth.response;
  return Response.json({ appointments: await listAppointments(), rates: await getCardRates() });
}

export async function POST(request: Request) {
  const auth = await requireAuthorized(request);
  if (auth.response || !auth.user) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? 'create');
  const admin = createSupabaseAdmin();

  if (action === 'create') {
    const planType = String(body.planType ?? 'monthly') as Appointment['planType'];
    if (!['monthly', 'fortnightly', 'single'].includes(planType)) {
      return Response.json({ error: 'invalid_plan_type' }, { status: 400 });
    }
    const totalSessions = planType === 'monthly' ? 4 : planType === 'fortnightly' ? 2 : 1;
    const intervalDays = intervalForPlan(planType);
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
    const rows = Array.from({ length: totalSessions }, (_, index) => ({
      id: crypto.randomUUID(),
      group_id: groupId,
      customer_pet_name: [ownerName, dogName].filter(Boolean).join(' + '),
      owner_name: ownerName,
      dog_name: dogName,
      whatsapp: String(body.whatsapp ?? ''),
      cpf: String(body.cpf ?? ''),
      payment_method: paymentMethod,
      payment_details: paymentDetails,
      plan_type: planType,
      amount_cents: storedAmountCents,
      paid: Boolean(body.paid),
      scheduled_date: sessionDates[index],
      scheduled_time: String(body.scheduledTime ?? '09:00'),
      status: sessionCompleted[index] ? 'completed' : 'scheduled',
      services: Array.isArray(sessionServices[index])
        ? sessionServices[index]
        : Array.isArray(body.services) ? body.services : [],
      session_number: index + 1,
      total_sessions: totalSessions,
      created_at: createdAt,
    }));
    const { error } = await admin.from('appointments').insert(rows);
    assertNoError(error);
    await writeAudit(auth.user, 'appointment_created', 'appointment_group', groupId,
      `Criou ${totalSessions === 1 ? 'um banho avulso' : `um plano com ${totalSessions} sessões`} para ${dogName || ownerName || 'cliente sem nome'}`,
      { planType, totalSessions, startDate, paymentMethod, paymentDetails, sessionDates, completedSessions: sessionCompleted.filter(Boolean).length });
  }

  if (action === 'complete_day') {
    const date = String(body.scheduledDate ?? '');
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string'))] : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !ids.length) {
      return Response.json({ error: 'invalid_selection' }, { status: 400 });
    }
    const { data, error } = await admin.from('appointments').update({ status: 'completed' })
      .eq('scheduled_date', date).eq('status', 'scheduled').in('id', ids).select('id');
    assertNoError(error);
    await writeAudit(auth.user, 'appointments_completed', 'appointment_day', date,
      `Concluiu ${data?.length ?? 0} banho(s) do dia ${date}`,
      { scheduledDate: date, ids: (data ?? []).map((item) => item.id) });
  }

  if (action === 'status') {
    const target = await findAppointment(String(body.id ?? ''));
    if (target) {
      const status = String(body.status ?? 'scheduled');
      if (!['scheduled', 'completed', 'absent'].includes(status)) {
        return Response.json({ error: 'invalid_status' }, { status: 400 });
      }
      const { error } = await admin.from('appointments').update({ status }).eq('id', target.id);
      assertNoError(error);
      const labels: Record<string, string> = { scheduled: 'Reabriu', completed: 'Concluiu', absent: 'Registrou falta em' };
      await writeAudit(auth.user, 'appointment_status', 'appointment', target.id,
        `${labels[status]} o atendimento de ${appointmentName(target)}`,
        { from: target.status, to: status, scheduledDate: target.scheduled_date });
    }
  }

  if (action === 'paid' || action === 'payment_method') {
    const row = await findAppointment(String(body.id ?? ''));
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
      const { error } = await admin.from('appointments').update({
        paid,
        payment_method: paymentMethod,
        payment_details: paymentDetails,
        amount_cents: storedAmountCents,
      }).eq('group_id', row.group_id);
      assertNoError(error);
      await writeAudit(auth.user, 'payment_updated', 'appointment_group', row.group_id,
        `${paid ? 'Confirmou' : 'Desmarcou'} o pagamento ${row.plan_type === 'single' ? 'do banho avulso' : 'do plano'} de ${appointmentName(row)}`,
        { paid, paymentMethod, baseCents, amountCents: storedAmountCents, paymentDetails, appliesToEntirePlan: row.plan_type !== 'single' });
    }
  }

  if (action === 'paid_multiple') {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string'))] : [];
    const paymentMethod = String(body.paymentMethod ?? '');
    if (ids.length < 2 || !['pix', 'cash', 'debit', 'credit'].includes(paymentMethod)) {
      return Response.json({ error: 'invalid_batch_selection' }, { status: 400 });
    }
    const { data: selected, error } = await admin.from('appointments').select('*').in('id', ids).returns<AppointmentRow[]>();
    assertNoError(error);
    const plans = Array.from(new Map((selected ?? []).map((row) => [row.group_id, row])).values());
    if (plans.length < 2 || plans.some((row) => row.plan_type === 'single')) {
      return Response.json({ error: 'invalid_batch_selection' }, { status: 400 });
    }
    if (plans.some((row) => row.paid)) return Response.json({ error: 'batch_already_paid' }, { status: 409 });
    if (plans.some((row) => row.amount_cents === null)) {
      return Response.json({ error: 'batch_amount_required', missing: plans.filter((row) => row.amount_cents === null).map(appointmentName) }, { status: 400 });
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
    let allocated = 0;
    await Promise.all(plans.map(async (row, index) => {
      const baseCents = Number(row.amount_cents);
      const totalCents = index === plans.length - 1
        ? combinedPayment.totalCents - allocated
        : baseTotalCents === 0 ? 0 : Math.floor(combinedPayment.totalCents * baseCents / baseTotalCents);
      allocated += totalCents;
      const details: PaymentBreakdown = { baseCents, rateBps: combinedPayment.rateBps, surchargeCents: totalCents - baseCents, totalCents };
      const result = await admin.from('appointments').update({ paid: true, payment_method: paymentMethod, payment_details: details, amount_cents: totalCents }).eq('group_id', row.group_id);
      assertNoError(result.error);
    }));
    await writeAudit(auth.user, 'payments_updated', 'appointment_groups', crypto.randomUUID(),
      `Confirmou o pagamento conjunto de ${plans.length} planos`,
      { groupIds: plans.map((row) => row.group_id), customers: plans.map(appointmentName), paymentMethod, paymentDetails: combinedPayment });
  }

  if (action === 'move') {
    const target = await findAppointment(String(body.id ?? ''));
    if (target) {
      const scheduledDate = String(body.scheduledDate ?? target.scheduled_date);
      const recalculateFutureDates = body.recalculateFutureDates !== false;
      const updated = await reschedule(target, scheduledDate, recalculateFutureDates);
      await writeAudit(auth.user, 'appointment_moved', 'appointment', target.id,
        `Moveu o atendimento de ${appointmentName(target)} de ${target.scheduled_date} para ${scheduledDate}`,
        { from: target.scheduled_date, to: scheduledDate, futureSessionsUpdated: updated, recalculateFutureDates });
    }
  }

  if (action === 'edit') {
    const id = String(body.id ?? '');
    const row = await findAppointment(id);
    if (row) {
      const ownerName = String(body.ownerName ?? '');
      const dogName = String(body.dogName ?? '');
      const scheduledDate = String(body.scheduledDate ?? row.scheduled_date);
      const recalculateFutureDates = body.recalculateFutureDates !== false;
      const futureSessionsUpdated = await reschedule(row, scheduledDate, recalculateFutureDates);
      const amountCents = body.amountCents === null || body.amountCents === undefined ? null : Number(body.amountCents);
      const groupUpdate = await admin.from('appointments').update({
        customer_pet_name: [ownerName, dogName].filter(Boolean).join(' + '),
        owner_name: ownerName,
        dog_name: dogName,
        whatsapp: String(body.whatsapp ?? ''),
        cpf: String(body.cpf ?? ''),
        payment_method: String(body.paymentMethod ?? ''),
        amount_cents: amountCents,
      }).eq('group_id', row.group_id);
      assertNoError(groupUpdate.error);
      const sessionUpdate = await admin.from('appointments').update({
        scheduled_time: String(body.scheduledTime ?? '09:00'),
        services: Array.isArray(body.services) ? body.services : [],
      }).eq('id', id);
      assertNoError(sessionUpdate.error);
      await writeAudit(auth.user, 'appointment_edited', 'appointment', id,
        `Editou o atendimento de ${dogName || ownerName || appointmentName(row)}`,
        { previousDate: row.scheduled_date, scheduledDate, sessionNumber: row.session_number, futureSessionsUpdated, recalculateFutureDates });
    }
  }

  if (action === 'delete') {
    const target = await findAppointment(String(body.id ?? ''));
    if (!target) return Response.json({ error: 'not_found' }, { status: 404 });
    const plan = await findPlan(target.group_id);
    const completedCount = plan.filter((session) => session.status === 'completed').length;
    const isPaid = plan.some((session) => session.paid);
    const blockers: string[] = [];
    if (completedCount) blockers.push(`${completedCount} ${completedCount === 1 ? 'banho concluído' : 'banhos concluídos'}`);
    if (isPaid) blockers.push('pagamento marcado como pago');
    if (blockers.length) return Response.json({ error: 'delete_blocked', blockers }, { status: 409 });
    const { error } = await admin.from('appointments').delete().eq('group_id', target.group_id);
    assertNoError(error);
    await writeAudit(auth.user, 'appointment_deleted', 'appointment_group', target.group_id,
      `Apagou ${target.plan_type === 'single' ? 'o banho avulso' : `o plano com ${plan.length} banhos`} de ${appointmentName(target)}`,
      { planType: target.plan_type, sessionsDeleted: plan.length });
  }

  if (action === 'renew_info' || action === 'renew') {
    const previousGroupId = String(body.groupId ?? '');
    const previousSessions = await findPlan(previousGroupId);
    const previous = previousSessions.at(-1);
    if (!previous) return Response.json({ error: 'not_found' }, { status: 404 });
    if (previous.plan_type === 'single') return Response.json({ error: 'single_cannot_renew' }, { status: 409 });
    const pendingCount = previousSessions.filter((session) => session.status === 'scheduled').length;
    if (pendingCount) return Response.json({ error: 'plan_incomplete', pendingCount }, { status: 409 });
    const existingRenewal = await findPlanRenewal(previousGroupId);
    const totalSessions = previous.plan_type === 'monthly' ? 4 : 2;
    const intervalDays = intervalForPlan(previous.plan_type);
    const nextStart = addDays(previous.scheduled_date, intervalDays);
    const defaultDates = Array.from({ length: totalSessions }, (_, index) => addDays(nextStart, intervalDays * index));
    if (action === 'renew_info') {
      return Response.json({
        alreadyRenewed: Boolean(existingRenewal),
        renewalGroupId: existingRenewal?.renewal_group_id ?? null,
        renewedAt: existingRenewal?.created_at ?? null,
        dogName: appointmentName(previous),
        planType: previous.plan_type,
        sessionDates: defaultDates,
      });
    }
    if (existingRenewal) {
      return Response.json({ error: 'plan_already_renewed', renewalGroupId: existingRenewal.renewal_group_id }, { status: 409 });
    }
    const requestedDates = Array.isArray(body.sessionDates) ? body.sessionDates.map(String) : [];
    const sessionDates = defaultDates.map((date, index) => /^\d{4}-\d{2}-\d{2}$/.test(requestedDates[index] ?? '') ? requestedDates[index] : date);
    const groupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const reservation = await admin.from('plan_renewals').insert({
      original_group_id: previousGroupId,
      renewal_group_id: groupId,
      created_by: auth.user.id,
      created_at: createdAt,
    });
    if (reservation.error) {
      return Response.json({ error: 'plan_already_renewed' }, { status: 409 });
    }
    const renewalAmount = parsePaymentDetails(previous.payment_details)?.baseCents ?? previous.amount_cents;
    const rows = Array.from({ length: totalSessions }, (_, index) => ({
      id: crypto.randomUUID(),
      group_id: groupId,
      customer_pet_name: previous.customer_pet_name,
      owner_name: previous.owner_name,
      dog_name: previous.dog_name,
      whatsapp: previous.whatsapp,
      cpf: previous.cpf,
      payment_method: '',
      payment_details: null,
      plan_type: previous.plan_type,
      amount_cents: renewalAmount,
      paid: false,
      scheduled_date: sessionDates[index],
      scheduled_time: previous.scheduled_time,
      status: 'scheduled',
      services: parseServices(previousSessions[index]?.services ?? previous.services),
      session_number: index + 1,
      total_sessions: totalSessions,
      created_at: createdAt,
    }));
    const inserted = await admin.from('appointments').insert(rows);
    if (inserted.error) {
      await admin.from('plan_renewals').delete().eq('original_group_id', previousGroupId);
      throw inserted.error;
    }
    await writeAudit(auth.user, 'plan_renewed', 'appointment_group', groupId,
      `Renovou o plano de ${appointmentName(previous)}`,
      { previousGroupId, planType: previous.plan_type, totalSessions, sessionDates });
  }

  return Response.json({ appointments: await listAppointments() });
}
