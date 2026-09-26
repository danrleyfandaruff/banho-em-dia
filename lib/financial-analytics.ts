import type { PaymentBreakdown } from './payment';
import { dateRange, dayCount, shiftDate, validDate } from './finance-date';

export type FinanceRow = {
  id: string;
  group_id: string;
  client_id: string | null;
  pet_id: string | null;
  owner_name: string;
  dog_name: string;
  plan_type: string;
  paid: boolean;
  amount_cents: number | null;
  payment_method: string;
  payment_details: PaymentBreakdown | string | null;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  services: string[] | string;
  session_number: number;
  created_at: string;
};
export type Receipt = {
  id: string;
  groupId: string;
  clientId: string;
  owner: string;
  pet: string;
  plan: string;
  date: string;
  method: string;
  gross: number;
  base: number;
  fees: number;
  net: number;
  batchId?: string;
};
export type FinanceFilters = {
  start: string;
  end: string;
  plan: string;
  method: string;
};
export const PLAN_LABELS: Record<string, string> = {
  monthly: 'Mensal',
  fortnightly: 'Quinzenal',
  single: 'Avulso',
};
export const METHOD_LABELS: Record<string, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit: 'Débito',
  credit: 'Crédito',
};
export const WEEKDAYS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];
function details(
  value: FinanceRow['payment_details'],
): PaymentBreakdown | null {
  try {
    return typeof value === 'string'
      ? (JSON.parse(value) as PaymentBreakdown)
      : value;
  } catch {
    return null;
  }
}
function services(value: FinanceRow['services']): string[] {
  try {
    const parsed: unknown =
      typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}
export function extractFinancialData(rows: FinanceRow[], today: string) {
  const groups = new Map<string, FinanceRow[]>();
  for (const row of rows) {
    const group = groups.get(row.group_id) ?? [];
    group.push(row);
    groups.set(row.group_id, group);
  }
  const receipts: Receipt[] = [];
  const pending: {
    groupId: string;
    owner: string;
    pet: string;
    plan: string;
    start: string;
    amount: number | null;
    hasPastSession: boolean;
  }[] = [];
  let incomplete = 0;
  for (const [groupId, sessions] of groups) {
    sessions.sort((a, b) => a.session_number - b.session_number);
    const row = sessions[0];
    if (!row.paid && sessions.every((session) => !session.paid)) {
      const start = sessions.reduce(
        (date, session) =>
          session.scheduled_date < date ? session.scheduled_date : date,
        row.scheduled_date,
      );
      pending.push({
        groupId,
        owner: row.owner_name,
        pet: row.dog_name,
        plan: row.plan_type,
        start,
        amount: row.amount_cents,
        hasPastSession: sessions.some(
          (session) => session.scheduled_date <= today,
        ),
      });
      continue;
    }
    const payment = details(row.payment_details);
    const receipt = payment?.receipt;
    // Never guess payment dates from appointment dates or creation timestamps.
    if (
      !payment ||
      !receipt ||
      !validDate(receipt.date) ||
      receipt.date > today ||
      !Object.hasOwn(METHOD_LABELS, receipt.method) ||
      !Number.isSafeInteger(payment.totalCents) ||
      payment.totalCents < 0 ||
      !Number.isSafeInteger(payment.baseCents) ||
      payment.baseCents < 0 ||
      !Number.isInteger(payment.rateBps) ||
      payment.rateBps < 0 ||
      payment.rateBps >= 10000 ||
      sessions.some(
        (session) =>
          !session.paid ||
          details(session.payment_details)?.receipt?.id !== receipt.id ||
          session.amount_cents !== payment.totalCents,
      )
    ) {
      incomplete++;
      continue;
    }
    const fees = Math.round((payment.totalCents * payment.rateBps) / 10000);
    receipts.push({
      id: receipt.id,
      groupId,
      clientId: row.client_id ?? groupId,
      owner: row.owner_name,
      pet: row.dog_name,
      plan: row.plan_type,
      date: receipt.date,
      method: receipt.method,
      gross: payment.totalCents,
      base: payment.baseCents,
      fees,
      net: payment.totalCents - fees,
      batchId: receipt.batchId,
    });
  }
  receipts.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.groupId.localeCompare(b.groupId),
  );
  return { receipts, pending, incomplete };
}
const sum = (items: Receipt[], key: 'gross' | 'base' | 'fees' | 'net') =>
  items.reduce((n, item) => n + item[key], 0);
