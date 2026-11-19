/* The nav (docs/nav-guide.md): no tabs; the app opens on the Guide; a label next to the wordmark says where you are
   and is the way back, with a dot when work is waiting that you can't see from here; Lineup, Artifacts and Settings
   live in the menu with Fuzz's head; calendar links land one tap from Start.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 900);
const URL0 = `http://127.0.0.1:${PORT}/`;
let server, browser, page;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL0); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

beforeEach(async () => {
  page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

async function open(hash = '') {
  await page.goto(URL0 + hash);
  await page.locator('#where').waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.body.dataset.view);
}
const label = () => page.evaluate(() => {
  const a = document.getElementById('where');
  return { text: [...a.children].filter(c => c.tagName === 'B' || c.classList.contains('where-s')).map(c => c.textContent).join(' · '),
    dot: a.querySelector('.where-dot') ? a.querySelector('.where-dot').getAttribute('aria-label') : null, current: a.getAttribute('aria-current') };
});
const checked = () => page.evaluate(() => { const r = document.querySelector('.g-row[aria-checked="true"]'); return r ? r.dataset.pick : null; });
const goText = () => page.evaluate(() => document.getElementById('dw-go').firstChild.textContent);
const bubble = () => page.evaluate(() => document.getElementById('bubble').textContent);
/* Links with an until: the page's clock is pinned to 10am, so a block ending at noon is always ahead */
async function morning() { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d); }

test('the app opens on the Guide, with no tabs and no Settings gear', async () => {
  await open();
  assert.equal(await page.title(), 'Guide · Fuzz');
  assert.deepEqual(await label(), { text: 'Guide', dot: null, current: 'page' });
  assert.equal(await page.locator('.mainnav, [data-nav], #navcount, #dwcount, #setbtn').count(), 0);
  assert.equal(await page.getAttribute('.brand', 'href'), '#/guide');
  assert.equal(await page.textContent('#g-q'), 'Where do you want to start?');
});

test('one list: Triage, then My work, then Something else; one is picked and tagged Fuzz suggests', async () => {
  await open('#/guide');
  const groups = await page.$$eval('.g-grp', els => els.map(e => e.textContent));
  assert.deepEqual(groups, ['Keep things moving', 'My work']);
  const picks = await page.$$eval('.g-row', els => els.map(e => e.dataset.pick));
  const pool = await page.evaluate(() => Store.inState('deepwork').map(i => i.id));
  assert.equal(picks[0], 'triage');
  assert.equal(picks[picks.length - 1], 'typed');
  /* three rows before Something else (Triage and the top two of My work); the rest wait behind More */
  assert.equal(picks.length, 4);
  assert.equal(picks.slice(1, -1).filter(id => pool.includes(id)).length, 2);
  assert.equal(await page.textContent('#g-more'), `More from My work (${pool.length - 2})`);
  assert.equal(await page.locator('.g-row[aria-checked="true"]').count(), 1);
  /* the demo has something with a time on it, so Fuzz suggests Triage */
  assert.equal(await checked(), 'triage');
  assert.match(await page.textContent('.g-row[data-pick="triage"]'), /Fuzz suggests.*One has a time on it/);
  assert.match(await bubble(), /Something has a time on it/);
  assert.equal(await goText(), 'Start Triage');
  assert.equal(await page.locator('.dw-times').count(), 0);   /* no time question for Triage */
});

