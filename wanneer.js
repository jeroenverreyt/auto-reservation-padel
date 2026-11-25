#!/usr/bin/env node
/**
 * Berekent wanneer je bij Woten een terrein kunt boeken (96 uur vooraf) en geeft
 * de directe reservatielinks voor Padel 1, 2 en 3. Geen extra pakketten nodig.
 *
 *   node wanneer.js 2026-12-06 19:30
 */
const TZ = 'Europe/Brussels';
const MAX_HOURS_AHEAD = 96;
const CLUB_ID = 2220;
const COURTS = [
  { name: 'Padel 1', terrainId: 9195931 },
  { name: 'Padel 2', terrainId: 9195932 },
  { name: 'Padel 3', terrainId: 9195933 },
];
const SLOTS = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00'];

const [date, time] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) {
  console.error('Gebruik: node wanneer.js JJJJ-MM-DD UU:MM   (bv. node wanneer.js 2026-12-06 19:30)');
  process.exit(1);
}
if (!SLOTS.includes(time)) {
  console.error(`⚠️  Woten werkt met vaste blokken van 90 min. Kies een beginuur uit: ${SLOTS.join(', ')}`);
  process.exit(1);
}

// Brussels local time -> Date (handles winter/summer time)
function brussels(dateStr, timeStr) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const off = new Intl.DateTimeFormat('en', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(guess).find(p => p.type === 'timeZoneName').value.replace('GMT', '') || '+0';
  const [h, m = '0'] = off.split(':');
  const sign = h.startsWith('-') ? -1 : 1;
  return new Date(guess.getTime() - sign * (Math.abs(+h) * 60 + +m) * 60000);
}
const fmt = d => d.toLocaleString('nl-BE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const start = brussels(date, time);
const end = new Date(start.getTime() + 90 * 60000);
const endHm = end.toLocaleTimeString('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const opens = new Date(start.getTime() - MAX_HOURS_AHEAD * 36e5);
const [y, mo, d] = date.split('-');

console.log(`Spelen:        ${fmt(start)} – ${endHm}`);
console.log(`Boeken vanaf:  ${fmt(opens)}${opens <= new Date() ? '  (nu al mogelijk)' : ''}`);
console.log(`Taak plannen:  ${fmt(new Date(opens.getTime() - 3 * 60000))}  (3 min vooraf)`);
console.log('\nDirecte reservatielinks:');
for (const c of COURTS) {
  console.log(`  ${c.name}: https://www.tennisenpadelvlaanderen.be/reservatie?clubId=${CLUB_ID}&terrainId=${c.terrainId}&reservationDate=${d}-${mo}-${y}&startHour=${time}&endHour=${endHm}`);
}
