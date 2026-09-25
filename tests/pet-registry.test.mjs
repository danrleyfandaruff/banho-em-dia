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
    export const requireAuthorized = async () => ({user:{id:'staff'}});
    export const writeAudit = async () => {};
    export const getCardRates = async () => ({credit:308,debit:87});
    export const createSupabaseAdmin = () => ({from(table) {
      const filters = []; let operation='read',values,range;
      const q = {
        select(){return q}, order(){return q},
        eq(key,value){filters.push(row=>row[key]===value);return q},
        is(key,value){return q.eq(key,value)},
        gt(key,value){filters.push(row=>row[key]>value);return q},
        in(key,values){filters.push(row=>values.includes(row[key]));return q},
        range(start,end){range=[start,end];return q},
        insert(data){operation='insert';values=structuredClone(data);return q},
        update(data){operation='update';values=structuredClone(data);return q},
        delete(){operation='delete';return q},
        run(){
          let data=db[table].filter(row=>filters.every(filter=>filter(row)));
          if(operation!=='read') writes.push({table,operation,values});
          if(operation==='insert'){data=Array.isArray(values)?values:[values]; db[table].push(...data)}
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
        `from ${JSON.stringify(name === '@/lib/registration-validation' ? validation : name === '@/lib/payment' ? payment : name === '@/lib/pet-registry' ? registry : mock)}`,
    );
  const registry = moduleUrl(replace(registrySource));
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
