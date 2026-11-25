/**
 * Alert engine. Runs every few minutes (GitHub Actions, cron or the home server)
 * and sends push notifications through ntfy (https://ntfy.sh).
 *
 * Alert types (see alerts.example.json):
 *   release  "Ping me the moment I may book <date> <time>." Sent ahead with ntfy's scheduled
 *            delivery, so it arrives on the exact minute even if this job runs late.
 *            Right after the window opened, it checks which courts are still free; if none,
 *            it keeps watching that slot for cancellations until the match starts.
 *   weekly   A release alert that repeats every week (e.g. every Thursday 19:30).
 *   watch    "Tell me when something frees up" between `from` and `to` on a date or on
 *            weekdays, for bookable slots only (cancellations, late releases).
 */
const fs = require('fs');
const path = require('path');
const tpv = require('./tpv');
const P = require('../docs/plan');

const DAY_MS = 864e5;

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function resolveClub(config, ref) {
  const c = (config.clubs || {})[ref] || (/^\d+$/.test(String(ref)) ? { id: Number(ref) } : null);
  if (!c) throw new Error(`Onbekende club "${ref}". Voeg ze toe onder "clubs" in alerts.json.`);
  return { windowHours: 96, ...c, key: String(ref) };
}

const WD = { zo: 0, ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const weekdayNum = w => (typeof w === 'number' ? w : WD[String(w).toLowerCase().slice(0, 3)] ?? WD[String(w).toLowerCase().slice(0, 2)]);

/** Expand weekly alerts into concrete release alerts for the next `weeks` weeks. */
function expand(config, now = new Date()) {
  const out = [];
  for (const a of config.alerts || []) {
    if (a.enabled === false) continue;
    if (a.type === 'weekly') {
      const wd = weekdayNum(a.weekday);
      const today = P.local(now).ymd;
      for (let i = 0; i < 7 * (a.weeks || 3); i++) {
        const date = P.addDays(today, i);
        if (new Date(`${date}T12:00:00Z`).getUTCDay() !== wd) continue;
        if (a.until && date > a.until) continue;
        if ((a.skip || []).includes(date)) continue;
        out.push({ ...a, type: 'release', id: `${a.id || `weekly-${a.club}-${a.weekday}`}@${date}T${a.time}`, date });
      }
    } else out.push({ ...a, id: a.id || `${a.type}-${a.club}-${a.date || a.weekday}-${a.time || a.from}` });
  }
  return out;
}

async function push(config, msg, log) {
  const server = (config.ntfy && config.ntfy.server) || process.env.NTFY_SERVER || 'https://ntfy.sh';
  if (!msg.topic) { log('  (geen ntfy-topic ingesteld, melding enkel in log)', msg.title); return; }
  const headers = { 'content-type': 'application/json' };
  const token = process.env.NTFY_TOKEN || (config.ntfy && config.ntfy.token);
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(server, { method: 'POST', headers, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
  log(`  📲 ${msg.delay ? `gepland voor ${P.fmt(new Date(+msg.delay * 1000))}` : 'verstuurd'}: ${msg.title}`);
}

function matchOf(alert, club, dayInfo) {
  return {
    clubId: club.id, clubName: club.name || (dayInfo && dayInfo.name) || `club ${club.id}`,
    clubAddress: dayInfo && dayInfo.address, date: alert.date, time: alert.time,
    minutes: alert.minutes || 90, windowHours: club.windowHours, players: alert.players,
  };
}

/**
 * Run all alerts once.
 * @param {{config:object, state:object, now?:Date, topic?:string, log?:Function, fetchDay?:Function}} o
 */
async function run({ config, state, now = new Date(), topic = process.env.NTFY_TOPIC || (config.ntfy || {}).topic, log = console.log, fetchDay }) {
  state.releases = state.releases || {};
  state.seen = state.seen || {};
  const dayCache = new Map(), clubCache = new Map();
  const getDay = fetchDay || (async (club, date) => {
    if (!clubCache.has(club.id)) clubCache.set(club.id, tpv.getClub(club.id));
    const info = await clubCache.get(club.id);
    const k = `${club.id}|${date}`;
    if (!dayCache.has(k)) dayCache.set(k, tpv.getDay(club.id, date, { club: info, groups: club.groups }));
    return dayCache.get(k);
  });
  const results = [];

  const defaultTopic = topic;
  for (const a of expand(config, now)) {
    const club = resolveClub(config, a.club);
    topic = a.topic || defaultTopic;
    try {
      if (a.type === 'release') {
        const m = matchOf(a, club);
        const { start, opens } = P.describe(m);
        if (start <= now) continue;                                   // match passed
        const st = state.releases[a.id] || (state.releases[a.id] = {});

        // 1) schedule the exact-minute push as soon as ntfy allows (max 3 days ahead)
        if (!st.scheduled && opens > now && opens - now <= P.NTFY_MAX_DELAY_MS) {
          const day = await getDay(club, a.date);
          const wanted = tpv.match(day.slots, { start: a.time, minutes: m.minutes });
          const courts = (wanted.length ? wanted : day.slots.filter(s => s.start === a.time))
            .map(s => ({ name: s.court, terrainId: s.terrainId }));
          await push(config, P.releaseMessage(topic, { ...m, clubName: club.name || day.name, courts }), log);
          st.scheduled = new Date().toISOString();
          results.push({ id: a.id, action: 'scheduled' });
        }

        // 2) after opening: still free? (or, for alerts added late: book now / full)
        if (now >= opens) {
          const day = await getDay(club, a.date);
          const free = tpv.match(day.slots, { start: a.time, minutes: m.minutes });
          const key = free.map(s => s.terrainId).sort().join(',');
          if (!st.checked) {
            st.checked = new Date().toISOString();
            if (!free.length) {
              await push(config, P.ntfyMessage(topic, {
                title: `😕 Volzet: ${club.name || day.name} ${P.fmt(start)}`,
                message: 'Geen vrij terrein meer op dat uur. Ik hou het in de gaten en meld het als er een vrijkomt.',
                click: P.dayUrl(club.id, a.date), tags: ['tennis', 'hourglass'], priority: 3,
              }), log);
            } else if (!st.scheduled) {
              const msg = P.releaseMessage(topic, { ...m, clubName: club.name || day.name,
                courts: free.map(s => ({ name: s.court, terrainId: s.terrainId })) });
              delete msg.delay; // the window is already open: send right away
              await push(config, msg, log);
              results.push({ id: a.id, action: 'book-now' });
            }
            st.scheduled = st.scheduled || st.checked;
            st.lastFree = key;
          } else if (free.length && key !== st.lastFree && !st.lastFree.split(',').filter(Boolean).length) {
            await push(config, P.ntfyMessage(topic, {
              title: `🎉 Vrijgekomen: ${club.name || day.name} ${P.fmt(start)}`,
              message: `${free.map(s => s.court).join(', ')} is weer vrij. Snel zijn!`,
              click: free[0].url, actions: free.map(s => ({ label: s.court, url: s.url })), priority: 5, tags: ['tennis', 'tada'],
            }), log);
            st.lastFree = key;
          } else st.lastFree = key;
        }
      }

      if (a.type === 'watch') {
        const dates = a.date ? [a.date] : [];
        if (!a.date) {
          const days = (a.weekdays || [a.weekday]).filter(x => x !== undefined).map(weekdayNum);
          const today = P.local(now).ymd;
          for (let i = 0; i <= Math.ceil((club.windowHours || 96) / 24); i++) {
            const d = P.addDays(today, i);
            if (!days.length || days.includes(new Date(`${d}T12:00:00Z`).getUTCDay())) dates.push(d);
          }
        }
        const seen = new Set(state.seen[a.id] || []);
        const fresh = [];
        for (const date of dates) {
          if (a.until && date > a.until) continue;
          const day = await getDay(club, date);
          for (const s of tpv.match(day.slots, { from: a.from, to: a.to, minutes: a.minutes })) {
            const startAt = P.brussels(s.date, s.start);
            if (startAt <= now) continue;                                          // already started
            if (startAt - now > club.windowHours * 3600e3) continue;              // not bookable yet
            const k = `${s.date} ${s.start} ${s.terrainId} ${s.minutes}`;
            if (!seen.has(k)) fresh.push({ ...s, clubName: club.name || day.name });
          }
          // forget slots that are gone, so they alert again if they free up again
          const current = new Set(day.slots.map(s => `${s.date} ${s.start} ${s.terrainId} ${s.minutes}`));
          for (const k of [...seen]) if (k.startsWith(date) && !current.has(k)) seen.delete(k);
        }
        if (fresh.length && (state.seen[a.id] || a.notifyFirstRun)) {
          const lines = fresh.slice(0, 6).map(s => `${P.fmt(P.brussels(s.date, s.start))} · ${s.court} (${s.minutes}′)`);
          await push(config, P.ntfyMessage(topic, {
            title: `🎾 ${fresh.length} vrij terrein${fresh.length > 1 ? 'en' : ''}: ${fresh[0].clubName}`,
            message: lines.join('\n') + (fresh.length > 6 ? `\n… en ${fresh.length - 6} meer` : ''),
            click: fresh[0].url, actions: fresh.slice(0, 3).map(s => ({ label: `${s.start} ${s.court}`.slice(0, 24), url: s.url })),
          }), log);
          results.push({ id: a.id, action: 'notified', count: fresh.length });
        } else if (fresh.length) log(`  (eerste run voor ${a.id}: ${fresh.length} vrije terreinen onthouden, geen melding)`);
        for (const s of fresh) seen.add(`${s.date} ${s.start} ${s.terrainId} ${s.minutes}`);
        state.seen[a.id] = [...seen];
      }
    } catch (e) {
      log(`  ❌ ${a.id}: ${e.message}`);
      results.push({ id: a.id, action: 'error', error: e.message });
    }
  }

  // housekeeping: drop state of matches long gone
  for (const id of Object.keys(state.releases)) {
    const date = (id.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
    if (date && date < P.addDays(P.local(now).ymd, -2)) delete state.releases[id];
  }
  state.lastRun = now.toISOString();
  return results;
}

module.exports = { run, expand, resolveClub, loadJson, saveJson, push };
