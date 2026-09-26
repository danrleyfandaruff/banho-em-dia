import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/plan-renewal.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { canRenewPlan } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const lastSession = { planType: 'monthly', sessionNumber: 4, totalSessions: 4, status: 'completed', renewal: null };

test('renewal action and attention list require a completed, unrenewed cycle', () => {
  assert.equal(canRenewPlan(lastSession, 0), true);
  assert.equal(canRenewPlan({ ...lastSession, planType: 'fortnightly', sessionNumber: 2, totalSessions: 2 }, 0), true);
  assert.equal(canRenewPlan({ ...lastSession, renewal: { groupId: 'new-cycle', renewedAt: '2026-09-26T12:00:00Z' } }, 0), false);
  assert.equal(canRenewPlan(lastSession, 1), false);
  assert.equal(canRenewPlan({ ...lastSession, status: 'scheduled' }, 0), false);
  assert.equal(canRenewPlan({ ...lastSession, sessionNumber: 1 }, 0), false);
  assert.equal(canRenewPlan({ ...lastSession, planType: 'single', sessionNumber: 1, totalSessions: 1 }, 0), false);
  assert.equal(canRenewPlan(undefined, 0), false);
});
