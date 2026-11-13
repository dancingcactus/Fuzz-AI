/* Check-ins count cards, and the bar shows the stretch to the next one as boxes (#9, docs/energy-and-priority.md).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9190 + Math.floor(Math.random() * 100);
let server, browser, page;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

/* A queue of n plain task cards (10 minutes, normal energy, from no one in particular), nothing due, so
   nothing holds a check-in back. The first `quick` of them take two minutes. */
async function plain(n, quick = 0) {
  await page.evaluate(([n, quick]) => {
    const st = Store.get();
    const tasks = st.queue.map(Store.item).filter(i => i.kind === 'task' && !i.group && i.state === 'triage');
    st.items.forEach(i => { i.dueAt = null; if (i.state === 'working' || i.state === 'queued') i.state = 'done'; });   /* no demo work lands mid-test */
    tasks.forEach((i, k) => Object.assign(i, { handedBack: false, result: false, foundOut: false, needsPermission: false, joinReply: false,
      kickoff: false, putOff: false, review: false, inTheWay: false, stage: 'fresh', who: 'Someone', energy: 'normal', mins: k < quick ? 2 : 10 }));
    tasks.slice(n).forEach(i => Store.leave(i.id));
    st.queue = tasks.slice(0, n).map(i => i.id);
    st.totalEver = st.queue.length;
    Store.emit({ type: 'work' });
  }, [n, quick]);
}

beforeEach(async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('#focuscard').waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

const boxes = () => page.evaluate(() => [...document.querySelectorAll('.pg-seg')].filter(s => !s.classList.contains('is-tick') && !s.classList.contains('is-bank')).length);
const checkinOpen = () => page.evaluate(() => !document.querySelector('#checkin').hidden);
async function start(n, quick) {
  await plain(n, quick);
  await page.keyboard.press('Escape');
  await page.locator('#card [data-act]').first().waitFor();
}
/* Park the card in front and wait for whatever comes next */
async function clear() {
  const id = await page.evaluate(() => Store.front().id);
  await page.keyboard.press('p');
  await page.waitForFunction((id) => !Store.inQueue(id), id);
  /* the cleared card flies to the bar first; then the check-in, or the next card, settles in */
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => !document.querySelector('#checkin').hidden || (document.querySelector('#card').style.display !== 'none' && Store.front() && (document.querySelector('#ask') || {}).textContent.includes(Store.front().title)));
}
async function answer(key) {
  await page.keyboard.press(key);
}

test('two boxes to start, and the check-in comes when they run out', async () => {
  await start(9);
  assert.equal(await boxes(), 2);
  await clear();
  assert.equal(await checkinOpen(), false);
  assert.equal(await boxes(), 1);
  await clear();
  assert.equal(await checkinOpen(), true, 'the boxes ran out');
  assert.equal(await boxes(), 0, 'none while it asks');
});

test('the answer sets the next stretch, and it comes without waiting on the clock', async () => {
  await start(9);
  await clear(); await clear();
  await answer('1');   /* Good: a stretch of 5 */
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  assert.equal(await boxes(), 5);
  for (let i = 0; i < 4; i++) { await clear(); assert.equal(await checkinOpen(), false); }
  await clear();
  assert.equal(await checkinOpen(), true, 'five cards, then the next check-in');
});

test('fewer cards than the stretch: only what’s left', async () => {
  await start(1);
  assert.equal(await boxes(), 1);
});

test('overloaded: a break offer, then what’s left out waits for tomorrow, with one Undo', async () => {
  await start(9);
  await clear(); await clear();
  await answer('4');   /* Overloaded */
  assert.deepEqual(await page.locator('#ci-follow .btn').allTextContents().then(t => t.map(x => x.replace(/\d$/, ''))), ['Take 5', 'Keep going']);
  await answer('2');
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => Store.queue().length), 0, 'plain cards wait for tomorrow');
  assert.equal(await page.evaluate(() => Store.energy()), 'overloaded');
  assert.equal(await checkinOpen(), false);
  /* Undo puts them all back: the next card shows, the stretch stays at two boxes */
  await page.evaluate(() => { Say.undoList()[0].run(); });
  await page.locator('#card [data-act]').first().waitFor();
  await page.waitForTimeout(400);
  assert.equal(await checkinOpen(), false);
  assert.equal(await page.evaluate(() => Store.queue().length), 7);
  assert.equal(await boxes(), 2);
});

