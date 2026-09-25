import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = await readFile(
  new URL('../components/plan-session-dates.tsx', import.meta.url),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
});
const require = createRequire(import.meta.url);
const resolved = outputText.replace(
  /from (['"])(react\/jsx-runtime|lucide-react)\1/g,
  (_match, _quote, specifier) =>
    `from ${JSON.stringify(pathToFileURL(require.resolve(specifier)).href)}`,
);
const { PlanSessionDates } = await import(
  `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`
);

test('plan dates remain visible across months and expose status beyond color', () => {
  const html = renderToStaticMarkup(
    createElement(PlanSessionDates, {
      currentId: '2',
      onOpen() {},
      sessions: [
        { id: '1', scheduledDate: '2026-08-28', status: 'completed' },
        { id: '2', scheduledDate: '2026-09-04', status: 'absent' },
        { id: '3', scheduledDate: '2026-09-11', status: 'scheduled' },
        { id: '4', scheduledDate: '2026-09-18', status: 'scheduled' },
      ],
    }),
  );
  assert.equal((html.match(/<time /g) ?? []).length, 4);
  assert.match(
    html,
    /28\/08\/2026 concluída; 04\/09\/2026 faltou; 11\/09\/2026 em aberto; 18\/09\/2026 em aberto/,
  );
  assert.match(html, /lucide-check/);
  assert.match(html, /lucide-x/);
  assert.match(html, /dateTime="2026-08-28">28\/08<\/time>/);
  assert.match(html, /dateTime="2026-09-18">18\/09<\/time>/);
});

test('completion and rescheduling are reflected by the current appointment data', () => {
  const html = renderToStaticMarkup(
    createElement(PlanSessionDates, {
      currentId: '1',
      onOpen() {},
      sessions: [{ id: '1', scheduledDate: '2026-10-02', status: 'completed' }],
    }),
  );
  assert.match(html, /02\/10\/2026 concluída/);
  assert.match(html, /dateTime="2026-10-02">02\/10<\/time>/);
});
