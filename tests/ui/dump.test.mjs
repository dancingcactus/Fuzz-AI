/* Dump mode on the New box (docs/dump-mode.md): a switch, a quiet offer to its right that never interrupts, and Sort it
   out, which splits what you wrote and adds the tasks as a best guess (no review for now; Undo takes them back).
   The core's side is in core/tests/test_dump.py; here the Live calls are stubbed on the demo page.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/* A free port from the OS, so parallel test files never collide */
const PORT = await new Promise((res, rej) => { const srv = createServer(); srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); }); srv.on('error', rej); });
let server, browser, page;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

const DUMP = 'send the budget numbers\ncall the dentist\nthe vendor seems slow lately\nsomeday learn to bake bread';

beforeEach(async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#card [data-act]').first().waitFor();
  await page.evaluate((text) => {
    window.calls = [];
    window.nextDump = { id: 7, state: 'splitting', text };
    Live.on = () => true;   /* the core's calls are stubbed: the screen is what's under test */
    Live.dumpStart = (t, d) => { calls.push(['start', t, d]); return Promise.resolve({ dump_id: 7 }); };
    Live.dumpGet = () => Promise.resolve(window.nextDump);
    window.realSync = Live.sync;
    Live.sync = () => { calls.push(['sync']); return Promise.resolve(); };
    App.navigate('#/capture');
  }, DUMP);
  await page.locator('#cap-text').waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

const paste = (text) => page.evaluate((t) => {
  const ta = document.getElementById('cap-text');
  ta.value = t;
  ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
}, text);
const calls = () => page.evaluate(() => window.calls);
const said = () => page.locator('#bubble').textContent();

test('a pasted list shows a quiet offer: no dialog, the cursor stays, and Enter still captures one task', async () => {
  await page.locator('#cap-text').focus();
  assert.equal(await page.locator('#cap-offer').textContent(), '');
  await paste(DUMP);
  await page.locator('#cap-split').waitFor();
  assert.match(await page.locator('#cap-offer').textContent(), /Looks like a few things/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cap-text', 'the offer never takes focus');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('#cap-offer').getAttribute('aria-live'), 'polite');
  await page.keyboard.press('Meta+Enter');   /* not answering it is a whole answer: it captures as it always did */
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual(await calls(), []);
  assert.equal(await page.locator('#cap-offer').textContent(), '', 'and the offer is gone with the text');
});

test('the offer sits to the right of the switch, on its row, and the row is there before the offer is', async () => {
  const before = await page.locator('.cap-modebar').boundingBox();
  await paste(DUMP);
  await page.locator('#cap-split').waitFor();
  const after = await page.locator('.cap-modebar').boundingBox();
  assert.equal(after.height, before.height, 'the offer takes no new space, so nothing under it moves');
  const sw = await page.locator('#cap-dumpmode').boundingBox();
  const offer = await page.locator('#cap-offer').boundingBox();
  assert.ok(offer.x >= sw.x + sw.width, 'to the right of the switch');
  assert.ok(Math.abs((offer.y + offer.height / 2) - (sw.y + sw.height / 2)) < sw.height / 2, 'on the same row');
});

test('the offer does not appear while you are typing, or for a short list', async () => {
  await page.locator('#cap-text').focus();
  await page.keyboard.type('one line of words that goes on and on and on');
  assert.equal(await page.locator('#cap-offer').textContent(), '');
  await paste('first\nsecond');
  assert.equal(await page.locator('#cap-offer').textContent(), '', 'two lines are not a few things');
  await page.evaluate(() => { document.getElementById('cap-text').value = ''; document.getElementById('cap-text').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.type('a');
  await page.keyboard.press('Enter');
  await page.keyboard.type('b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('c');
  assert.equal(await page.locator('#cap-offer').textContent(), '', 'typed words never bring it up mid-line');
  await page.keyboard.press('Enter');   /* a line break is the text landing */
  await page.locator('#cap-split').waitFor();
});

test('taking the offer sorts it out at once: no review, the box clears, and the tasks are in Triage when it is done', async () => {
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual((await calls())[0], ['start', DUMP, false]);
  assert.equal(await page.locator('#cap-keep, #cap-review, [data-dump]').count(), 0, 'nothing to approve: it is a best guess');
  assert.equal(await page.locator('#cap-dumpmode').getAttribute('aria-checked'), 'true', 'taking it turns the switch on');
  assert.match(await said(), /Sorting it out/);
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'committed', task_ids: [11, 12, 13] }; });
  await page.waitForFunction(() => /Sorted\. They’re waiting in Triage/.test(document.getElementById('bubble').textContent), null, { timeout: 15000 });
  assert.ok((await calls()).some(c => c[0] === 'sync'), 'and the screen reloads from the core');
});

test('the page drawing New again while it sorts changes nothing: the switch stays on and the result still shows', async () => {
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'start'));
  await page.evaluate(() => { App.navigate('#/triage'); });   /* away and back: the view is drawn again, as it is when the core syncs */
  await page.locator('#card [data-act]').first().waitFor();
  await page.evaluate(() => { App.navigate('#/capture'); });
  await page.locator('#cap-text').waitFor();
  assert.equal(await page.locator('#cap-dumpmode').getAttribute('aria-checked'), 'true', 'the switch is as you left it');
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'committed', task_ids: [11, 12] }; });
  await page.waitForFunction(() => /Sorted\. They’re waiting in Triage/.test(document.getElementById('bubble').textContent), null, { timeout: 15000 });
  await page.evaluate(() => { App.navigate('#/triage'); });   /* and drawn again after it said so: it still says so */
  await page.locator('#card [data-act]').first().waitFor();
  await page.evaluate(() => { App.navigate('#/capture'); });
  await page.locator('#cap-text').waitFor();
  assert.match(await said(), /Sorted\. They’re waiting in Triage/);
});

