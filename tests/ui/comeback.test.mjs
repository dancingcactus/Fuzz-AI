/* Cards that come back to ask share one layout and one set of keys (the ADHD pass, #6): numbered ways
   forward, and It still matters (K), Later (S) and Let it go (L) in the same row on every one.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9290 + Math.floor(Math.random() * 100);
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

/* Bring a task to the front as a card that came back: set its flags first */
async function show(id, flags) {
  await page.evaluate(([id, flags]) => {
    const it = Store.item(id); Object.assign(it, flags || {});
    if (!Store.inQueue(id)) Store.enqueue(it, 'front');
    Store.pick(id); App.refresh();
  }, [id, flags]);
  await page.locator('#card .comeback').waitFor();
}
const row = () => page.locator('.comeback .card-actions [aria-keyshortcuts]').evaluateAll(bs => bs.map(b => b.getAttribute('aria-keyshortcuts')));

for (const [name, id, flags, keys] of [
  ['quiet for a while', 'naming', null, ['K', 'S', 'L']],
  ['keeps coming back', 'vendor', null, ['K', 'S', 'L']],
  ['back from Parked', 'vendor', { putOff: false, review: true }, ['S', 'L']],
  ['waiting on someone', 'vendor', { putOff: false, checkBack: true, waitingOn: 'Dana' }, ['S', 'L']],
]) {
  test(`${name}: a lead, then the same keys on every card`, async () => {
    await show(id, flags);
    const have = await row();
    for (const k of keys) assert.ok(have.includes(k), `${k} is on the card`);
    assert.equal(await page.locator('.comeback .card-actions > .btn.primary, .comeback .card-actions > .split > .primary, .comeback .card-actions > .ca-ans.primary').count() >= 1, true, 'one lead');
    assert.equal(await page.locator('.comeback .card-actions .primary:not(.more-btn)').count(), 1, 'one fill');
    for (const gone of ['U', 'R']) assert.equal(await page.locator(`#card [aria-keyshortcuts="${gone}"]`).count(), 0, `${gone} is retired`);
  });
}

test('a check-back: 1 is They got back to me', async () => {
  await show('vendor', { putOff: false, checkBack: true, waitingOn: 'Dana' });
  assert.match(await page.locator('#ask').textContent(), /Has Dana gotten back to you\?/);
  await page.keyboard.press('1');
  await page.waitForFunction(() => !Store.item('vendor').checkBack);
});

test('keeps coming back: 1 is Help me start, and L lets it go', async () => {
  await show('vendor');
  assert.match(await page.locator('.comeback .card-actions > .ca-lead-btn').textContent(), /Help me start/);
  await page.keyboard.press('l');
  await page.waitForFunction(() => Store.item('vendor').state === 'letgo');
});

test('S opens the time picker on a card that came back, and Esc goes back to it', async () => {
  await show('naming');
  await page.keyboard.press('s');
  await page.locator('.sched-panel').waitFor();
  assert.equal(await page.locator('.comeback').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.locator('.comeback').waitFor();
  assert.equal(await page.locator('#actions .sched-panel').count(), 0);
});
