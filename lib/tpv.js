/**
 * Tennis en Padel Vlaanderen: public court schedule reader.
 *
 * Reads the public day schedule ("terreinreservatie") of any club with a plain
 * HTTP request: no browser, no login. Works in Node 18+ (global fetch).
 *
 *   const tpv = require('./lib/tpv');
 *   const club = await tpv.getClub(2220);
 *   const day  = await tpv.getDay(2220, '2026-11-29');            // all padel groups
 *   const free = day.slots.filter(s => s.start === '19:30');
 */
const BASE = 'https://www.tennisenpadelvlaanderen.be';
const UA = 'Mozilla/5.0 (compatible; padel-planner/1.0; +https://github.com/)';

const decode = s => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = s => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** '2026-11-29' -> '29-11-2026' */
const toDmy = ymd => ymd.split('-').reverse().join('-');
/** '29-11-2026' -> '2026-11-29' */
const toYmd = dmy => dmy.split('-').reverse().join('-');
const minutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const hm = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

function dayUrl(clubId, ymd, groupId) {
  const q = new URLSearchParams({ clubId: String(clubId) });
  if (ymd) q.set('planningDay', toDmy(ymd));
  if (groupId) q.set('terrainGroupId', String(groupId));
  return `${BASE}/clubdashboard/reserveer-een-terrein?${q}`;
}

function reservationUrl({ clubId, terrainId, date, start, end }) {
  const q = new URLSearchParams({
    clubId: String(clubId), terrainId: String(terrainId),
    reservationDate: toDmy(date), startHour: start, endHour: end,
  });
  return `${BASE}/reservatie?${q}`;
}

async function fetchHtml(url, { retries = 2 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'nl-BE,nl;q=0.9' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

/** Parse one day-schedule page. */
function parseDay(html, clubId) {
  const name = text((html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
  const address = text((html.match(/sport-label[\s\S]*?<\/div>\s*<p>([\s\S]*?)<\/p>/) || [])[1] || '');
  const sports = [...html.matchAll(/sport-label--(\w+)/g)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);

  const groups = [...html.matchAll(/:terrainGroupId:\d+"[^>]*type="radio" value="(\d+)"([^>]*)>\s*<span[^>]*>([^<]*)<\/span>/g)]
    .map(m => ({ id: Number(m[1]), name: decode(m[3]).trim(), selected: /checked/.test(m[2]) }))
    .map(g => ({ ...g, padel: /padel/i.test(g.name) }));

  const courts = [...html.matchAll(/reservation-header-strip__court[^>]*>\s*([^<]+?)\s*</g)].map(m => decode(m[1]));
  const date = (html.match(/planningDay_input"[^>]*value="([\d/]+)"/) || [])[1];

  const slots = [];
  for (const m of html.matchAll(/<td class="([^"]*)"[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)<\/td>/g)) {
    const url = decode(m[2]);
    const q = new URLSearchParams(url.split('?')[1]);
    const court = text((m[3].match(/<div class="tooltip"[^>]*>([\s\S]*?)<hr/) || [])[1] || '');
    const note = text((m[3].match(/<hr>\s*<span>([\s\S]*?)<\/span>/) || [])[1] || '');
    const start = q.get('startHour'), end = q.get('endHour');
    slots.push({
      clubId: Number(clubId), court, terrainId: Number(q.get('terrainId')),
      date: toYmd(q.get('reservationDate')), start, end,
      minutes: minutes(end) - minutes(start), note,
      url: BASE + url.replace(/&returnUrl=.*$/, ''),
    });
  }
  return {
    clubId: Number(clubId), name, address, sports, groups, courts,
    date: date ? toYmd(date.replace(/\//g, '-')) : undefined,
    selectedGroup: (groups.find(g => g.selected) || {}).id, slots,
  };
}

/** Club info (name, address, terrain groups) from today's schedule. */
async function getClub(clubId) {
  const day = parseDay(await fetchHtml(dayUrl(clubId)), clubId);
  if (!day.name) throw new Error(`Club ${clubId} niet gevonden of heeft geen terreinreservatie`);
  const { slots, date, selectedGroup, ...club } = day;
  return club;
}

/**
 * Free slots of one day. By default every padel terrain group of the club is read.
 * @param {number} clubId
 * @param {string} date YYYY-MM-DD
 * @param {{groups?: number[], club?: object}} opts
 */
async function getDay(clubId, date, opts = {}) {
  const club = opts.club || await getClub(clubId);
  const groups = opts.groups || club.groups.filter(g => g.padel).map(g => g.id);
  const out = { ...club, date, slots: [], courts: [] };
  for (const gid of groups.length ? groups : [undefined]) {
    const d = parseDay(await fetchHtml(dayUrl(clubId, date, gid)), clubId);
    if (d.date && d.date !== date) throw new Error(`Kreeg ${d.date} i.p.v. ${date} voor club ${clubId}`);
    const gname = (club.groups.find(g => g.id === gid) || {}).name;
    out.courts.push(...d.courts.map(c => ({ name: c, group: gname, groupId: gid })));
    out.slots.push(...d.slots.filter(s => s.date === date).map(s => ({ ...s, group: gname, groupId: gid })));
  }
  out.slots.sort((a, b) => a.start.localeCompare(b.start) || a.court.localeCompare(b.court, 'nl', { numeric: true }));
  return out;
}

/** Filter free slots on time window / duration. */
function match(slots, { start, from, to, minutes: dur } = {}) {
  return slots.filter(s =>
    (!start || s.start === start) &&
    (!from || minutes(s.start) >= minutes(from)) &&
    (!to || minutes(s.start) <= minutes(to)) &&
    (!dur || s.minutes === Number(dur)));
}

module.exports = { BASE, getClub, getDay, parseDay, match, dayUrl, reservationUrl, toDmy, toYmd, minutes, hm };
