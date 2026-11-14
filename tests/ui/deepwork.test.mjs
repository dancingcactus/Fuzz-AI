/* Deep Work's focus view: the task id at the bottom, Triage-style links under the card (Tell Fuzz, park a
   thought, the clock on or off), and the session's time in the header, not inside the task's card.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9800 + Math.floor(Math.random() * 100);
let server, browser, page;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

beforeEach(async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(`http://127.0.0.1:${PORT}/#/deepwork`);
  await page.locator('#dw-go').click();
  await page.locator('#dw-step').waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

const current = () => page.evaluate(() => document.querySelector('.dw-taskline span').textContent);

test('the task id is at the bottom of the card', async () => {
  const last = await page.evaluate(() => document.querySelector('.dw-panel').lastElementChild.className);
  assert.equal(last, 'taskid');
  assert.match(await page.textContent('.dw-panel .taskid'), /^(Task #|Local )/);
});

test('the session time is in the header, not in the card', async () => {
  assert.equal(await page.locator('#dwprog').isVisible(), true);
  assert.match(await page.textContent('#dwprog-t'), /Break in .* left/);
  assert.equal(await page.locator('.dw-panel .dw-dial').count(), 0);
  await page.click('#dw-clocktoggle');
  assert.equal(await page.locator('#dwprog').isHidden(), true);
  await page.click('#dw-clocktoggle');
  assert.equal(await page.locator('#dwprog').isVisible(), true);
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#focuscard').waitFor();
  assert.equal(await page.locator('#dwprog').isHidden(), true);
});

test('T parks a thought from the link under the card, and the card stays put', async () => {
  await page.click('.dw-prepfold summary').catch(() => {});
  const open = await page.evaluate(() => { const d = document.querySelector('.dw-prepfold'); return d ? d.open : null; });
  await page.keyboard.press('t');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dw-parktext');
  await page.keyboard.type('call the dentist');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#dw-parkform').isHidden(), true);
  assert.equal(await page.textContent('#dw-parked'), '1 parked ✓');
  assert.equal(await page.evaluate(() => { const d = document.querySelector('.dw-prepfold'); return d ? d.open : null; }), open);
  assert.equal(await page.evaluate(() => Store.inState('parked').some(i => i.title === 'call the dentist')), true);
});

test('E tells Fuzz: Esc closes it, a note stays on the task, Enter hands it over with the note', async () => {
  const title = await current();
  const id = await page.evaluate((t) => Store.inState('deepwork').find(i => i.title === t).id, title);
  await page.keyboard.press('e');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#dw-tellform').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dw-tellbtn');

  await page.keyboard.press('e');
  await page.keyboard.type('the numbers are in the Q3 sheet');
  await page.click('#dw-noteit');
  assert.equal(await current(), title);
  const notes = await page.evaluate((t) => Store.inState('deepwork').find(i => i.title === t).notes, title);
  assert.match(notes, /Q3 sheet/);

  await page.keyboard.press('e');
  await page.keyboard.type('draft it for my OK');
  await page.keyboard.press('Enter');
  await page.locator('.dw-beat').waitFor();
  assert.match(await page.textContent('.dw-title'), /Fuzz has/);
  const it = await page.evaluate((t) => { const i = Store.item(t); return { state: i.state, notes: i.notes }; }, id);
  assert.ok(['working', 'queued'].includes(it.state), it.state);
  assert.match(it.notes, /draft it for my OK/);
  assert.equal(await page.locator('#dw-footfocus').isHidden(), true);
  assert.equal(await page.locator('#dw-keysbtn').isVisible(), true);
});

test('? opens the key guide on the keys for where you are', async () => {
  await page.keyboard.press('?');
  const dlg = page.locator('#dw-keysdlg');
  assert.equal(await dlg.isVisible(), true);
  assert.match(await page.textContent('#dw-keys-now'), /Right now.*Finished it.*Tell Fuzz/s);
  assert.equal(await page.evaluate(() => document.querySelector('#dw-keysdlg .keys-all').open), false);
  await page.keyboard.press('Escape');
  assert.equal(await dlg.isHidden(), true);
  assert.equal(await page.locator('#dw-step').isVisible(), true);   // Esc closed the guide, not the task

  await page.keyboard.press('s');
  await page.keyboard.press('?');
  assert.match(await page.textContent('#dw-keys-now'), /Send it back to Triage/);
  await page.keyboard.press('Escape');

  await page.click('#dw-keysbtn');
  assert.equal(await dlg.isVisible(), true);
  await page.click('#dw-keysdlg [data-close]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dw-keysbtn');
});

test('in a session N parks a thought instead of leaving, and the nav steps back until you leave', async () => {
  await page.locator('#dw-step').click();   /* focus off any box, so keys reach the session */
  await page.keyboard.press('n');
  assert.equal(await page.evaluate(() => location.hash), '#/deepwork', 'N stays in the session');
  assert.equal(await page.locator('#dw-parkform').isVisible(), true);
  await page.waitForFunction(() => document.body.classList.contains('dw-session'));
  assert.equal(await page.locator('.mainnav').isVisible(), false);
  /* Another page keeps the session's bar, and it leads back */
  await page.evaluate(() => App.navigate('#/tasks'));
  await page.waitForFunction(() => !document.body.classList.contains('dw-session'));
  await page.locator('#dwprog.away').waitFor();
  await page.click('#dwprog');
  await page.waitForFunction(() => location.hash === '#/deepwork');
});

test('the Deep Work dot means one is waiting part-way, not that the pool has something', async () => {
  await page.evaluate(() => { Store.inState('deepwork').forEach(i => { i.leftOff = ''; }); Store.emit({ type: 'work' }); });
  await page.waitForFunction(() => !document.getElementById('dwcount').classList.contains('has'));
  await page.evaluate(() => { Store.inState('deepwork')[0].leftOff = 'Drafted the intro'; Store.emit({ type: 'work' }); });
  await page.waitForFunction(() => document.getElementById('dwcount').classList.contains('has'));
  assert.match(await page.locator('[data-nav="deepwork"]').evaluate(a => a.textContent), /1 to pick up where you left off/);
});
