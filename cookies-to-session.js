#!/usr/bin/env node
/**
 * Zet een cookies.txt-export uit je gewone browser om naar de secret TPV_SESSION.
 *
 * 1. Log in je gewone Chrome in op https://www.tennisenpadelvlaanderen.be (vink "Onthoud mij" aan).
 * 2. Exporteer je cookies als cookies.txt (Netscape-formaat), bv. met de extensie
 *    "Get cookies.txt LOCALLY". Exporteer zowel www.tennisenpadelvlaanderen.be als
 *    auth.tennispadelvlaanderen.be, of gebruik "Export All Cookies".
 * 3. node cookies-to-session.js pad/naar/cookies.txt [pad/naar/nog-een-cookies.txt]
 *
 * Alleen cookies van Tennis en Padel Vlaanderen worden bewaard; de rest wordt genegeerd.
 * Geen extra pakketten nodig.
 */
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Gebruik: node cookies-to-session.js cookies.txt [meer-cookies.txt]');
  process.exit(1);
}

const KEEP = /(^|\.)tennis(en)?padelvlaanderen\.be$/i;
const cookies = new Map();

for (const file of files) {
  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) { httpOnly = true; line = line.slice('#HttpOnly_'.length); }
    if (!line.trim() || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domain, , path, secure, expiry, name, ...rest] = parts;
    if (!KEEP.test(domain.replace(/^\./, ''))) continue;
    const exp = Number(expiry);
    cookies.set(`${domain}|${path}|${name}`, {
      name,
      value: rest.join('\t'),
      domain,
      path,
      expires: exp > 0 ? exp : -1,
      httpOnly,
      secure: secure.toUpperCase() === 'TRUE',
      sameSite: 'Lax',
    });
  }
}

const list = [...cookies.values()];
if (!list.length) {
  console.error('Geen cookies van Tennis en Padel Vlaanderen gevonden in dit bestand. Was je ingelogd toen je exporteerde?');
  process.exit(1);
}

const domains = [...new Set(list.map(c => c.domain.replace(/^\./, '')))];
console.log(`${list.length} cookies gevonden voor: ${domains.join(', ')}`);
if (!domains.some(d => d.startsWith('auth.'))) {
  console.log('⚠️  Geen cookies van auth.tennispadelvlaanderen.be. Exporteer die ook als het boeken "SESSIE VERLOPEN" meldt.');
}

const b64 = Buffer.from(JSON.stringify({ cookies: list, origins: [] })).toString('base64');
console.log('\n===== Kopieer ALLES tussen de lijnen als GitHub-secret TPV_SESSION =====\n');
console.log(b64);
console.log('\n=========================================================================\n');
console.log('⚠️  Deze tekst geeft toegang tot je account. Verwijder je cookies.txt-bestand(en) als je klaar bent.');