test('under the Guide, a bubble sums up what Fuzz did while you were away, one chip per kind; the list is behind See what changed', async () => {
  await open('#/guide');
  await page.locator('#g-away').waitFor();
  assert.match(await page.textContent('#g-away-h'), /^While you were away since /);
  /* like the task's tabs: what it was, then the count */
  const chips = await page.$$eval('.g-away-chip', els => els.map(e => [e.firstChild.nextSibling.textContent, e.lastChild.textContent]));
  assert.deepEqual(chips, [['Marked complete', '1'], ['Series finished', '1'], ['Moved to waiting', '1'], ['New tasks', '2'], ['New series', '1']]);
  /* the summary only, until you open it */
  assert.equal(await page.locator('.g-away-item').first().isVisible(), false);
  await page.click('.g-away-more summary');
  assert.equal(await page.textContent('.g-away-more summary'), 'See what changed (6)');
  const items = await page.$$eval('.g-away-item', els => els.map(e => [e.dataset.kind, e.querySelector('.g-away-tag').textContent]));
  assert.deepEqual(items.map(i => i[0]), ['closed', 'wrapped', 'waiting', 'new', 'new', 'series']);
  assert.deepEqual(items.map(i => i[1]), ['Complete', 'Finished', 'Waiting', 'New', 'New', 'Series']);   /* series by their names */
  /* it sits below the choice, and stays open as you pick a row */
  const [panel, away] = await page.$$eval('.g-panel, #g-away', els => els.map(e => e.getBoundingClientRect().top));
  assert.ok(away > panel);
  await page.click('.g-row[data-pick="typed"]');
  assert.equal(await page.locator('.g-away-item').first().isVisible(), true);
});

test('picking a task asks how long and names it on Start; Start Triage opens Triage, and the label leads back', async () => {
  await open('#/guide');
  const id = await page.$$eval('.g-row', els => els[1].dataset.pick);   /* the first task on the short list */
  await page.click(`.g-row[data-pick="${id}"]`);
  assert.equal(await checked(), id);
  assert.equal(await page.locator('.dw-times').count(), 1);
  assert.match(await page.textContent('#g-fit'), /^(Fits in your time\.|Won’t fit in one go\. I’ll stop you at a good place\.)/);
  assert.match(await goText(), /^Start: /);
  await page.click('.g-row[data-pick="triage"]');
  await page.click('#dw-go');
  await page.locator('#card').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/triage');
  /* the Guide already asked where to start: straight to the first card, no arrival screen or focus question */
  assert.equal(await page.locator('#focuscard').isHidden(), true);
  assert.deepEqual(await label(), { text: 'Triage · Back to the Guide', dot: null, current: null });
  await page.click('#where');
  await page.locator('#g-q').waitFor();
  assert.deepEqual(await label(), { text: 'Guide', dot: null, current: 'page' });
});

test('More from My work shows the rest and focuses the first new row; a task picked from further down always shows', async () => {
  await open('#/guide');
  const store = await page.evaluate(() => Store.inState('deepwork').map(i => i.id));
  const before = await page.$$eval('.g-row', els => els.map(e => e.dataset.pick));
  await page.click('#g-more');
  const pool = (await page.$$eval('.g-row', els => els.map(e => e.dataset.pick))).slice(1, -1);   /* Fuzz's order */
  assert.deepEqual(pool.slice().sort(), store.slice().sort());
  assert.deepEqual(pool.slice(0, 2), before.slice(1, -1));
  assert.equal(await page.locator('#g-more').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.pick), pool[2]);
  await page.click(`.g-row[data-pick="${pool[pool.length - 1]}"]`);
  assert.equal(await checked(), pool[pool.length - 1]);
  /* back on the Guide with that one picked (as Work on this does): the short list, with it on it */
  const last = pool[pool.length - 1];
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForFunction(() => document.body.dataset.view === 'tasks');
  await page.evaluate((id) => DeepWork.start(id), last);
  await page.locator('#g-q').waitFor();
  const short = await page.$$eval('.g-row', els => els.map(e => e.dataset.pick));
  assert.equal(short.length, 4);
  assert.ok(short.includes(last));
  assert.equal(await checked(), last);
  assert.equal(await page.textContent('#g-more'), `More from My work (${pool.length - 2})`);
});

