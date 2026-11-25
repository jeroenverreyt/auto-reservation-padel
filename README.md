# Padel booker

Boekt automatisch een padelterrein van 90 minuten via Tennis en Padel Vlaanderen. Het script leest daarvoor afspraken met de titel `Padel: <club>` uit je Google Agenda.

- Clubs staan in `CLUBS` in `book.js` (nu: Woten = clubId 2220).
- Woten heeft vaste blokken: 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00.
- Secrets: `TPV_USER`, `TPV_PASS` (later ook `ICAL_URL` voor de agenda).
- Standaard draait het in de droge modus. Echt boeken: zet de repository-variabele `DRY_RUN` op `0`.

Handmatig testen: `node book.js --club woten --date 2026-12-10 --time 19:30`

Testen via GitHub: Actions → "Padel boeken" → Run workflow → club, datum en uur invullen (droge modus staat standaard aan).
