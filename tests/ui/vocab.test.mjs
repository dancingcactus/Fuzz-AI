/* Every name js/live.js sends to the core is one the core accepts (js/vocab.js, made from the core by
   core/scripts/make_vocab.py). Node built-ins only: run with `node --test vocab.test.mjs`, no install. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const box = { window: {} };
vm.runInNewContext(read('js/vocab.js'), box);
const V = box.window.FuzzVocab;
const LIVE = read('js/live.js');

/* The arguments of every call to fn(...), split at top-level commas */
function calls(src, fn) {
  const out = [], re = new RegExp('(?<![\\w.])' + fn + '\\(', 'g');
  let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 9), m.index))) continue;   // its definition
    let depth = 1, i = re.lastIndex, arg = '', args = [], quote = null;
    for (; i < src.length && depth; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; arg += c; continue; }
      if (c === "'" || c === '"') quote = c;
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth--;
      if (depth === 1 && c === ',') { args.push(arg.trim()); arg = ''; continue; }
      if (depth) arg += c;
    }
    args.push(arg.trim());
    out.push(args);
  }
  return out;
}
const literal = a => (/^'([a-z_]+)'$/.exec(a || '') || [])[1];

const allOptions = new Set([...V.taskAnswers, ...Object.values(V.cardKinds).flatMap(k => k.options)]);

test('every option decide() sends is an answer some card has', () => {
  const sent = calls(LIVE, 'decide').map(a => literal(a[1])).filter(Boolean);
  assert.ok(sent.length >= 25, `found only ${sent.length} options: the parser is missing calls`);
  const unknown = [...new Set(sent)].filter(o => !allOptions.has(o));
  assert.deepEqual(unknown, [], 'options the core has no card answer for');
});

test('every task verb decide() falls back to has a route', () => {
  const verbs = calls(LIVE, 'decide').map(a => literal(a[3])).filter(Boolean);
  assert.ok(verbs.length >= 10, `found only ${verbs.length} verbs: the parser is missing calls`);
  const unknown = [...new Set(verbs)].filter(v => !V.taskVerbs.includes(v));
  assert.deepEqual(unknown, [], 'verbs with no POST /tasks/{id}/<verb>');
});

test("the question cards' buttons are that kind's own answers", () => {
  const block = /var QUESTION = \{([\s\S]*?)\n  \};/.exec(LIVE)[1];
  const kinds = [...block.matchAll(/^\s*(\w+): \{(.*)\},?$/gm)];
  assert.ok(kinds.length >= 6, `found only ${kinds.length} question kinds`);
  for (const [, kind, body] of kinds) {
    assert.ok(V.cardKinds[kind], `${kind} isn't a card kind`);
    const used = [...body.matchAll(/(?:primary|secondary|third): \['([a-z_]+)'|dismissed: '([a-z_]+)'/g)].map(m => m[1] || m[2]);
    for (const o of used) assert.ok(V.cardKinds[kind].options.includes(o), `${kind} has no answer ${o}`);
  }
  const kick = /var KICKOFF_ASK = \{(.*)\};/.exec(LIVE)[1];
  for (const [, a, b] of kick.matchAll(/\['([a-z_]+)'|dismissed: '([a-z_]+)'/g)) {
    assert.ok(V.cardKinds.permission.options.includes(a || b), `permission has no answer ${a || b}`);
  }
});

test('a draft edit is a draft answer', () => {
  assert.match(LIVE, /\{ option: 'edit', value: text \}/);
  assert.ok(V.cardKinds.draft.options.includes('edit'));
});
