/* Arriving, the counts and New task (the ADHD pass, #5, #7 and #9).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9490 + Math.floor(Math.random() * 100);
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
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

test('arriving shows what happened, then the card to start with and why', async () => {
  const fc = page.locator('#focuscard');
  assert.equal(await fc.locator('.arrive-pick').count(), 1);
  assert.equal(await fc.locator('#fo-q').count(), 0, 'no question before you have the context');
  const named = await fc.locator('.arrive-pick h2').textContent();
  assert.ok(named.trim().length > 0);
  assert.ok((await fc.locator('.arrive-pick .meta').textContent()).trim().length > 0, 'it says why');
  await page.keyboard.press('Enter');
  await page.locator('#card [data-act]').first().waitFor();
  assert.equal((await page.locator('#ask').textContent()).replace(/^The one thing to decide: /, '').trim(), named.trim(), 'Enter starts on the named card');
});

test('O asks what we’re working on instead', async () => {
  await page.keyboard.press('o');
  await page.locator('#focuscard #fo-q').waitFor();
});

test('the header shows the stretch to the first check-in, not the whole queue (#9)', async () => {
  await page.keyboard.press('Enter');
  await page.locator('#card [data-act]').first().waitFor();
  const open = await page.evaluate(() => [...document.querySelectorAll('.pg-seg')].filter(s => !s.classList.contains('is-tick') && !s.classList.contains('is-bank') && !s.classList.contains('is-ghost')).length);
  assert.equal(open, await page.evaluate(() => Math.min(2, Store.queue().length)));
});

test('Lineup names what’s first, with no counts of what’s left', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => App.navigate('#/tasks'));
  await page.locator('#board .decide').waitFor();
  assert.equal(await page.locator('.decide-n').count(), 0);
  assert.equal(await page.locator('#board h2 .lcount').count(), 0);
  const first = await page.evaluate(() => Store.front().title);
  assert.match(await page.locator('#board .decide').textContent(), new RegExp(first.slice(0, 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*is first'));
});

test('New task: the field first, with focus; a document is a small link, and the box takes a drop', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => App.navigate('#/capture'));
  await page.locator('#cap-text').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cap-text');
  const order = await page.evaluate(() => { const a = document.querySelector('#cap-text'), b = document.querySelector('#dropbtn'); return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING; });
  assert.ok(order, 'Add a document comes after the field');
  assert.match(await page.locator('#dropbtn').textContent(), /Add a document/);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    window.__dt = dt;
    document.querySelector('#cap-text').dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  assert.equal(await page.locator('.cap-dropzone').isVisible(), true, 'the box is a drop zone while a file is dragged');
  await page.evaluate(() => document.querySelector('#cap-text').dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  await page.locator('#files li').first().waitFor();
  assert.equal(await page.locator('.cap-dropzone').isVisible(), false);
});
