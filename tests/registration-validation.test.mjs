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
