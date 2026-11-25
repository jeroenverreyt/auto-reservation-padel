/**
 * Pure planning helpers shared by the web app (browser) and the Node tools.
 * No dependencies. Times are Europe/Brussels unless stated otherwise.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PadelPlan = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TZ = 'Europe/Brussels';
  const BASE = 'https://www.tennisenpadelvlaanderen.be';
  const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

  const pad = n => String(n).padStart(2, '0');
  const toDmy = ymd => ymd.split('-').reverse().join('-');
  const minutesOf = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hmOf = mins => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

  /** UTC offset (minutes) of Brussels at a given instant. */
  function offsetAt(date) {
    const name = new Intl.DateTimeFormat('en', { timeZone: TZ, timeZoneName: 'shortOffset' })
      .formatToParts(date).find(p => p.type === 'timeZoneName').value; // "GMT+1"
    const m = name.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    const h = Number(m[1]);
    return h * 60 + Math.sign(h || 1) * Number(m[2] || 0);
  }

  /** Brussels local date+time -> Date */
  function brussels(ymd, hm) {
    const guess = new Date(`${ymd}T${hm}:00Z`);
    let d = new Date(guess.getTime() - offsetAt(guess) * 60000);
    d = new Date(guess.getTime() - offsetAt(d) * 60000); // correct around DST switches
    return d;
  }

  /** Date -> { ymd, hm, weekday } in Brussels */
  function local(date) {
    const p = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(date).reduce((o, x) => ((o[x.type] = x.value), o), {});
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, weekday: wd };
  }

  function fmt(date, opts = {}) {
    return date.toLocaleString('nl-BE', {
      timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts,
    });
  }

  function addDays(ymd, n) {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** A planned match: { clubId, clubName, date, time, minutes, windowHours, courts? } */
  function describe(m) {
    const start = brussels(m.date, m.time);
    const end = new Date(start.getTime() + (m.minutes || 90) * 60000);
    const opens = new Date(start.getTime() - (m.windowHours ?? 96) * 3600000);
    return { start, end, opens, endHm: local(end).hm };
  }

  function dayUrl(clubId, ymd) {
    return `${BASE}/clubdashboard/reserveer-een-terrein?clubId=${clubId}&planningDay=${toDmy(ymd)}`;
  }

  function reservationUrl(clubId, terrainId, ymd, start, end) {
    return `${BASE}/reservatie?clubId=${clubId}&terrainId=${terrainId}&reservationDate=${toDmy(ymd)}&startHour=${start}&endHour=${end}`;
  }

  /** Best link to book: direct court link when the court id is known, else the club's day planning. */
  function bookUrl(m, court) {
    const { endHm } = describe(m);
    return court && court.terrainId ? reservationUrl(m.clubId, court.terrainId, m.date, m.time, endHm) : dayUrl(m.clubId, m.date);
  }

  // ---------- calendar (.ics) ----------
  const icsDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  // Fold long lines on code points (never split an emoji in two).
  const fold = line => {
    const chars = Array.from(line), out = [];
    for (let i = 0; i < chars.length; i += 70) out.push(chars.slice(i, i + 70).join(''));
    return out.join('\r\n ');
  };

  /**
   * Calendar with the match itself and (optionally) a "booking opens" event with an alarm,
   * so the phone rings at exactly the right moment, without any server.
   */
  function ics(matches, { reminder = true } = {}) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//padel-planner//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    const stamp = icsDate(new Date());
    for (const m of [].concat(matches)) {
      const { start, end, opens } = describe(m);
      const uid = `${m.clubId}-${m.date}-${m.time.replace(':', '')}@padel-planner`;
      const url = bookUrl(m, (m.courts || [])[0]);
      const who = m.players && m.players.length ? `\nSpelers: ${m.players.join(', ')}` : '';
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`,
        fold(`SUMMARY:${icsText(`Padel: ${m.clubName || m.clubId}`)}`),
        fold(`DESCRIPTION:${icsText(`Padel bij ${m.clubName || m.clubId} (${m.minutes || 90} min).${who}\nReserveren: ${url}`)}`),
        fold(`LOCATION:${icsText(m.clubAddress || m.clubName || '')}`), fold(`URL:${url}`),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT2H', `DESCRIPTION:${icsText('Padel over 2 uur')}`, 'END:VALARM', 'END:VEVENT');
      if (reminder && opens > new Date()) {
        lines.push('BEGIN:VEVENT', `UID:open-${uid}`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(opens)}`,
          `DTEND:${icsDate(new Date(opens.getTime() + 15 * 60000))}`,
          fold(`SUMMARY:${icsText(`🎾 Nu boeken: ${m.clubName || m.clubId} ${fmt(start)}`)}`),
          fold(`DESCRIPTION:${icsText(`Het boekingsvenster gaat nu open. Tik om te reserveren:\n${url}`)}`), fold(`URL:${url}`),
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT5M', `DESCRIPTION:${icsText('Boeken over 5 minuten')}`, 'END:VALARM',
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT0M', `DESCRIPTION:${icsText('Nu boeken!')}`, 'END:VALARM', 'END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- push (ntfy) ----------
  /** ntfy JSON message; `at` schedules delivery (ntfy.sh allows up to 3 days ahead). */
  function ntfyMessage(topic, { title, message, click, actions, at, tags, priority }) {
    const msg = { topic, title, message, tags: tags || ['tennis'], priority: priority || 4 };
    if (click) msg.click = click;
    if (actions && actions.length) msg.actions = actions.slice(0, 3).map(a => ({ action: 'view', label: a.label, url: a.url, clear: true }));
    if (at) msg.delay = String(Math.floor(at.getTime() / 1000));
    return msg;
  }
  const NTFY_MAX_DELAY_MS = 3 * 24 * 3600 * 1000 - 5 * 60000;

  function releaseMessage(topic, m) {
    const { start, opens } = describe(m);
    const courts = (m.courts || []).filter(c => c.terrainId);
    return ntfyMessage(topic, {
      title: `🎾 Nu boeken: ${m.clubName || 'padel'} ${fmt(start)}`,
      message: `Het boekingsvenster is open. Tik om te reserveren${m.players && m.players.length ? ` (met ${m.players.join(', ')})` : ''}.`,
      click: bookUrl(m, courts[0]),
      actions: courts.map(c => ({ label: c.name, url: bookUrl(m, c) })),
      at: opens > new Date(Date.now() + 60000) ? opens : undefined,
      priority: 5, tags: ['tennis', 'alarm_clock'],
    });
  }

  // ---------- sharing ----------
  function shareText(m) {
    const { start, endHm } = describe(m);
    return `🎾 Padel ${fmt(start, { weekday: 'long', month: 'long' })}–${endHm} bij ${m.clubName || 'de club'}.` +
      `${m.clubAddress ? `\n📍 ${m.clubAddress}` : ''}\nDoe je mee? 👍/👎`;
  }

  function parseClubLink(input) {
    const s = String(input || '').trim();
    const m = s.match(/clubId=(\d+)/i) || s.match(/^(\d{3,9})$/);
    return m ? Number(m[1]) : null;
  }

  return {
    TZ, BASE, DAYS, pad, toDmy, minutesOf, hmOf, brussels, local, fmt, addDays, describe,
    dayUrl, reservationUrl, bookUrl, ics, ntfyMessage, releaseMessage, NTFY_MAX_DELAY_MS, shareText, parseClubLink,
  };
});
