#!/usr/bin/env node
/**
 * Draai dit EENMALIG op je eigen computer (niet op GitHub).
 *
 * Er opent een browservenster. Log daarin zelf in bij Tennis en Padel Vlaanderen
 * (vink "Onthoud mij" aan). Daarna bewaart dit script je ingelogde sessie en
 * toont het een lange tekst die je als GitHub-secret TPV_SESSION opslaat.
 *
 *   npm install
 *   npx playwright install chromium
 *   node login-save.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://www.tennisenpadelvlaanderen.be';
const OUT = path.join(__dirname, 'session.json');

(async () => {
  // Gebruik je eigen Chrome als die er is, anders de Chromium van Playwright.
  const browser = await chromium.launch({ headless: false, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: false }));
  const context = await browser.newContext({ locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
  const page = await context.newPage();

  await page.goto(`${BASE}/c/portal/login`);
  console.log('\n👉 Log in het browservenster in (vink "Onthoud mij" aan).');
  console.log('   Dit script wacht tot je ingelogd bent (max. 5 minuten).\n');

  // Klaar zodra we na het inloggen terug op de hoofdsite zijn.
  await page.waitForURL(u => {
    const s = String(u);
    return s.startsWith(BASE) && !/\/c\/portal\/login|oauth|login/i.test(s);
  }, { timeout: 5 * 60 * 1000 });
  await page.waitForLoadState('load');

  const cookies = (await context.cookies()).filter(c => /tennis(en)?padelvlaanderen\.be$/.test(c.domain.replace(/^\./, '')));
  console.log(`Ingelogd. ${cookies.length} cookies bewaard.`);

  const state = await context.storageState();
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  const b64 = Buffer.from(JSON.stringify(state)).toString('base64');

  console.log(`\nSessie opgeslagen in ${OUT}`);
  console.log('\n===== Kopieer ALLES tussen de lijnen als GitHub-secret TPV_SESSION =====\n');
  console.log(b64);
  console.log('\n=========================================================================\n');
  console.log('⚠️  Deze tekst geeft toegang tot je account: deel hem met niemand en verwijder session.json als je klaar bent.');
  await browser.close();
})().catch(e => { console.error('Mislukt:', e.message); process.exit(1); });