test('arrow keys move through the list, a number picks a row, and Enter starts', async () => {
  await open('#/guide');
  await page.focus('.g-row[aria-checked="true"]');
  await page.keyboard.press('ArrowDown');
  const second = await page.$$eval('.g-row', els => els[1].dataset.pick);
  assert.equal(await checked(), second);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.pick), second);
  await page.keyboard.press('1');
  assert.equal(await checked(), 'triage');
  await page.keyboard.press('Enter');
  await page.locator('#card').waitFor();
  assert.equal(await page.locator('#focuscard').isHidden(), true);
});

test('Something else edits inline: new text, a match with Use that, the text stays, empty can’t start', async () => {
  await open('#/guide');
  await page.click('.g-row[data-pick="typed"]');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'g-typed');
  assert.equal(await page.getAttribute('#g-typed', 'placeholder'), 'Tell me what you want to work on');
  assert.equal(await page.locator('.dw-times').count(), 1);   /* how long, as soon as it's picked */
  assert.equal(await goText(), 'Tell me what first');
  assert.equal(await page.locator('#dw-go').isDisabled(), true);

  await page.keyboard.type('Plan the garden party');
  assert.match(await page.textContent('#g-hint'), /^New\. I’ll make it a task/);
  assert.equal(await goText(), 'Start: Plan the garden party');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'g-typed');   /* typing never redraws the field */

  const t = await page.evaluate(() => Store.inState('deepwork')[0]);
  await page.fill('#g-typed', t.title.split(' ').slice(0, 4).join(' '));
  assert.match(await page.textContent('#g-hint'), /That sounds like “.*”, and it’s ready\. Use that/);
  await page.click('#g-hint [data-use]');
  assert.equal(await checked(), (await page.evaluate(() => document.querySelector('.g-row[aria-checked="true"]').dataset.pick)));
  assert.notEqual(await checked(), 'typed');
  /* your words stay on the row */
  assert.match(await page.textContent('.g-row[data-pick="typed"]'), /Something else, in your words/);
});

test('starting Something else makes it a task and starts the session on it', async () => {
  await open('#/guide');
  await page.click('.g-row[data-pick="typed"]');
  await page.keyboard.type('Plan the garden party');
  await page.keyboard.press('Enter');
  await page.locator('#dw-step').waitFor();
  assert.equal(await page.textContent('.dw-taskline span'), 'Plan the garden party');
  assert.equal(await page.evaluate(() => Store.inState('deepwork').some(i => i.title === 'Plan the garden party')), true);
});

test('the menu with Fuzz’s head: Lineup, Series, Artifacts, Settings, Keys and help; Esc and outside clicks close it', async () => {
  await open('#/guide');
  await page.click('#menubtn');
  assert.equal(await page.getAttribute('#menubtn', 'aria-expanded'), 'true');
  const items = await page.$$eval('#navmenu [role="menuitem"] b', els => els.map(e => e.textContent));
  assert.deepEqual(items, ['Lineup', 'Series', 'Artifacts', 'Settings', 'Keys and help']);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.menu), 'tasks');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.menu), 'series');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#navmenu').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menubtn');
  await page.click('#menubtn');
  await page.mouse.click(5, 400);
  assert.equal(await page.locator('#navmenu').isHidden(), true);
  await page.click('#menubtn');
  await page.click('#navmenu [data-menu="tasks"]');
  await page.waitForFunction(() => document.title === 'Lineup · Fuzz');
  /* away from the Guide, a dot says work is waiting */
  assert.deepEqual(await label(), { text: 'Lineup · Back to the Guide', dot: 'things are waiting', current: null });
});

test('Settings and New task follow the label pattern', async () => {
  await open('#/settings');
  assert.equal((await label()).text, 'Settings · Back to the Guide');
  await open('#/capture');
  assert.equal((await label()).text, 'New · Back to the Guide');
});

