/* The end of the onboarding: a check-in on your first task, then the Guide, one part at a time.
   Run: cd tests/ui && npm install && npm test */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 8790 + Math.floor(Math.random() * 900);
let server, browser, page;

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function at(step, hash) {
  page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.errors = errors;
  await page.addInitScript(s => {
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('fuzz.onboarding.v1', JSON.stringify({ step: s, done: false, needed: true, tips: [], setup: {} })); }
  }, step);
  await page.goto(`http://127.0.0.1:${PORT}/${hash}`);
}
afterEach(async () => { assert.deepEqual(page.errors, []); await page.close(); });

test('how it works no longer asks for a daily slot', async () => {
  await at('how', '#/welcome');
  await page.locator('.onb-how').waitFor();
  assert.equal(await page.locator('#onb-caltime').count(), 0);
  assert.doesNotMatch(await page.locator('.onb-tips').textContent(), /once or twice a day/);
});

test('the check-in offers a few times and, without a calendar tool, a one-off 20-minute calendar file; then the tour', async () => {
  await at('checkin', '#/welcome');
  await page.locator('.onb-ci [data-citime]').first().waitFor();
  assert.ok(await page.locator('[data-citime]').count() >= 2);
  assert.match(await page.locator('[data-onb="ciadd"]').textContent(), /Add to my calendar/);
  await page.locator('[data-citime="1"]').click();
  assert.equal(await page.locator('[data-citime="1"]').getAttribute('aria-pressed'), 'true');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-onb="ciadd"]').click()]);
  const ics = await readFile(await dl.path(), 'utf8');
  assert.match(ics, /SUMMARY:Check in with Fuzz/);
  assert.doesNotMatch(ics, /RRULE/, 'once, not every day');
  const s = /DTSTART:(\d{8}T\d{6}Z)/.exec(ics)[1], e = /DTEND:(\d{8}T\d{6}Z)/.exec(ics)[1];
  const t = x => Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8), +x.slice(9, 11), +x.slice(11, 13));
  assert.equal((t(e) - t(s)) / 60000, 20);
  assert.match(ics, /#\/triage/);
  await page.locator('#onb-tour').waitFor();
  assert.match(page.url(), /#\/guide/);
});

test('the tour points at Triage, My work, Something else and the menu, then the onboarding is over', async () => {
  await at('tour', '#/guide');
  const tip = page.locator('#onb-tour');
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await tip.locator('h2').waitFor();
    seen.push([(await tip.locator('h2').textContent()).trim(), await page.evaluate(() => { const e = document.querySelector('.onb-spot'); return e && (e.dataset.pick || e.id || e.textContent.trim()); })]);
    await tip.locator('[data-tour="next"]').click();
  }
  assert.deepEqual(seen, [['Triage', 'triage'], ['My work', 'My work'], ['Something else', 'typed'], ['Everything else', 'menubtn']]);
  await page.waitForFunction(() => !document.querySelector('#onb-tour') && !Onboard.active());
  assert.equal(await page.locator('.onb-spot').count(), 0);
});

test('Skip the tour ends it, and leaving the Guide hides the bubble until you come back', async () => {
  await at('tour', '#/guide');
  await page.locator('#onb-tour h2').waitFor();
  await page.evaluate(() => App.navigate('#/tasks'));
  await page.waitForFunction(() => !document.querySelector('#onb-tour'));
  await page.evaluate(() => App.navigate('#/guide'));
  await page.locator('#onb-tour h2').waitFor();
  await page.locator('[data-tour="skip"]').click();
  await page.waitForFunction(() => !document.querySelector('#onb-tour') && !Onboard.active());
});
