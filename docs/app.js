/* Padel Planner web app. Runs fully in the browser; data stays in localStorage. */
(() => {
  const P = window.PadelPlan;
  const $ = s => document.querySelector(s);
  const KEY = 'padel-planner-v1';

  const DEFAULT = {
    clubs: [{
      id: 2220, name: 'Woten', windowHours: 96, address: 'Tiendeschuurveld 106, 1932 Sint-Stevens-Woluwe',
      courts: [{ name: 'Padel 1', terrainId: 9195931 }, { name: 'Padel 2', terrainId: 9195932 }, { name: 'Padel 3', terrainId: 9195933 }],
      slots: ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30', '18:00', '19:30', '21:00'],
    }],
    matches: [], topic: '', ics: true, api: '', key: '',
  };

  let S;
  try { S = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { S = { ...DEFAULT }; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} render(); };
  const clubOf = id => S.clubs.find(c => c.id === Number(id));
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- helpers ----------
  function toast(msg, ms = 3500) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function countdown(ms) {
    if (ms <= 0) return 'nu';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
    return d ? `${d}d ${h}u` : h ? `${h}u ${m}m` : `${m} min`;
  }
  function matchFull(m) {
    const c = clubOf(m.clubId) || { id: m.clubId, name: `club ${m.clubId}`, windowHours: 96 };
    return { ...m, clubName: c.name, clubAddress: c.address, windowHours: c.windowHours, courts: m.courts || c.courts || [] };
  }
  function download(name, text, type = 'text/calendar') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function api(path, opts = {}) {
    if (!S.api) throw new Error('Geen server ingesteld');
    const res = await fetch(S.api.replace(/\/$/, '') + path, {
      ...opts, headers: { 'content-type': 'application/json', ...(S.key ? { 'x-key': S.key } : {}), ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`Server: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ---------- push ----------
  async function sendNtfy(msg, tries = 3) {
    for (let i = 1; ; i++) {
      const res = await fetch('https://ntfy.sh', { method: 'POST', body: JSON.stringify(msg) });
      if (res.ok) return;
      if (res.status !== 429 || i >= tries) throw new Error(`ntfy ${res.status}`);
      await new Promise(r => setTimeout(r, 2500 * i));
    }
  }
  /** Schedule the "book now" push for every match whose window opens within ntfy's 3-day limit. */
  async function schedulePending() {
    if (!S.topic) return 0;
    let n = 0;
    for (const m of S.matches) {
      if (m.pushAt || m.server || m.booked) continue;
      const full = matchFull(m);
      const { opens } = P.describe(full);
      const until = opens - Date.now();
      if (until <= 0 || until > P.NTFY_MAX_DELAY_MS) continue;
      try { await sendNtfy(P.releaseMessage(S.topic, full)); m.pushAt = opens.toISOString(); n++; } catch (e) { console.warn(e); }
    }
    if (n) save();
    return n;
  }

  // ---------- plan form ----------
  function fillClubSelects() {
    for (const sel of [$('#f-club'), $('#v-club')]) {
      const v = sel.value;
      sel.innerHTML = S.clubs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">Voeg eerst een club toe</option>';
      if (v && clubOf(v)) sel.value = v;
    }
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function formMatch() {
    const c = clubOf($('#f-club').value);
    if (!c || !$('#f-date').value || !$('#f-time').value) return null;
    return matchFull({
      clubId: c.id, date: $('#f-date').value, time: $('#f-time').value, minutes: Number($('#f-minutes').value),
      players: $('#f-players').value.split(',').map(s => s.trim()).filter(Boolean),
    });
  }
  function updateInfo() {
    const m = formMatch(), box = $('#f-info');
    if (!m) { box.textContent = ''; return; }
    const c = clubOf(m.clubId);
    const { start, opens } = P.describe(m);
    const lines = [];
    if (c.slots && c.slots.length && !c.slots.includes(m.time)) lines.push(`⚠️ ${c.name} werkt met vaste starturen: ${c.slots.join(', ')}.`);
    if (start < new Date()) lines.push('⚠️ Dit tijdstip ligt in het verleden.');
    else if (opens <= new Date()) lines.push(`✅ Je kunt nu al boeken (venster ${c.windowHours} u).`);
    else lines.push(`⏰ Boeken kan vanaf <strong>${P.fmt(opens, { weekday: 'long' })}</strong> (over ${countdown(opens - Date.now())}).`);
    box.innerHTML = lines.join('<br>');
  }

  async function onPlan(e) {
    e.preventDefault();
    const base = formMatch();
    if (!base) return;
    const repeat = Number($('#f-repeat').value);
    const created = [];
    for (let i = 0; i < Math.max(1, repeat); i++) {
      const date = P.addDays(base.date, 7 * i);
      if (S.matches.some(x => x.clubId === base.clubId && x.date === date && x.time === base.time)) continue;
      created.push({ id: uid(), clubId: base.clubId, date, time: base.time, minutes: base.minutes, players: base.players, created: new Date().toISOString() });
    }
    if (!created.length) { toast('Die match staat al in je lijst.'); return; }
    S.matches.push(...created);
    S.matches.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    let serverOk = false;
    if (S.api) {
      try {
        for (const m of created) { await api('/api/alerts', { method: 'POST', body: JSON.stringify({ id: m.id, type: 'release', club: m.clubId, clubName: clubOf(m.clubId).name, windowHours: clubOf(m.clubId).windowHours, date: m.date, time: m.time, minutes: m.minutes, players: m.players, topic: S.topic }) }); m.server = true; }
        serverOk = true;
      } catch (err) { toast(`Server niet bereikbaar: ${err.message}`); }
    }
    save();
    const scheduled = serverOk ? 0 : await schedulePending();
    if (S.ics) download(`padel-${base.date}.ics`, P.ics(created.map(matchFull)));
    const first = P.describe(matchFull(created[0]));
    toast(serverOk ? '✅ Gepland op je server: melding komt exact op tijd.'
      : scheduled ? `✅ Melding gepland voor ${P.fmt(first.opens)}.`
      : S.topic ? `📅 Gepland. De pushmelding wordt ingepland zodra het venster binnen 3 dagen opent (open de app af en toe), de agenda-herinnering werkt altijd.`
      : '📅 Gepland. Zet in Instellingen een ntfy-topic voor pushmeldingen.', 6000);
    $('#f-players').value = '';
    show('list');
  }

  // ---------- list ----------
  function statusOf(m) {
    const full = matchFull(m);
    const { start, opens, end } = P.describe(full);
    const now = Date.now();
    if (end < now) return { cls: 'past', text: 'Gespeeld' };
    if (m.booked) return { cls: 'done', text: '✓ Gereserveerd' };
    if (opens <= now) return { cls: 'open', text: '🔥 Boeken kan nu!' };
    const push = m.server ? ' · 🔔 server' : m.pushAt ? ' · 🔔 melding gepland' : S.topic ? ' · 🔔 wordt gepland' : '';
    return { cls: 'wait', text: `Boeken over <span class="countdown">${countdown(opens - now)}</span>${push}` };
  }
  function renderList() {
    const now = Date.now();
    S.matches = S.matches.filter(m => P.describe(matchFull(m)).end > now - 2 * 864e5);
    const box = $('#list');
    if (!S.matches.length) {
      box.innerHTML = '<div class="card empty">Nog niets gepland.<br>Tik op <strong>➕ Plannen</strong> om te beginnen.</div>';
      $('#list-actions').hidden = true; return;
    }
    $('#list-actions').hidden = false;
    box.innerHTML = S.matches.map(m => {
      const full = matchFull(m), st = statusOf(m), { start, opens, endHm } = P.describe(full);
      const open = st.cls === 'open';
      return `<article class="card match" data-id="${m.id}">
        <h3>${esc(full.clubName)}</h3>
        <div class="when">${P.fmt(start, { weekday: 'long', month: 'long' })} – ${endHm} · ${m.minutes}′${m.players && m.players.length ? ` · met ${esc(m.players.join(', '))}` : ''}</div>
        <div class="status ${st.cls}">${st.text}</div>
        ${st.cls === 'wait' ? `<div class="hint">Venster opent ${P.fmt(opens, { weekday: 'long' })}</div>` : ''}
        <div class="actions-row">
          ${st.cls !== 'past' && !m.booked ? `<button data-act="book" class="${open ? 'hot' : 'secondary'}">${open ? 'Nu boeken' : 'Reservatiepagina'}</button>` : ''}
          ${open ? '<button data-act="booked" class="secondary">✓ Geboekt</button>' : ''}
          <button data-act="share" class="secondary">Delen</button>
          <button data-act="ics" class="secondary">📅</button>
          <button data-act="del" class="secondary" aria-label="Verwijderen">🗑</button>
        </div></article>`;
    }).join('');
    const hot = S.matches.filter(m => statusOf(m).cls === 'open').length;
    $('#badge').hidden = !hot; $('#badge').textContent = hot;
  }

  async function onListClick(e) {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const m = S.matches.find(x => x.id === btn.closest('[data-id]').dataset.id); if (!m) return;
    const full = matchFull(m);
    switch (btn.dataset.act) {
      case 'book': {
        const court = (full.courts || [])[0];
        window.open(court ? P.bookUrl(full, court) : P.dayUrl(full.clubId, full.date), '_blank', 'noopener');
        break;
      }
      case 'booked': m.booked = true; save(); toast('Top! Veel speelplezier 🎾'); break;
      case 'share': {
        const link = `${location.origin}${location.pathname}?club=${full.clubId}&name=${encodeURIComponent(full.clubName)}&w=${full.windowHours}&date=${full.date}&time=${full.time}&min=${full.minutes}`;
        const text = `${P.shareText(full)}\n\nZelf een herinnering? ${link}`;
        if (navigator.share) { try { await navigator.share({ text }); } catch {} }
        else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        break;
      }
      case 'ics': download(`padel-${m.date}.ics`, P.ics(full)); break;
      case 'del':
        if (confirm('Deze match verwijderen? Een al geplande pushmelding komt nog wel door.')) {
          if (m.server) api(`/api/alerts/${m.id}`, { method: 'DELETE' }).catch(() => {});
          S.matches = S.matches.filter(x => x !== m); save();
        }
        break;
    }
  }

  // ---------- free courts ----------
  async function showFree() {
    const c = clubOf($('#v-club').value), date = $('#v-date').value, out = $('#v-out');
    if (!c || !date) return;
    if (!S.api) {
      out.innerHTML = `<p class="hint">Live beschikbaarheid heeft een server nodig (zie Instellingen). Zonder server open je de dagplanning van de club:</p>
        <a class="button" href="${P.dayUrl(c.id, date)}" target="_blank" rel="noopener">Open dagplanning ${esc(c.name)} →</a>`;
      return;
    }
    out.innerHTML = '<p class="hint">Laden…</p>';
    try {
      const day = await api(`/api/day?club=${c.id}&date=${date}`);
      if (day.courts && day.courts.length && !c.courts) {
        // learn court ids so pushes can link straight to a court
        const ids = new Map(day.slots.map(s => [s.court, s.terrainId]));
        c.courts = [...ids].map(([name, terrainId]) => ({ name, terrainId })); save();
      }
      const now = Date.now();
      out.innerHTML = day.slots.length ? day.slots.map(s => {
        const opens = P.describe({ clubId: c.id, date: s.date, time: s.start, windowHours: c.windowHours }).opens;
        const ok = opens <= now;
        return `<div class="slot"><div><span class="t">${s.start}–${s.end}</span> · ${esc(s.court)}<div class="hint">${s.minutes}′ · ${ok ? '✅ nu boekbaar' : `⏳ vanaf ${P.fmt(opens)}`}</div></div>
          <a href="${s.url}" target="_blank" rel="noopener">${ok ? 'Boek →' : 'Bekijk'}</a></div>`;
      }).join('') : '<p class="hint">Geen vrije terreinen.</p>';
    } catch (err) { out.innerHTML = `<p class="hint">❌ ${esc(err.message)}</p>`; }
  }

  // ---------- settings ----------
  function renderClubs() {
    $('#club-list').innerHTML = S.clubs.map(c => `<li><span><strong>${esc(c.name)}</strong> <span class="hint">#${c.id} · ${c.windowHours} u vooraf</span></span>
      <button data-del-club="${c.id}" class="secondary" aria-label="Verwijder ${esc(c.name)}">✕</button></li>`).join('') || '<li class="hint">Nog geen clubs.</li>';
  }
  function exportAlerts() {
    const clubs = {};
    for (const c of S.clubs) clubs[c.name.toLowerCase().replace(/[^a-z0-9]+/g, '')] = { id: c.id, name: c.name, windowHours: c.windowHours };
    const key = id => Object.keys(clubs).find(k => clubs[k].id === id) || String(id);
    return JSON.stringify({
      ntfy: { server: 'https://ntfy.sh', topic: '(gebruik de GitHub-secret NTFY_TOPIC)' }, clubs,
      alerts: S.matches.filter(m => !m.booked).map(m => ({ id: m.id, type: 'release', club: key(m.clubId), date: m.date, time: m.time, minutes: m.minutes, players: m.players })),
    }, null, 2);
  }

  function addClubFromInputs(link, name, windowHours) {
    const id = P.parseClubLink(link);
    if (!id) { toast('Geen clubId gevonden in die link.'); return false; }
    if (clubOf(id)) { toast('Die club staat al in je lijst.'); return false; }
    S.clubs.push({ id, name: name || `Club ${id}`, windowHours: Number(windowHours) || 96 });
    save(); return true;
  }

  // ---------- render / tabs ----------
  function render() { fillClubSelects(); renderList(); renderClubs(); updateInfo(); $('#s-export').value = exportAlerts(); }
  function show(tab) {
    document.querySelectorAll('.tab').forEach(t => { const on = t.id === `tab-${tab}`; t.hidden = !on; t.classList.toggle('active', on); });
    document.querySelectorAll('nav.bottom button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    window.scrollTo(0, 0);
  }

  function init() {
    // prefill from a shared link: ?club=2220&name=Woten&w=96&date=2026-12-06&time=19:30&min=90
    const q = new URLSearchParams(location.search);
    if (q.get('club')) {
      const id = Number(q.get('club'));
      if (!clubOf(id)) S.clubs.push({ id, name: q.get('name') || `Club ${id}`, windowHours: Number(q.get('w')) || 96 });
      fillClubSelects();
      $('#f-club').value = id;
      if (q.get('date')) $('#f-date').value = q.get('date');
      if (q.get('time')) $('#f-time').value = q.get('time');
      if (q.get('min')) $('#f-minutes').value = q.get('min');
      history.replaceState(null, '', location.pathname);
    }
    const today = P.local(new Date()).ymd;
    if (!$('#f-date').value) $('#f-date').value = P.addDays(today, 7);
    if (!$('#f-time').value) $('#f-time').value = '19:30';
    $('#f-date').min = today; $('#v-date').value = today;
    $('#s-topic').value = S.topic; $('#s-ics').checked = S.ics; $('#s-api').value = S.api; $('#s-key').value = S.key;

    document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    $('#plan-form').addEventListener('submit', onPlan);
    ['#f-club', '#f-date', '#f-time', '#f-minutes'].forEach(s => $(s).addEventListener('input', updateInfo));
    $('#list').addEventListener('click', onListClick);
    $('#ics-all').addEventListener('click', () => download('padel.ics', P.ics(S.matches.filter(m => !m.booked).map(matchFull))));
    $('#v-go').addEventListener('click', showFree);
    $('#club-list').addEventListener('click', e => {
      const id = e.target.closest('[data-del-club]')?.dataset.delClub;
      if (id && confirm('Club verwijderen?')) { S.clubs = S.clubs.filter(c => c.id !== Number(id)); save(); }
    });
    $('#c-add').addEventListener('click', () => {
      if (addClubFromInputs($('#c-link').value, $('#c-name').value.trim(), $('#c-window').value)) {
        $('#c-link').value = ''; $('#c-name').value = ''; toast('Club toegevoegd.');
      }
    });
    $('#s-topic').addEventListener('change', e => { S.topic = e.target.value.trim(); save(); schedulePending(); });
    $('#s-topic-new').addEventListener('click', () => {
      const t = 'padel-' + Array.from(crypto.getRandomValues(new Uint8Array(9)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
      S.topic = t; $('#s-topic').value = t; save();
      toast('Nieuw topic. Abonneer je er nu op in de ntfy-app (zelfde naam).', 6000);
    });
    $('#s-test').addEventListener('click', async () => {
      if (!S.topic) return toast('Stel eerst een topic in.');
      try { await sendNtfy(P.ntfyMessage(S.topic, { title: '🎾 Testmelding', message: 'Meldingen werken!', click: location.href })); toast('Verstuurd. Kijk op je gsm.'); }
      catch (e) { toast(`Mislukt: ${e.message}`); }
    });
    $('#s-ics').addEventListener('change', e => { S.ics = e.target.checked; save(); });
    $('#s-save').addEventListener('click', async () => {
      S.api = $('#s-api').value.trim(); S.key = $('#s-key').value; save();
      if (!S.api) return toast('Server verwijderd.');
      try { const h = await api('/api/health'); toast(`Verbonden met server (${h.alerts} meldingen actief).`); } catch (e) { toast(`❌ ${e.message}`); }
    });
    $('#s-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#s-export').value); toast('Gekopieerd.'); } catch { $('#s-export').select(); } });

    render();
    schedulePending();
    setInterval(() => { renderList(); updateInfo(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderList(); schedulePending(); } });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (S.matches.some(m => statusOf(m).cls === 'open')) show('list');
  }
  init();
})();
