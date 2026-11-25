---
name: padel-boeken
description: Padel plannen en boeken bij clubs van Tennis en Padel Vlaanderen. Gebruik dit als de gebruiker vraagt naar vrije padelterreinen, wanneer boeken kan, een padelmatch wil plannen of boeken ("boek padel zondag 19:30 in Woten", "is er morgen iets vrij?"), en wanneer een geplande taak dit skill noemt.
---

# Padel plannen en boeken

Werk vanuit de map van deze repository. Alles wat geen login vraagt, doe je met `cli.js`
(Node 20+, geen pakketten nodig). Het eigenlijke **Reserveren** gebeurt in de eigen Chrome van de
gebruiker via Claude in Chrome (`mcp__claude-in-chrome__*`), want inloggen is beveiligd met een
check die je niet omzeilt. Laad het skill `chrome-browser` als dat er is.

## Clubs

Clubs staan in `alerts.json` (of `alerts.example.json`) onder `clubs`, met `id` (clubId) en
`windowHours` (hoeveel uur vooraf een lid mag boeken). Een andere club: vraag de link van de
terreinreservatie van die club (`clubId=…` staat erin) en gebruik `node cli.js club <link>`.

| Club | clubId | Boekingsvenster | Bijzonder |
|---|---|---|---|
| Woten | 2220 | 96 uur | 3 terreinen, vaste blokken van 90 min (09:00, 10:30 … 21:00), betalen via Mollie |

## Commando's

```
node cli.js club <club>                              # naam, adres, padelterreinen, duur
node cli.js free <club> <JJJJ-MM-DD> [UU:MM] [--from 18:00 --to 21:00 --minutes 90]
node cli.js when <club> <JJJJ-MM-DD> <UU:MM>         # wanneer boeken kan + directe links
node cli.js ics  <club> <JJJJ-MM-DD> <UU:MM>         # agendabestand met boekalarm
```
Werkt `fetch` niet achter een proxy, zet dan `NODE_USE_ENV_PROXY=1`.

## Vragen beantwoorden

- "Wat is er vrij?" Gebruik `free` en geef de vrije uren per terrein, en of ze al boekbaar zijn.
- "Wanneer kan ik boeken?" Gebruik `when`.

## Plannen ("plan padel zondag 6 december 19:30 in Woten")

1. Controleer met `when` het openingsmoment.
2. Maak een **geplande taak**, eenmalig, **3 minuten voor** het openingsmoment, met de opdracht:
   > Gebruik het skill padel-boeken: boek <club> op <JJJJ-MM-DD> om <UU:MM> (<duur> min). Boeken opent om <UU:MM>.
3. Bevestig het moment aan de gebruiker, en dat de computer dan aan moet staan met Chrome open.
   Gebruikt de gebruiker de Padel Planner-app of thuisserver, dan komt er daarnaast ook een pushmelding.

## Boeken (nu, of wanneer de geplande taak loopt)

1. `node cli.js when <club> <datum> <uur>` geeft de directe links per vrij terrein.
2. Open de eerste link in een nieuw Chrome-tabblad.
3. Zie je "Je bent al aangemeld op dit toestel" met "Doorgaan als dit lid", klik daarop.
   Zie je een loginformulier of een beveiligingscheck, **stop dan**: vul niets in en omzeil niets.
   Meld dat de gebruiker in Chrome opnieuw moet inloggen.
4. Controleer club, terrein, datum, start- en einduur en duur. Wijkt iets af, stop dan.
5. Staat er "mag niet meer dan X dagen vooruit reserveren" en is het openingsmoment nog niet voorbij:
   wacht tot het moment, herlaad, en herlaad daarna elke ~15 seconden, maximaal 10 minuten.
6. Bezet? Neem de volgende link. Alles bezet: stop en meld het, en stel andere vrije uren voor
   (`free`). Kies nooit zelf een ander uur.
7. Prijs: is "Te betalen" meer dan **€ 50**, stop en vraag het. Betaalmethode: kies "Saldo" alleen als
   de gebruiker gezegd heeft dat saldo mag; anders laat je "Online betaling" staan.
8. Klik **één keer** op **Reserveren**.
9. Daarna:
   - **Mollie-betaalpagina**: raak niets aan. Het terrein staat vast ("wachtend op betaling") en de gebruiker
     heeft **60 minuten** om te betalen. Meld terrein, datum, uur, prijs en dat er binnen het uur betaald
     moet worden in dat tabblad (Bancontact kan met de QR-code op de gsm).
   - **Bevestiging** (betaald met saldo): meld terrein, datum, uur en prijs.
   - **Iets anders**: stop, maak een screenshot en meld wat je ziet.

## Nooit

- Wachtwoorden, kaart- of bankgegevens invullen of lezen; een betaling bevestigen.
- Een beveiligingscheck (Cloudflare Turnstile) omzeilen of het inloggen automatiseren.
- Meer dan één terrein boeken per opdracht, of reservaties annuleren of wijzigen zonder dat de gebruiker het vraagt.
- Medespelers toevoegen die de gebruiker niet noemde.
