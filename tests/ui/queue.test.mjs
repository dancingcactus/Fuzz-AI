/* The card on screen stays at the front of the queue until you act on it (the ADHD pass, finding #1).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8890 + Math.floor(Math.random() * 100);
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

/* A task not in the queue, sent to the queue with a deadline: it would sort ahead of anything without one */
async function arriveWithDeadline() {
  return page.evaluate(() => {
    const it = Store.get().items.find(i => i.kind === 'task' && !Store.inQueue(i.id));
    it.dueAt = Date.now() + 10 * 60000;
    Store.enqueue(it, 'back');
    it.order = Store.get().minOrder - 100; Store.sortQueue();   /* ahead of every other deadline: only the pin keeps the shown card first */
    Store.emit({ type: 'review' });
    return it.id;
  });
}

test('a card that arrives with a deadline waits behind the card on screen', async () => {
  const shown = await page.evaluate(() => Store.shown());
  assert.ok(shown, 'the card on screen is pinned');
  const late = await arriveWithDeadline();
  const q = await page.evaluate(() => Store.get().queue.slice(0, 2));
  assert.equal(q[0], shown, 'the card on screen is still first');
  assert.equal(q[1], late, 'the newcomer comes next');
  /* and the deadline pill is not painted from the newcomer */
  await page.waitForTimeout(1200);
  const pill = await page.evaluate(() => { const d = document.querySelector('#duetag'); return d && !d.hidden ? d.textContent : ''; });
  const shownDue = await page.evaluate((id) => !!Store.item(id).dueAt, shown);
  if (!shownDue) assert.equal(pill, '', 'no pill borrowed from the queue');
  /* without the pin, the newcomer would have taken the front from under the card on screen */
  assert.equal(await page.evaluate(() => { Store.unpin(); Store.sortQueue(); return Store.front().id; }), late);
});

test('acting on the card lets go, and the newcomer comes in', async () => {
  const late = await arriveWithDeadline();
  await page.evaluate(() => { const id = Store.shown(); Store.park(id); App.refresh(); });
  assert.equal(await page.evaluate(() => Store.front().id), late);
  await page.waitForFunction((id) => Store.shown() === id, late);
});