test('Keys and help opens the page’s own key guide, or the short list', async () => {
  await open('#/guide');
  await page.click('#menubtn');
  await page.click('#navmenu [data-menu="keys"]');
  assert.equal(await page.evaluate(() => document.getElementById('dw-keysdlg').open), true);
  assert.match(await page.textContent('#dw-keys-now'), /Move through the list/);
  await page.keyboard.press('Escape');
  await open('#/tasks');
  await page.click('#menubtn');
  await page.click('#navmenu [data-menu="keys"]');
  assert.equal(await page.evaluate(() => document.getElementById('appkeys').open), true);
});

test('in a session the label is My work · Back to the Guide like any page; it leads out through the wrap-up, and only something that can’t wait lights the dot', async () => {
  await open('#/guide');
  const t = await page.evaluate(() => Store.item(document.querySelectorAll('.g-row')[1].dataset.pick));
  await page.click(`.g-row[data-pick="${t.id}"]`);
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  assert.equal(await page.title(), 'My work · Fuzz');
  let l = await label();
  assert.equal(l.text, 'My work · Back to the Guide');
  assert.equal(l.current, null);
  assert.equal(await page.locator('#where .where-ring').count(), 0);
  assert.equal(await page.evaluate(() => document.getElementById('dw-mode').getBoundingClientRect().width <= 1), true);   /* no title above Fuzz (screen readers still get it): the label says where you are */
  /* the demo has a card with a time on it, so the dot shows, as "can't wait" */
  assert.equal(l.dot, 'something can’t wait');
  await page.evaluate(() => Store.queue().forEach(i => { i.dueAt = null; }));
  await page.evaluate(() => App.paintLabel());
  assert.equal((await label()).dot, null);   /* ordinary waiting work doesn't pull you out of focus */

  /* from another page, the label is that page's; back to the Guide is back to the session */
  await page.click('#menubtn');
  await page.click('#navmenu [data-menu="tasks"]');
  await page.waitForFunction(() => document.body.dataset.view === 'tasks');
  l = await label();
  assert.equal(l.text, 'Lineup · Back to the Guide');
  /* Work on this isn't offered mid-session */
  assert.equal(await page.locator('text=Work on this').count(), 0);
  await page.click('#where');
  await page.locator('#dw-step').waitFor();
  assert.equal(await page.textContent('.dw-taskline span'), t.title);

  /* on the session, the label is a way out: the wrap-up, where Actually, keep going goes back */
  await page.click('#where');
  await page.locator('#dw-save').waitFor();
  assert.equal((await label()).text, 'My work · Back to the Guide');
  await page.click('#dw-backwork');
  await page.locator('#dw-step').waitFor();
  /* and so is the logo */
  await page.click('.brand');
  await page.locator('#dw-save').waitFor();
});

test('every way out lands on one wrap-up, then the Guide with a recap', async () => {
  await open('#/deepwork');
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  const title = await page.textContent('.dw-taskline span');
  await page.keyboard.press('Escape');
  await page.locator('#dw-save').waitFor();
  assert.equal((await label()).text, 'My work · Back to the Guide');
  assert.equal(await page.textContent('#dw-save'), 'Wrap upEnter');
  assert.deepEqual(await page.$$eval('[data-after] b', els => els.map(e => e.textContent)), ['Back in my work', 'Hand the rest to Fuzz', 'Book time to finish']);
  await page.click('#dw-save');
  await page.locator('#g-q').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/guide');
  assert.deepEqual(await label(), { text: 'Guide', dot: null, current: 'page' });
  /* the bubble may fold a long line, so look at what Fuzz said */
  assert.match(await page.evaluate(() => document.getElementById('bubble').getAttribute('aria-label') || document.getElementById('bubble').dataset.full || document.getElementById('bubble').textContent), /^Nice: .+ on “/);
  /* it stays yours, with your place kept */
  assert.equal(await page.evaluate((t) => Store.inState('deepwork').some(i => i.title === t), title), true);
});

test('Hand the rest to Fuzz, from the wrap-up', async () => {
  await open('#/deepwork');
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  const title = await page.textContent('.dw-taskline span');
  await page.keyboard.press('Escape');
  await page.click('[data-after="fuzz"]');
  await page.click('#dw-save');
  await page.locator('#g-q').waitFor();
  assert.equal(await page.evaluate((t) => Store.inState('deepwork').some(i => i.title === t), title), false);
});

