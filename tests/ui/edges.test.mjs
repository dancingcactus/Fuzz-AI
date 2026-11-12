/* Edges of the ADHD pass: the pin lets go when you ask for a different card, panels on cards that came
   back, notes with every choice, results, the working card, entity notes and a draft arriving.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9590 + Math.floor(Math.random() * 100);
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

async function show(id, flags) {
  await page.evaluate(([id, flags]) => {
    const it = Store.item(id); Object.assign(it, flags || {});
    if (!Store.inQueue(id)) Store.enqueue(it, 'back');
    Store.pick(id); App.refresh();
  }, [id, flags]);
  await page.waitForFunction((id) => Store.shown() === id, id);
}
const said = (id) => page.evaluate((id) => Store.item(id).log.filter(l => l.kind === 'guidance').map(l => l.text), id);

test('bringing a card to the front lets go of the pin, as does a focus or a mood', async () => {
  /* Deadlines still sort first, as before; what matters is the card on screen no longer holds the front */
  for (const act of [
    () => { const id = Store.get().queue[3]; Store.bringBack(id, 'front'); },
    () => { Store.setFocus('x', [Store.get().queue.slice(-1)[0]]); },
    () => { Store.setMoment('low'); },
  ]) {
    const released = await page.evaluate((src) => { Store.show(Store.front().id); (0, eval)('(' + src + ')')(); return Store.get().shown; }, act.toString());
    assert.equal(released, null);
  }
});

test('Book time on a card that came back shows the booking panel, and Esc goes back', async () => {
  await show('naming');
  await page.keyboard.press('b');
  await page.locator('#actions .sched-panel').waitFor();
  assert.equal(await page.locator('.comeback').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.locator('.comeback').waitFor({ state: 'visible' });
});

test('⌘ Enter on a check-back keeps the note instead of handing it over', async () => {
  await show('vendor', { putOff: false, checkBack: true, waitingOn: 'Dana' });
  await page.keyboard.press('e');
  await page.keyboard.type('She is out until Monday');
  await page.keyboard.press('Meta+Enter');
  assert.equal(await page.evaluate(() => Store.inQueue('vendor')), true, 'not handed over');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ask');
  await page.keyboard.press('s');
  await page.waitForFunction(() => !Store.inQueue('vendor'));
  assert.ok((await said('vendor')).includes('You said: She is out until Monday'));
});

test('a note goes with I did it', async () => {
  await show('room');
  await page.keyboard.press('e');
  await page.keyboard.type('Booked it myself on 3');
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  await page.waitForFunction(() => Store.item('room').state === 'done');
  assert.ok((await said('room')).includes('You said: Booked it myself on 3'));
});

test('a result keeps its follow-up answer, and its brief isn’t folded', async () => {
  await show('naming', { stage: 'fresh', handedBack: true, result: true, quick: ['Draft the guide from the notes'] });
  assert.equal(await page.locator('.answers .ans[data-quick]').count(), 1);
  assert.equal(await page.locator('#details').count(), 0);
});

test('the working card isn’t folded', async () => {
  await show('naming', { stage: 'fresh' });
  await page.evaluate(() => { Store.doNow('naming'); App.refresh(); });
  await page.locator('.working-actions').waitFor();
  assert.equal(await page.locator('#details').count(), 0);
});

test('an entity card: numbers answer it, and the note is a link (E)', async () => {
  await show('dana');
  assert.equal(await page.locator('#note').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ask');
  await page.keyboard.press('e');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'note');
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
  await page.waitForFunction(() => !Store.inQueue('dana'));
});

test('a draft that arrives waits as a quiet line above the card on screen', async () => {
  const shown = await page.evaluate(() => Store.shown());
  await page.evaluate(() => {
    const it = Store.get().items.find(i => i.kind === 'task' && !Store.inQueue(i.id));
    it.state = 'review'; it.draft = 'Hi'; Store.queueUp(it, 'back'); Store.emit({ type: 'review', item: it }); window.__rv = it.title;
  });
  const line = page.locator('#upnext');
  await line.waitFor();
  assert.match(await line.textContent(), /is ready for your OK/);
  assert.equal(await page.evaluate(() => Store.shown()), shown, 'the card on screen stays');
});

test('after Undo, a note goes with the next choice once', async () => {
  await show('room');
  await page.keyboard.press('e');
  await page.keyboard.type('Not this quarter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await page.waitForFunction(() => Store.item('room').state === 'parked');
  await page.evaluate(() => { Say.undoList()[0].run(); });
  await page.waitForFunction(() => Store.inQueue('room'));
  await show('room');
  assert.equal(await page.locator('#instr').inputValue(), 'Not this quarter', 'the note is still in the box');
  await page.keyboard.press('x');
  await page.waitForFunction(() => Store.item('room').state === 'letgo');
  const told = await page.evaluate(() => Store.item('room').log.filter(l => !l.undone && l.text === 'You said: Not this quarter').length);
  assert.equal(told, 1);
});
