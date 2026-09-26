import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const validation = moduleUrl(
  await compile('../lib/registration-validation.ts'),
);
const payment = moduleUrl(await compile('../lib/payment.ts'));
const financeDate = moduleUrl(await compile('../lib/finance-date.ts'));
const paymentRecord = moduleUrl(
  (await compile('../lib/payment-record.ts'))
    .replace("from './payment'", 'from ' + JSON.stringify(payment))
    .replace("from './finance-date'", 'from ' + JSON.stringify(financeDate)),
);
const appointmentServices = moduleUrl(
  await compile('../lib/appointment-services.ts'),
);
const extraSource = await compile('../lib/extra-services.ts');
const registrySource = await compile('../lib/pet-registry.ts');
const routeSource = await compile('../app/api/appointments/route.ts');
let sequence = 0;
async function fixture() {
  const mock = moduleUrl(`
    // isolated fixture ${sequence++}
    export const db = {
      clients: [{id:'client',owner_name:'Ana',whatsapp:'48999993916',cpf:''}],
      pets: [{id:'pet',client_id:'client',name:'Mel',notes:'Cuidado',favorite_services:['Banho'],last_time:'10:00',last_amount_cents:9000}],
      appointments: [], plan_renewals: [],
    };
    export const writes = [];
    export const hooks = { beforeWrite: null };
    export const requireAuthorized = async () => ({user:{id:'staff'}});
    export const writeAudit = async () => {};
    export const getCardRates = async () => ({credit:308,debit:87});
    export const createSupabaseAdmin = () => ({from(table) {
      const filters = []; let operation='read',values,range;
      const q = {
        select(){return q}, order(){return q},
        eq(key,value){filters.push(row=>key==='services'?JSON.stringify(row[key])===value:row[key]===value);return q},
        is(key,value){return q.eq(key,value)},
        gt(key,value){filters.push(row=>row[key]>value);return q},
        in(key,values){filters.push(row=>values.includes(row[key]));return q},
        range(start,end){range=[start,end];return q},
        insert(data){operation='insert';values=structuredClone(data);return q},
        update(data){operation='update';values=structuredClone(data);return q},
        delete(){operation='delete';return q},
        run(){
          if(operation!=='read' && hooks.beforeWrite){const hook=hooks.beforeWrite;hooks.beforeWrite=null;hook(table,operation);}
          let data=db[table].filter(row=>filters.every(filter=>filter(row)));
          if(operation!=='read') writes.push({table,operation,values});
          if(operation==='insert'){
            data=Array.isArray(values)?values:[values];
            if(table==='plan_renewals' && data.some(value=>db[table].some(row=>row.original_group_id===value.original_group_id || row.renewal_group_id===value.renewal_group_id))) {
              return {data:null,error:{code:'23505',message:'duplicate renewal'}};
            }
            db[table].push(...data);
          }
          if(operation==='update') data.forEach(row=>Object.assign(row,values));
          if(operation==='delete') db[table]=db[table].filter(row=>!data.includes(row));
          if(range) data=data.slice(range[0],range[1]+1);
          return {data:structuredClone(data),error:null};
        },
        returns(){return Promise.resolve(q.run())},
        overrideTypes(){return Promise.resolve(q.run())},
        maybeSingle(){const result=q.run();return Promise.resolve({...result,data:result.data[0]??null})},
        then(resolve,reject){return Promise.resolve(q.run()).then(resolve,reject)},
      };return q;
    }});
  `);
  const replace = (source) =>
    source.replace(
      /from (['"])(@\/lib\/[^'"]+)\1/g,
      (_, _quote, name) =>
        `from ${JSON.stringify(name === '@/lib/registration-validation' ? validation : name === '@/lib/payment' ? payment : name === '@/lib/pet-registry' ? registry : name === '@/lib/payment-record' ? paymentRecord : name === '@/lib/appointment-services' ? appointmentServices : name === '@/lib/extra-services' ? extras : mock)}`,
    );
  const registry = moduleUrl(replace(registrySource));
  const extras = moduleUrl(
    extraSource.replace(
      /from (['"])(\.\/[^'"]+)\1/g,
      (_, _quote, name) =>
        'from ' +
        JSON.stringify(
          name === './appointment-services'
            ? appointmentServices
            : name === './payment-record'
              ? paymentRecord
              : name === './payment'
                ? payment
                : mock,
        ),
    ),
  );
  return {
    ...(await import(mock)),
    ...(await import(moduleUrl(replace(routeSource)))),
  };
}
const post = (f, body) =>
  f.POST(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const plan = {
  action: 'create',
  petId: 'pet',
  clientId: 'client',
  planType: 'monthly',
  scheduledDate: '2026-10-01',
  scheduledTime: '10:00',
  sessionServices: [['Banho'], ['Tosa'], ['Banho'], ['Hidratação']],
  sessionCompleted: [true, false, false, false],
  amountCents: 12000,
  paid: true,
  paymentMethod: 'credit',
};

test('plans use registered identity and keep sessions and card payment without writing registration', async () => {
  const f = await fixture();
  const before = structuredClone({ clients: f.db.clients, pets: f.db.pets });
  const response = await post(f, {
    ...plan,
    ownerName: 'Intruso',
    dogName: 'Outro',
    whatsapp: '000',
  });
  assert.equal(response.status, 200);
  assert.equal(f.db.appointments.length, 4);
  assert.deepEqual(
    f.db.appointments.map((row) => row.scheduled_date),
    ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'],
  );
  assert.deepEqual(
    f.db.appointments.map((row) => row.services),
    plan.sessionServices,
  );
  assert.deepEqual(
    f.db.appointments.map((row) => row.status),
    ['completed', 'scheduled', 'scheduled', 'scheduled'],
  );
  for (const row of f.db.appointments) {
    assert.equal(row.owner_name, 'Ana');
    assert.equal(row.dog_name, 'Mel');
    assert.equal(row.whatsapp, '48999993916');
    assert.equal(row.payment_details.baseCents, 12000);
    assert.ok(row.amount_cents > 12000);
  }
  assert.deepEqual({ clients: f.db.clients, pets: f.db.pets }, before);
  assert.deepEqual(
    f.writes.map((write) => write.table),
    ['appointments'],
  );
});

test('missing pet and mismatched tutor are rejected before any writes', async () => {
  for (const [body, error] of [
    [{ ...plan, petId: '' }, 'pet_selection_required'],
    [{ ...plan, clientId: 'someone-else' }, 'pet_client_mismatch'],
  ]) {
    const f = await fixture();
    const response = await post(f, body);
    assert.equal((await response.json()).error, error);
    assert.equal(f.writes.length, 0);
  }
});

test('another pet reuses its tutor and cannot modify tutor details', async () => {
  const f = await fixture();
  const response = await post(f, {
    action: 'profile_create',
    clientId: 'client',
    ownerName: 'Fake',
    dogName: 'Lola',
    whatsapp: '000',
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(f.db.clients.length, 1);
  assert.equal(f.db.clients[0].owner_name, 'Ana');
  assert.equal(f.db.clients[0].whatsapp, '48999993916');
  assert.equal(f.db.pets.length, 2);
  assert.equal(f.db.pets[1].client_id, 'client');
  assert.equal(f.db.pets[1].id, data.savedPetId);
  assert.equal(f.db.appointments.length, 0);
  assert.deepEqual(
    f.writes.map((write) => write.table),
    ['pets'],
  );
});

test('registration rejects missing names and duplicate pets or phone numbers', async () => {
  for (const [body, error] of [
    [{ ownerName: ' ', dogName: 'Bob' }, 'owner_name_required'],
    [{ ownerName: 'Bia', dogName: ' ' }, 'pet_name_required'],
    [{ clientId: 'client', dogName: ' mél ' }, 'pet_exists'],
    [
      { ownerName: 'Ana', dogName: 'Lola', whatsapp: '+55 (48) 99999-3916' },
      'client_exists',
    ],
  ]) {
    const f = await fixture();
    const response = await post(f, { action: 'profile_create', ...body });
    assert.equal((await response.json()).error, error);
    assert.equal(f.writes.length, 0);
  }
});

test('editing registration updates displayed identity without modifying appointments or pet preferences', async () => {
  const f = await fixture();
  await post(f, plan);
  f.writes.length = 0;
  const before = structuredClone(f.db.appointments);
  const response = await post(f, {
    action: 'profile_edit',
    petId: 'pet',
    clientId: 'client',
    ownerName: 'Ana Maria',
    dogName: 'Melzinha',
    whatsapp: '48999993916',
    notes: 'Alergia',
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(f.db.appointments, before);
  assert.equal(data.appointments[0].ownerName, 'Ana Maria');
  assert.equal(data.appointments[0].dogName, 'Melzinha');
  assert.deepEqual(f.db.pets[0].favorite_services, ['Banho']);
  assert.equal(f.db.pets[0].last_time, '10:00');
  assert.deepEqual(
    f.writes.map((write) => write.table),
    ['clients', 'pets'],
  );
});

test('pet notes cannot overwrite registration names or contacts', async () => {
  const f = await fixture();
  const response = await post(f, {
    action: 'pet_notes',
    petId: 'pet',
    ownerName: 'Fake',
    dogName: 'Fake',
    whatsapp: '000',
    notes: 'Nova nota',
  });
  assert.equal(response.status, 200);
  assert.equal(f.db.pets[0].notes, 'Nova nota');
  assert.equal(f.db.pets[0].name, 'Mel');
  assert.equal(f.db.clients[0].owner_name, 'Ana');
  assert.deepEqual(
    f.writes.map((write) => write.table),
    ['pets'],
  );
});

test('renewal takes current registry names and preserves services and base price', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  const groupId = f.db.appointments[0].group_id;
  f.db.clients[0].owner_name = 'Ana Maria';
  f.db.pets[0].name = 'Melzinha';
  f.writes.length = 0;
  const response = await post(f, { action: 'renew', groupId });
  assert.equal(response.status, 200);
  const rows = f.db.appointments.slice(4);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => row.services),
    plan.sessionServices,
  );
  for (const row of rows) {
    assert.equal(row.owner_name, 'Ana Maria');
    assert.equal(row.dog_name, 'Melzinha');
    assert.equal(row.paid, false);
    assert.equal(row.amount_cents, 12000);
  }
  assert.ok(
    f.writes.every((write) => !['clients', 'pets'].includes(write.table)),
  );
});

test('legacy completion links only its explicit group and retains payments and sessions', async () => {
  const f = await fixture();
  await post(f, plan);
  for (const row of f.db.appointments) {
    row.pet_id = null;
    row.client_id = null;
  }
  const before = structuredClone(f.db.appointments);
  const source = before[0];
  f.db.appointments.push({ ...source, id: 'unrelated', group_id: 'unrelated' });
  const response = await post(f, {
    action: 'profile_create',
    clientId: 'client',
    dogName: 'Bob',
    sourceAppointmentId: source.id,
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  for (let i = 0; i < 4; i++) {
    const {
      client_id,
      pet_id,
      owner_name,
      dog_name,
      customer_pet_name,
      whatsapp,
      cpf,
      ...rest
    } = f.db.appointments[i];
    assert.equal(pet_id, data.savedPetId);
    assert.deepEqual(
      {
        ...before[i],
        client_id,
        pet_id,
        owner_name,
        dog_name,
        customer_pet_name,
        whatsapp,
        cpf,
      },
      {
        ...rest,
        client_id,
        pet_id,
        owner_name,
        dog_name,
        customer_pet_name,
        whatsapp,
        cpf,
      },
    );
  }
  assert.equal(f.db.appointments[4].pet_id, null);
});

test('editing an appointment cannot overwrite its linked registry identity', async () => {
  const f = await fixture();
  await post(f, plan);
  const before = structuredClone({ clients: f.db.clients, pets: f.db.pets });
  f.writes.length = 0;
  const response = await post(f, {
    action: 'edit',
    id: f.db.appointments[0].id,
    ownerName: 'Fake',
    dogName: 'Fake',
    whatsapp: '000',
    scheduledDate: '2026-10-02',
    scheduledTime: '11:00',
    services: ['Banho'],
    amountCents: 12000,
    recalculateFutureDates: false,
  });
  assert.equal(response.status, 200);
  assert.deepEqual({ clients: f.db.clients, pets: f.db.pets }, before);
  assert.equal(f.db.appointments[0].owner_name, 'Ana');
  assert.equal(f.db.appointments[0].scheduled_date, '2026-10-02');
  assert.equal(f.db.appointments[1].scheduled_date, '2026-10-08');
  assert.ok(f.writes.every((write) => write.table === 'appointments'));
});

test('legacy plans require registration before renewal and reject unnamed edits', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  for (const row of f.db.appointments) {
    row.pet_id = null;
    row.client_id = null;
  }
  f.writes.length = 0;
  const groupId = f.db.appointments[0].group_id;
  for (const action of ['renew', 'renew_info']) {
    const response = await post(f, { action, groupId });
    assert.equal((await response.json()).error, 'pet_selection_required');
  }
  const response = await post(f, {
    action: 'edit',
    id: f.db.appointments[0].id,
    ownerName: ' ',
    dogName: 'Bob',
  });
  assert.equal((await response.json()).error, 'owner_name_required');
  assert.equal(f.writes.length, 0);
});

test('paid plans require a value and record payment date once across every session', async () => {
  const f = await fixture();
  let response = await post(f, {
    ...plan,
    amountCents: null,
    paymentMethod: 'pix',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'payment_amount_required');
  assert.equal(f.writes.length, 0);
  response = await post(f, { ...plan, paymentDate: '2026-02-30' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_payment_date');
  assert.equal(f.writes.length, 0);
  response = await post(f, { ...plan, paymentDate: '2026-02-28' });
  assert.equal(response.status, 200);
  assert.equal(
    new Set(f.db.appointments.map((row) => row.payment_details.receipt.id))
      .size,
    1,
  );
  assert.equal(f.db.appointments[0].payment_details.receipt.date, '2026-02-28');
  assert.equal(f.db.appointments[0].scheduled_date, '2026-10-01');
});

test('rescheduling or editing an appointment preserves its paid amount and receipt; payment correction preserves the date and rate', async () => {
  const f = await fixture();
  await post(f, { ...plan, paymentDate: '2026-01-10' });
  const row = f.db.appointments[0];
  const before = structuredClone(row.payment_details);
  await post(f, {
    action: 'edit',
    id: row.id,
    amountCents: 99999,
    paymentMethod: 'cash',
    scheduledDate: '2026-11-01',
  });
  assert.deepEqual(row.payment_details, before);
  assert.equal(row.amount_cents, before.totalCents);
  assert.equal(row.payment_method, 'credit');
  // Simulate a historical rate different from current settings.
  for (const row of f.db.appointments) row.payment_details.rateBps = 250;
  const response = await post(f, {
    action: 'payment_method',
    id: row.id,
    paymentMethod: 'credit',
    amountCents: 13000,
    expectedRateBps: 308,
  });
  assert.equal(response.status, 200);
  assert.equal(row.payment_details.rateBps, 250);
  assert.equal(row.payment_details.receipt.date, '2026-01-10');
  assert.equal(row.payment_details.receipt.id, before.receipt.id);
  await post(f, { action: 'paid', id: row.id, paid: false });
  assert.equal(row.paid, false);
  assert.equal(row.payment_details, null);
  assert.equal(row.amount_cents, 13000);
});

test('batch payments allocate one charge across plans, store a shared date, and preserve allocated cents on date-only correction', async () => {
  const f = await fixture();
  await post(f, { ...plan, paid: false, amountCents: 10001 });
  await post(f, { ...plan, paid: false, amountCents: 20002 });
  const first = f.db.appointments[0];
  const second = f.db.appointments[4];
  const response = await post(f, {
    action: 'paid_multiple',
    ids: [first.id, second.id],
    paymentMethod: 'credit',
    paymentDate: '2026-03-15',
  });
  assert.equal(response.status, 200);
  const total = Math.ceil((30003 * 10000) / (10000 - 308));
  assert.equal(first.amount_cents + second.amount_cents, total);
  assert.equal(
    first.payment_details.receipt.batchId,
    second.payment_details.receipt.batchId,
  );
  assert.notEqual(
    first.payment_details.receipt.id,
    second.payment_details.receipt.id,
  );
  assert.equal(first.payment_details.receipt.date, '2026-03-15');
  const allocated = first.amount_cents;
  await post(f, {
    action: 'payment_method',
    id: first.id,
    paymentMethod: 'credit',
    amountCents: 10001,
    paymentDate: '2026-03-16',
  });
  assert.equal(first.amount_cents, allocated);
  assert.equal(first.payment_details.receipt.date, '2026-03-16');
});

const extraRequest = (id, overrides = {}) => ({
  action: 'extra_create',
  id,
  extraId: crypto.randomUUID(),
  revision: 0,
  name: 'Tosa bebê',
  amountCents: 5000,
  paid: false,
  paymentMethod: '',
  paymentDate: '2026-08-21',
  ...overrides,
});

test('an extra belongs to one session and leaves the original plan payment untouched; retries do not duplicate it', async () => {
  const f = await fixture();
  await post(f, plan);
  const before = structuredClone(f.db.appointments);
  f.writes.length = 0;
  const body = extraRequest(f.db.appointments[2].id);
  let response = await post(f, body);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.appointments[2].extras.length, 1);
  assert.equal(data.appointments[2].extras[0].paid, false);
  assert.equal(data.appointments[2].servicesRevision, 1);
  assert.deepEqual(data.appointments[2].services, ['Banho']);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(
      { ...f.db.appointments[i], services: before[i].services },
      before[i],
    );
    if (i !== 2)
      assert.deepEqual(f.db.appointments[i].services, before[i].services);
  }
  assert.equal(f.writes.length, 1);
  assert.deepEqual(Object.keys(f.writes[0].values), ['services']);
  response = await post(f, body);
  assert.equal(response.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.db.appointments[2].services.extras.length, 1);
});

test('extra creation validates names, amounts, dates, included services and stale revisions without overwriting', async () => {
  const f = await fixture();
  await post(f, plan);
  const row = f.db.appointments[0];
  f.writes.length = 0;
  for (const [overrides, error] of [
    [{ name: ' ' }, 'invalid_extra'],
    [{ amountCents: null }, 'invalid_extra'],
    [{ amountCents: -1 }, 'invalid_extra'],
    [{ amountCents: 1.5 }, 'invalid_extra'],
    [{ name: ' banho ' }, 'extra_already_included'],
    [
      { paid: true, paymentMethod: 'pix', paymentDate: '2999-01-01' },
      'invalid_payment_date',
    ],
    [
      { paid: true, paymentMethod: 'credit', expectedRateBps: 1 },
      'rates_changed',
    ],
  ]) {
    const response = await post(f, extraRequest(row.id, overrides));
    assert.equal((await response.json()).error, error);
    assert.equal(f.writes.length, 0);
  }
  await post(f, extraRequest(row.id));
  let response = await post(f, extraRequest(row.id, { name: 'Hidratação' }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'extra_conflict');
  response = await post(
    f,
    extraRequest(row.id, { revision: 1, name: 'Tosa bebe' }),
  );
  assert.equal((await response.json()).error, 'extra_duplicate');
  assert.equal(row.services.extras.length, 1);
});

test('extra payment, correction and removal have independent receipts and preserve the plan', async () => {
  const f = await fixture();
  await post(f, plan);
  const row = f.db.appointments[0];
  const original = structuredClone(row.payment_details);
  const body = extraRequest(row.id);
  await post(f, body);
  let response = await post(f, {
    ...body,
    action: 'extra_edit',
    revision: 1,
    paid: true,
    paymentMethod: 'credit',
    expectedRateBps: 308,
  });
  assert.equal(response.status, 200);
  let extra = row.services.extras[0];
  assert.equal(extra.paid, true);
  assert.equal(extra.paymentDetails.receipt.date, '2026-08-21');
  assert.notEqual(extra.paymentDetails.receipt.id, original.receipt.id);
  assert.equal(
    extra.paymentDetails.totalCents,
    Math.ceil((5000 * 10000) / 9692),
  );
  const receiptId = extra.paymentDetails.receipt.id;
  response = await post(f, { ...body, action: 'extra_remove', revision: 2 });
  assert.equal((await response.json()).error, 'extra_paid_delete_blocked');
  response = await post(f, {
    ...body,
    action: 'extra_edit',
    revision: 2,
    paid: true,
    paymentMethod: 'credit',
    expectedRateBps: 308,
    paymentDate: '2026-08-22',
  });
  assert.equal(response.status, 200);
  extra = row.services.extras[0];
  assert.equal(extra.paymentDetails.receipt.id, receiptId);
  assert.equal(extra.paymentDetails.receipt.date, '2026-08-22');
  await post(f, { ...body, action: 'extra_unpay', revision: 3 });
  assert.equal(row.services.extras[0].paid, false);
  assert.equal(row.services.extras[0].paymentDetails, null);
  assert.deepEqual(row.payment_details, original);
  assert.equal(row.paid, true);
  response = await post(f, { ...body, action: 'extra_remove', revision: 4 });
  assert.equal(response.status, 200);
  assert.equal(row.services.extras.length, 0);
  assert.deepEqual(row.payment_details, original);
});

test('editing services and moving a session preserves extras; renewal copies only included services', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  const row = f.db.appointments[3];
  const body = extraRequest(row.id);
  await post(f, body);
  const originalExtra = structuredClone(row.services.extras[0]);
  const response = await post(f, {
    action: 'edit',
    id: row.id,
    services: ['Banho', 'Tosa higiênica'],
    scheduledDate: '2026-10-25',
    scheduledTime: '11:00',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(row.services.included, ['Banho', 'Tosa higiênica']);
  assert.deepEqual(row.services.extras[0], originalExtra);
  assert.equal(row.scheduled_date, '2026-10-25');
  await post(f, { action: 'renew', groupId: row.group_id });
  const newRows = f.db.appointments.slice(4);
  assert.equal(newRows.length, 4);
  assert.ok(newRows.every((item) => Array.isArray(item.services)));
  assert.deepEqual(newRows[3].services, ['Banho', 'Tosa higiênica']);
  assert.ok(newRows.every((item) => !item.services.includes('Tosa bebê')));
});

test('paid extras block deleting an otherwise unpaid and uncompleted plan', async () => {
  const f = await fixture();
  await post(f, {
    ...plan,
    paid: false,
    sessionCompleted: [false, false, false, false],
  });
  const row = f.db.appointments[0];
  await post(f, extraRequest(row.id, { paid: true, paymentMethod: 'pix' }));
  const response = await post(f, { action: 'delete', id: row.id });
  assert.equal(response.status, 409);
  assert.ok((await response.json()).blockers.includes('serviço extra pago'));
  assert.equal(f.db.appointments.length, 4);
});

test('a concurrent JSON update is not overwritten by an extra or an ordinary appointment edit', async () => {
  const f = await fixture();
  await post(f, plan);
  const row = f.db.appointments[0];
  const changed = {
    version: 1,
    revision: 1,
    included: ['Banho', 'Tosa higiênica'],
    extras: [],
  };
  f.hooks.beforeWrite = () => {
    row.services = structuredClone(changed);
  };
  let response = await post(f, extraRequest(row.id));
  assert.equal(response.status, 409);
  assert.deepEqual(row.services, changed);
  const originalDate = row.scheduled_date;
  const originalAmount = row.amount_cents;
  f.hooks.beforeWrite = () => {
    row.services.revision = 2;
  };
  response = await post(f, {
    action: 'edit',
    id: row.id,
    services: ['Banho'],
    scheduledDate: '2026-11-12',
    amountCents: 77777,
  });
  assert.equal(response.status, 409);
  assert.equal(row.services.revision, 2);
  assert.deepEqual(row.services.included, changed.included);
  assert.equal(row.scheduled_date, originalDate);
  assert.equal(row.amount_cents, originalAmount);
});


test('renewal status is returned immediately and on reload for every session of the old plan', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  const groupId = f.db.appointments[0].group_id;
  const response = await post(f, { action: 'renew', groupId });
  assert.equal(response.status, 200);
  const saved = f.db.plan_renewals[0];
  for (const data of [await response.json(), await (await f.GET(new Request('http://localhost/api/appointments'))).json()]) {
    const oldPlan = data.appointments.filter(item => item.groupId === groupId);
    assert.equal(oldPlan.length, 4);
    for (const item of oldPlan) assert.deepEqual(item.renewal, { groupId: saved.renewal_group_id, renewedAt: saved.created_at });
    const nextPlan = data.appointments.filter(item => item.groupId === saved.renewal_group_id);
    assert.equal(nextPlan.length, 4);
    assert.ok(nextPlan.every(item => item.renewal === null));
  }
  // A stale tab receives the same persisted metadata, even if an old session was reopened.
  f.db.appointments[0].status = 'scheduled';
  const info = await post(f, { action: 'renew_info', groupId });
  const data = await info.json();
  assert.equal(data.alreadyRenewed, true);
  assert.equal(data.renewalGroupId, saved.renewal_group_id);
  assert.equal(data.renewedAt, saved.created_at);
  const duplicate = await post(f, { action: 'renew', groupId });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).renewalGroupId, saved.renewal_group_id);
  assert.equal(f.db.appointments.length, 8);
  assert.equal(f.db.plan_renewals.length, 1);
});

test('concurrent renewals create only one new plan and return the existing renewal to the loser', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  const groupId = f.db.appointments[0].group_id;
  const responses = await Promise.all([post(f, { action: 'renew', groupId }), post(f, { action: 'renew', groupId })]);
  assert.deepEqual(responses.map(response => response.status).sort((a, b) => a - b), [200, 409]);
  assert.equal(f.db.plan_renewals.length, 1);
  assert.equal(f.db.appointments.length, 8);
  const conflict = await responses.find(response => response.status === 409).json();
  assert.equal(conflict.error, 'plan_already_renewed');
  assert.equal(conflict.renewalGroupId, f.db.plan_renewals[0].renewal_group_id);
  assert.equal(conflict.renewedAt, f.db.plan_renewals[0].created_at);
});

test('a completed new cycle can renew while the previous cycle stays marked as renewed', async () => {
  const f = await fixture();
  await post(f, { ...plan, sessionCompleted: [true, true, true, true] });
  const originalGroup = f.db.appointments[0].group_id;
  await post(f, { action: 'renew', groupId: originalGroup });
  const nextGroup = f.db.plan_renewals[0].renewal_group_id;
  f.db.appointments.filter(item => item.group_id === nextGroup).forEach(item => { item.status = 'completed'; });
  const response = await post(f, { action: 'renew', groupId: nextGroup });
  assert.equal(response.status, 200);
  assert.equal(f.db.plan_renewals.length, 2);
  assert.equal(f.db.appointments.length, 12);
  const data = await response.json();
  assert.equal(data.appointments.find(item => item.groupId === originalGroup).renewal.groupId, nextGroup);
  assert.equal(data.appointments.find(item => item.groupId === nextGroup).renewal.groupId, f.db.plan_renewals[1].renewal_group_id);
});
