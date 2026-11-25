#!/usr/bin/env node
/**
 * Padel planner command line.
 *
 *   node cli.js club <clubId|link>                  club info (name, address, padel groups, courts)
 *   node cli.js free <club> <JJJJ-MM-DD> [UU:MM] [--from 18:00 --to 21:00 --minutes 90]
 *   node cli.js when <club> <JJJJ-MM-DD> <UU:MM> [--minutes 90]   when booking opens + links
 *   node cli.js ics <club> <JJJJ-MM-DD> <UU:MM> [--out match.ics]  calendar file with booking alarm
 *   node cli.js run [--config alerts.json] [--state state/state.json]   run all alerts once
 *   node cli.js test-push                            send a test notification
 *
 * <club> is a number (2220), a link containing clubId=…, or a key from alerts.json ("woten").
 */
const fs = require('fs');
const path = require('path');
const tpv = require('./lib/tpv');
const P = require('./docs/plan');
const alerts = require('./lib/alerts');

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [cmd, ...args] = pos;

const CONFIG = flag('config', process.env.ALERTS_CONFIG || path.join(__dirname, 'alerts.json'));
const STATE = flag('state', process.env.ALERTS_STATE || path.join(__dirname, 'state', 'state.json'));
const config = alerts.loadJson(CONFIG, null) || alerts.loadJson(path.join(__dirname, 'alerts.example.json'), { clubs: {} });

function club(ref) {
  if (!ref) throw new Error('Geef een club: nummer, link of naam uit alerts.json');
  const id = P.parseClubLink(ref);
  if (id) return { windowHours: 96, ...(Object.values(config.clubs || {}).find(c => c.id === id) || {}), id };
  return alerts.resolveClub(config, ref.toLowerCase());
}

async function main() {
  switch (cmd) {
    case 'club': {
      const c = await tpv.getClub(club(args[0]).id);
      console.log(`${c.name} (clubId ${c.clubId})\n${c.address}`);
      console.log('Terreingroepen:', c.groups.map(g => `${g.name}${g.padel ? ' 🎾' : ''} [${g.id}]`).join(', '));
      const day = await tpv.getDay(c.clubId, P.local(new Date()).ymd, { club: c });
      console.log('Padelterreinen:', [...new Set(day.courts.map(x => x.name))].join(', ') || '(geen)');
      const lens = [...new Set(day.slots.map(s => s.minutes))].sort((a, b) => a - b);
      if (lens.length) console.log('Duur (min):', lens.join(', '), '· starturen vandaag:', [...new Set(day.slots.map(s => s.start))].join(' '));
      break;
    }
    case 'free': {
      const c = club(args[0]);
      const date = args[1] || P.local(new Date()).ymd;
      const day = await tpv.getDay(c.id, date, c.groups ? { groups: c.groups } : {});
      const list = tpv.match(day.slots, { start: args[2], from: flag('from'), to: flag('to'), minutes: flag('minutes') });
      console.log(`${day.name} · ${date} · ${list.length} vrij`);
      let later = 0;
      for (const s of list) {
        const opens = P.describe({ clubId: c.id, date: s.date, time: s.start, windowHours: c.windowHours }).opens;
        const wait = opens > new Date() ? `⏳ vanaf ${P.fmt(opens)}` : '✅ nu boekbaar';
        if (opens > new Date()) later++;
        console.log(`  ${s.start}-${s.end} (${s.minutes}′)  ${s.court.padEnd(28)} ${wait.padEnd(26)} ${s.url}`);
      }
      if (later) console.log(`\n⏳ = nog niet boekbaar (venster ${c.windowHours} u voor de start; pas aan met "windowHours" in alerts.json).`);
      break;
    }
    case 'when': {
      const c = club(args[0]);
      const m = { clubId: c.id, clubName: c.name, date: args[1], time: args[2], minutes: Number(flag('minutes', 90)), windowHours: c.windowHours };
      if (!m.date || !m.time) throw new Error('Gebruik: when <club> <JJJJ-MM-DD> <UU:MM>');
      const d = P.describe(m);
      console.log(`Spelen:       ${P.fmt(d.start, { weekday: 'long' })} – ${d.endHm}`);
      console.log(`Boeken vanaf: ${P.fmt(d.opens, { weekday: 'long' })}${d.opens <= new Date() ? '  (nu al mogelijk)' : ''}  [venster ${c.windowHours} u]`);
      const day = await tpv.getDay(c.id, m.date, c.groups ? { groups: c.groups } : {});
      const free = tpv.match(day.slots, { start: m.time, minutes: m.minutes });
      console.log(free.length ? `Nu vrij: ${free.map(s => s.court).join(', ')}` : 'Nu geen vrij terrein op dat uur.');
      for (const s of free) console.log(`  ${s.court}: ${s.url}`);
      console.log(`Dagplanning: ${P.dayUrl(c.id, m.date)}`);
      break;
    }
    case 'ics': {
      const c = club(args[0]);
      const info = await tpv.getClub(c.id);
      const day = await tpv.getDay(c.id, args[1], { club: info, groups: c.groups });
      const m = {
        clubId: c.id, clubName: c.name || info.name, clubAddress: info.address, date: args[1], time: args[2],
        minutes: Number(flag('minutes', 90)), windowHours: c.windowHours,
        courts: tpv.match(day.slots, { start: args[2] }).map(s => ({ name: s.court, terrainId: s.terrainId })),
      };
      const out = flag('out', `padel-${m.date}-${m.time.replace(':', '')}.ics`);
      fs.writeFileSync(out, P.ics(m));
      console.log(`Geschreven: ${out} (open op je gsm of mail het naar jezelf)`);
      break;
    }
    case 'run': {
      if (!fs.existsSync(CONFIG)) { console.log(`Geen ${path.basename(CONFIG)}: niets te doen. Kopieer alerts.example.json naar alerts.json en pas aan.`); break; }
      const state = alerts.loadJson(STATE, {});
      console.log(`Alerts uitvoeren (${new Date().toISOString()})`);
      const res = await alerts.run({ config, state });
      alerts.saveJson(STATE, state);
      console.log(`Klaar: ${res.length} acties`);
      if (res.some(r => r.action === 'error')) process.exitCode = 1;
      break;
    }
    case 'test-push': {
      const topic = process.env.NTFY_TOPIC || (config.ntfy || {}).topic;
      await alerts.push(config, P.ntfyMessage(topic, {
        title: '🎾 Testmelding padel-planner', message: 'Als je dit ziet, werken de meldingen.',
        click: P.dayUrl(2220, P.local(new Date()).ymd),
      }), console.log);
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
