import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const validationUrl = moduleUrl(
  compile(
    await readFile(
      new URL('../lib/registration-validation.ts', import.meta.url),
      'utf8',
    ),
  ),
);
const { validateRegistrationNames } = await import(validationUrl);
const routeSource = compile(
  await readFile(
    new URL('../app/api/appointments/route.ts', import.meta.url),
    'utf8',
  ),
);
const sharedMocks = `
export const requireAuthorized = async () => ({ user: { id: 'staff' } });
export const writeAudit = () => { throw new Error('Unexpected audit write'); };
export const getCardRates = () => { throw new Error('Unexpected rates query'); };
export const calculatePayment = () => {};
export const cardRateBps = () => {};
`;
async function loadRoute(databaseMock) {
  const mockUrl = moduleUrl(sharedMocks + databaseMock);
  return import(
    moduleUrl(
      routeSource.replace(
        /from (['"])(@\/lib\/[^'"]+)\1/g,
        (_match, _quote, specifier) =>
          `from ${JSON.stringify(specifier === '@/lib/registration-validation' ? validationUrl : mockUrl)}`,
      ),
    )
  );
}
const post = (route, body) =>
  route.POST(
    new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

test('both names are mandatory, including whitespace-only and non-string values', () => {
  assert.equal(validateRegistrationNames({}).error, 'names_required');
  assert.equal(
    validateRegistrationNames({ ownerName: ' \t ', dogName: '\n\u00a0' }).error,
    'names_required',
  );
  assert.equal(
    validateRegistrationNames({ ownerName: 'Ana', dogName: ' ' }).error,
    'pet_name_required',
  );
  assert.equal(
    validateRegistrationNames({ ownerName: null, dogName: 'Mel' }).error,
    'owner_name_required',
  );
  assert.equal(
    validateRegistrationNames({ ownerName: {}, dogName: ['Mel'] }).error,
    'names_required',
  );
});

test('valid names retain accents and punctuation and lose surrounding whitespace', () => {
  assert.deepEqual(
    validateRegistrationNames({
      ownerName: "  João D'Ávila  ",
      dogName: '  Pérola II ',
    }),
    {
      ownerName: "João D'Ávila",
      dogName: 'Pérola II',
      error: null,
    },
  );
});

test('create, edit and notes reject incomplete names before any database access', async () => {
  const route = await loadRoute(
    `export const createSupabaseAdmin = () => { throw new Error('Unexpected database access'); };`,
  );
  for (const action of ['create', 'edit', 'pet_notes']) {
    for (const [names, error] of [
      [{}, 'names_required'],
      [{ ownerName: 'Ana', dogName: '   ' }, 'pet_name_required'],
      [{ ownerName: '\t', dogName: 'Bob' }, 'owner_name_required'],
      [{ ownerName: {}, dogName: [] }, 'names_required'],
    ]) {
      const response = await post(route, { action, id: 'existing', ...names });
      assert.equal(response.status, 400, action);
      assert.deepEqual(await response.json(), { error });
    }
  }
  assert.equal((await post(route, {})).status, 400);
});

test('renewal of an unnamed legacy plan is rejected before reserving or inserting a plan', async () => {
  const route = await loadRoute(`export const createSupabaseAdmin = () => ({
    from(table) {
      if (table !== 'appointments') throw new Error('Unexpected table: ' + table);
      return { select: () => ({ eq: () => ({ order: () => ({ returns: async () => ({
        data: [{ id: 'legacy', owner_name: '', dog_name: 'Bob', plan_type: 'monthly', status: 'completed' }], error: null,
      }) }) }) }) };
    }
  });`);
  for (const action of ['renew', 'renew_info']) {
    const response = await post(route, { action, groupId: 'legacy-plan' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'owner_name_required' });
  }
});
