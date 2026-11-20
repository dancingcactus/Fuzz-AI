/* Short sessions: about 15 minutes into Triage, the smaller cards wait and the session ends on All clear, with
   the next few in My work under it. Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9900 + Math.floor(Math.random() * 100);
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

/* The queue: two plain tasks, one Fuzz is waiting on you for (a nudge you asked for), and Fuzz's memory question
   about Dana. Nothing due, no demo work landing mid-test. */
async function setQueue() {
  await page.evaluate(() => {
    const st = Store.get();
    st.items.forEach(i => { i.dueAt = null; if (['working', 'queued', 'review'].includes(i.state)) i.state = 'done'; });
    const tasks = st.queue.map(Store.item).filter(i => i.kind === 'task' && !i.group && i.state === 'triage').slice(0, 3);
    tasks.forEach(i => Object.assign(i, { handedBack: false, result: false, foundOut: false, needsPermission: false, joinReply: false, nudged: false,
      kickoff: false, isNew: false, putOff: false, review: false, inTheWay: false, stage: 'fresh', who: 'Someone', energy: 'normal', mins: 10 }));
    tasks[1].nudged = true;   /* waiting on you: it never waits */
    const dana = Store.item('dana');
    st.queue = [tasks[0].id, tasks[1].id, 'dana', tasks[2].id];
    st.totalEver = st.queue.length;
    window.__ids = { plain: [tasks[0].id, tasks[2].id], keep: tasks[1].id, dana: dana.id };
    Store.emit({ type: 'work' });
  });
  await page.evaluate(() => TriageView.refresh());
  await page.locator('#card [data-act]').first().waitFor();
}
async function park() {
  const id = await page.evaluate(() => Store.front().id);
  await page.keyboard.press('p');
  await page.waitForFunction((id) => !Store.inQueue(id), id);
  await page.waitForTimeout(1500);
}
const onScreen = () => page.evaluate(() => { const c = document.querySelector('#card'); return c.style.display !== 'none' && Store.shown(); });

test('in the first 15 minutes nothing waits', async () => {
  await setQueue();
  assert.equal(await page.evaluate(() => Store.deferredCount()), 0);
  await park();
  assert.equal(await page.evaluate(() => Store.deferredCount()), 0);
  assert.ok(await onScreen(), 'the next card comes as usual');
});

test('after 15 minutes the smaller cards wait, and Triage ends on All clear with My work under it', async () => {
  await setQueue();
  await page.evaluate(() => TriageView.sessionStartedAgo(16));
  /* the card on screen stays put: the clock is only read between cards */
  const first = await page.evaluate(() => Store.shown());
  await page.evaluate(() => TriageView.refresh());
  assert.equal(await page.evaluate(() => Store.shown()), first, 'the card on screen never moves');
  await park();
  /* the plain task and Dana wait; the one Fuzz is waiting on you for comes next */
  assert.equal(await onScreen(), await page.evaluate(() => __ids.keep));
  assert.equal(await page.evaluate(() => Store.deferredCount()), 2);
  assert.equal(await page.evaluate(() => Store.queue().length), 3, 'they wait in the queue, not gone');
  await park();
  await page.locator('.empty h2').waitFor();
  assert.equal(await page.locator('.empty h2').textContent(), 'All clear');
  assert.match(await page.locator('.empty .ac-wait').textContent(), /2 smaller cards can wait/);
  assert.equal(await page.evaluate(() => document.getElementById('left').textContent), 'All clear', 'the header agrees');
  /* the next few in My work, each opening the Guide with it picked */
  const rows = page.locator('.empty .ac-next a.g-row');
  assert.ok(await rows.count() >= 1 && await rows.count() <= 3);
  const want = await page.evaluate(() => DeepWorkView.upNext(3).map(i => i.title));
  assert.deepEqual(await rows.locator('b').allTextContents(), want);
  assert.match(await rows.first().getAttribute('href'), /^#\/work\//);
});

test('Show them brings the smaller cards back for this session', async () => {
  await setQueue();
  await page.evaluate(() => TriageView.sessionStartedAgo(16));
  await park(); await park();
  await page.locator('.empty .ac-wait button').click();
  /* the next card, or the usual check-in first (two cards were cleared) */
  await page.waitForFunction(() => !document.querySelector('#checkin').hidden || (document.querySelector('#card').style.display !== 'none' && Store.shown()));
  assert.equal(await page.locator('.empty').count(), 0, 'All clear is gone');
  assert.equal(await page.evaluate(() => Store.deferredCount()), 0);
  /* Dana's card can't be parked; the plain one behind it can, so answer Dana by moving on with Not sure yet */
  assert.equal(await page.evaluate(() => Store.queue().length), 2);
});

test('the All clear lists My work even when nothing waited', async () => {
  await page.evaluate(() => { const st = Store.get(); st.items.forEach(i => { if (['working', 'queued', 'review'].includes(i.state)) i.state = 'done'; }); st.queue.slice().forEach(id => Store.leave(id)); Store.emit({ type: 'work' }); TriageView.refresh(); });
  await page.locator('.empty h2').waitFor();
  assert.equal(await page.locator('.empty h2').textContent(), 'All clear');
  assert.equal(await page.locator('.empty .ac-wait').count(), 0);
  assert.ok(await page.locator('.empty .ac-next a.g-row').count() >= 1);
});
