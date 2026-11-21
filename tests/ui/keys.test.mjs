/* One letter, one meaning, and no card starts in a text box (the ADHD pass, #2 and #6).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8990 + Math.floor(Math.random() * 100);
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
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#card [data-act]').first().waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

const focused = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));

test('a card starts at its heading, not in a text box', async () => {
  assert.equal(await focused(), 'ask');
});

test('E opens the card’s box, and Esc brings the keys back with the note kept', async () => {
  const box = await page.evaluate(() => (document.querySelector('#card #instr') || document.querySelector('#card #note') || {}).id);
  assert.ok(box, 'the first card has a box for Fuzz');
  await page.keyboard.press('e');
  assert.equal(await focused(), box);
  await page.keyboard.type(' and copy Ines');
  await page.keyboard.press('Escape');
  assert.equal(await focused(), 'ask');
  assert.match(await page.locator('#' + box).inputValue(), /and copy Ines$/);
});

test('the keys sheet opens on this card’s keys, with All keys folded', async () => {
  await page.keyboard.press('?');
  const dlg = page.locator('#keysdlg');
  await dlg.waitFor();
  assert.match(await dlg.locator('#keys-card h3').textContent(), /On this card/);
  const keys = await dlg.locator('#keys-card kbd').allTextContents();
  assert.ok(keys.includes('E'), 'Tell Fuzz is listed');
  assert.equal(new Set(keys).size, keys.length, 'each key once');
  assert.equal(await dlg.locator('.keys-all').evaluate(d => d.open), false);
});

test('a draft: E asks for a change and S is Not now', async () => {
  await page.evaluate(() => {
    const it = Store.get().items.find(i => i.state === 'review');
    Store.pick(it.id); App.refresh();
  });
  await page.locator('#card .card-actions.review').waitFor();
  assert.equal(await page.locator('[data-act="revise"]').getAttribute('aria-keyshortcuts'), 'E');
  assert.equal(await page.locator('[data-act="notnow"]').getAttribute('aria-keyshortcuts'), 'S');
  await page.keyboard.press('e');
  assert.equal(await page.locator('#revise').isVisible(), true);
  /* It is the same composer as the Tell Fuzz box: the field with + and the mic inside it */
  const inBox = await page.evaluate(() => ['#revise-text', '[data-act="plus"]', '[data-dictate="revise-text"]'].map(s => !!document.querySelector('#revise .composer ' + s)));
  assert.deepEqual(inBox, [true, true, true]);
  assert.equal(await page.locator('#revise .refs').getAttribute('data-for'), 'revise-text');
  await page.locator('#revise [data-act="plus"]').click();
  assert.equal(await page.locator('#plusmenu').isVisible(), true);
  assert.ok(await page.locator('#plusmenu [data-act="upload"]').isVisible(), 'Upload files is in the menu');
  await page.keyboard.press('Escape');
  /* The line under the box says what the keys do while you type, and they do it */
  await page.locator('#revise-text').focus();
  const line = page.locator('#revise .typing');
  assert.equal(await line.isVisible(), true);
  assert.match(await line.textContent(), /Enter\s*Send back.*Esc\s*Keep it, keys back/);
  await page.locator('#revise-text').fill('shorter');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-act')), 'revise', 'Esc leaves the box');
  assert.equal(await page.locator('#revise-text').inputValue(), 'shorter', 'and keeps what you wrote');
});
