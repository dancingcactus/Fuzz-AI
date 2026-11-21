/* Live mode against a real core (#9): categories from the core, Settings → Who comes first, a tired
   check-in holding the rest, and "a few more". The core runs from this checkout in a throwaway folder.
   Needs uv (the core's tests use it too). Run: cd tests/ui && npm install && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/* A free port from the OS, so parallel test files and other running cores never collide */
const PORT = await new Promise((res, rej) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); }); srv.on('error', rej); });
const HAVE_UV = spawnSync('uv', ['--version']).status === 0;
let home, core, browser, page, tok, base;

before(async () => {
  if (!HAVE_UV) return;
  home = mkdtempSync(join(tmpdir(), 'fuzz-live-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ me: { names: ['Sam'], emails: ['sam@acme.example'], slack_ids: [], folders: {} }, embedder: 'hash', tz: 'UTC' }));
  core = spawn('uv', ['run', '--project', join(ROOT, 'core'), 'python', '-m', 'fuzz', '--home', home, 'serve', '--port', String(PORT)], { cwd: join(ROOT, 'core'), stdio: 'ignore' });
  base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 900; i++) {   /* up to three minutes: the suite starts every file at once */
    try { if ((await fetch(base + '/health')).ok) break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  tok = Object.keys(JSON.parse(readFileSync(join(home, 'tokens.json'), 'utf8')))[0];
  for (const t of ['Plan the offsite agenda', 'Write the quarterly review', 'Book the team dinner', 'Sort the shared drive']) await api('POST', '/tasks', { text: t });
  browser = await chromium.launch();
  page = await browser.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${base}/?token=${tok}#/triage`);
  await page.waitForFunction(() => window.Live && Live.on() && Store.queue().length >= 4, null, { timeout: 180000 });
});
after(async () => { await browser?.close(); core?.kill(); if (home) rmSync(home, { recursive: true, force: true }); });

function api(m, p, b) {
  return fetch(base + p, { method: m, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
}

test('live cards carry the core’s categories', { skip: !HAVE_UV && 'needs uv' }, async () => {
  assert.ok(await page.evaluate(() => Store.queue().every(i => Array.isArray(i.cats))));
});

test('Settings → Who comes first saves to the core', { skip: !HAVE_UV && 'needs uv' }, async () => {
  await page.evaluate(() => App.navigate('#/settings'));
  await page.locator('#vip-manager').waitFor({ timeout: 15000 });
  await page.fill('#vip-manager', 'Priya Raman');
  await page.fill('#vip-people', 'Marcus, elena@acme.example');
  await page.locator('#sec-vips button[type=submit]').click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#said-vips').textContent), null, { timeout: 10000 });
  assert.deepEqual(await api('GET', '/vips'), { manager: 'Priya Raman', people: ['Marcus', 'elena@acme.example'] });
  await page.evaluate(() => App.navigate('#/'));
});

test('a tired check-in holds the rest in the core, and a few more brings a stretch back', { skip: !HAVE_UV && 'needs uv' }, async () => {
  await page.evaluate(() => Store.checkin('tired'));
  await page.waitForFunction(() => Store.queue().length === 0, null, { timeout: 10000 });
  let cards = await api('GET', '/cards');
  assert.equal(cards.energy, 'tired');
  assert.equal(cards.cards.length, 0, 'plain cards wait for tomorrow');
  await page.evaluate(() => Store.more());
  await new Promise(r => setTimeout(r, 1500));
  cards = await api('GET', '/cards');
  assert.equal(cards.energy, 'okay');
  assert.equal(cards.cards.length, 4, 'one okay stretch back');
  assert.deepEqual(page.errors, []);
});

test('a calendar link opens the Guide on the task, and Start moves it into My work in the core', { skip: !HAVE_UV && 'needs uv' }, async () => {
  const made = await api('POST', '/tasks', { text: 'Draft the launch email' });
  const tid = made.task_id;
  assert.ok(tid, 'the core made the task');
  const p = await browser.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  /* opened cold, as from the invite: the first sync lands before the Guide looks the task up */
  await p.goto(`${base}/?token=${tok}#/work/${tid}`);
  await p.waitForFunction((id) => { const r = document.querySelector('.g-row[aria-checked="true"]'); return r && r.dataset.pick === 't' + id; }, tid, { timeout: 30000 });
  assert.equal(await p.locator('#dw-step').count(), 0, 'one tap from Start, not started');
  await p.click('#dw-go');
  await p.locator('#dw-step').waitFor();
  let state;
  for (let i = 0; i < 50 && state !== 'deepwork'; i++) {
    state = (await api('GET', '/tasks/' + tid)).state;
    if (state !== 'deepwork') await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(state, 'deepwork');
  assert.deepEqual(errors, []);
  await p.close();
});

test('the feedback button opens a GitHub issue with the page’s details, and no query values', { skip: !HAVE_UV && 'needs uv' }, async () => {
  await page.evaluate(() => App.navigate('#/work?until=15:00&what=Secret%20task%20title'));
  /* a failed load with a token in its URL, and a logged header: neither may reach a public issue */
  await page.evaluate(() => new Promise(res => {
    const img = new Image(); img.onerror = res; img.src = '/files/999?token=sekrit123'; document.body.appendChild(img);
    console.error('[fuzz live]', new Error('call failed: Bearer sekrit456'), { title: 'Secret card data' });
  }));
  let opened;
  const asked = new Promise(res => { opened = res; });
  await page.context().route('https://github.com/**', r => { opened(r.request().url()); r.abort(); });
  await page.locator('#fbbtn').hover();
  await page.waitForFunction(() => /server `/.test(decodeURIComponent(Feedback.url())), null, { timeout: 5000 });
  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.locator('#fbbtn').click()]);
  const url = new URL(await asked);
  await popup.close();
  await page.context().unroute('https://github.com/**');
  assert.equal(url.origin + url.pathname, 'https://github.com/dancingcactus/Fuzz-AI/issues/new');
  const body = url.searchParams.get('body');
  assert.match(url.searchParams.get('title'), /^\[(Guide|My work)\] $/);
  assert.match(body, /\*\*View:\*\* .*`#\/work\?until&what`/);
  assert.match(body, /\*\*Fuzz:\*\* 0\.\d+\.\d+ · tree /);
  assert.match(body, /\*\*Data:\*\* Live · \d+ in triage/);
  assert.doesNotMatch(body, /Secret task title|15:00|sekrit|Secret card data/);
  assert.match(body, /failed to load .*\/files\/999\?…/);
  assert.match(body, /console: \[fuzz live\] call failed: Bearer …/);
  await page.evaluate(() => App.navigate('#/'));
});
