// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const alerts = require('../lib/alerts');
const P = require('../docs/plan');

const slot = (date, start, court, terrainId, minutes = 90) => ({
  clubId: 2220, court, terrainId, date, start,
  end: P.hmOf(P.minutesOf(start) + minutes), minutes, url: `https://x/${terrainId}/${date}/${start}`,
});

function harness(days) {
  const pushed = [];
  const config = {
    ntfy: { server: 'http://unused' },
    clubs: { woten: { id: 2220, name: 'Woten', windowHours: 96 } },
    alerts: [],
  };
  const origPush = alerts.push;
  global.fetch = async (url, opts) => { pushed.push(JSON.parse(opts.body)); return { ok: true, text: async () => '' }; };
  const fetchDay = async (club, date) => ({ name: 'WOTEN', slots: (days[date] || []).slice() });
  return { config, pushed, fetchDay, origPush };
}

test('release alert is scheduled once, at the exact opening minute', async () => {
  const h = harness({ '2026-12-06': [slot('2026-12-06', '19:30', 'Padel 1', 1), slot('2026-12-06', '19:30', 'Padel 2', 2)] });
  h.config.alerts.push({ id: 'r', type: 'release', club: 'woten', date: '2026-12-06', time: '19:30' });
  const state = {};
  // 4 days before opening: too early for ntfy scheduling
  await alerts.run({ config: h.config, state, now: new Date('2026-11-28T12:00:00Z'), topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.equal(h.pushed.length, 0);
  // 2 days before opening: scheduled with delay = opening time
  await alerts.run({ config: h.config, state, now: new Date('2026-11-30T18:30:00Z'), topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.equal(h.pushed.length, 1);
  assert.equal(h.pushed[0].delay, String(Date.parse('2026-12-02T18:30:00Z') / 1000));
  assert.equal(h.pushed[0].actions.length, 2);
  // running again does not schedule twice
  await alerts.run({ config: h.config, state, now: new Date('2026-11-30T19:00:00Z'), topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.equal(h.pushed.length, 1);
});

test('after opening: full -> "volzet", then a cancellation -> "vrijgekomen"', async () => {
  const days = { '2026-12-06': [] };
  const h = harness(days);
  h.config.alerts.push({ id: 'r', type: 'release', club: 'woten', date: '2026-12-06', time: '19:30' });
  const state = { releases: { r: { scheduled: 'x' } } };
  await alerts.run({ config: h.config, state, now: new Date('2026-12-02T18:35:00Z'), topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.match(h.pushed[0].title, /Volzet/);
  days['2026-12-06'] = [slot('2026-12-06', '19:30', 'Padel 3', 3)];
  await alerts.run({ config: h.config, state, now: new Date('2026-12-04T10:00:00Z'), topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.match(h.pushed[1].title, /Vrijgekomen/);
  assert.equal(h.pushed.length, 2);
});

test('weekly alert expands to concrete dates with time in the id', () => {
  const list = alerts.expand({ alerts: [{ id: 'w', type: 'weekly', club: 'woten', weekday: 'do', time: '19:30', weeks: 2, skip: ['2026-12-03'] }] },
    new Date('2026-11-25T10:00:00Z'));
  assert.deepEqual(list.map(a => a.date), ['2026-11-26']); // 3 dec is skipped, 10 dec is beyond 2 weeks
  assert.ok(list[0].id.endsWith('@2026-11-26T19:30'));
});

test('watch: first run remembers, later runs only report new bookable slots', async () => {
  const days = { '2026-11-28': [slot('2026-11-28', '19:30', 'Padel 1', 1)], '2026-11-29': [] };
  const h = harness(days);
  h.config.alerts.push({ id: 'w', type: 'watch', club: 'woten', weekdays: ['za', 'zo'], from: '18:00', to: '21:00' });
  const state = {};
  const now = new Date('2026-11-26T12:00:00Z');
  await alerts.run({ config: h.config, state, now, topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.equal(h.pushed.length, 0);
  days['2026-11-29'] = [slot('2026-11-29', '18:00', 'Padel 2', 2), slot('2026-11-29', '12:00', 'Padel 2', 2)];
  await alerts.run({ config: h.config, state, now, topic: 't', fetchDay: h.fetchDay, log() {} });
  assert.equal(h.pushed.length, 1);
  assert.match(h.pushed[0].message, /Padel 2/);
  assert.doesNotMatch(h.pushed[0].message, /12:00/);
});

test('ics contains the match and a booking alarm', () => {
  const ics = P.ics({ clubId: 2220, clubName: 'Woten', date: '2099-12-06', time: '19:30', minutes: 90, windowHours: 96 });
  assert.match(ics, /DTSTART:20991206T183000Z/);
  assert.match(ics, /DTSTART:20991202T183000Z/);
  assert.match(ics, /TRIGGER:PT0M/);
  assert.ok(ics.split('\r\n').every(l => Array.from(l).length <= 75));
});
