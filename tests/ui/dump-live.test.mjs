/* Dump mode end to end (docs/dump-mode.md): a real core, the real page, and the real `fuzz run split` headless path.
   The one thing stood in for is the model: a `claude` on the PATH that reads the dump id from the prompt, hands the
   split to the scripted role (which goes through the real MCP tools) and prints the result line a client prints.
   So this checks the run, its usage record, the polling, the review, Keep, Undo and the Focus time path, but not
   what a model writes: that's `fuzz eval dump`. Needs uv. Run: cd tests/ui && npm install && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = await new Promise((res, rej) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); }); srv.on('error', rej); });
const HAVE_UV = spawnSync('uv', ['--version']).status === 0;
let home, bin, core, browser, page, tok, base;

before(async () => {
  if (!HAVE_UV) return;
  home = mkdtempSync(join(tmpdir(), 'fuzz-dump-live-'));
  bin = join(home, 'bin');
  mkdirSync(bin);
  /* only the splitter has an engine: nothing else can run, read mail or send */
  writeFileSync(join(home, 'config.json'), JSON.stringify({ me: { names: ['Sam'], emails: ['sam@acme.example'], slack_ids: [], folders: {} }, embedder: 'hash', tz: 'UTC',
    setup: { done: true }, roles: { split: { client: 'claude-code' } }, evals: { spot_checks_per_week: 0, run_checks_per_week: 0, test_lessons: false } }));
  writeFileSync(join(bin, 'split_stub.py'), [
    'import os, sys', 'from fuzz.db import Core', 'from fuzz.roles import scripted',
    'scripted.run_split(Core(os.environ["FUZZ_HOME"], int(os.environ.get("FUZZ_USER", "1"))), (sys.argv[1], ""))'].join('\n'));
  writeFileSync(join(bin, 'claude'), [
    '#!/bin/bash', 'if [ "$1" = "--version" ]; then echo "9.9.9 (stand-in)"; exit 0; fi',
    'id=$(printf "%s" "$2" | sed -n \'s/.*dump_id: \\([0-9][0-9]*\\).*/\\1/p\' | head -1)',
    `[ -n "$id" ] && (cd "${join(ROOT, 'core')}" && uv run python "${join(bin, 'split_stub.py')}" "$id" >&2)`,
    'echo \'{"type":"result","subtype":"success","is_error":false,"duration_ms":1000,"result":"ok","total_cost_usd":0.0123,"usage":{"input_tokens":100,"output_tokens":20}}\''].join('\n'));
  chmodSync(join(bin, 'claude'), 0o755);
  core = spawn('uv', ['run', '--project', join(ROOT, 'core'), 'python', '-m', 'fuzz', '--home', home, 'serve', '--port', String(PORT)],
    { cwd: join(ROOT, 'core'), stdio: 'ignore', env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 900; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  tok = Object.keys(JSON.parse(readFileSync(join(home, 'tokens.json'), 'utf8')))[0];
  browser = await chromium.launch();
  page = await browser.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${base}/?token=${tok}#/capture`);
  await page.waitForFunction(() => window.Live && Live.on(), null, { timeout: 180000 });
  await page.locator('#cap-text').waitFor();
});
after(async () => { await browser?.close(); core?.kill(); if (home) rmSync(home, { recursive: true, force: true }); });

const api = (m, p, b) => fetch(base + p, { method: m, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
const DUMP = 'send the budget numbers to the finance lead\ncall the dentist\nnote: the vendor seems slow lately\nsomeday learn to bake bread\nalready paid the parking ticket';
const live = (tasks) => tasks.filter(t => t.state !== 'letgo');
const until = async (fn, ms = 90000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 400)); } };

test('a pasted list: the offer, the real split, a review, Keep, and one Undo', { skip: !HAVE_UV && 'needs uv' }, async () => {
  await page.locator('#cap-text').focus();
  await page.evaluate((t) => { const ta = document.getElementById('cap-text'); ta.value = t; ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true })); }, DUMP);
  await page.locator('#cap-split').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cap-text', 'the offer never takes focus');
  await page.locator('#cap-split').click();
  await page.locator('#cap-keep').waitFor({ timeout: 90000 });   /* the real run: serve → fuzz run split → the stand-in client → MCP submit_split → the polling */
  const groups = await page.locator('#cap-review .grp').allTextContents();
  assert.deepEqual(groups, ['To do', 'For later', 'To keep', 'Already done, or not yours']);
  assert.deepEqual(live((await api('GET', '/tasks')).tasks), [], 'nothing is made by the split');
  await page.locator('#cap-review label', { hasText: 'call the dentist' }).locator('input').uncheck();
  await page.locator('#cap-keep').click();
  await page.locator('#cap-compose').waitFor({ state: 'visible' });
  const made = live((await api('GET', '/tasks')).tasks).map(t => [t.title, t.state]).sort();
  assert.deepEqual(made, [['send the budget numbers to the finance lead', 'triage'], ['someday learn to bake bread', 'parked']]);
  const row = (await api('GET', '/dumps/1'));
  assert.equal(row.state, 'committed');
  assert.equal(row.text, DUMP, 'the raw dump is kept as written');
  assert.equal(row.task_ids.length, 2, 'and linked to what it made');
  await api('POST', '/undo', {});
  assert.deepEqual(live((await api('GET', '/tasks')).tasks), [], 'one Undo takes the whole dump back');
  assert.equal((await api('GET', '/dumps/1')).state, 'undone');
  assert.deepEqual(page.errors, []);
});

test('the split run is on the record and counted in usage as the splitter', { skip: !HAVE_UV && 'needs uv' }, async () => {
  const u = await api('GET', '/usage?days=1');
  const roles = Object.values(u.days[0].clients).flatMap(c => Object.entries(c.roles));
  const split = roles.find(([role]) => role === 'split');
  assert.ok(split, 'a split run shows in usage');
  assert.ok(split[1].measured >= 1, 'with what the client reported it used');
  assert.ok(u.runs.some(r => r.role === 'split' && r.outcome === 'ok'));
});

test('in Focus time the same dump is made at once, no review, and one Undo takes it back', { skip: !HAVE_UV && 'needs uv' }, async () => {
  const r = await api('POST', '/dumps', { text: DUMP, deep_work: true });
  const did = r.dump_id;
  await until(async () => (await api('GET', '/dumps/' + did)).state === 'committed');
  const made = live((await api('GET', '/tasks')).tasks).map(t => [t.title, t.state]).sort();
  assert.deepEqual(made, [['call the dentist', 'deepwork'], ['send the budget numbers to the finance lead', 'deepwork'], ['someday learn to bake bread', 'parked']]);
  await api('POST', '/undo', {});
  assert.deepEqual(live((await api('GET', '/tasks')).tasks), []);
});
