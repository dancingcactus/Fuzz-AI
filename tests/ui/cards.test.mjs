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
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
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

test('Fuzz’s spot checks draw like memory cards: the message, then what was there; the run, then what was off', async () => {
  await page.evaluate(() => {
    const st = Store.get();
    const base = { kind: 'deliv', memory: true, state: 'triage', incoming: '', source: 'Fuzz’s spot check', who: '', age: '',
      log: [], sources: [], people: [], context: [], conversation: [], code: [] };
    st.items.push(Object.assign({}, base, { id: 'c902', cardKind: 'spot_message', cardId: 902, suggested: 'nothing',
      cardOptions: ['nothing', 'had_ask', 'not_sure'], title: 'Was there anything for you here?', ask: 'Was there anything for you here?',
      payload: { source: 'slack', from: 'Sam Lee', title: 'Launch', quote: 'Can someone own the launch notes?', link: 'https://chat.example/m1' } }));
    st.items.push(Object.assign({}, base, { id: 'c903', cardKind: 'spot_run', cardId: 903, suggested: 'right',
      cardOptions: ['right', 'off', 'not_sure'], title: 'How did Fuzz do on this?', ask: 'How did Fuzz do on this?',
      payload: { title: 'Find the venue contract', steps: ['Searched mail for the contract.'],
                 off: { gave_up: 'Handed back too early', brief: 'The brief is wrong' } } }));
    st.queue.unshift('c902', 'c903');
  });
  await show('c902');
  assert.match(await page.locator('#card .pquote').textContent(), /own the launch notes/);
  assert.equal(await page.locator('#card #spot-ask').count(), 1);
  assert.match(await page.locator('#card [data-dv="nothing"]').getAttribute('class'), /primary/);
  assert.match(await page.locator('#card [data-dv="had_ask"]').textContent(), /There was something/);
  await show('c903');
  assert.equal(await page.locator('#card [data-spotoff]').count(), 2);
  assert.match(await page.locator('#card .dv-steps').textContent(), /Searched mail/);
  assert.match(await page.locator('#card [data-dv="off"]').textContent(), /Something was off/);
});

test('no Find out: a task card has Done, Q does nothing, and What’s in the way? has four choices; 2 lays out the options', async () => {
  const t = await page.evaluate(() => Store.get().queue.find(id => { const i = Store.item(id); return i && i.kind === 'task' && i.state === 'triage' && !i.doing && !i.result && !Store.isBig(i); }));
  await show(t);
  assert.equal(await page.locator('#card [data-act="findout"]').count(), 0);
  assert.equal((await page.locator('#card [data-act="done"]').textContent()).replace(/D$/, ''), 'Done');
  assert.doesNotMatch(await page.locator('#card').textContent(), /Find out|I did it/);
  await page.keyboard.press('q');
  assert.equal(await page.evaluate(() => Store.shown()), t);
  await page.evaluate((id) => { Store.item(id).inTheWay = true; App.refresh(); }, t);
  await page.locator('#way-h').waitFor();
  const choices = await page.$$eval('.way .when', els => els.map(e => [e.dataset.act, e.getAttribute('aria-keyshortcuts')]));
  assert.deepEqual(choices, [['way-big', '1'], ['way-decide', '2'], ['way-draft', '3'], ['way-notnow', '4']]);
  await page.keyboard.press('2');
  await page.waitForFunction((id) => !Store.inQueue(id), t);
  assert.equal(await page.evaluate((id) => Store.item(id).now, t), 'Laying out the options');
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
  assert.doesNotMatch((await page.locator('#card [data-act="assign"]').first().getAttribute('class')) || '', /primary/, 'the answers lead');
  assert.equal(await page.locator('#card .quiet-row > *').count(), 2, 'under the answers, Later and Other ways only');
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

test('a wiki page draft opens as the page will look, sandboxed, with Source to edit it', async () => {
  await page.evaluate(() => {
    const it = Store.item('retro');
    it.sendTo = { to: 'Team notes', via: 'Wiki, edits the page', verb: 'edit', where: '', change: 'Adds the Q3 retro section', link: 'https://wiki.example/x' };
    it.draft = '<h2>Q3 retro</h2><p>Three actions.</p><script>parent.HACKED = 1</script><ac:structured-macro ac:name="info"><ac:parameter ac:name="title">T</ac:parameter><ac:rich-text-body><p>Note</p></ac:rich-text-body></ac:structured-macro>';
  });
  await show('retro');
  const fr = page.locator('#card .draft-preview');
  assert.equal(await fr.isVisible(), true, 'preview first');
  assert.equal(await page.locator('#card #draft').isVisible(), false);
  assert.equal(await fr.getAttribute('sandbox'), '', 'no scripts, forms or same-origin');
  const doc = page.frameLocator('#card .draft-preview');
  assert.equal((await doc.locator('h2').textContent()).trim(), 'Q3 retro');
  assert.equal(await page.evaluate(() => window.HACKED), undefined);
  await page.locator('#card [data-dview="source"]').click();
  assert.equal(await page.locator('#card #draft').isVisible(), true);
  assert.equal(await fr.isVisible(), false);
  await page.locator('#card #draft').fill('<h2>Changed</h2>');
  await page.locator('#card [data-dview="preview"]').click();
  assert.equal((await doc.locator('h2').textContent()).trim(), 'Changed', 'preview shows your edit');
  assert.equal(await page.locator('#card #draft').inputValue(), '<h2>Changed</h2>', 'the edit is what gets approved');
});

test('a message draft stays a plain text box', async () => {
  await page.evaluate(() => { Store.item('retro').draft = '<b>hi</b> team'; });
  await show('retro');
  assert.equal(await page.locator('#card .draft-preview').count(), 0);
  assert.equal(await page.locator('#card #draft').isVisible(), true);
});
