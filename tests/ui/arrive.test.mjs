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
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#card [data-act]').first().waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

/* The card on screen is this one: its heading is the task's title or its question */
const showing = (id) => page.evaluate((id) => {
  const i = Store.item(id), h = document.getElementById('ask').textContent.replace(/^The one thing to decide: /, '').trim();
  return h === i.title || h === i.ask;
}, id);

test('Triage opens on the first card: no “while you were away” screen, no focus question (#31)', async () => {
  assert.equal(await page.locator('#focuscard').isHidden(), true);
  assert.equal(await page.locator('.arrive-list, .arrive-pick').count(), 0);
  assert.ok(await showing(await page.evaluate(() => Store.front().id)), 'the front card is on screen');
});

test('F still asks what we’re working on', async () => {
  await page.keyboard.press('f');
  await page.locator('#focuscard #fo-q').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#card [data-act]').first().waitFor();
});

test('a card picked from Lineup opens in Triage, straight away (#31)', async () => {
  await page.evaluate(() => App.navigate('#/tasks'));
  await page.locator('#decide-list').waitFor();
  await page.click('#decide-list summary');
  const rows = page.locator('#decide-list [data-pick]');
  const pick = await rows.nth(await rows.count() - 1);
  const id = await pick.getAttribute('data-pick');
  assert.notEqual(id, await page.evaluate(() => Store.front().id), 'pick one that isn’t already first');
  await pick.click();
  await page.locator('#card [data-act]').first().waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/triage');
  assert.equal(await page.locator('#focuscard').isHidden(), true);
  assert.equal(await page.evaluate(() => Store.front().id), id);
  assert.ok(await showing(id), 'the card you picked is on screen');
});

test('the header shows the stretch to the first check-in, not the whole queue (#9)', async () => {
  const open = await page.evaluate(() => [...document.querySelectorAll('.pg-seg')].filter(s => !s.classList.contains('is-tick') && !s.classList.contains('is-bank') && !s.classList.contains('is-ghost')).length);
  assert.equal(open, await page.evaluate(() => Math.min(2, Store.queue().length)));
});

test('Lineup names what’s first, with no counts of what’s left', async () => {
  await page.evaluate(() => App.navigate('#/tasks'));
  await page.locator('#board .decide').waitFor();
  assert.equal(await page.locator('.decide-n').count(), 0);
  assert.equal(await page.locator('#board h2 .lcount').count(), 0);
  const first = await page.evaluate(() => Store.front().title);
  assert.match(await page.locator('#board .decide').textContent(), new RegExp(first.slice(0, 15).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*is first'));
});

test('New: the field first, with focus; + and the mic sit in the box, as on Tell Fuzz, and the box takes a drop', async () => {
  await page.evaluate(() => App.navigate('#/capture'));
  await page.locator('#cap-text').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cap-text');
  const inBox = await page.evaluate(() => ['#cap-text', '#cap-plus', '#cap-mic'].map(s => !!document.querySelector('.cap-drop .composer ' + s)));
  assert.deepEqual(inBox, [true, true, true], 'the field, + and the mic share one box');
  assert.equal(await page.locator('.cap-drop label:not(.sr)').count(), 0, 'no New task heading over the box');
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
