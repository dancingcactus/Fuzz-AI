/* Series (docs/series.md): the page under Lineup in the menu, its sheet, New task's + → Series, and, against a real
   core, a series you start waiting for your OK on its Triage card, then going on the page with its sheet's actions.
   The demo half needs only a static server; the live half needs uv, like live.test.mjs.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 900);
const LIVE_PORT = 9740 + Math.floor(Math.random() * 40);   /* outside the static servers' 8790–9690, and live.test's 9700–9739 */
const HAVE_UV = spawnSync('uv', ['--version']).status === 0;
let server, browser, home, core, tok, base;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
  if (!HAVE_UV) return;
  home = mkdtempSync(join(tmpdir(), 'fuzz-series-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ me: { names: ['Sam'], emails: ['sam@acme.example'], slack_ids: [], folders: {} }, embedder: 'hash', tz: 'UTC' }));
  core = spawn('uv', ['run', '--project', join(ROOT, 'core'), 'python', '-m', 'fuzz', '--home', home, 'serve', '--port', String(LIVE_PORT)], { cwd: join(ROOT, 'core'), stdio: 'ignore' });
  base = `http://127.0.0.1:${LIVE_PORT}`;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  tok = Object.keys(JSON.parse(readFileSync(join(home, 'tokens.json'), 'utf8')))[0];
});
after(async () => { await browser?.close(); server?.kill(); core?.kill(); if (home) rmSync(home, { recursive: true, force: true }); });

function api(m, p, b) {
  return fetch(base + p, { method: m, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
}
async function newPage(url) {
  const page = await browser.newPage();
  page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.view);
  return page;
}

test('the menu has Series under Lineup, and the page shows the demo’s sections', async () => {
  const page = await newPage(`http://127.0.0.1:${PORT}/#/guide`);
  await page.click('#menubtn');
  await page.click('#navmenu [data-menu="series"]');
  await page.waitForFunction(() => document.title === 'Series · Fuzz');
  const heads = await page.$$eval('.series-page .lsec h2', els => els.map(e => e.firstChild.textContent.trim()));
  assert.deepEqual(heads, ['Going', 'Gone quiet', 'Fuzz is watching', 'Wrapped']);
  assert.match(await page.textContent('.scard[data-series="1"]'), /Next in Northwind rollout: send Priya Friday’s status note/);
  assert.equal(await page.locator('.scard[data-series="4"] [data-keep]').count(), 1, 'Fuzz is watching: Keep it');
  /* the sheet */
  await page.click('.scard[data-series="1"] .scard-name');
  await page.locator('.series-sheet #ss-title').waitFor();
  assert.equal(await page.textContent('#ss-title'), 'Northwind rollout');
  assert.match(await page.textContent('.series-sheet'), /How Fuzz spots it/);
  await page.keyboard.press('Escape');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('New task’s + → Series puts the capture in one', async () => {
  const page = await newPage(`http://127.0.0.1:${PORT}/#/capture`);
  await page.fill('#cap-text', 'Send Northwind the pilot checklist');
  await page.click('#cap-plus');
  const items = await page.$$eval('#cap-plusmenu [role="menuitem"] b', els => els.map(e => e.textContent));
  assert.deepEqual(items, ['Series', 'Person', 'Source', 'Artifact', 'Upload a file']);
  await page.click('[data-plus="series"]');
  assert.match(await page.textContent('#cap-series'), /Start a new series from this/);
  assert.match(await page.textContent('#cap-series'), /Fuzz has been watching/);
  await page.fill('#cap-q', 'north');
  await page.click('[data-serpick="1"]');
  assert.match(await page.textContent('#files'), /Part of Northwind rollout/);
  /* Person: a name you type, for them */
  await page.click('#cap-plus');
  await page.click('[data-plus="person"]');
  await page.fill('#cap-q', 'Dana Ortiz');
  await page.click('[data-person="-1"][data-role="for"]');
  /* Source: a link Fuzz should read */
  await page.click('#cap-plus');
  await page.click('[data-plus="source"]');
  await page.fill('#cap-q', 'https://example.slack.com/archives/C1/p123');
  await page.press('#cap-q', 'Enter');
  const chips = await page.textContent('#files');
  assert.match(chips, /For Dana Ortiz/);
  assert.match(chips, /example\.slack\.com/);
  await page.click('#cap-go');
  const it = await page.evaluate(() => { const i = Store.get().items.filter(x => x.title === 'Send Northwind the pilot checklist')[0]; return { line: Store.seriesLine(i), sources: i.sources.map(s => s.type), people: i.people.map(p => p.name) }; });
  assert.equal(it.line, 'Part of Northwind rollout');
  assert.deepEqual(it.sources, ['Person', 'Link']);
  assert.deepEqual(it.people, ['Dana Ortiz']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('live: a series you start waits for your OK in Triage, then it’s going, with its sheet', { skip: !HAVE_UV && 'needs uv' }, async () => {
  for (const t of ['Draft the Northwind pilot plan', 'Book the Northwind pilot kickoff', 'Send Northwind the pilot test data']) await api('POST', '/tasks', { text: t });
  const out = await api('POST', '/series', { note: 'Northwind pilot' });
  assert.ok(out.series_id, 'the core started it');
  const page = await newPage(`${base}/?token=${tok}#/triage`);
  await page.waitForFunction(() => window.Live && Live.on() && Store.queue().some(i => i.cardKind === 'series_new'), null, { timeout: 60000 });
  await page.evaluate(() => { const it = Store.queue().filter(i => i.cardKind === 'series_new')[0]; Store.pick(it.id); App.refresh(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-sertask]').length >= 3, null, { timeout: 15000 });
  const visible = await page.$$eval('#actions .actions > .btn', els => els.map(e => e.textContent.replace(/\d$/, '').trim()));
  assert.deepEqual(visible, ['Looks right', 'Adjust on its sheet'], 'Not a series sits under its own menu');
  await page.click('input[name="ser-role"][value="drive"]');
  await page.click('[data-dv="looks_right"]');
  await page.waitForFunction(() => !Store.queue().some(i => i.cardKind === 'series_new'), null, { timeout: 15000 });
  for (let i = 0; i < 50; i++) { if ((await api('GET', '/series')).counts.going === 1) break; await new Promise(r => setTimeout(r, 200)); }
  const pg = await api('GET', '/series');
  assert.equal(pg.counts.going, 1);
  assert.equal(pg.sections.going[0].role, 'drive');
  /* the page and its sheet: add a task to it */
  await page.evaluate(() => App.navigate('#/series'));
  await page.waitForFunction(() => document.querySelector('.scard .scard-name'), null, { timeout: 15000 });
  await page.click('.scard .scard-name');
  await page.locator('#ss-task').waitFor();
  await page.fill('#ss-task', 'Write the Northwind pilot success criteria');
  await page.press('#ss-task', 'Enter');
  await page.waitForFunction(() => /Write the Northwind pilot success criteria/.test(document.querySelector('.series-sheet').textContent), null, { timeout: 15000 });
  const sheet = await api('GET', '/series/' + out.series_id);
  assert.equal(sheet.open_tasks.length, 4);
  assert.deepEqual(page.errors, []);
  await page.close();
});
