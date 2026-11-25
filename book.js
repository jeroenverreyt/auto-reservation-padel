#!/usr/bin/env node
/**
 * Padel booker for Tennis en Padel Vlaanderen.
 *
 * Reads calendar events titled "Padel: <club>" and books a 90-minute padel court
 * at that club, starting at the event's start time.
 *
 * Environment variables:
 *   TPV_SESSION     saved login session (base64), made with `node login-save.js` (required)
 *   ICAL_URL        private iCal address of the Google Calendar (required unless --date/--time used)
 *   DRY_RUN         "1" (default) = go up to the final confirm button, but do not book
 *   LOOKAHEAD_DAYS  how many days ahead to look in the calendar (default 14)
 *   STATE_FILE      where booked events are remembered (default ./state/booked.json)
 *
 * Manual one-off use (no calendar):
 *   node book.js --club woten --date 2026-12-10 --time 19:30
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://www.tennisenpadelvlaanderen.be';
const TZ = 'Europe/Brussels';
const OUT = path.join(__dirname, 'out');

// Club name (as written in the calendar, lowercase) -> Tennis en Padel Vlaanderen clubId
const CLUBS = {
  woten: { id: 2220, name: 'WOTEN' },
};

const DRY_RUN = (process.env.DRY_RUN ?? '1') !== '0';
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS || 14);
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state', 'booked.json');

// ---------- helpers ----------
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function localParts(date) {
  // Date -> { ymd: '2026-12-10', dmy: '10/12/2026', hm: '19:30' } in Brussels time
  const f = new Intl.DateTimeFormat('nl-BE', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return { ymd: `${f.year}-${f.month}-${f.day}`, dmy: `${f.day}/${f.month}/${f.year}`, hm: `${f.hour}:${f.minute}` };
}

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return { club: get('--club'), date: get('--date'), time: get('--time') };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ---------- calendar ----------
async function wantedFromCalendar() {
  const ical = require('node-ical');
  if (!process.env.ICAL_URL) throw new Error('ICAL_URL is not set');
  const data = await ical.async.fromURL(process.env.ICAL_URL);
  const now = new Date();
  const until = new Date(now.getTime() + LOOKAHEAD_DAYS * 864e5);
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== 'VEVENT') continue;
    const m = String(ev.summary || '').match(/^\s*padel\s*[:@-]\s*(.+?)\s*$/i);
    if (!m) continue;
    const club = m[1].toLowerCase();
    // expand recurring events in the window
    const starts = ev.rrule
      ? ev.rrule.between(now, until, true).filter(d => !(ev.exdate && Object.values(ev.exdate).some(x => +x === +d)))
      : [ev.start];
    for (const s of starts) {
      if (s < now || s > until) continue;
      const p = localParts(s);
      out.push({ uid: `${ev.uid}@${p.ymd}`, club, ...p, title: ev.summary });
    }
  }
  return out.sort((a, b) => (a.ymd + a.hm).localeCompare(b.ymd + b.hm));
}

// ---------- browser ----------
async function hideOverlays(page) {
  await page.addStyleTag({ content: 'header{display:none!important}' }).catch(() => {});
}

async function openDay(page, clubId, dmy) {
  await page.goto(`${BASE}/nl/clubdashboard/reserveer-een-terrein?clubId=${clubId}`, { waitUntil: 'networkidle' });
  await hideOverlays(page);
  // pick padel courts if the club has a sport selector
  const padel = page.getByLabel(/Padel/i).first();
  if (await padel.count()) await padel.check().catch(() => {});

  const [dd, mm, yyyy] = dmy.split('/').map(Number);
  await page.locator('[id$=":planningDay_input"]').click();
  const dp = page.locator('#ui-datepicker-div');
  await dp.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 24; i++) {
    const m = await dp.locator('.ui-datepicker-month').evaluate(e => (e.tagName === 'SELECT' ? +e.value + 1 : e.textContent));
    const y = await dp.locator('.ui-datepicker-year').evaluate(e => (e.tagName === 'SELECT' ? +e.value : +e.textContent));
    if (y === yyyy && m === mm) break;
    await dp.locator('.ui-datepicker-next').click();
  }
  await dp.locator('td:not(.ui-datepicker-other-month) a', { hasText: new RegExp(`^${dd}$`) }).click();
  const want = dmy.replace(/\//g, '-');
  await page.waitForFunction(w => {
    const tds = document.querySelectorAll('td[data-url]');
    return tds.length === 0 || [...tds].every(td => td.dataset.url.includes('reservationDate=' + w));
  }, want, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function freeSlots(page) {
  return page.$$eval('td[data-url]', els => els.map(e => {
    const u = new URLSearchParams(e.dataset.url.split('?')[1]);
    const court = (e.querySelector('.tooltip')?.childNodes[0]?.textContent || '').trim();
    return { url: e.dataset.url, court, terrainId: u.get('terrainId'), start: u.get('startHour'), end: u.get('endHour') };
  }));
}

async function loginIfNeeded(page) {
  // Logging in automatically is blocked by Cloudflare Turnstile, so we only use a
  // session that the user created by logging in themselves (login-save.js).
  if (/auth\.tennispadelvlaanderen\.be|\/login/.test(page.url())) {
    throw new Error('SESSIE VERLOPEN: niet meer ingelogd. Draai `node login-save.js` op je computer en vervang de secret TPV_SESSION.');
  }
}

function sessionState() {
  if (!process.env.TPV_SESSION) throw new Error('TPV_SESSION is niet ingesteld (maak hem met `node login-save.js`).');
  return JSON.parse(Buffer.from(process.env.TPV_SESSION.trim(), 'base64').toString('utf8'));
}

async function dumpPage(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${name}.html`), await page.content());
  const fields = await page.$$eval('input, select, textarea', els => els
    .filter(e => e.type !== 'hidden' && e.offsetParent)
    .map(e => `${e.tagName.toLowerCase()} ${e.type || ''} name=${e.name} id=${e.id} value=${e.value}`));
  const buttons = await page.$$eval('button, input[type=submit], a.btn', els => els
    .filter(e => e.offsetParent).map(e => (e.innerText || e.value || '').trim()).filter(Boolean));
  log('form fields:', fields);
  log('buttons:', buttons);
}

async function book(page, want) {
  const club = CLUBS[want.club];
  if (!club) throw new Error(`unknown club "${want.club}" (known: ${Object.keys(CLUBS).join(', ')})`);
  log(`→ ${club.name} ${want.dmy} ${want.hm}`);

  await openDay(page, club.id, want.dmy);
  const slots = (await freeSlots(page)).filter(s => s.start === want.hm);
  if (!slots.length) {
    const all = [...new Set((await freeSlots(page)).map(s => s.start))];
    return { ok: false, reason: `geen vrij terrein om ${want.hm} (vrije starturen: ${all.join(', ') || 'geen'})` };
  }
  const slot = slots[0];
  log(`free: ${slots.map(s => s.court).join(', ')} → taking ${slot.court} ${slot.start}-${slot.end}`);

  await page.goto(BASE + slot.url, { waitUntil: 'domcontentloaded' });
  // With a valid session the auth server redirects straight back; otherwise the login form shows.
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !location.host.startsWith('auth.') || document.querySelector('#username'), null, { timeout: 30000 });
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);
  await loginIfNeeded(page);
  await hideOverlays(page);
  await dumpPage(page, `form-${want.ymd}-${want.hm.replace(':', '')}`);

  const confirm = page.getByRole('button', { name: /bevestig|reserveer|reservatie (aan)?maken|boek/i })
    .or(page.locator('input[type=submit][value*="evestig"], input[type=submit][value*="eserveer"]')).first();
  if (!(await confirm.count())) return { ok: false, reason: 'bevestigingsknop niet gevonden (zie out/)', slot };

  if (DRY_RUN) return { ok: true, dry: true, slot, reason: `DRY RUN: zou nu "${(await confirm.innerText().catch(() => '')).trim()}" klikken` };

  await confirm.click();
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await dumpPage(page, `result-${want.ymd}-${want.hm.replace(':', '')}`);
  const text = await page.evaluate(() => document.body.innerText);
  const success = /(succesvol|bevestigd|geboekt|is aangemaakt|reservatie is)/i.test(text) && !/(fout|niet toegelaten|niet mogelijk|maximum)/i.test(text);
  return { ok: success, slot, reason: success ? 'geboekt' : 'onzeker resultaat, zie out/' };
}

// ---------- main ----------
(async () => {
  const args = parseArgs();
  let wanted;
  if (args.date && args.time) {
    const [y, m, d] = args.date.split('-');
    wanted = [{ uid: `manual@${args.date}T${args.time}`, club: (args.club || 'woten').toLowerCase(), ymd: args.date, dmy: `${d}/${m}/${y}`, hm: args.time }];
  } else {
    wanted = await wantedFromCalendar();
  }
  const state = loadState();
  const todo = wanted.filter(w => !state[w.uid]);
  log(`${wanted.length} padel-afspraken gevonden, ${todo.length} nog te boeken${DRY_RUN ? ' (DRY RUN)' : ''}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: sessionState(), viewport: { width: 1400, height: 1000 }, locale: 'nl-BE', timezoneId: TZ });
  const page = await context.newPage();
  let failures = 0;
  for (const w of todo) {
    try {
      const r = await book(page, w);
      log(r.ok ? '✅' : '❌', w.ymd, w.hm, r.slot?.court || '', '-', r.reason);
      if (r.ok && !r.dry) { state[w.uid] = { ...w, court: r.slot.court, bookedAt: new Date().toISOString() }; saveState(state); }
      if (!r.ok) failures++;
    } catch (e) {
      failures++;
      log('❌', w.ymd, w.hm, e.message);
      await dumpPage(page, `error-${w.ymd}-${w.hm.replace(':', '')}`).catch(() => {});
    }
  }
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
