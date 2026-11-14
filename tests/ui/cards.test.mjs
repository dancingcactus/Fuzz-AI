/* The task and question cards (the ADHD pass, #3 and #4): a question answered on the card with numbered
   answers, an ordinary task that leads with the task and Hand it to Fuzz, and the rest under Details.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9090 + Math.floor(Math.random() * 100);
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

async function show(id) {
  await page.evaluate((id) => { Store.pick(id); App.refresh(); }, id);
  await page.waitForFunction((id) => Store.shown() === id, id);
}
const ask = () => page.locator('#ask').textContent();

test('an ordinary task leads with the task, and Fuzz’s plan is plain text', async () => {
  const t = await page.evaluate(() => Store.front());
  assert.match(await ask(), new RegExp(t.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(await page.locator('#plan').isVisible(), true);
  assert.equal(await page.locator('#instr').isVisible(), false, 'no text box until you ask for one');
  assert.match(await page.locator('#card [data-act="assign"]').first().getAttribute('class'), /primary/);
  assert.match(await page.locator('#card [data-act="assign"]').first().textContent(), /Hand it to Fuzz/);
});

test('a task card shows three moves and one filled button; every other move waits behind an arrow', async () => {
  const shown = await page.evaluate(() => [...document.querySelectorAll('#actions .actions > .split > .split-main')].filter(b => b.offsetParent).map(b => b.dataset.act));
  assert.deepEqual(shown, ['assign', 'schedule', 'done']);
  assert.equal(await page.locator('#card .btn.primary.split-main').count(), 1);
  for (const act of ['claude', 'findout', 'book', 'deepwork', 'park', 'waiting', 'theirs']) {
    assert.equal(await page.locator(`#card [data-act="${act}"]`).count(), 1, act + ' is still on the card');
    assert.equal(await page.locator(`#card [data-act="${act}"]`).isVisible(), false, act + ' waits behind an arrow');
  }
  /* Deep Work sits under Later: it's yours, for when you have the time, not a way of handing it off */
  assert.equal(await page.locator('#latermenu [data-act="deepwork"]').count(), 1);
});

test('the top line keeps where it came from, its size and when it’s due; age is under Details, never a warning', async () => {
  await show('room');
  const top = await page.locator('#card .eyebrow').textContent();
  assert.doesNotMatch(top, /Aging|Sitting|\d+ days?\b/);
  assert.equal(await page.locator('#card .eb-warn').count(), 0);
  assert.match(await page.locator('#details .about').textContent(), /Came in/);
});

test('every card says its id: a task its task number, a deliverable or memory card its card number', async () => {
  const tags = await page.evaluate(() => [
    { coreId: 14, kind: 'task', id: 't14' }, { coreId: 15, kind: 'task', cardKind: 'hold', cardId: 3, id: 't15' },
    { kind: 'deliv', cardId: 7, id: 'c7' }, { kind: 'task', id: 'local-1' },
  ].map(it => new DOMParser().parseFromString(UI.idTag(it), 'text/html').querySelector('.taskid-txt').textContent));
  assert.deepEqual(tags, ['Task #14', 'Task #15', 'Card #7', 'Local local-1']);
});

test('a memory card left in front keeps its own answers: What’s in the way? is for tasks', { timeout: 60000 }, async () => {
  await page.evaluate(() => {
    const st = Store.get();
    st.work = { stuck_minutes: { sort: 0.001, work: 25 } };
    st.items.push({ id: 'c901', kind: 'deliv', cardKind: 'fact_conflict', cardId: 901, memory: true, state: 'triage',
      cardOptions: ['first', 'second', 'neither', 'not_sure'], title: 'Which is right?', ask: 'Which is right?', incoming: '',
      payload: { facts: [{ value: 'Tuesday', level: 'reported' }, { value: 'Thursday', level: 'reported' }] },
      source: 'Fuzz’s memory', who: '', age: '', log: [], sources: [], people: [], context: [], conversation: [], code: [] });
    st.queue.unshift('c901');
  });
  await show('c901');
  await page.locator('#card [data-dv="first"]').waitFor();
  /* the stuck check runs every 15 seconds */
  await page.waitForTimeout(16500);
  assert.equal(await page.locator('#way-h').count(), 0, 'no What’s in the way? on a memory card');
  assert.equal(await page.locator('#card [data-dv="first"]').count(), 1, 'its own answers stay');
  assert.equal(await page.locator('#card [data-act="assign"]').count(), 0, 'no task buttons');
  /* a task left in front still gets asked */
  const t = await page.evaluate(() => Store.get().queue.find(id => { const i = Store.item(id); return i && i.kind === 'task' && i.state === 'triage' && !i.doing; }));
  await show(t);
  await page.locator('#way-h').waitFor({ timeout: 20000 });
});

test('E edits the plan; Esc keeps the change in the plan text', async () => {
  await page.keyboard.press('e');
  assert.equal(await page.locator('#instr').isVisible(), true);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Ask the venue for 16, and copy Ines');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#plan').isVisible(), true);
  assert.equal(await page.locator('#plantext').textContent(), 'Ask the venue for 16, and copy Ines');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ask');
});

test('⌘ Enter in the box hands it to Fuzz with what you wrote', async () => {
  const id = await page.evaluate(() => Store.front().id);
  await page.keyboard.press('e');
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Tell the venue 16');
  await page.keyboard.press('Meta+Enter');
  await page.waitForFunction((id) => !Store.inQueue(id), id);
  assert.equal(await page.evaluate((id) => Store.item(id).instr, id), 'Tell the venue 16');
});

test('a question card answers its headline with numbered answers', async () => {
  await show('room');
  assert.match(await ask(), /big room on 3 or the quiet one on 5/);
  const answers = page.locator('.answers .ans');
  assert.equal(await answers.count(), 3, 'two answers and Something else');
  assert.match(await answers.first().getAttribute('class'), /primary/, 'the answers lead');
  /* Picking an answer is the hand-off: handing it over as it is waits under Other ways, its key still works */
  assert.equal(await page.locator('#card [data-act="assign"]').first().isVisible(), false);
  assert.equal(await page.locator('#othermenu [data-act="assign"]').count(), 1);
  await page.keyboard.press('2');
  await page.waitForFunction(() => !Store.inQueue('room'));
  assert.match(await page.evaluate(() => Store.item('room').instr), /quiet room on 5/);
});

test('a note goes along with the answer you pick', async () => {
  await show('room');
  await page.keyboard.press('e');
  await page.keyboard.type('and copy Ines');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#instr').isVisible(), true, 'the note stays in view');
  await page.keyboard.press('1');
  await page.waitForFunction(() => !Store.inQueue('room'));
  const instr = await page.evaluate(() => Store.item('room').instr);
  assert.match(instr, /big room on 3/);
  assert.match(instr, /and copy Ines/);
});

test('Something else opens the box', async () => {
  await show('room');
  await page.keyboard.press('3');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'instr');
});

test('Details folds the rest, and I opens it', async () => {
  const d = page.locator('#details');
  assert.equal(await d.evaluate(x => x.open), false);
  await page.keyboard.press('i');
  assert.equal(await d.evaluate(x => x.open), true);
  assert.equal(await d.locator('.incoming').count(), 1, 'where it came from is inside');
});
