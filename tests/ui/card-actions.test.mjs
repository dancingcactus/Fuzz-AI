/* The card-action rules (docs/card-actions.md), checked on every card kind: one fill, four visible, a key means
   one verb, icons only on the lead, menus hold one theme, and what you typed for Fuzz travels with the action.
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
  await page.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await page.locator('#card [data-act]').first().waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

async function show(id, flags) {
  await page.evaluate(([id, flags]) => {
    const { __new, ...flags2 } = flags || {};
    if (__new && !Store.item(id)) Store.get().items.push(Object.assign({ id, state: 'triage', source: 'Test', who: 'Test', age: '1 day', sources: [], people: [], log: [] }, __new));
    const it = Store.item(id); const { __doNow, ...rest } = flags2; Object.assign(it, rest);
    if (!Store.inQueue(id)) Store.enqueue(it, 'front');
    Store.pick(id); if (__doNow) Store.doNow(id); App.refresh();
  }, [id, flags]);
  await page.waitForFunction((id) => Store.shown() === id, id);
  await page.locator('#card .card-actions').first().waitFor({ timeout: 10000 });
}

/* Each card kind the doc names, as a way to bring one to the front */
const KINDS = [
  ['ordinary task', 'naming', { stage: 'fresh', handedBack: false, result: false, quick: null }],
  ['big task', 'naming', { stage: 'fresh', handedBack: false, result: false, forceBig: true, quick: null }],
  ['handback with answers', 'room'],
  ['handback with three answers', 'room', { quick: ['One', 'Two', 'Three'] }],
  ['result Fuzz found', 'naming', { stage: 'fresh', handedBack: true, result: true, quick: null }],
  ['entity question', 'dana'],
  ['parked check-in', 'vendor', { putOff: false, review: true }],
  ['waiting check-in', 'vendor', { putOff: false, checkBack: true, waitingOn: 'Dana' }],
  ['keeps coming back', 'vendor'],
  ['stale check-in', 'naming', { stage: 'stale', handedBack: false, result: false, quick: null }],
  ['working card', 'naming', { stage: 'fresh', handedBack: false, result: false, quick: null, __doNow: true }],
  ['join a waiting reply', 'naming', { stage: 'fresh', handedBack: false, result: false, quick: null, joinReply: true, joinReason: 'A reply to this thread is waiting for your OK.' }],
  ['parked check-in Fuzz leans to let go', 'vendor', { putOff: false, review: true, leansGo: true }],
  ['draft waiting for your OK', 'retro', {}],
  ['deliverable question', 'dv-test', { __new: { kind: 'deliv', cardKind: 'deliverable_keep', title: 'Release notes', ask: 'Keep going on this?', cardOptions: ['keep_going', 'make_active', 'its_done', 'let_go', 'not_sure'], suggested: 'keep_going', payload: {} } }],
  ['part-of question', 'po-test', { __new: { kind: 'task', cardKind: 'part_of', title: 'Draft the intro', partOfPrompt: 'Is this part of Release notes?', cardOptions: ['yes', 'no', 'not_sure'], suggested: 'yes' } }],
  ['calendar hold', 'hold-test', { __new: { kind: 'task', cardKind: 'hold', title: 'Prepare the demo', holdPrompt: 'Add a hold for this to your calendar?', holdWhen: 'Tue 2 to 3 PM' } }],
  ['What’s in the way?', 'naming', { stage: 'fresh', handedBack: false, result: false, quick: null, inTheWay: true }],
];

for (const [name, id, flags] of KINDS) {
  test(`${name}: one lead, at most three sub-actions, and no rule the component flags`, async () => {
    await show(id, flags);
    const r = await page.evaluate(() => {
      const ca = document.querySelector('#card .card-actions');
      const lead = ca.querySelector(':scope > .btn, :scope > .split, :scope > .ca-ans');
      const row = [...ca.querySelectorAll(':scope > .ca-row > *')];
      return {
        fills: ca.querySelectorAll('.primary:not(.more-btn)').length,
        row: row.length,
        leadIsFirst: lead === ca.querySelector(':scope > :not(.ca-line)'),
        icons: [...ca.querySelectorAll('.ca-row svg, .menu svg')].length - [...ca.querySelectorAll('.ca-row .more-btn svg')].length,
        menus: [...ca.querySelectorAll('.menu')].map(m => m.querySelectorAll('[role="menuitem"]').length),
        violations: CardActions.violations.slice(),
      };
    });
    assert.equal(r.fills, 1, 'exactly one filled button (rule 1)');
    assert.ok(r.row <= 3, `at most three sub-actions, not ${r.row} (rules 2 and 12)`);
    assert.equal(r.icons, 0, 'icons only on the lead (rule 3)');
    assert.ok(r.menus.every(n => n <= 4), 'a menu holds at most four items (rule 15)');
    assert.deepEqual(r.violations, [], 'the component flagged nothing');
  });
}

