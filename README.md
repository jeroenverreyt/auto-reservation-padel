# 🎾 Padel Planner

Nooit meer te laat om een padelterrein te boeken bij clubs van **Tennis en Padel Vlaanderen**
(Woten en andere clubs die via hun systeem reserveren).

- **Melding op de minuut** dat het boekingsvenster opengaat, met een knop per vrij terrein, rechtstreeks naar het reservatieformulier.
- **Volzet? Ik waarschuw als er iets vrijkomt**, bijvoorbeeld door een annulatie.
- **Terreinwachter**: "meld me elk vrij terrein op za/zo tussen 18 en 21 uur".
- **Wekelijkse vaste match** (bv. elke donderdag 19:30), met uitzonderingen.
- **Agenda-herinnering (.ics)** die altijd werkt, ook zonder app of server.
- **Delen met je medespelers** via WhatsApp, met een link waarmee zij zelf een melding instellen.
- **Live vrije terreinen** per club en dag (met thuisserver).
- Werkt op **gsm** als installeerbare web-app; geen account nodig, gegevens blijven op je toestel.

Geïnspireerd op Padel Ping (meldingen bij annulaties en releases), Handler (Priority/Claim),
Padel Snipe (boeken bij het openen van het venster) en Anybuddy (zoeken over clubs heen),
maar gratis, open, en voor de clubs van Tennis en Padel Vlaanderen.

## Waarom niet volautomatisch boeken?

Twee dingen houden we bewust bij jou:
1. **Inloggen** op Tennis en Padel Vlaanderen is beveiligd met Cloudflare Turnstile. Die check omzeilen we niet.
2. **Betalen** gebeurt via Mollie (Bancontact), met bevestiging door jou. Na *Reserveren* staat het
   terrein 60 minuten op jouw naam ("wachtend op betaling"), dus je hebt tijd.

De snelheid zit in de melding op het juiste moment: één tik en je staat op het juiste formulier.
Met een computer die aanstaat kan Claude ook zelf op *Reserveren* klikken (zie *Claude*).

## Drie manieren om het te gebruiken

| | Wat heb je nodig | Wat krijg je |
|---|---|---|
| **1. Enkel de app** | gsm + de gratis app **ntfy** | plannen, agenda-alarm, push op de minuut (vanaf 3 dagen vooraf: open de app af en toe), delen |
| **2. App + GitHub-watcher** | eigen kopie van deze repo | ook pushes verder dan 3 dagen vooruit, "volzet → vrijgekomen", terreinwachter |
| **3. App + thuisserver** | computer of Raspberry Pi die altijd aanstaat | alles hierboven + live vrije terreinen in de app, meerdere gebruikers, elke 2 minuten controle |

### 1. Enkel de app (iedereen, meteen)

1. Open de app op je gsm (zie *Publiceren* hieronder) en kies **Zet op beginscherm**.
2. Installeer **ntfy** ([iPhone](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
3. In de app: **Instellingen → Nieuw geheim topic**, en abonneer je in ntfy op datzelfde topic. Tik op *Testmelding*.
4. **Mijn clubs**: Woten staat er al. Voor een andere club open je op tennisenpadelvlaanderen.be de terreinreservatie
   van die club, plak je de link en vul je het boekingsvenster in (Woten: 96 uur).
5. **Plannen**: club, datum, uur. Je krijgt een .ics voor je agenda (met alarm op het openingsmoment) en een
   gepland pushbericht zodra dat kan (ntfy plant tot 3 dagen vooruit).

### 2. GitHub-watcher (zonder server)

1. Kopieer `alerts.example.json` naar `alerts.json` en pas aan (of gebruik *Instellingen → Exporteer* in de app).
2. Zet de secret `NTFY_TOPIC` in GitHub (*Settings → Secrets and variables → Actions*).
3. De workflow *Padel-meldingen* draait elke 30 minuten. Starten kan ook handmatig via *Actions*.
   - Publieke repo: gratis. Privé repo: ongeveer 1500 van de 2000 gratis minuten per maand.
   - Zet je in `alerts.json` geen topic, maar alleen in de secret, dan kan de repo veilig publiek.

### 3. Thuisserver (later)

```
docker compose up -d          # of: PADEL_KEY=… NTFY_TOPIC=… node server.js
```
- Draait op elke computer met Node 20+ of Docker: Mac mini, NAS, Raspberry Pi.
- Open `http://<server>:8080` op je gsm. De app wordt door de server zelf geserveerd.
- Vul in de app onder *Thuisserver* het adres en de `PADEL_KEY` in.
- Van buitenaf bereikbaar maken kan veilig met bv. **Tailscale** (alleen jouw toestellen) of een Cloudflare Tunnel.
- Meerdere vrienden kunnen dezelfde server gebruiken: elke melding gaat naar het eigen topic van wie ze plande.

API: `GET /api/day?club=2220&date=2026-12-06`, `GET /api/club?club=2220`, `GET|POST /api/alerts`,
`DELETE /api/alerts/<id>`, `GET /api/health`. Header `x-key: <PADEL_KEY>`.

## Publiceren van de app

De app staat in `docs/` en is een statische site:
- **GitHub Pages**: *Settings → Pages → Branch `main`, map `/docs`*. Op een gratis account kan dat alleen voor een publieke repo.
- Of gratis via Cloudflare Pages of Netlify, met de map `docs` en geen buildstap.
- Of via de thuisserver.

## Opdrachtregel

```
node cli.js club 2220                                  # info + padelterreinen
node cli.js free woten 2026-12-06 --from 18:00         # vrije terreinen, met ✅ of ⏳ boekbaar
node cli.js when woten 2026-12-06 19:30                # wanneer boeken kan + directe links
node cli.js ics woten 2026-12-06 19:30                 # agendabestand
node cli.js run                                        # alle meldingen uit alerts.json één keer uitvoeren
NTFY_TOPIC=… node cli.js test-push
npm test
```
`<club>` is een clubnummer, een link met `clubId=`, of een naam uit `alerts.json`.

## Claude

Het skill [`padel-boeken`](.claude/skills/padel-boeken/SKILL.md) laat Claude (desktopapp + Claude in Chrome)
vrije terreinen opzoeken, plannen, en op het openingsmoment in je eigen Chrome op *Reserveren* klikken.
Betalen en inloggen blijven bij jou.

## Hoe het werkt

`lib/tpv.js` leest de **publieke** dagplanning van een club met een gewone HTTP-request
(`/clubdashboard/reserveer-een-terrein?clubId=…&planningDay=DD-MM-JJJJ&terrainGroupId=…`), zonder login.
Elke vrije cel bevat de directe reservatielink. `lib/alerts.js` beslist wanneer er een melding gaat,
en `docs/plan.js` (gedeeld met de app) rekent tijdzones, .ics en ntfy-berichten uit.
Wees zuinig: de server cachet een dagplanning 60 seconden, de watcher draait om de 30 minuten.

## Woten in het kort

| | |
|---|---|
| clubId | 2220 |
| Terreinen | Padel 1 = 9195931, Padel 2 = 9195932, Padel 3 = 9195933 |
| Starturen | 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00 (90 min) |
| Boekingsvenster | max. 96 uur vooraf, tot op het uur |
| Betalen | Mollie, binnen 60 minuten, of saldo als de club dat toelaat |