function totals(items: Receipt[]) {
  const gross = sum(items, 'gross');
  return {
    gross,
    base: sum(items, 'base'),
    fees: sum(items, 'fees'),
    net: sum(items, 'net'),
    count: items.length,
    customers: new Set(items.map((item) => item.clientId)).size,
    ticket: items.length ? Math.round(gross / items.length) : 0,
  };
}
function breakdown(
  items: Receipt[],
  labels: Record<string, string>,
  field: 'method' | 'plan',
) {
  const total = sum(items, 'gross');
  return Object.entries(labels).map(([key, label]) => {
    const selected = items.filter((item) => item[field] === key);
    const value = sum(selected, 'gross');
    return {
      key,
      label,
      value,
      count: selected.length,
      share: total ? (value / total) * 100 : 0,
    };
  });
}
export function analyzeFinance(
  rows: FinanceRow[],
  filters: FinanceFilters,
  today: string,
) {
  const {
    receipts: all,
    pending,
    incomplete,
  } = extractFinancialData(rows, today);
  const days = dayCount(filters.start, filters.end);
  const previousEnd = shiftDate(filters.start, -1);
  const previousStart = shiftDate(previousEnd, 1 - days);
  const matches = (item: Receipt) =>
    (filters.plan === 'all' || item.plan === filters.plan) &&
    (filters.method === 'all' || item.method === filters.method);
  const eligible = all.filter(matches);
  const receipts = eligible.filter(
    (item) => item.date >= filters.start && item.date <= filters.end,
  );
  const previous = eligible.filter(
    (item) => item.date >= previousStart && item.date <= previousEnd,
  );
  const currentTotals = totals(receipts);
  const previousTotals = totals(previous);
  const daily = dateRange(filters.start, filters.end).map((date) => ({
    date,
    gross: 0,
    count: 0,
    completed: 0,
    absent: 0,
  }));
  const byDay = new Map(daily.map((day) => [day.date, day]));
  for (const item of receipts) {
    const day = byDay.get(item.date)!;
    day.gross += item.gross;
    day.count++;
  }
  // Activity has its own date basis; payment method does not apply to attendance.
  const activity = rows.filter(
    (row) =>
      row.scheduled_date >= filters.start &&
      row.scheduled_date <= filters.end &&
      (filters.plan === 'all' || row.plan_type === filters.plan),
  );
  const serviceCounts = new Map<string, number>();
  const hours = new Map<string, number>();
  for (const row of activity) {
    const day = byDay.get(row.scheduled_date)!;
    if (row.status === 'completed') {
      day.completed++;
      for (const service of new Set(services(row.services)))
        serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
    }
    if (row.status === 'absent') day.absent++;
    const hour = row.scheduled_time.slice(0, 2) + ':00';
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }
  const weekdays = WEEKDAYS.map((label, key) => ({
    key,
    label,
    gross: 0,
    count: 0,
    days: 0,
    average: 0,
    completed: 0,
    absent: 0,
  }));
  for (const day of daily) {
    const weekday = weekdays[new Date(`${day.date}T12:00:00Z`).getUTCDay()];
    weekday.days++;
    weekday.gross += day.gross;
    weekday.count += day.count;
    weekday.completed += day.completed;
    weekday.absent += day.absent;
  }
  for (const weekday of weekdays)
    weekday.average = weekday.days
      ? Math.round(weekday.gross / weekday.days)
      : 0;
  const months = new Map<
    string,
    { month: string; gross: number; count: number }
  >();
  for (const item of eligible) {
    const key = item.date.slice(0, 7);
    const month = months.get(key) ?? { month: key, gross: 0, count: 0 };
    month.gross += item.gross;
    month.count++;
    months.set(key, month);
  }
  const monthly = [...months.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const historyStart = monthly[0]?.month ?? today.slice(0, 7);
  // Include zero months so charts do not conceal gaps in the history.
  const monthSeries: typeof monthly = [];
  let month = historyStart;
  const lastMonth = today.slice(0, 7);
  while (month <= lastMonth) {
    monthSeries.push(months.get(month) ?? { month, gross: 0, count: 0 });
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    month = next.toISOString().slice(0, 7);
  }
  const bestMonth = monthly.reduce<(typeof monthly)[number] | null>(
    (best, item) => (!best || item.gross > best.gross ? item : best),
    null,
  );
  const bestDay = daily.reduce<(typeof daily)[number] | null>(
    (best, item) =>
      item.count && (!best || item.gross > best.gross) ? item : best,
    null,
  );
  const bestWeekday = weekdays.reduce<(typeof weekdays)[number] | null>(
    (best, item) =>
      item.count && (!best || item.average > best.average) ? item : best,
    null,
  );
  const customerMap = new Map<
    string,
    {
      id: string;
      name: string;
      gross: number;
      count: number;
      pets: Set<string>;
    }
  >();
  for (const item of receipts) {
    const customer = customerMap.get(item.clientId) ?? {
      id: item.clientId,
      name: item.owner,
      gross: 0,
      count: 0,
      pets: new Set<string>(),
    };
    customer.gross += item.gross;
    customer.count++;
    customer.pets.add(item.pet);
    customerMap.set(item.clientId, customer);
  }
  const customers = [...customerMap.values()]
    .map((item) => ({ ...item, pets: [...item.pets] }))
    .sort((a, b) => b.gross - a.gross);
  // New/returning is based on all payment history, even with a method filter.
  const firstPayments = new Map<string, string>();
  for (const item of all)
    if (
      !firstPayments.has(item.clientId) ||
      item.date < firstPayments.get(item.clientId)!
    )
      firstPayments.set(item.clientId, item.date);
  const returning = customers.filter(
    (customer) => firstPayments.get(customer.id)! < filters.start,
  ).length;
  const open = pending.filter(
    (item) => filters.plan === 'all' || item.plan === filters.plan,
  );
  const openStarted = open.filter(
    (item) => item.start >= filters.start && item.start <= filters.end,
  );
  const knownPending = open.reduce((n, item) => n + (item.amount ?? 0), 0);
  const completed = activity.filter((row) => row.status === 'completed').length;
  const absent = activity.filter((row) => row.status === 'absent').length;
  return {
    filters,
    today,
    previousStart,
    previousEnd,
    days,
    totals: currentTotals,
    previous: previousTotals,
    change: previousTotals.gross
      ? ((currentTotals.gross - previousTotals.gross) / previousTotals.gross) *
        100
      : null,
    daily,
    weekdays,
    monthly: monthSeries,
    bestDay,
    bestMonth,
    bestWeekday,
    methods: breakdown(receipts, METHOD_LABELS, 'method'),
    plans: breakdown(receipts, PLAN_LABELS, 'plan'),
    customers,
    returning,
    newCustomers: customers.length - returning,
    services: [...serviceCounts]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    hours: [...hours]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    activity: {
      count: activity.length,
      completed,
      absent,
      open: activity.length - completed - absent,
      absenceRate:
        completed + absent ? (absent / (completed + absent)) * 100 : 0,
    },
    pending: {
      gross: knownPending,
      count: open.length,
      unknown: open.filter((item) => item.amount === null).length,
      startedInPeriod: openStarted.reduce(
        (n, item) => n + (item.amount ?? 0),
        0,
      ),
      withPastSession: open.filter((item) => item.hasPastSession).length,
      items: open.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 20),
    },
    receipts,
    incomplete,
    historyCount: eligible.length,
    activeDays: daily.filter((day) => day.count > 0).length,
  };
}
export type FinanceReport = ReturnType<typeof analyzeFinance>;
export function csvReceipts(receipts: Receipt[]) {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const currency = (value: number) =>
    (value / 100).toFixed(2).replace('.', ',');
  return (
    '\ufeff' +
    [
      [
        'Data do recebimento',
        'Tutor',
        'Pet',
        'Plano',
        'Forma',
        'Valor base (R$)',
        'Recebido bruto (R$)',
        'Taxa estimada (R$)',
        'Líquido estimado (R$)',
        'Identificador do plano',
      ],
      ...receipts.map((item) => [
        item.date,
        item.owner,
        item.pet,
        PLAN_LABELS[item.plan],
        METHOD_LABELS[item.method],
        currency(item.base),
        currency(item.gross),
        currency(item.fees),
        currency(item.net),
        item.groupId,
      ]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  );
}