test('a key means one verb across every card kind (rule 3)', async () => {
  const seen = {};
  for (const [name, id, flags] of KINDS) {
    await page.evaluate(() => { CardActions.violations.length = 0; });
    await show(id, flags);
    const pairs = await page.locator('#card .card-actions [aria-keyshortcuts][data-act]').evaluateAll(bs =>
      bs.map(b => [b.getAttribute('aria-keyshortcuts'), b.dataset.act, b.textContent.replace(/[A-Z0-9]$/, '').trim()]));
    for (const [key, act, text] of pairs) {
      if (/^\d$/.test(key)) continue;   /* numbers are answers (rule 4) */
      const verbOf = { keep: 'stillmatters', keepwaiting: 'schedule', 'ent-later': 'schedule', 'way-notnow': 'schedule', notnow: 'schedule', sentself: 'done', 'hold-skip': 'schedule' }[act] || act;
      if (seen[key] && seen[key] !== verbOf) assert.fail(`${key} is ${seen[key]} and ${verbOf} (${name})`);
      seen[key] = verbOf;
    }
  }
  assert.equal(seen.S, 'schedule');
  assert.equal(seen.A, 'assign');
  assert.equal(seen.D, 'done');
});

test('every card has a free way out on S, in the visible row (rule 6)', async () => {
  for (const [name, id, flags] of KINDS) {
    await show(id, flags);
    const n = await page.locator('#card .card-actions [aria-keyshortcuts~="S"]:not([role="menuitem"])').count();
    assert.ok(n >= 1, `${name} has S`);
  }
});

test('the order is who does it, then when, then clear it from my plate (rule 5)', async () => {
  await show('naming', KINDS[0][2]);
  const order = await page.locator('#card .card-actions > .ca-row > *').evaluateAll(els => els.map(e => (e.querySelector('[data-act]') || e).dataset.act));
  assert.deepEqual(order, ['claude', 'schedule', 'done']);
});

test('a menu holds one theme: Later has the when moves, Done the clear-it moves (rule 15)', async () => {
  await show('naming', KINDS[0][2]);
  const items = async (id) => page.locator(`#${id} [role="menuitem"]`).evaluateAll(b => b.map(x => x.dataset.act));
  assert.deepEqual(await items('whenmenu'), ['book', 'afterothers']);
  assert.deepEqual(await items('clearmenu'), ['park', 'waiting', 'theirs']);
  assert.deepEqual(await items('whomenu'), ['deepwork', 'donow']);
});

test('Let it go is in Done’s menu on a check-in, and L still works (rules 9 and 15)', async () => {
  await show('naming', KINDS[9][2]);
  assert.ok((await page.locator('#clearmenu [data-act="letgo"]').count()) === 1);
  await page.keyboard.press('l');
  await page.waitForFunction(() => Store.item('naming').state === 'letgo');
});

test('H is Help me start, in the card where it is offered (rule 3)', async () => {
  await show('naming', KINDS[9][2]);
  assert.equal(await page.locator('#card [data-act="helpstart"]').getAttribute('aria-keyshortcuts'), 'H');
  assert.equal(await page.locator('#card [data-act="firststep"], #card [data-act="unclear"]').count(), 0, 'one action, not two');
});

/* Rule 13: what you typed for Fuzz goes with every action that closes or moves the card */
const NOTED = [
  ['ordinary task', 0, ['park', 'afterothers', 'theirs', 'deepwork']],
  ['stale check-in', 9, ['helpstart', 'letgo', 'keep', 'park']],
  ['keeps coming back', 8, ['stillmatters', 'letgo', 'assign']],
  ['parked check-in', 6, ['keepparked', 'clarify', 'letgo']],
  ['waiting check-in', 7, ['keepwaiting', 'gotit', 'nudge', 'letgo']],
];
for (const [name, k, acts] of NOTED) {
  for (const act of acts) {
    test(`${name}: the note for Fuzz goes with ${act} (rule 13)`, async () => {
      const [, id, flags] = KINDS[k];
      await show(id, flags);
      await page.keyboard.press('e');
      await page.keyboard.type('and mention the budget');
      await page.keyboard.press('Escape');
      /* A hand-off takes the note as its instruction; every other action leaves it as a note on the task */
      const where = (id) => page.evaluate(([id, act]) => { const i = Store.item(id); return act === 'assign' ? (i.instr || '') : (i.notes || ''); }, [id, act]);
      const before = await where(id);
      await page.evaluate((act) => document.querySelector(`#card [data-act="${act}"]`).click(), act);
      let after = before;
      for (let i = 0; i < 50 && after === before; i++) { await page.waitForTimeout(100); after = await where(id); }
      assert.notEqual(after, before, 'it changed');
      assert.match(after, /and mention the budget/);
    });
  }
}

