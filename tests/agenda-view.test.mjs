import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Load the pure TypeScript helpers on the project's Node 20 runtime.
const source = await readFile(
  new URL('../lib/agenda-view.ts', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const { periodDays, movePeriod, filterAgenda, clientVisits, matchesSearch } =
  await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  );
const appointment = (overrides = {}) => ({
  id: 'a',
  petId: 'pet-1',
  dogName: 'Mel',
  ownerName: 'João',
  whatsapp: '(47) 99999-1234',
  cpf: '123.456.789-00',
  scheduledDate: '2026-09-25',
  scheduledTime: '09:00',
  status: 'scheduled',
  paid: false,
  services: ['Banho'],
  ...overrides,
});

test('daily, weekly and monthly windows include year and leap-month boundaries', () => {
  assert.deepEqual(periodDays('2026-09-25', 'day'), ['2026-09-25']);
  assert.deepEqual(periodDays('2027-01-01', 'week'), [
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  assert.equal(periodDays('2024-02-12', 'month').length, 29);
  assert.equal(periodDays('2026-02-12', 'month').length, 28);
  assert.equal(movePeriod('2026-01-31', 'month', 1), '2026-02-01');
  assert.equal(movePeriod('2026-12-31', 'day', 1), '2027-01-01');
  assert.equal(movePeriod('2026-12-28', 'week', 1), '2027-01-04');
});

test('status and payment filters combine independently and preserve chronological order', () => {
  const items = [
    appointment({ id: 'late', scheduledTime: '15:00', status: 'completed' }),
    appointment({ id: 'paid', paid: true, status: 'completed' }),
    appointment({ id: 'early', scheduledTime: '08:00', status: 'completed' }),
    appointment({ id: 'absent', status: 'absent' }),
  ];
  assert.deepEqual(
    filterAgenda(items, '', 'completed', true).map((x) => x.id),
    ['early', 'late'],
  );
  assert.deepEqual(
    filterAgenda(items, '', 'absent', false).map((x) => x.id),
    ['absent'],
  );
  assert.equal(filterAgenda(items, 'Joao', 'all', true).length, 3);
  assert.equal(filterAgenda(items, 'inexistente', 'all', false).length, 0);
});

test('search accepts accents, formatted identifiers and services', () => {
  const item = appointment();
  assert.ok(matchesSearch(item, ' JOAO '));
  assert.ok(matchesSearch(item, '47999991234'));
  assert.ok(matchesSearch(item, '12345678900'));
  assert.ok(matchesSearch(item, 'banho'));
  assert.equal(matchesSearch(item, 'Bob 123'), false);
});

test('client summary ignores missed visits and completed future sessions', () => {
  const items = [
    appointment({
      id: 'last',
      scheduledDate: '2026-09-20',
      status: 'completed',
    }),
    appointment({
      id: 'missed',
      scheduledDate: '2026-09-24',
      status: 'absent',
    }),
    appointment({ id: 'next', scheduledDate: '2026-09-28' }),
    appointment({
      id: 'future-complete',
      scheduledDate: '2026-10-02',
      status: 'completed',
    }),
    appointment({ id: 'other-pet', petId: 'pet-2', status: 'completed' }),
  ];
  const visits = clientVisits(
    items,
    { petId: 'pet-1', dogName: 'Mel', ownerName: 'João', whatsapp: '' },
    '2026-09-25',
  );
  assert.equal(visits.last.id, 'last');
  assert.equal(visits.next.id, 'next');
});

test('same-name pets stay separate by ID and legacy records match their tutor', () => {
  const items = [
    appointment({ petId: null, id: 'legacy', status: 'completed' }),
    appointment({ petId: 'pet-2', id: 'another', status: 'completed' }),
    appointment({
      petId: null,
      id: 'other-tutor',
      ownerName: 'Maria',
      whatsapp: '11999990000',
      status: 'completed',
    }),
  ];
  const visits = clientVisits(
    items,
    { petId: 'pet-1', dogName: 'Mel', ownerName: 'João', whatsapp: '' },
    '2026-09-25',
  );
  assert.equal(visits.last.id, 'legacy');
  assert.equal(visits.next, undefined);
});
