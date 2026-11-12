/* The Later panel on Triage, driven in a real browser against the demo data (a static server has no token).
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 100);
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
  /* The session-focus question comes first; Esc skips it to the first card */
  await page.locator('#focuscard').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('[data-act="schedule"]').first().waitFor();
});
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

/* Give the current card exactly n rough times (the demo's own, repeated if it has fewer), then open Later */
async function openLater(n) {
  await page.evaluate((n) => {
    const real = Store.scheduleOptions;
    Store.scheduleOptions = (it) => {
      const all = real(it), times = all.filter(o => o.anchor.type !== 'exact'), exact = all.filter(o => o.anchor.type === 'exact');
      const out = [];
      for (let i = 0; i < n; i++) out.push(Object.assign({}, times[i % times.length], { label: 'Time ' + (i + 1) }));
      return out.concat(exact);
    };
  }, n);
  /* The first card puts you in its instructions box, where letters type; Later is clicked instead */
  await page.locator('[data-act="schedule"]').first().click();
  await page.locator('.sched-panel').waitFor();
}
const tiles = () => page.locator('.sched-panel [data-when]');
const more = () => page.locator('[data-sched="more"]');

test('Exact time is a numbered tile shown before More times', async () => {
  await openLater(5);
  assert.equal(await page.locator('.sched-links [data-sched="exact"]').count(), 0, 'no exact-time link under the tiles');
  const exactTile = page.locator('.when-grid [data-sched="exact"]');
  assert.equal(await exactTile.count(), 1);
  assert.equal(await page.locator('#exact').isVisible(), false);
  /* three times, End of the list, then Exact time: 5. X is Not mine, never a time */
  assert.equal(await exactTile.getAttribute('aria-keyshortcuts'), '5');
  await page.keyboard.press('5');
  assert.equal(await page.locator('#exact').isVisible(), true);
  assert.equal(await exactTile.getAttribute('aria-expanded'), 'true');
});

test('One extra time shows as a fourth tile, not behind More times', async () => {
  await openLater(4);
  assert.equal(await tiles().count(), 4);
  assert.equal(await more().count(), 0);
});

test('Two or more extra times fold behind More times', async () => {
  await openLater(5);
  assert.equal(await tiles().count(), 3);
  assert.equal(await more().count(), 1);
  await page.keyboard.press('m');
  assert.equal(await tiles().count(), 5);
  assert.equal(await more().count(), 0);
});

test('End of the list is a number, not E', async () => {
  await openLater(5);
  assert.equal(await page.locator('[data-sched="back"]').getAttribute('aria-keyshortcuts'), '4');
  await page.keyboard.press('e');
  assert.equal(await page.locator('.sched-panel').count(), 1, 'E does nothing in the time picker');
});

test('An open exact time stays open through More times, until a real time is picked', async () => {
  await openLater(5);
  await page.keyboard.press('5');
  const exact = page.locator('#exact');
  /* Set something in the picker, so we can tell it was kept rather than drawn fresh */
  const tomorrow = exact.locator('[data-xpchip]').nth(1);
  await tomorrow.click();
  const day = await tomorrow.getAttribute('data-xpchip');
  assert.equal(await tomorrow.getAttribute('aria-pressed'), 'true');

  await more().click();
  assert.equal(await tiles().count(), 5, 'More times showed the rest');
  assert.equal(await exact.isVisible(), true, 'the exact-time picker is still open');
  assert.equal(await exact.locator(`[data-xpchip="${day}"]`).getAttribute('aria-pressed'), 'true', 'and still has the day you picked');
  assert.equal(await page.locator('.when-grid [data-sched="exact"]').getAttribute('aria-expanded'), 'true');

  /* Picking a real time schedules the card, and the panel (picker with it) goes */
  await tiles().nth(4).click();
  await page.locator('.sched-panel').waitFor({ state: 'detached' });
});
