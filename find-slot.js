#!/usr/bin/env node
/**
 * Zoekt een vrij padelterrein (zonder in te loggen) en toont de directe reservatielink.
 * Met --open wordt die link in je gewone Google Chrome geopend (macOS), zodat je zelf bevestigt.
 *
 *   node find-slot.js --date 2026-12-10 --time 19:30 [--club woten] [--open]
 */
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const BASE = 'https://www.tennisenpadelvlaanderen.be';
const CLUBS = { woten: 2220 };

const a = process.argv.slice(2);
const get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const club = (get('--club') || 'woten').toLowerCase();
const date = get('--date');
const time = get('--time');
if (!date || !time || !CLUBS[club]) {
  console.error('Gebruik: node find-slot.js --date JJJJ-MM-DD --time UU:MM [--club woten] [--open]');
  process.exit(1);
}
const [y, m, d] = date.split('-').map(Number);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/nl/clubdashboard/reserveer-een-terrein?clubId=${CLUBS[club]}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'header{display:none!important}' });

  await page.locator('[id$=":planningDay_input"]').click();
  const dp = page.locator('#ui-datepicker-div');
  await dp.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 24; i++) {
    const mm = await dp.locator('.ui-datepicker-month').evaluate(e => (e.tagName === 'SELECT' ? +e.value + 1 : e.textContent));
    const yy = await dp.locator('.ui-datepicker-year').evaluate(e => (e.tagName === 'SELECT' ? +e.value : +e.textContent));
    if (yy === y && mm === m) break;
    await dp.locator('.ui-datepicker-next').click();
  }
  await dp.locator('td:not(.ui-datepicker-other-month) a', { hasText: new RegExp(`^${d}$`) }).click();
  const want = `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
  // Wait until the grid has been re-rendered for the chosen day (cells exist and carry that date).
  await page.waitForFunction(w => {
    const cells = document.querySelectorAll('td.show-tooltip');
    const tds = document.querySelectorAll('td[data-url]');
    return cells.length > 0 && [...tds].every(td => td.dataset.url.includes('reservationDate=' + w))
      && (tds.length > 0 || !document.querySelector('.ui-blockui, .global-spinner:not([style*="none"])'));
  }, want, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const slots = await page.$$eval('td[data-url]', els => els.map(e => {
    const u = new URLSearchParams(e.dataset.url.split('?')[1]);
    return { url: e.dataset.url, court: (e.querySelector('.tooltip')?.childNodes[0]?.textContent || '').trim(), start: u.get('startHour'), end: u.get('endHour') };
  }));
  await browser.close();

  const hit = slots.filter(s => s.start === time);
  if (!hit.length) {
    console.log(`❌ Geen vrij terrein op ${date} om ${time}. Vrije starturen: ${[...new Set(slots.map(s => s.start))].join(', ') || 'geen'}`);
    process.exit(2);
  }
  const s = hit[0];
  const link = BASE + s.url;
  console.log(`✅ Vrij: ${hit.map(h => h.court).join(', ')} → ${s.court} ${s.start}-${s.end}`);
  console.log(link);
  if (a.includes('--open')) execFileSync('open', ['-a', 'Google Chrome', link]);
})().catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
