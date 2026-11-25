/* Dump mode on the New box (docs/dump-mode.md): a toggle, a quiet "Split it?" offer that never interrupts, a review
   of Fuzz's split that makes nothing until you keep it, and Focus time with no review at all.
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

const SPLIT = {
  id: 7, state: 'ready', say: 'I’ve got all of it.',
  items: [{ id: 1, group: 'task', text: 'Send the budget numbers', keep: true }, { id: 2, group: 'task', text: 'Call the dentist', keep: true },
    { id: 3, group: 'note', text: 'The vendor seems slow lately', keep: true }, { id: 4, group: 'later', text: 'Learn to bake bread', keep: true },
    { id: 5, group: 'done', text: 'Paid the parking ticket', keep: false }],
};
const DUMP = 'send the budget numbers\ncall the dentist\nthe vendor seems slow lately\nsomeday learn to bake bread';

beforeEach(async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#card [data-act]').first().waitFor();
  await page.evaluate((split) => {
    window.calls = [];
    window.nextDump = split;
    Live.on = () => true;   /* the core's calls are stubbed: the screen is what's under test */
    Live.dumpStart = (t, d) => { calls.push(['start', t, d]); return Promise.resolve({ dump_id: 7 }); };
    Live.dumpGet = () => Promise.resolve(window.nextDump);
    Live.dumpRevise = (id, said) => { calls.push(['revise', said]); return Promise.resolve({}); };
    Live.dumpCommit = (id, accept) => { calls.push(['commit', accept]); return Promise.resolve({ task_ids: [11, 12, 13] }); };
    Live.dumpOneTask = () => { calls.push(['one']); return Promise.resolve({ task_ids: [14] }); };
    Live.dumpDiscard = () => { calls.push(['discard']); return Promise.resolve(); };
    App.navigate('#/capture');
  }, SPLIT);
  await page.locator('#cap-text').waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

const paste = (text) => page.evaluate((t) => {
  const ta = document.getElementById('cap-text');
  ta.value = t;
  ta.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true }));
}, text);
const calls = () => page.evaluate(() => window.calls);

test('a pasted list shows a quiet offer: no dialog, the cursor stays, and Enter still captures one task', async () => {
  await page.locator('#cap-text').focus();
  assert.equal(await page.locator('#cap-offer').textContent(), '');
  await paste(DUMP);
  await page.locator('#cap-split').waitFor();
  assert.match(await page.locator('#cap-offer').textContent(), /This looks like a few things/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'cap-text', 'the offer never takes focus');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('#cap-offer').getAttribute('aria-live'), 'polite');
  await page.keyboard.press('Meta+Enter');   /* not answering it is a whole answer: it captures as it always did */
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual(await calls(), []);
  assert.equal(await page.locator('#cap-offer').textContent(), '', 'and the offer is gone with the text');
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

test('taking the offer shows the split, and nothing is made until you keep it', async () => {
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.locator('#cap-keep').waitFor();
  assert.deepEqual((await calls())[0], ['start', DUMP, false]);
  const groups = await page.locator('#cap-review .grp').allTextContents();
  assert.deepEqual(groups, ['To do', 'For later', 'To keep', 'Already done, or not yours']);
  assert.equal(await page.locator('#cap-review input[data-item]:checked').count(), 4, 'what Fuzz would keep is ticked, the done one is not');
  assert.equal((await calls()).some(c => c[0] === 'commit'), false);
  await page.locator('#cap-review [data-item="2"]').uncheck();
  await page.locator('#cap-keep').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'commit'));
  assert.deepEqual((await calls()).find(c => c[0] === 'commit')[1].sort(), [1, 3, 4]);
  await page.locator('#cap-compose').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cap-text').inputValue(), '');
  assert.match(await page.locator('#bubble').textContent(), /Kept\. They’re waiting in Triage/);
});

test('in the onboarding, a dump counts as the first capture: its first task goes on to the wait', async () => {
  await page.evaluate(() => { Store.item = (id) => ({ id, coreId: +id.slice(1) }); Onboard.captured = (it) => { window.calls.push(['onboard', it.id]); return true; }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.locator('#cap-keep').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'onboard'));
  assert.deepEqual((await calls()).find(c => c[0] === 'onboard'), ['onboard', 't11']);
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

test('Esc in the review goes back to your words and drops the dump', async () => {
  await page.evaluate(() => { document.getElementById('cap-dumpmode').click(); });
  await page.fill('#cap-text', DUMP);
  await page.keyboard.press('Meta+Enter');
  await page.locator('#cap-keep').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#cap-compose').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#cap-text').inputValue(), DUMP, 'your words are still there');
  assert.ok((await calls()).some(c => c[0] === 'discard'));
});

test('tell Fuzz to change it runs the split again with your words', async () => {
  await page.evaluate(() => { document.getElementById('cap-dumpmode').click(); });
  await page.fill('#cap-text', DUMP);
  await page.keyboard.press('Meta+Enter');
  await page.locator('#cap-keep').waitFor();
  await page.fill('#cap-change', 'Make the dentist a note');
  await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'revise'));
  assert.deepEqual((await calls()).find(c => c[0] === 'revise'), ['revise', 'Make the dentist a note']);
});

test('a split that fails says your words are safe and offers one task', async () => {
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'failed', error: 'Fuzz took too long to split it', items: [] }; document.getElementById('cap-dumpmode').click(); });
  await page.fill('#cap-text', DUMP);
  await page.keyboard.press('Meta+Enter');
  await page.locator('[data-dump="one"]').waitFor();
  assert.match(await page.locator('#cap-review').textContent(), /Your words are safe/);
  await page.locator('[data-dump="one"]').click();
  await page.waitForFunction(() => window.calls.some(c => c[0] === 'one'));
});

test('with a real Focus time session running, New still knows it, so the dump goes in with no review', async () => {
  /* nothing about the session is stubbed: the session survives a visit to another page, and so does active() */
  await page.evaluate(() => App.navigate('#/deepwork'));
  await page.locator('#dw-go').click();
  await page.locator('#dw-step').waitFor();
  await page.keyboard.press('n');
  await page.locator('#cap-text').waitFor();
  assert.equal(await page.evaluate(() => DeepWorkView.active()), true, 'the session is still running on New');
  await page.evaluate(() => { window.nextDump = { id: 7, state: 'committed', items: [] }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual((await calls())[0], ['start', DUMP, true]);
  assert.equal(await page.locator('#cap-keep').count(), 0);
});

test('in Focus time there is no review: the words go in, and the box clears', async () => {
  await page.evaluate(() => { window.DeepWorkView = Object.assign({}, window.DeepWorkView, { active: () => true }); window.nextDump = { id: 7, state: 'committed', items: [] }; });
  await paste(DUMP);
  await page.locator('#cap-split').click();
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual((await calls())[0], ['start', DUMP, true]);
  assert.equal(await page.locator('#cap-keep').count(), 0, 'no review in Focus time');
  await page.waitForFunction(() => /Sorted/.test(document.getElementById('bubble').textContent));
});
