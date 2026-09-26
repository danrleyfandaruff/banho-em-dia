import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const url = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const datesUrl = url(await compile('../lib/finance-date.ts'));
const source = (await compile('../lib/financial-analytics.ts')).replace(
  "from './finance-date'",
  'from ' + JSON.stringify(datesUrl),
);
const { analyzeFinance, extractFinancialData, csvReceipts } = await import(
  url(source)
);
const { businessDate, validDate } = await import(datesUrl);
const filters = {
  start: '2026-09-01',
  end: '2026-09-30',
  method: 'all',
  plan: 'all',
};
const today = '2026-09-30';
function rows({
  group = 'g1',
  client = 'c1',
  date = '2026-09-05',
  gross = 10000,
  base = gross,
  rate = 0,
  method = 'pix',
  plan = 'monthly',
  paid = true,
  start = '2026-10-01',
  count = 4,
  ...rest
} = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: group + '-' + i,
    group_id: group,
    client_id: client,
    pet_id: group,
    owner_name: 'Ana',
    dog_name: 'Mel',
    plan_type: plan,
    paid,
    amount_cents: gross,
    payment_method: method,
    payment_details: paid
      ? {
          baseCents: base,
          totalCents: gross,
          rateBps: rate,
          surchargeCents: gross - base,
          receipt: {
            id: 'r-' + group,
            date,
            method,
            recordedAt: date + 'T12:00:00Z',
          },
        }
      : null,
    scheduled_date: start,
    scheduled_time: '09:00',
    status: 'scheduled',
    services: ['Banho', 'Tosa'],
    session_number: i + 1,
    created_at: '2026-09-01T12:00:00Z',
    ...rest,
  }));
}

test('monthly plans count once in payment month, even with sessions in another month', () => {
  const report = analyzeFinance(rows(), filters, today);
  assert.equal(report.totals.gross, 10000);
  assert.equal(report.totals.count, 1);
  assert.equal(report.activity.count, 0);
  assert.equal(report.bestDay.date, '2026-09-05');
  assert.equal(
    analyzeFinance(
      rows(),
      { ...filters, start: '2026-10-01', end: '2026-10-31' },
      '2026-10-31',
    ).totals.gross,
    0,
  );
});

test('comparisons include equal-length windows and do not invent percentages when previous receipts are zero', () => {
  const report = analyzeFinance(
    [...rows(), ...rows({ group: 'prev', date: '2026-08-10', gross: 5000 })],
    filters,
    today,
  );
  assert.equal(report.previousStart, '2026-08-02');
  assert.equal(report.previousEnd, '2026-08-31');
  assert.equal(report.change, 100);
  const zero = analyzeFinance([], filters, today);
  assert.equal(zero.change, null);
  assert.equal(zero.bestDay, null);
  assert.equal(zero.bestWeekday, null);
  assert.equal(zero.totals.ticket, 0);
});

test('weekly averages include zero dates and divide by actual weekday occurrences', () => {
  const input = [
    ...rows({ group: 'm', date: '2026-09-07', gross: 20000 }),
    ...rows({ group: 't', date: '2026-09-01', gross: 20000 }),
  ];
  const report = analyzeFinance(input, filters, today);
  assert.equal(report.weekdays[1].days, 4);
  assert.equal(report.weekdays[1].average, 5000);
  assert.equal(report.weekdays[2].days, 5);
  assert.equal(report.weekdays[2].average, 4000);
  assert.equal(report.bestWeekday.label, 'Segunda');
});

test('best month considers history and includes zero months, while period and method filters stay scoped', () => {
  const input = [
    ...rows({ group: 'jan', date: '2026-01-05', gross: 50000, method: 'cash' }),
    ...rows(),
    ...rows({ group: 'aug', date: '2026-08-10', gross: 20000 }),
  ];
  const report = analyzeFinance(input, filters, today);
  assert.equal(report.bestMonth.month, '2026-01');
  assert.equal(report.totals.gross, 10000);
  assert.equal(report.monthly.length, 9);
  assert.equal(report.monthly[1].gross, 0);
  assert.equal(
    analyzeFinance(input, { ...filters, method: 'pix' }, today).bestMonth.month,
    '2026-08',
  );
});

test('one tutor with two pets is counted once; recurrence checks all methods before period', () => {
  const input = [
    ...rows(),
    ...rows({ group: 'g2', gross: 5000 }),
    ...rows({ group: 'old', date: '2026-08-01', method: 'cash' }),
  ];
  const report = analyzeFinance(input, { ...filters, method: 'pix' }, today);
  assert.equal(report.totals.customers, 1);
  assert.equal(report.returning, 1);
  assert.equal(report.newCustomers, 0);
  assert.equal(report.totals.ticket, 7500);
  assert.equal(report.customers[0].gross, 15000);
});

test('pending values deduplicate sessions, distinguish unknown amounts and ignore payment method filter', () => {
  const input = [
    ...rows({ paid: false, start: '2026-09-02' }),
    ...rows({ group: 'missing', paid: false, amount_cents: null }),
  ];
  const report = analyzeFinance(input, { ...filters, method: 'cash' }, today);
  assert.equal(report.pending.gross, 10000);
  assert.equal(report.pending.count, 2);
  assert.equal(report.pending.unknown, 1);
  assert.equal(report.pending.startedInPeriod, 10000);
  assert.equal(report.pending.withPastSession, 1);
});