test('Book time to finish, from the wrap-up: Book time’s slots open in place, what you typed stays, and it’s booked', async () => {
  await open('#/deepwork');
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  const title = await page.textContent('.dw-taskline span');
  await page.keyboard.press('Escape');
  await page.fill('#dw-crumb', 'Outline done; numbers next');
  await page.click('[data-after="book"]');
  await page.locator('#dw-book [data-slot]').first().waitFor();
  const slots = await page.$$eval('#dw-book [data-slot]', els => els.map(e => e.querySelector('b').textContent));
  assert.ok(slots.length >= 1);
  assert.equal(await page.inputValue('#dw-crumb'), 'Outline done; numbers next');   /* picking didn't redraw the wrap-up */
  assert.equal(await page.getAttribute('#dw-book [data-slot="0"]', 'aria-checked'), 'true');   /* the best time is picked */
  if (slots.length > 1) await page.click('#dw-book [data-slot="1"]');
  const pick = slots[slots.length > 1 ? 1 : 0];
  await page.click('#dw-save');
  await page.locator('#g-q').waitFor();
  const it = await page.evaluate((t) => Store.get().items.find(i => i.title === t), title);
  assert.equal(it.state, 'scheduled');
  assert.equal(it.booked, pick);
  assert.match(await page.evaluate(() => document.getElementById('bubble').textContent), /booked to finish/);
});

test('switching back from Book time to finish closes the slots, and nothing is booked', async () => {
  await open('#/deepwork');
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  const title = await page.textContent('.dw-taskline span');
  await page.keyboard.press('Escape');
  await page.click('[data-after="book"]');
  await page.locator('#dw-book [data-slot]').first().waitFor();
  await page.click('[data-after="keep"]');
  assert.equal(await page.locator('#dw-book [data-slot]').count(), 0);
  await page.click('#dw-save');
  await page.locator('#g-q').waitFor();
  assert.equal(await page.evaluate((t) => Store.get().items.find(i => i.title === t).state, title), 'deepwork');
});

test('the old #/deepwork opens the Guide with the top of My work picked', async () => {
  await open('#/deepwork');
  const top = await page.evaluate(() => document.querySelectorAll('.g-row')[1].dataset.pick);
  assert.equal(await checked(), top);
  assert.deepEqual(await label(), { text: 'Guide', dot: null, current: 'page' });
});