test('with the switch on, the button says Sort it out and does the same', async () => {
  await page.locator('#cap-dumpmode').click();
  assert.equal((await page.locator('#cap-go').textContent()).trim(), 'Sort it out');
  await page.fill('#cap-text', 'ring the dentist\nsend the budget\nbook the room');
  await page.locator('#cap-go').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'start'));
  assert.deepEqual((await calls())[0], ['start', 'ring the dentist\nsend the budget\nbook the room', false]);
  assert.equal(await page.locator('#cap-dumpmode').getAttribute('aria-checked'), 'true', 'it stays on until you flip it back');
});

test('a dump with nothing to do says it is all kept', async () => {
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'committed', task_ids: [] }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => /nothing to do in it, and it’s all kept/.test(document.getElementById('bubble').textContent), null, { timeout: 15000 });
});

test('a sort that fails puts your words back in the box', async () => {
  await page.evaluate((text) => { window.nextDump = { id: 7, state: 'failed', text, error: 'Fuzz took too long to split it' }; }, DUMP);
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction((t) => document.getElementById('cap-text').value === t, DUMP, { timeout: 15000 });
  assert.match(await said(), /couldn’t sort that one\. Your words are back in the box/);
});

test('Dump mode is a switch: it holds where you leave it, and the button says Sort it out while it is on', async () => {
  const sw = page.locator('#cap-dumpmode');
  assert.equal(await sw.getAttribute('role'), 'switch');
  assert.equal(await sw.getAttribute('aria-checked'), 'false');
  assert.equal((await page.locator('#cap-go').textContent()).trim(), 'Capture');
  await sw.focus();
  await page.keyboard.press('Space');
  assert.equal(await sw.getAttribute('aria-checked'), 'true');
  assert.equal((await page.locator('#cap-go').textContent()).trim(), 'Sort it out');
  await page.keyboard.press('Space');
  assert.equal(await sw.getAttribute('aria-checked'), 'false');
  assert.equal((await page.locator('#cap-go').textContent()).trim(), 'Capture');
});

test('in the onboarding, a dump counts as the first capture: its first task goes on to the wait', async () => {
  await page.evaluate(() => { Store.item = (id) => ({ id, coreId: +id.slice(1) }); Onboard.captured = (it) => { window.calls.push(['onboard', it.id]); return true; }; window.nextDump = { id: 7, state: 'committed', task_ids: [11, 12] }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'onboard'), null, { timeout: 15000 });
  assert.deepEqual((await calls()).find(c => c[0] === 'onboard'), ['onboard', 't11']);
});

test('with a real Focus time session running, New still knows it, so the dump goes in as Focus time work', async () => {
  /* nothing about the session is stubbed: the session survives a visit to another page, and so does active() */
  await page.evaluate(() => { Live.sync = window.realSync; App.navigate('#/deepwork'); });   /* the Guide uses the page's own sync */
  await page.locator('#dw-go').click();
  await page.locator('#dw-step').waitFor();
  await page.keyboard.press('n');
  await page.locator('#cap-text').waitFor();
  await page.evaluate(() => { Live.sync = () => { calls.push(['sync']); return Promise.resolve(); }; });
  assert.equal(await page.evaluate(() => DeepWorkView.active()), true, 'the session is still running on New');
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'committed', task_ids: [11] }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual((await calls())[0], ['start', DUMP, true]);
  await page.waitForFunction(() => /Sorted\. It’s in your Focus time/.test(document.getElementById('bubble').textContent), null, { timeout: 15000 });
});
