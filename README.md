# Padel booker

Boekt automatisch een padelterrein van 90 minuten via Tennis en Padel Vlaanderen. Het script leest daarvoor afspraken met de titel `Padel: <club>` uit je Google Agenda.

- Clubs staan in `CLUBS` in `book.js` (nu: Woten = clubId 2220).
- Woten heeft vaste blokken: 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00.
- Secret: `TPV_SESSION`, je ingelogde sessie (zie hieronder). Later komt er `ICAL_URL` bij voor de agenda.
- Standaard draait het in de droge modus. Echt boeken: zet de repository-variabele `DRY_RUN` op `0`.

Handmatig testen: `node book.js --club woten --date 2026-12-10 --time 19:30`

Testen via GitHub: Actions → "Padel boeken" → Run workflow → club, datum en uur invullen (droge modus staat standaard aan).

## Inloggen (eenmalig, op je eigen computer)

De loginpagina gebruikt een beveiligingscheck (Cloudflare Turnstile). Daarom log je zelf in, en hergebruikt het script die sessie.

1. Installeer [Node.js](https://nodejs.org) (LTS).
2. Download deze repo en open een terminal in de map.
3. `npm install` en daarna `npx playwright install chromium`
4. `node login-save.js`. Log in het venster dat opengaat in, en vink "Onthoud mij" aan.
5. Kopieer de lange tekst die verschijnt naar de GitHub-secret `TPV_SESSION`.
6. Verwijder `session.json`.

Meldt een run "SESSIE VERLOPEN"? Herhaal dan stap 4 en 5.
