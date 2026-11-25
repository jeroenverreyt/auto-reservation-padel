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

// Woten: leden mogen maximaal 4 dagen (96 uur, tot op het uur) vooruit reserveren.
const MAX_HOURS_AHEAD = 96;
{
  // Start time in Brussels; the offset in winter is +01:00, in summer +02:00.
  const probe = new Date(`${date}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Brussels', timeZoneName: 'shortOffset' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+0';
  const [oh, om = '0'] = offset.split(':');
  const iso = `${date}T${time}:00${oh.startsWith('-') ? '-' : '+'}${String(Math.abs(+oh)).padStart(2, '0')}:${om.padStart(2, '0')}`;
  const start = new Date(iso);
  const opens = new Date(start.getTime() - MAX_HOURS_AHEAD * 36e5);
  if (opens > new Date()) {
    const fmt = opens.toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    console.log(`⚠️  Te vroeg: je mag maar ${MAX_HOURS_AHEAD} uur vooruit reserveren. Boeken kan vanaf ${fmt}.`);
  }
}

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