test('Lineup’s Work on this opens the Guide with that task picked', async () => {
  await open('#/tasks');
  const t = await page.evaluate(() => Store.inState('deepwork')[1]);
  await page.getByText(t.title, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Work on this' }).click();
  await page.locator('#g-q').waitFor();
  assert.equal(await checked(), t.id);
  assert.equal(await goText(), 'Start: ' + (t.title.split(' ').length > 5 ? t.title.split(' ').slice(0, 5).join(' ') + '…' : t.title));
});

test('an old calendar hold’s #tasks/<id> opens that task on the Guide', async () => {
  await open('#/guide');
  /* a live task's UI id is 't' + its core id; give a demo task one so the old link can find it */
  const title = await page.evaluate(() => { const t = Store.inState('deepwork')[2]; t.id = 't42'; t.coreId = 42; return t.title; });
  await page.evaluate(() => { location.hash = '#tasks/42'; });
  await page.waitForFunction(() => { const r = document.querySelector('.g-row[aria-checked="true"]'); return r && r.dataset.pick === 't42'; });
  assert.match(await page.textContent('.g-row[aria-checked="true"]'), new RegExp(title.slice(0, 12)));
});

test('a link to a task Fuzz is working on isn’t started from the Guide', async () => {
  await open('#/guide');
  const id = await page.evaluate(() => Store.inState('working', 'queued')[0].id);
  await page.evaluate((id) => { location.hash = '#/work/' + id; }, id);
  await page.waitForFunction(() => /isn’t yours to start right now/.test(document.getElementById('bubble').textContent));
  assert.notEqual(await checked(), id);
});

test('#/triage?until= opens Triage straight away, with the end time on the label', async () => {
  await morning();
  await open('#/triage?until=13:30');
  await page.locator('#card [data-act]').first().waitFor();
  assert.equal((await label()).text, 'Triage · Until 1:30pm · Back to the Guide');
  /* same page, a new link: only the label changes */
  await page.evaluate(() => { location.hash = '#/triage'; });
  await page.waitForFunction(() => document.getElementById('where').textContent.indexOf('Until') < 0);
  assert.equal((await label()).text, 'Triage · Back to the Guide');
});

test('#/work?until= opens the Guide with the time set to the block and nothing picked', async () => {
  await morning();
  await open('#/work?until=' + '12:00');
  assert.equal(await checked(), null);
  assert.match(await bubble(), /^This is your work time, until .+\. Where do you want to start\?$/);
  assert.equal(await page.locator('#dw-go').isDisabled(), true);
  const id = await page.$$eval('.g-row', els => els[1].dataset.pick);
  await page.click(`.g-row[data-pick="${id}"]`);
  const chip = await page.textContent('.dw-time[aria-pressed="true"]');
  assert.match(chip, /^Until .+~.+ · your calendar block$/);
});

test('#/work/<taskId>?until= picks the task, even one booked or back in Triage, one tap from Start', async () => {
  await morning();
  await open('#/guide');
  const t = await page.evaluate(() => Store.queue().find(i => i.kind === 'task' && i.state === 'triage'));
  await open('#/work/' + t.id + '?until=' + '12:00');
  assert.equal(await checked(), t.id);
  assert.match(await bubble(), /^Your calendar has this time for “.+”, until .+\. Everything’s ready\.$/);
  assert.equal(await page.locator('#dw-step').count(), 0);   /* it doesn't start by itself */
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  assert.equal(await page.textContent('.dw-taskline span'), t.title);
  assert.equal(await page.evaluate((id) => Store.item(id).state, t.id), 'deepwork');
});

test('#/work?what= fills in Something else', async () => {
  await open('#/work?what=Draft%20the%20launch%20email');
  assert.equal(await checked(), 'typed');
  assert.equal(await page.inputValue('#g-typed'), 'Draft the launch email');
  assert.equal(await goText(), 'Start: Draft the launch email');
});

test('a link to a task that is done says so, and nothing is picked from it', async () => {
  await open('#/guide');
  const id = await page.evaluate(() => { const t = Store.inState('deepwork')[0]; Store.markDone(t.id); return t.id; });
  await page.evaluate((id) => { location.hash = '#/work/' + id; }, id);
  await page.waitForFunction(() => /already done/.test(document.getElementById('bubble').textContent));
  assert.notEqual(await checked(), id);
});

test('a deep link never ends or changes a running session', async () => {
  await open('#/deepwork');
  await page.click('#dw-go');
  await page.locator('#dw-step').waitFor();
  const title = await page.textContent('.dw-taskline span');
  const other = await page.evaluate((t) => Store.inState('deepwork').find(i => i.title !== t).id, title);
  await page.evaluate((id) => { location.hash = '#/work/' + id + '?until=23:59'; }, other);
  await page.waitForTimeout(150);
  assert.equal(await page.textContent('.dw-taskline span'), title);
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForFunction(() => document.body.dataset.view === 'tasks');
  await page.evaluate((id) => { location.hash = '#/work/' + id; }, other);
  await page.locator('#dw-step').waitFor();
  assert.equal(await page.textContent('.dw-taskline span'), title);
});

test('#/tasks still opens Lineup', async () => {
  await open('#/tasks');
  assert.equal(await page.title(), 'Lineup · Fuzz');
});
