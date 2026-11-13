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
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9700 + Math.floor(Math.random() * 40);   /* outside the static servers' 8790–9690 */
const HAVE_UV = spawnSync('uv', ['--version']).status === 0;
let home, core, browser, page, tok, base;

before(async () => {
  if (!HAVE_UV) return;
  home = mkdtempSync(join(tmpdir(), 'fuzz-live-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ me: { names: ['Sam'], emails: ['sam@acme.example'], slack_ids: [], folders: {} }, embedder: 'hash', tz: 'UTC' }));
  core = spawn('uv', ['run', '--project', join(ROOT, 'core'), 'python', '-m', 'fuzz', '--home', home, 'serve', '--port', String(PORT)], { cwd: join(ROOT, 'core'), stdio: 'ignore' });
  base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  tok = Object.keys(JSON.parse(readFileSync(join(home, 'tokens.json'), 'utf8')))[0];
  for (const t of ['Plan the offsite agenda', 'Write the quarterly review', 'Book the team dinner', 'Sort the shared drive']) await api('POST', '/tasks', { text: t });
  browser = await chromium.launch();
  page = await browser.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(`${base}/?token=${tok}`);
  await page.waitForFunction(() => window.Live && Live.on() && Store.queue().length >= 4, null, { timeout: 20000 });
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
