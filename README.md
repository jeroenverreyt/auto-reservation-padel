# Padel boeken bij Woten

Claude boekt een padelterrein bij Woten (Tennis en Padel Vlaanderen) in **je eigen Chrome**,
precies op het moment dat het boekingsvenster opengaat. Jij betaalt daarna zelf, binnen het uur.

## Hoe het werkt

1. Je zegt in de Claude-desktopapp bijvoorbeeld: *"Plan padel zondag 6 december 19:30."*
2. Claude rekent uit wanneer je mag boeken: Woten laat leden **96 uur** vooraf reserveren, dus hier woensdag 2 december om 19:30.
3. Claude maakt een geplande taak die 3 minuten voor dat moment start.
4. Die taak opent de reservatiepagina in je Chrome, wacht tot het venster opengaat en klikt op **Reserveren**.
   Is Padel 1 bezet, dan probeert ze Padel 2 en daarna 3.
5. Het terrein staat dan op jouw naam ("wachtend op betaling"). Je krijgt een melding en betaalt
   binnen **60 minuten** in het geopende tabblad, bijvoorbeeld via Bancontact met de QR-code op je gsm.

Claude vult nooit kaartgegevens in en bevestigt nooit een betaling. Heb je **saldo** opgeladen bij Woten en
staat dat aan in de instellingen van het skill, dan wordt er met saldo betaald en is er geen betaalstap.

Alle regels staan in [`.claude/skills/padel-boeken/SKILL.md`](.claude/skills/padel-boeken/SKILL.md),
onder andere de maximumprijs (€ 50), de voorkeur voor de terreinen en wat Claude nooit doet.

## Eenmalig instellen

1. **Claude-desktopapp** op je Mac, met deze map als project geopend in Claude Code.
2. **Claude in Chrome**: installeer de extensie en koppel ze aan de desktopapp.
3. **Inloggen in Chrome** op https://www.tennisenpadelvlaanderen.be met "Onthoud mij" aangevinkt.
4. Op het moment van een geplande taak:
   - de Mac staat aan en slaapt niet (Systeeminstellingen → Energie, of de app Amphetamine);
   - de Claude-app en Chrome zijn open;
   - je bent nog ingelogd in Chrome. Zo niet, dan stopt Claude en vraagt het je om opnieuw in te loggen.

## Handige commando's

```
node wanneer.js 2026-12-06 19:30
```
Toont wanneer je mag boeken, wanneer de taak moet lopen en de directe links voor Padel 1, 2 en 3.
Hiervoor zijn geen extra pakketten nodig.

```
node find-slot.js --date 2026-11-29 --time 19:30
```
Toont welke terreinen nu vrij zijn, zonder in te loggen. Hiervoor zijn `npm install` en
`npx playwright install chromium` nodig. Gebruiken hoeft niet: Claude bekijkt het rooster ook in Chrome.

## Woten in het kort

| | |
|---|---|
| clubId | 2220 |
| Terreinen | Padel 1 = 9195931, Padel 2 = 9195932, Padel 3 = 9195933 |
| Starturen | 09:00, 10:30, 12:00, 13:30, 15:00, 16:30, 18:00, 19:30, 21:00 (90 min) |
| Boekingsvenster | max. 96 uur vooraf |
| Betalen | Mollie, binnen 60 minuten, of saldo als de club dat toelaat |
| Prijs (gezien) | € 44 voor 90 min, 1 speler |

## Later: een thuisserver die altijd aanstaat

Hetzelfde werkt op elke computer die altijd aanstaat, bijvoorbeeld een Mac mini:
de Claude-desktopapp, Chrome met Claude in Chrome, ingelogd bij Tennis en Padel Vlaanderen,
deze map als project, en slaapstand uit. Je plant dan vanaf je laptop of gsm, en de thuisserver voert de taak uit.
Alleen inloggen blijft handwerk: verloopt je login, dan log je één keer opnieuw in op die computer
(eventueel via Schermdeling).
