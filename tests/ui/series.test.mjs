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
  assert.match(await page.textContent('.ep[data-series="1"]'), /Next\s*Send Priya Friday’s status note/);
  assert.equal(await page.locator('.ep[data-series="4"] [data-keep]').count(), 1, 'Fuzz is watching: Keep it');
  /* past 20 tasks the done ones fold into one box holding their count in fives, then the leftover dots */
  assert.equal(await page.textContent('.ep[data-series="6"] .sdot.five'), '35');
  assert.equal(await page.locator('.ep[data-series="6"] .sdot.d').count(), 2);
  assert.equal(await page.locator('.ep[data-series="1"] .sdot.five').count(), 0, 'under 20 tasks: a dot each');
  /* the role pill and Edit share a line, centred */
  const mid = await page.evaluate(() => { const c = document.querySelector('.ep[data-series="1"]'), r = e => { const b = c.querySelector(e).getBoundingClientRect(); return b.top + b.height / 2; }; return Math.abs(r('.pill') - r('.ep-edit')); });
  assert.ok(mid < 1.5, 'pill and Edit are centred on one line: ' + mid);
  /* the card opens the series' own page, like an artifact: back pill, name, Work on it and ⋯ */
  await page.click('.ep[data-series="1"] .ep-about');
  await page.locator('#sp-title').waitFor();
  assert.equal(await page.textContent('#sp-title'), 'Northwind rollout');
  assert.match(await page.textContent('.series-one'), /How Fuzz spots it/);
  assert.match(await page.textContent('.sp-gaps'), /Fuzz doesn’t know yet/);
  await page.click('.sp-gaps [data-edit="add:next_milestone"]');
  assert.equal(await page.isVisible('#sp-val'), true, 'a gap opens its form in place');
  await page.keyboard.press('Escape');
  await page.click('[data-more]');
  assert.equal(await page.isVisible('#sp-menu'), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('#sp-menu'), false);
  await page.click('.sp-back');
  await page.locator('.ep[data-series="6"] .ep-edit').waitFor();
  /* Edit opens it too; past 5 people, 4 show and the rest open with a filter */
  await page.click('.ep[data-series="6"] .ep-edit');
  await page.locator('#sp-people').waitFor();
  assert.equal(await page.locator('#sp-people > li').count(), 4);
  await page.click('[data-people]');
  await page.fill('#sp-pq', 'okafor');
  assert.equal(await page.locator('#sp-people > li:not([hidden])').count(), 1);
  assert.match(await page.textContent('.sp-title .meta'), /with Ana Costa and 13 others/);
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
  /* Back goes to the list, and Esc in a panel does too */
  await page.click('[data-plusback]');
  assert.equal(await page.locator('#cap-plusmenu [data-plus]').count(), 5);
  await page.click('[data-plus="series"]');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#cap-plusmenu [data-plus]').count(), 5);
  assert.equal(await page.isVisible('#cap-plusmenu'), true, 'Esc in a panel keeps the menu open');
  await page.click('[data-plus="series"]');
  assert.match(await page.textContent('#cap-series'), /Start a new series from this/);
  const fits = await page.$eval('#cap-q', q => { const m = q.closest('.menu'); return q.getBoundingClientRect().right <= m.getBoundingClientRect().right - 4; });
  assert.ok(fits, 'the search field fits inside the menu');
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

test('Start a series on the Series page opens New with New series from this picked', async () => {
  const page = await newPage(`http://127.0.0.1:${PORT}/#/series`);
  await page.click('a[href="#/capture?series=start"]');
  await page.locator('#cap-text').waitFor();
  assert.match(await page.textContent('#files'), /New series from this/);
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
  const visible = await page.$$eval('#actions .card-actions button:not([role="menuitem"]):not(.more-btn)', els => els.map(e => e.textContent.replace(/^\d/, '').replace(/\d$/, '').trim()));
  assert.deepEqual(visible, ['Looks right', 'Adjust on its sheet', 'Not a series'], 'its cousins sit under Not a series’s own menu');
  await page.click('input[name="ser-role"][value="drive"]');
  await page.click('[data-dv="looks_right"]');
  await page.waitForFunction(() => !Store.queue().some(i => i.cardKind === 'series_new'), null, { timeout: 15000 });
  for (let i = 0; i < 50; i++) { if ((await api('GET', '/series')).counts.going === 1) break; await new Promise(r => setTimeout(r, 200)); }
  const pg = await api('GET', '/series');
  assert.equal(pg.counts.going, 1);
  assert.equal(pg.sections.going[0].role, 'drive');
  /* the page and its sheet: add a task to it */
  await page.evaluate(() => App.navigate('#/series'));
  await page.waitForFunction(() => document.querySelector('.ep .ep-name'), null, { timeout: 15000 });
  await page.click('.ep .ep-name');
  await page.locator('#ss-task').waitFor();
  await page.fill('#ss-task', 'Write the Northwind pilot success criteria');
  await page.press('#ss-task', 'Enter');
  await page.waitForFunction(() => /Write the Northwind pilot success criteria/.test(document.querySelector('.series-one').textContent), null, { timeout: 15000 });
  const sheet = await api('GET', '/series/' + out.series_id);
  assert.equal(sheet.open_tasks.length, 4);
  /* a fact: the × removes it, and Undo right under the list puts it back */
  await api('POST', '/series/' + out.series_id + '/facts', { attr: 'status', value: 'Kickoff is booked' });
  await page.evaluate(() => SeriesView.refresh());
  await page.waitForFunction(() => document.querySelector('.sp-facts [data-attr="status"]'), null, { timeout: 15000 });
  await page.click('.sp-facts [data-attr="status"]');
  await page.locator('[data-factundo]').waitFor({ timeout: 15000 });
  assert.ok(!(await api('GET', '/series/' + out.series_id)).knows.some(k => k.attr === 'status'), 'removed');
  await page.click('[data-factundo]');
  for (let i = 0; i < 50; i++) { if ((await api('GET', '/series/' + out.series_id)).knows.some(k => k.attr === 'status')) break; await new Promise(r => setTimeout(r, 200)); }
  assert.ok((await api('GET', '/series/' + out.series_id)).knows.some(k => k.attr === 'status'), 'Undo put it back');
  /* its menu opens from ⋯ and stays inside the page */
  await page.click('[data-more]');
  const box = await page.evaluate(() => { const m = document.querySelector('#sp-menu').getBoundingClientRect(), d = document.querySelector('.series-one').getBoundingClientRect(); return { ml: m.left, mr: m.right, dl: d.left, dr: d.right }; });
  assert.ok(box.ml >= box.dl && box.mr <= box.dr, 'the menu fits in the page: ' + JSON.stringify(box));
  /* Split it into parts: a task whose title says a part's name goes there by itself */
  await page.click('[data-act="split"]');
  await page.fill('#ss-part-0', 'kickoff');
  await page.fill('#ss-part-1', 'test data');
  await page.waitForFunction(() => /kickoff gets 1 · test data gets 1/.test(document.querySelector('#ss-split-sum').textContent), null, { timeout: 5000 });
  await page.click('[data-split-ok]');
  for (let i = 0; i < 50; i++) { if ((await api('GET', '/series')).counts.going === 3) break; await new Promise(r => setTimeout(r, 200)); }
  const names = (await api('GET', '/series')).sections.going.map(s => s.name).sort();
  assert.deepEqual(names, ['Northwind pilot', 'kickoff', 'test data']);
  assert.equal((await api('GET', '/series/' + out.series_id)).open_tasks.length, 2, 'the rest stays');
  assert.deepEqual(page.errors, []);
  await page.close();
});
