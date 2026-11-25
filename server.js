#!/usr/bin/env node
/**
 * Padel Planner home server. No dependencies, Node 20+.
 *
 * - Serves the web app (docs/) so phones can install it from your own address.
 * - Live availability API for any Tennis en Padel Vlaanderen club.
 * - Stores alerts (from the app or data/alerts.json) and runs the alert engine
 *   every 2 minutes: exact "book now" pushes, "full" + "freed up" follow-ups,
 *   cancellation watches. Several people can share one server: each alert
 *   carries its own ntfy topic.
 *
 *   PADEL_KEY=een-lange-code PORT=8080 node server.js
 *
 * Env: PORT (8080), PADEL_KEY (access code for /api, strongly advised when reachable
 * from the internet), NTFY_TOPIC (default topic), NTFY_SERVER, DATA_DIR (./data),
 * RUN_EVERY_SEC (120).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tpv = require('./lib/tpv');
const alerts = require('./lib/alerts');

const PORT = Number(process.env.PORT || 8080);
const KEY = process.env.PADEL_KEY || '';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG = path.join(DATA, 'alerts.json');
const STATE = path.join(DATA, 'state.json');
const STATIC = path.join(__dirname, 'docs');
const EVERY = Number(process.env.RUN_EVERY_SEC || 120) * 1000;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const loadConfig = () => alerts.loadJson(CONFIG, { ntfy: {}, clubs: {}, alerts: [] });
const saveConfig = c => alerts.saveJson(CONFIG, c);

// ---------- small cache for the public schedule (be gentle with the club website) ----------
const cache = new Map();
async function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}

// ---------- alert engine loop ----------
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const config = loadConfig();
    if (!(config.alerts || []).length) return;
    const state = alerts.loadJson(STATE, {});
    const res = await alerts.run({ config, state, log: m => log(m) });
    alerts.saveJson(STATE, state);
    if (res.length) log(`engine: ${res.map(r => `${r.id}=${r.action}`).join(', ')}`);
  } catch (e) { log('engine error', e.message); } finally { running = false; }
}

// ---------- http ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, {
    'content-type': type, 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-key', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
const readBody = req => new Promise((ok, bad) => {
  let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } }); req.on('error', bad);
});
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
const authorized = req => !KEY || crypto.timingSafeEqual(digest(req.headers['x-key'] || ''), digest(KEY));

async function api(req, res, url) {
  if (!authorized(req)) return send(res, 401, { error: 'Verkeerde toegangscode' });
  const q = url.searchParams;
  const p = url.pathname;

  if (p === '/api/health') {
    const c = loadConfig();
    return send(res, 200, { ok: true, alerts: (c.alerts || []).length, lastRun: (alerts.loadJson(STATE, {}) || {}).lastRun });
  }
  if (p === '/api/club') return send(res, 200, await cached(`club:${q.get('club')}`, 6 * 3600e3, () => tpv.getClub(Number(q.get('club')))));
  if (p === '/api/day') {
    const club = Number(q.get('club')), date = q.get('date');
    if (!club || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return send(res, 400, { error: 'club en date (JJJJ-MM-DD) nodig' });
    const info = await cached(`club:${club}`, 6 * 3600e3, () => tpv.getClub(club));
    return send(res, 200, await cached(`day:${club}:${date}`, 60e3, () => tpv.getDay(club, date, { club: info })));
  }
  if (p === '/api/alerts' && req.method === 'GET') return send(res, 200, loadConfig().alerts || []);
  if (p === '/api/alerts' && req.method === 'POST') {
    const b = await readBody(req);
    if (!['release', 'weekly', 'watch'].includes(b.type) || !b.club) return send(res, 400, { error: 'type en club nodig' });
    const c = loadConfig();
    const id = String(Number(b.club));
    c.clubs = c.clubs || {};
    c.clubs[id] = { ...(c.clubs[id] || {}), id: Number(b.club), ...(b.clubName ? { name: b.clubName } : {}), ...(b.windowHours ? { windowHours: Number(b.windowHours) } : {}) };
    const alert = { id: b.id || crypto.randomUUID().slice(0, 8), type: b.type, club: id };
    for (const k of ['date', 'time', 'minutes', 'players', 'weekday', 'weekdays', 'from', 'to', 'until', 'skip', 'topic']) if (b[k] !== undefined) alert[k] = b[k];
    c.alerts = (c.alerts || []).filter(a => a.id !== alert.id).concat(alert);
    saveConfig(c);
    setTimeout(tick, 500);
    return send(res, 201, alert);
  }
  const del = p.match(/^\/api\/alerts\/([\w@:.-]+)$/);
  if (del && req.method === 'DELETE') {
    const c = loadConfig(); const before = (c.alerts || []).length;
    c.alerts = (c.alerts || []).filter(a => a.id !== del[1]); saveConfig(c);
    return send(res, before === c.alerts.length ? 404 : 200, { deleted: before - c.alerts.length });
  }
  if (p === '/api/run' && req.method === 'POST') { await tick(); return send(res, 200, { ok: true }); }
  return send(res, 404, { error: 'Onbekend' });
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(STATIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC)) return send(res, 403, 'nee', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(STATIC, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    log('error', req.method, url.pathname, e.message);
    send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  fs.mkdirSync(DATA, { recursive: true });
  server.listen(PORT, () => {
    log(`Padel Planner op http://localhost:${PORT}${KEY ? '' : '  ⚠️  zonder PADEL_KEY: zet er een als de server vanop het internet bereikbaar is'}`);
    tick(); setInterval(tick, EVERY);
  });
}
module.exports = { server, tick };
