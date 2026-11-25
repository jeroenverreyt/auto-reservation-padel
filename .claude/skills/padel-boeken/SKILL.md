---
name: padel-boeken
description: Boek een padelterrein van 90 minuten bij Woten (Tennis en Padel Vlaanderen) in de eigen Chrome van de gebruiker via Claude in Chrome. Gebruik dit als de gebruiker vraagt om padel te boeken of te plannen ("boek padel zondag 19:30", "plan padel 6 december"), en wanneer een geplande taak dit skill noemt.
---

# Padel boeken bij Woten

Je boekt in de **eigen Google Chrome van de gebruiker**, via Claude in Chrome
(tools `mcp__claude-in-chrome__*`). De gebruiker is daar al ingelogd bij
Tennis en Padel Vlaanderen. Laad eerst het skill `chrome-browser` als dat er is.

## Instellingen (de gebruiker mag deze aanpassen)

| Instelling | Waarde |
|---|---|
| Club | WOTEN, clubId `2220` |
| Terreinen, in volgorde van voorkeur | Padel 1 (`9195931`), Padel 2 (`9195932`), Padel 3 (`9195933`) |
| Duur | 90 minuten |
| Maximumprijs per boeking | **€ 50,00**: is het hoger, dan stop je en meld je het |
| Betalen met saldo toegestaan | **nee**: zet op "ja" als de gebruiker saldo heeft opgeladen bij Woten |
| Medespelers toevoegen | nee, alleen de gebruiker zelf |

## Vaste regels van Woten

- Blokken van 90 min met vaste starturen: 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00.
  Een ander uur kan niet: meld dat en stel het dichtstbijzijnde blok voor.
- Een lid mag **maximaal 96 uur** voor de start reserveren. Is het te vroeg, dan toont
  het formulier: "… mag niet meer dan 4 dagen vooruit reserveren." en is de knop *Reserveren* uitgeschakeld.
- Na *Reserveren* volgt de betaalpagina van **Mollie**. Het terrein staat dan al vast op naam van
  de gebruiker ("wachtend op betaling"); de gebruiker heeft **60 minuten** om te betalen, anders vervalt de reservatie.

## Directe reservatielink

```
https://www.tennisenpadelvlaanderen.be/reservatie?clubId=2220&terrainId=<TERREIN>&reservationDate=<DD-MM-JJJJ>&startHour=<UU:MM>&endHour=<UU:MM + 90 min>
```

`node wanneer.js JJJJ-MM-DD UU:MM` (in deze map) geeft het openingsmoment en de drie links.

## Werkwijze A: de gebruiker vraagt om te plannen

1. Bepaal datum en beginuur, en controleer dat het een vast blok is.
2. Bereken het openingsmoment: start min 96 uur (met `node wanneer.js` of zelf, in tijdzone Europe/Brussels).
3. Is dat moment al voorbij, ga dan meteen naar werkwijze B.
4. Anders: maak een **geplande taak** die eenmalig loopt, **3 minuten voor** het openingsmoment, met als opdracht:
   > Gebruik het skill padel-boeken: boek Woten op <DD-MM-JJJJ> om <UU:MM>. Boeken opent om <UU:MM> op <DD-MM-JJJJ>.
5. Bevestig aan de gebruiker: wanneer de taak loopt, en dat de Mac dan aan moet staan, met de Claude-app open en Chrome open.

## Werkwijze B: nu boeken (of de geplande taak loopt)

1. **Tabblad openen.** Open in Chrome een nieuw tabblad met de link voor het eerste terrein.
2. **Account kiezen.** Zie je "Je bent al aangemeld op dit toestel" met "Doorgaan als dit lid", klik daarop.
   Zie je een loginformulier of een beveiligingscheck, **stop dan**. Vul geen wachtwoord in en
   probeer de check niet te omzeilen. Meld aan de gebruiker dat die in Chrome opnieuw moet inloggen.
3. **Formulier controleren.** Controleer club WOTEN, terrein, datum, startuur, einduur (+90 min) en duur 90 min.
   Wijkt iets af, stop en meld het.
4. **Wachten op het openingsmoment.** Staat de melding "mag niet meer dan 4 dagen vooruit reserveren" er
   en is het openingsmoment nog niet voorbij, wacht dan tot het openingsmoment en herlaad de pagina.
   Herlaad daarna elke ~15 seconden, tot de melding weg is, maximaal 10 minuten na het openingsmoment.
5. **Bezet of niet beschikbaar?** Zegt het formulier dat het terrein bezet of niet beschikbaar is,
   probeer dan het volgende terrein uit de lijst (stap 1 met een andere `terrainId`). Zijn alle drie bezet,
   stop en meld het. Kies nooit een ander uur zonder de gebruiker te vragen.
6. **Prijs en betaalmethode.**
   - Lees "Te betalen". Is het meer dan de maximumprijs, stop en meld het.
   - Betaalmethode: staat "Saldo" in de lijst **en** saldo is toegestaan in de instellingen, kies dan saldo.
     Anders laat je "Online betaling" staan.
7. **Reserveren.** Klik één keer op **Reserveren**. Klik nooit twee keer en open geen tweede reservatie.
8. **Na het klikken:**
   - **Mollie-betaalpagina**: raak niets aan. Vul geen kaart- of bankgegevens in, kies geen betaalmethode
     en bevestig geen betaling. Laat het tabblad open en meld aan de gebruiker: terrein, datum, uur, prijs, en dat
     er **binnen 60 minuten** betaald moet worden in dat tabblad (Bancontact kan met een QR-code op de gsm).
   - **Bevestiging zonder betaalstap** (betaald met saldo): meld terrein, datum, uur en prijs.
   - **Iets anders** (foutmelding, onverwacht scherm): stop, maak een screenshot en meld wat je ziet.

## Nooit

- Kaartnummers, wachtwoorden of andere gevoelige gegevens invullen of lezen.
- Een betaling bevestigen bij Mollie of bij een bank.
- Meer dan één terrein boeken per opdracht, of een bestaande reservatie annuleren of wijzigen zonder vraag.
- Medespelers toevoegen die de gebruiker niet zelf heeft genoemd.
