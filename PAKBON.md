# Pakbon verwerken

Uitbreiding van Surplus Voorraad, 6 oktober 2026. De bestaande voorraad- en barcodefuncties blijven beschikbaar.

## Werkwijze

1. Open **Pakbon verwerken**. Kies **Pakbon scannen**, **Foto maken** of **Afbeelding uploaden**. JPG/JFIF, PNG en WebP kunnen lokaal worden geopend als de browser het formaat ondersteunt. PDF is nog niet ondersteund.
2. Zorg dat de hele pakbon zichtbaar en scherp is. Draai de foto vóór uitlezen indien nodig. Met **Foto vergroten voor regelcontrole** bekijk je de regels op grotere schaal en schuif je door de foto.
3. Tik **Pakbon uitlezen**. Twee OCR-pogingen met verschillende pagina-indelingen worden naast de bestaande productgegevens gecontroleerd. Wacht tot het controlescherm verschijnt; annuleren stopt de verwerking.
4. Controleer leverancier, pakbon-/leveringsnummer en leverdatum. Gebruik een gecontroleerde, unieke leveringsreferentie als de vervoersbon geen gelabeld pakbonnummer bevat. De app kiest niet zelf tussen een transportnummer, bestelnummer en trackingcode.
5. Controleer **iedere regel**: artikelnummer, product, aantal en doosinhoud. COL is één doos. Bijvoorbeeld **2 COL met 4×18p = 8 verpakkingen van 18 stuks**. Het aantal stuks wordt niet als voorraad geboekt.
6. Kies per regel de voorraadruimte. Er is geen automatische verdeling of vaste locatie per product ingesteld.
7. Een onbekende code wordt niet afgekapt of automatisch op naam gekoppeld. Kies het juiste bestaande product en bevestig de afwijkende artikelkoppeling expliciet, of voer naam en verpakking in en kies **Nieuw product voorbereiden**. Een nieuw product en de nulstanden in alle ruimtes worden pas bij ontvangstbevestiging opgeslagen.
8. Controleer elke regel met het vinkje en controleer de volledigheid van de hele bon. Ontbrekende regels kun je toevoegen. Een regel overslaan vereist een reden die in de historie wordt bewaard.
9. Bekijk de aantallen en standen vóór/na. Tik **Ontvangst bevestigen**. Pas deze actie verhoogt de voorraad. De ontvangst, alle mutaties en eventuele nieuwe producten/koppelingen worden in één transactie opgeslagen.
10. De foto wordt na bevestiging of annuleren vrijgegeven. **Pakbonhistorie** toont leverancier, nummer, tijden, productregels, aantallen, bestemming, controlegegevens en gekoppelde mutaties. De actor is de fictieve **Demogebruiker**.

Elke wijziging aan een regel trekt de eerdere regelcontrole en volledigheidscontrole in. Na een onzekere opslaguitkomst blijven dezelfde gegevens vaststaan voor een veilige retry. Een eventueel al geslaagde ontvangst wordt dan teruggegeven en niet opnieuw geboekt.

## Zekerheid

**Hoge zekerheid** vereist dat artikelnummer of eerder bevestigde alias overeenkomt, het bestaande assortiment bevestigd is, naam en variant passen, het aantal een positief geheel getal is, de doosinhoud klopt, beide OCR-uitkomsten identiek zijn, het artikel niet herhaald voorkomt, een eventuele GTIN niet conflicteert en de bestemming door de medewerker gekozen is.

**Controle nodig** verschijnt zodra een controle ontbreekt of niet overeenkomt. **Niet herkend** betekent dat geen bestaand of expliciet voorbereid product gekoppeld is. De details **Waarom deze zekerheid?** tonen iedere controle afzonderlijk. Er worden geen procentuele kansen geclaimd. Ook regels met hoge zekerheid vereisen een bewuste regelcontrole en de uiteindelijke ontvangstbevestiging.

De acht oorspronkelijke demoartikelen hebben nog `assortmentVerified=false`. Daarom blijft hun automatische zekerheid beperkt. Een bevestigde afwijkende code is een expliciete alias, geen bewijs dat het hele assortiment actueel is. Nieuwe, door de medewerker gecontroleerde producten kunnen bij volgende leveringen wel aan die controle voldoen.

Een herhaald OCR-resultaat kan steeds dezelfde fout bevatten. De aangeleverde bon leverde in de verkennende test bijvoorbeeld 3×50p op waar de foto 3×30p toont. De verpakking moet overeenkomen met het gekozen product; anders blijft boeken geblokkeerd tot de medewerker corrigeert. De app meet geen beeldscherpte of verlichting en garandeert geen juiste OCR.

## Dubbele verwerking

Een unieke operationId maakt retries idempotent. Daarnaast controleert de app leverancier plus pakbonnummer, een SHA-256-fingerprint van leverancier, leverdatum en regelinhoud, en de hash van hetzelfde foto-bestand. Bij een vermoedelijke herhaling zie je de eerder verwerkte datum, het nummer en de producten. Er wordt niets opnieuw geboekt.

Een inhoudsfingerprint kan ook twee werkelijk identieke leveringen signaleren. Gebruik dan een gecontroleerde, juiste leverdatum en referentie en laat de situatie onderzoeken. Deze demo heeft geen knop om een duplicaatcontrole te omzeilen. Bescherming geldt binnen deze browserdataset; apparaten delen geen database.

## Techniek en privacy

React en TypeScript met Vite; Tesseract.js 7.0.0 voert OCR lokaal uit via een worker en WebAssembly. De worker, Nederlandse taaldata en alle benodigde cores staan in `public/ocr/` en worden door dezelfde website geleverd. Er is geen externe AI/OCR-API en er zijn geen API-sleutels. Internet is nodig om de website en OCR-bestanden te laden; de app heeft geen offline serviceworker.

`deliveryParser.ts` bewaart letterlijke artikelcodes en zet de gescheiden OCR-kolommen op basis van woordposities terug in rijen. `deliveryValidation.ts` controleert product, aantallen, verpakking, twee lezingen en bestemming. `destinationService.ts` voert de keuze van de medewerker uit; mogelijke `ProductLocationRule`-gegevens worden niet als automatische bestemming gebruikt. `deliveryService.ts` boekt de gehele ontvangst atomair. Dexie-schema 2 voegt historie en aliases toe en behoudt versie-1-voorraadgegevens.

Foto's blijven alleen in het werkgeheugen van de pagina. In IndexedDB staan de gecontroleerde gegevens, ruwe productregels, controles, hashes en mutaties, nooit foto/video of volledige OCR-documenttekst. Een demo-reset verwijdert ook pakbonhistorie en nieuwe koppelingen/producten. Er zijn geen accounts, centrale back-ups, synchronisatie of bewonersgegevens toegevoegd.

## Nog te testen

Camera, prestaties, afbeeldingsformaten en schermindeling op een echte iPad/Safari via HTTPS. De nieuwe route kon niet interactief in een browser worden getest omdat de automatische toestemmingscontrole die actie afwees. React-componenttests vervangen die praktijkcontrole niet. De echte afbeelding is als lokale OCR-proef onderzocht; correcte automatische verwerking van alle echte pakbonnen is daarmee niet bewezen.

Bronnen: [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [lokale worker-, core- en taalbestanden](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), geraadpleegd 6 oktober 2026. De functionele afspraken volgen de uitbreidingsopdracht en de vijf antwoorden van de gebruiker op dezelfde datum.
