/* Tell Fuzz (E) on every card, and a note goes along with whatever you pick next. A file dragged in
   opens the card's box, where the drop zone is (the ADHD pass).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9390 + Math.floor(Math.random() * 100);
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
async function note(text) {
  await page.keyboard.press('e');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}
const said = (id) => page.evaluate((id) => Store.item(id).log.filter(l => l.kind === 'guidance').map(l => l.text), id);

test('a card that came back has Tell Fuzz, and the note goes with Let it go', async () => {
  await show('vendor');
  assert.equal(await page.locator('.comeback .addnote').isVisible(), true);
  await note('Finance owns this now');
  await page.keyboard.press('l');
  await page.waitForFunction(() => Store.item('vendor').state === 'letgo');
  assert.ok((await said('vendor')).includes('You said: Finance owns this now'));
  assert.match(await page.evaluate(() => Store.item('vendor').notes), /You said: Finance owns this now/);
});

test('a note on a question card goes with Park it', async () => {
  await show('room');
  await note('Ask again after the reorg');
  await page.keyboard.press('p');
  await page.waitForFunction(() => Store.item('room').state === 'parked');
  assert.ok((await said('room')).includes('You said: Ask again after the reorg'));
});

test('It still matters sends the note, and the next card starts clean', async () => {
  await show('vendor');
  await note('Only the renewals');
  await page.keyboard.press('k');
  await page.locator('#plan').waitFor();
  assert.ok((await said('vendor')).includes('You said: Only the renewals'));
  assert.doesNotMatch(await page.locator('#plantext').textContent(), /Only the renewals/, 'the plan is still Fuzz’s');
});

test('no note, nothing extra in the log', async () => {
  await show('room');
  await page.keyboard.press('p');
  await page.waitForFunction(() => Store.item('room').state === 'parked');
  assert.equal((await said('room')).filter(t => t.startsWith('You said:')).length, 0);
});

test('a file dragged in opens the box and goes with the card', async () => {
  const id = await page.evaluate(() => Store.front().id);
  assert.equal(await page.locator('#planedit').isVisible(), false);
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['x'], 'venue-quote.pdf', { type: 'application/pdf' }));
    const at = document.querySelector('#card');
    at.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__dt = dt;
  });
  assert.equal(await page.locator('#planedit').isVisible(), true, 'the box opened');
  assert.equal(await page.locator('#adrop').isVisible(), true, 'with its drop zone');
  await page.evaluate(() => document.querySelector('#adrop').dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  await page.waitForFunction((id) => Store.item(id).sources.some(s => s.title === 'venue-quote.pdf'), id);
});
