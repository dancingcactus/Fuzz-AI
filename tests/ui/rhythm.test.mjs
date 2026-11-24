/* Focus time and Triage time on the page (docs/book-then-work.md): the question and the weekly plan as cards, the calendar
   file when no calendar tool is set up (a Triage habit is one repeating event), and Book time leading for a task that needs
   a time. Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 9700 + Math.floor(Math.random() * 100);
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

const SLOTS = [
  { id: 'focus-1', kind: 'focus', title: 'Focus time', start: '2026-11-24T09:30:00Z', end: '2026-11-24T11:00:00Z', link: 'http://x/#/work?until=11:00' },
  { id: 'triage-1', kind: 'triage', title: 'Triage time', start: '2026-11-24T14:00:00Z', end: '2026-11-24T14:30:00Z', link: 'http://x/#/triage?until=14:30' },
  { id: 'triage-2', kind: 'triage', title: 'Triage time', start: '2026-11-25T14:00:00Z', end: '2026-11-25T14:30:00Z', link: 'http://x/#/triage?until=14:30' },
  { id: 'triage-3', kind: 'triage', title: 'Triage time', start: '2026-11-26T14:00:00Z', end: '2026-11-26T14:30:00Z', link: 'http://x/#/triage?until=14:30' },
];

async function showCard(item) {
  await page.evaluate((item) => {
    Store.get().items.push(Object.assign({ state: 'triage', source: 'Your Focus time', who: '', age: '', log: [], sources: [], people: [], context: [], conversation: [], code: [] }, item));
    Store.enqueue(Store.item(item.id), 'front'); Store.pick(item.id); App.refresh();
  }, item);
  await page.waitForFunction((id) => Store.shown() === id, item.id);
  await page.locator('#card .card-actions').first().waitFor();
}

test('when do you usually get things done: four answers and a way to say not now, in your words', async () => {
  await showCard({ id: 'rb', kind: 'deliv', rhythm: true, cardKind: 'rhythm_best', cardId: 1, title: 'When do you usually get things done?', ask: 'When do you usually get things done?',
    cardOptions: ['morning', 'afternoon', 'late', 'varies', 'not_now'], payload: {} });
  const text = await page.locator('#card').textContent();
  assert.match(text, /When do you usually get things done\?/);
  assert.match(text, /a first guess/i);
  assert.match(text, /What I keep track of/, 'said when the question is asked, not only in Settings');
  assert.match(text, /not a mark against you/);
  assert.match(text, /nothing leaves this Mac/i);
  for (const w of ['Mornings', 'After lunch', 'Late afternoon', 'It varies', 'Not now']) assert.match(text, new RegExp(w), w);
  assert.equal(await page.locator('#card .card-actions .ca-lead').count() + await page.locator('#card .card-actions > *').count() > 0, true);
});

test('the weekly plan lists what is coming up, and says when a day had no room, without blame', async () => {
  await showCard({ id: 'rp', kind: 'deliv', rhythm: true, cardKind: 'rhythm_plan', cardId: 2, title: 'Keep your Focus time and Triage time on your calendar?',
    ask: 'Keep your Focus time and Triage time on your calendar?', cardOptions: ['approve', 'always_allow', 'skip'], suggested: 'approve',
    payload: { via: 'calendar', lines: ['Tue 24 Nov 9:30–11:00: Focus time', 'Tue 24 Nov 14:00–14:30: Triage time'], skipped: ['2026-11-25'], slots: SLOTS } });
  const text = await page.locator('#card').textContent();
  assert.match(text, /Tue 24 Nov 9:30–11:00: Focus time/);
  assert.match(text, /No room for Triage time on one day\. I left those out rather than move it\./);
  assert.match(text, /Put these on my calendar/);
  assert.match(text, /Always allow for my calendar/);
  assert.match(text, /Skip/);
  assert.doesNotMatch(text, /missed|overdue|failed/i);
});

test('with no calendar tool the plan downloads as a calendar file, and the Triage habit is one repeating event', async () => {
  await showCard({ id: 'rp', kind: 'deliv', rhythm: true, cardKind: 'rhythm_plan', cardId: 2, title: 'Keep it?', ask: 'Keep it?',
    cardOptions: ['approve', 'always_allow', 'skip'], suggested: 'approve',
    payload: { via: 'file', lines: ['a', 'b'], skipped: ['2026-11-27'], slots: SLOTS } });
  assert.match(await page.locator('#card').textContent(), /Download the calendar file/);
  assert.doesNotMatch(await page.locator('#card').textContent(), /Always allow/, 'it means nothing for a file you download');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#card [data-dv="approve"]').click()]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2, 'one Focus time block, and one repeating Triage event (not three)');
  assert.match(ics, /SUMMARY:Focus time/);
  assert.match(ics, /SUMMARY:Triage time/);
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY;BYDAY=TU,WE,TH/g) || []).length, 1);
  assert.match(ics, /EXDATE:20261127T\d{6}/, 'the day with no room is left out of the repeating event');
  assert.match(ics, /URL:http:\/\/x\/#\/work\?until=11:00/);
  assert.match(ics, /URL:http:\/\/x\/#\/triage\?until=14:30/);
  assert.doesNotMatch((ics.split('SUMMARY:Focus time')[0].split('BEGIN:VEVENT').pop()), /RRULE/, 'a Focus time block is one event');
});

test('a repeating event is written in local time so it stays at the same hour across a clock change', async () => {
  const text = await page.evaluate((slots) => Ics.text(Ics.forSlots(slots)), SLOTS);
  const focus = /BEGIN:VEVENT[\s\S]*?DTSTART:(\S+)[\s\S]*?SUMMARY:Focus time/.exec(text)[1];
  const triage = /DTSTART:(\S+)\r\nDTEND:\S+\r\nRRULE[\s\S]*?SUMMARY:Triage time/.exec(text)[1];
  assert.match(focus, /Z$/, 'a single block is in UTC');
  assert.doesNotMatch(triage, /Z$/, 'a repeating event is floating local time');
});

test('a task that needs a time leads with Book time, with Hand it to Fuzz beside it', async () => {
  await page.evaluate(() => {
    const it = Store.item(Store.get().queue.map(Store.item).find(i => i.kind === 'task' && i.state === 'triage').id);
    Object.assign(it, { suggested: 'book', stage: 'fresh', handedBack: false, result: false, quick: null, forceBig: false, putOff: false, afterOthers: false });
    Store.pick(it.id); App.refresh();
  });
  await page.locator('#card .card-actions').first().waitFor();
  const first = await page.locator('#card .card-actions [data-act]').first().getAttribute('data-act');
  assert.equal(first, 'book', 'Book time leads');
  assert.ok(await page.locator('#card [data-act="assign"]').count() >= 1);
  assert.equal(await page.locator('#card [data-act="deepwork"], #card [data-act="donow"]').count(), 0, 'no I’ll do it, no Do it now');
});