test('tired: the quick ones first, the rest tomorrow, three boxes', async () => {
  await start(9, 5);
  await clear(); await clear();   /* two of the quick ones */
  await answer('3');   /* Tired */
  await answer('2');   /* Keep going */
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => Store.queue().map(i => i.mins)), [2, 2, 2]);
  assert.equal(await boxes(), 3);
});

test('a quick tired stretch asks for a few more, and Sure brings some back', async () => {
  await start(9, 3);
  await clear(); await clear();
  await answer('3'); await answer('2');   /* Tired, keep going: one quick card left, the rest tomorrow */
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  await clear();
  await page.waitForFunction(() => !document.querySelector('#checkin').hidden);
  assert.equal(await page.locator('#ci-h').textContent(), 'That went quickly. Want a few more?');
  assert.deepEqual(await page.locator('#ci-follow .btn').allTextContents().then(t => t.map(x => x.replace(/\d$/, ''))), ['Sure, just a few more', 'Nah, I’ve done the important stuff']);
  await answer('1');
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  assert.equal(await page.evaluate(() => Store.energy()), 'okay', 'one level up');
  assert.ok(await page.evaluate(() => Store.queue().length) > 0, 'some came back from tomorrow');
});

test('a few more is a few, not the whole pile', async () => {
  await start(9);
  await page.evaluate(() => { Store.queue().forEach(i => { i.energy = 'low'; }); Store.checkin('overloaded'); });
  assert.equal(await page.evaluate(() => Store.queue().filter(i => i.kind === 'task').length), 0);
  assert.equal(await page.evaluate(() => Store.more().back), 3, 'tired: a stretch of three');
  assert.equal(await page.evaluate(() => Store.more().back), 4, 'okay: four more');
  assert.equal(await page.evaluate(() => Store.get().items.filter(i => i.checkinHold && i.state === 'scheduled').length), 2, 'the rest stay held');
});

test('Nah ends the session warmly, and one more is a click away', async () => {
  await start(9, 3);
  await clear(); await clear();
  await answer('3'); await answer('2');
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  await clear();
  await page.waitForFunction(() => !document.querySelector('#checkin').hidden);
  await answer('2');
  await page.locator('.empty.rested').waitFor();
  assert.match(await page.locator('.empty.rested h2').textContent(), /important stuff/);
  assert.equal(await page.evaluate(() => Store.energy()), 'tired', 'nothing moved');
  /* the queue that ran out stays clear; adding one and asking for it brings it in */
  await page.evaluate(() => { const it = Store.get().items.find(i => i.kind === 'task' && i.state === 'scheduled'); Store.enqueue(it, 'back'); Store.emit({ type: 'review' }); });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.empty.rested').count(), 1, 'a new card waits behind the rest screen');
  await page.locator('[data-rest="more"]').click();
  await page.locator('#card [data-act]').first().waitFor();
});

test('several put off in a row bring an early check-in that offers to make it lighter', async () => {
  await start(9);
  await clear(); await clear();
  await answer('2');   /* Okay: a stretch of four */
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  await page.locator('#card [data-act]').first().waitFor();
  for (let i = 0; i < 3; i++) {
    const id = await page.evaluate(() => Store.front().id);
    await page.keyboard.press('s');
    await page.locator('[data-sched="back"]').click();
    await page.waitForFunction((id) => Store.front().id !== id, id);
    await page.waitForTimeout(1500);
  }
  await page.waitForFunction(() => !document.querySelector('#checkin').hidden);
  assert.match(await page.locator('#ci-h').textContent(), /lighter/);
  await answer('1');
  await page.waitForFunction(() => document.querySelector('#checkin').hidden);
  assert.equal(await page.evaluate(() => Store.energy()), 'tired');
});

test('while something due holds the check-in back, the card in front is one box', async () => {
  await start(9);
  await page.evaluate(() => { const q = Store.queue(); q[3].dueAt = Date.now() + 3 * 3600000; Store.emit({ type: 'work' }); });
  await clear(); await clear();
  assert.equal(await checkinOpen(), false, 'it waits for the due card');
  assert.equal(await boxes(), 1);
});