test('missing or inconsistent receipts are excluded, never dated from an appointment', () => {
  const input = [
    ...rows({ group: 'legacy', payment_details: null }),
    ...rows({ group: 'mixed' }),
  ];
  input[7].paid = false;
  const data = extractFinancialData(input, today);
  assert.equal(data.receipts.length, 0);
  assert.equal(data.incomplete, 2);
});

test('service frequency counts completed appointments and attendance ignores receipt-method filter', () => {
  const input = rows({ start: '2026-09-10' });
  input[0].status = 'completed';
  input[0].services = ['Banho', 'Banho', 'Tosa'];
  input[1].status = 'absent';
  const report = analyzeFinance(input, { ...filters, method: 'cash' }, today);
  assert.equal(report.totals.count, 0);
  assert.equal(report.activity.completed, 1);
  assert.equal(report.activity.absent, 1);
  assert.equal(report.activity.absenceRate, 50);
  assert.equal(report.services.find((item) => item.label === 'Banho').count, 1);
});

test('fees use historical rate and CSV preserves cents, escapes formulas and quotes', () => {
  const report = analyzeFinance(
    rows({
      gross: 10318,
      base: 10000,
      rate: 308,
      method: 'credit',
      owner_name: '=2+2',
      dog_name: 'M"el',
    }),
    filters,
    today,
  );
  assert.equal(report.totals.fees, 318);
  assert.equal(report.totals.net, 10000);
  const csv = csvReceipts(report.receipts);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"\'=2+2"'));
  assert.ok(csv.includes('"M""el"'));
  assert.ok(csv.includes('"103,18"'));
});

test('calendar validation and business timezone handle midnight, leap dates and year boundaries', () => {
  assert.equal(businessDate(new Date('2026-10-01T02:59:00Z')), '2026-09-30');
  assert.equal(businessDate(new Date('2026-10-01T03:00:00Z')), '2026-10-01');
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  const report = analyzeFinance(
    [],
    { ...filters, start: '2026-01-01', end: '2026-01-01' },
    today,
  );
  assert.equal(report.previousStart, '2025-12-31');
  assert.equal(report.days, 1);
});

const routeSource = await compile('../app/api/analytics/route.ts');
async function apiFixture(data, { status = 200 } = {}) {
  const mock =
    url(`export const requireAdmin=async()=>(${status === 200 ? "{user:{role:'admin'},response:null}" : `{response:Response.json({error:'access_denied'},{status:${status}})}`});
    export let reads=0;
    const rows=${JSON.stringify(data)};
    export const createSupabaseAdmin=()=>({from(){reads++;let start=0,end=999;const q={select(){return q},order(){return q},range(a,b){start=a;end=b;return q},overrideTypes:async()=>({data:rows.slice(start,end+1),error:null})};return q}});`);
  const route = url(
    routeSource.replace(
      /from (['"])(@\/lib\/[^'"]+)\1/g,
      (_, q, name) =>
        'from ' +
        JSON.stringify(
          name === '@/lib/financial-analytics'
            ? url(source)
            : name === '@/lib/finance-date'
              ? datesUrl
              : mock,
        ),
    ),
  );
  return { ...(await import(route)), mock: await import(mock) };
}

test('analytics API rejects unauthorized users before querying financial data', async () => {
  for (const status of [401, 403]) {
    const f = await apiFixture([], { status });
    const response = await f.GET(new Request('http://localhost/api/analytics'));
    assert.equal(response.status, status);
    assert.equal(f.mock.reads, 0);
  }
});

test('analytics API loads beyond Supabase 1000-row limit; pagination and CSV preserve all receipts', async () => {
  const data = Array.from({ length: 260 }, (_, i) =>
    rows({ group: 'plan' + i, date: '2026-01-05', gross: 100 }),
  ).flat();
  const f = await apiFixture(data);
  const query = 'start=2026-01-01&end=2026-01-31';
  let response = await f.GET(
    new Request('http://localhost/api/analytics?' + query),
  );
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(f.mock.reads, 2);
  assert.equal(report.totals.gross, 26000);
  assert.equal(report.receipts.length, 25);
  assert.equal(report.pagination.total, 260);
  response = await f.GET(
    new Request('http://localhost/api/analytics?' + query + '&page=11'),
  );
  assert.equal((await response.json()).receipts.length, 10);
  response = await f.GET(
    new Request('http://localhost/api/analytics?' + query + '&format=csv'),
  );
  assert.equal((await response.text()).split('\r\n').length, 261);
});

test('analytics API rejects inverted, too long or future ranges before loading data', async () => {
  const f = await apiFixture([]);
  for (const query of [
    'start=2026-02-30',
    'start=2026-01-20&end=2026-01-01',
    'start=2020-01-01&end=2026-01-01',
    'end=2999-01-01',
    'method=bad',
  ]) {
    const response = await f.GET(
      new Request('http://localhost/api/analytics?' + query),
    );
    assert.equal(response.status, 400);
  }
  assert.equal(f.mock.reads, 0);
});