/* The setup cards (hours, folder, lookup) are private to the Triage view, so a test-only hook is spliced into
   the script as it is served. Nothing else about the page changes. */
test('the setup cards: one lead and a row, the way out in it, nothing the component flags', async () => {
  const { readFileSync } = await import('node:fs');
  const p2 = await browser.newPage();
  await p2.route('**/js/view-triage.js', async route => {
    let src = readFileSync(ROOT + 'js/view-triage.js', 'utf8');
    const i = src.lastIndexOf('})();');
    src = src.slice(0, i) + 'window.__setup=function(st){scOpen=true;scState=st;card.style.display="none";var sc=$("#setupcard");sc.hidden=false;sc.className="card setupcard";paintSetup();};\n' + src.slice(i);
    await route.fulfill({ contentType: 'application/javascript', body: src });
  });
  await p2.goto(`http://127.0.0.1:${PORT}/#/triage`);
  await p2.locator('#card [data-act]').first().waitFor();
  const seen = {};
  for (const [name, st] of [['hours', { card: { name: 'hours', hours: { hours: [8, 18.5] } }, step: 'ask' }],
    ['hours, other', { card: { name: 'hours', hours: { hours: [8, 18.5] } }, step: 'other' }],
    ['folder', { card: { name: 'folder' }, step: 'ask' }], ['lookup', { card: { name: 'lookup', engine: 'claude' }, step: 'ask' }],
    ['lookup, waiting', { card: { name: 'lookup', engine: 'claude' }, step: 'looking' }]]) {
    await p2.evaluate((st) => window.__setup(Object.assign({ tools: [] }, st)), st);
    seen[name] = await p2.evaluate(() => ({
      fills: document.querySelectorAll('#setupcard .card-actions .primary:not(.more-btn)').length,
      row: document.querySelectorAll('#setupcard .ca-row > *').length,
      out: !!document.querySelector('#setupcard [data-sc="later"], #setupcard [data-sc="back"]'),
      loose: document.querySelectorAll('#setupcard button[data-sc]:not(.card-actions *)').length,
    }));
  }
  const bad = await p2.evaluate(() => CardActions.violations.slice());
  await p2.close();
  assert.deepEqual(bad, []);
  for (const [name, r] of Object.entries(seen)) {
    assert.equal(r.fills, name === 'lookup, waiting' ? 0 : 1, `${name}: one fill, or none while it only waits`);
    assert.ok(r.row <= 3, `${name}: at most three in the row`);
    assert.equal(r.out, true, `${name}: a way out`);
    assert.equal(r.loose, 0, `${name}: no button outside the component`);
  }
});

/* Rule 13 for the actions that open a small form first (Pause, Waiting on someone), and for a question's own note */
test('Pause: the note for Fuzz goes with it, and so does where you left off (rule 13)', async () => {
  await show('naming', KINDS[10][2]);
  await page.keyboard.press('e');
  await page.keyboard.type('and mention the budget');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#card [data-act="pause"]').click());
  await page.locator('#pause-q').waitFor();
  await page.locator('#pause-q').fill('numbers next');
  await page.locator('#pause-form button[type="submit"]').click();
  await page.waitForFunction(() => /and mention the budget/.test(Store.item('naming').notes || '') && /numbers next/.test(JSON.stringify(Store.item('naming').log)));
});

test('Waiting on someone: a note typed first goes with it (rule 13)', async () => {
  await show('naming', KINDS[0][2]);
  await page.keyboard.press('e');
  await page.keyboard.type('and mention the budget');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('#card [data-act="waiting"]').click());
  await page.locator('#wait-who').fill('Dana');
  await page.locator('#wait-form button[type="submit"]').click();
  await page.waitForFunction(() => /and mention the budget/.test(Store.item('naming').notes || ''));
});

test('an entity question: the note goes along with the answer (rule 13)', async () => {
  await show('dana');
  await page.keyboard.press('e');
  await page.keyboard.type('they met at the offsite');
  await page.keyboard.press('Escape');
  await page.keyboard.press('2');
  await page.waitForFunction(() => !Store.inQueue('dana'));
  assert.match(JSON.stringify(await page.evaluate(() => Store.item('dana'))), /they met at the offsite/);
});
