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
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('#focuscard').waitFor();
  await page.keyboard.press('Escape');
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
  await page.locator('#card .actions.review').waitFor();
  assert.equal(await page.locator('[data-act="revise"]').getAttribute('aria-keyshortcuts'), 'E');
  assert.equal(await page.locator('[data-act="notnow"]').getAttribute('aria-keyshortcuts'), 'S');
  await page.keyboard.press('e');
  assert.equal(await page.locator('#revise').isVisible(), true);
});
