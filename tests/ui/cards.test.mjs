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
  assert.doesNotMatch(await page.locator('#card [data-act="assign"]').first().getAttribute('class'), /primary/, 'the answers lead');
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
