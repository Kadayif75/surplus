# Pakbon verwerken

Uitbreiding van Surplus Voorraad, 6 oktober 2026. De bestaande voorraad- en barcodefuncties blijven beschikbaar.

## Werkwijze

1. Open **Pakbon verwerken**. Kies **Pakbon scannen**, **Foto maken** of **Foto of PDF uploaden**. JPG/JFIF, PNG en WebP kunnen lokaal worden geopend als de browser het formaat ondersteunt. PDF’s met tekst of gescande afbeeldingen worden ondersteund. Maximaal 20 MB per bestand en 10 pagina’s per PDF; één pakbon per PDF. Upload wachtwoordbeveiligde PDF’s als onbeveiligde kopie.
2. Zorg dat de hele pakbon zichtbaar en scherp is. Draai de foto vóór uitlezen indien nodig. Met **Document vergroten voor regelcontrole** bekijk je de regels op grotere schaal. Bij PDF’s blader je met **Vorige pagina** en **Volgende pagina** door alle pagina’s.
3. Tik **Pakbon uitlezen**. Twee OCR-pogingen met verschillende pagina-indelingen worden naast de bestaande productgegevens gecontroleerd. Alle PDF-pagina’s worden achtereenvolgens gelezen; dit duurt bij meerdere pagina’s langer. Het paginanummer blijft bij iedere gevonden productregel zichtbaar. Wacht tot het controlescherm verschijnt; annuleren stopt de verwerking. Een fout op een latere pagina levert geen gedeeltelijk controlescherm op.
4. Controleer leverancier, pakbon-/leveringsnummer en leverdatum. Gebruik een gecontroleerde, unieke leveringsreferentie als de vervoersbon geen gelabeld pakbonnummer bevat. De app kiest niet zelf tussen een transportnummer, bestelnummer en trackingcode.
5. Controleer **iedere regel**: artikelnummer, product, aantal en doosinhoud. COL is één doos. Bijvoorbeeld **2 COL met 4×18p = 8 verpakkingen van 18 stuks**. Het aantal stuks wordt niet als voorraad geboekt.
6. Kies per regel de voorraadruimte. Er is geen automatische verdeling of vaste locatie per product ingesteld.
7. Een onbekende code wordt niet afgekapt of automatisch op naam gekoppeld. Kies het juiste bestaande product en bevestig de afwijkende artikelkoppeling expliciet, of voer naam en verpakking in en kies **Nieuw product voorbereiden**. Een nieuw product en de nulstanden in alle ruimtes worden pas bij ontvangstbevestiging opgeslagen.
8. Controleer elke regel met het vinkje en controleer de volledigheid van de hele bon. Ontbrekende regels kun je toevoegen. Een regel overslaan vereist een reden die in de historie wordt bewaard.
9. Bekijk de aantallen en standen vóór/na. Tik **Ontvangst bevestigen**. Pas deze actie verhoogt de voorraad. De ontvangst, alle mutaties en eventuele nieuwe producten/koppelingen worden in één transactie opgeslagen.
10. Foto en PDF worden na bevestiging of annuleren vrijgegeven. **Pakbonhistorie** toont leverancier, nummer, tijden, productregels, PDF-paginanummer indien aanwezig, aantallen, bestemming, controlegegevens en gekoppelde mutaties. De actor is de fictieve **Demogebruiker**.

Elke wijziging aan een regel trekt de eerdere regelcontrole en volledigheidscontrole in. Na een onzekere opslaguitkomst blijven dezelfde gegevens vaststaan voor een veilige retry. Een eventueel al geslaagde ontvangst wordt dan teruggegeven en niet opnieuw geboekt.

Controleer ook PDF-pagina’s zonder herkende productregels. De app meldt welke pagina’s dit zijn; voeg gemiste regels handmatig toe. Herhaalde artikelen op verschillende pagina’s worden behouden en vereisen controle om dubbeltelling te voorkomen. Een herhaald gedrukt COL-totaal wordt niet automatisch opgeteld; vergelijk het eerste gevonden totaal met de hele levering. Bij verschillende herkende pakbonnummers, leveranciers of leverdatums wordt samenvoegen geweigerd: controleer en upload de pakbonnen afzonderlijk. Niet alle verschillende pakbonnen zijn automatisch te herkennen; de volledigheidscontrole blijft nodig.

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

Mozilla PDF.js (`pdfjs-dist` 6.4.299, legacy-build) tekent elke PDF-pagina lokaal op een canvas van maximaal circa 2400 pixels aan de langste zijde. Daarna volgt dezelfde tweevoudige Tesseract-herkenning als bij foto’s; ook scans zonder tekstlaag werken zo. Pagina’s worden achtereenvolgens verwerkt en hun OCR-canvassen worden direct vrijgegeven. De PDF-worker wordt bij sluiten beëindigd. Er is geen betaalde PDF- of OCR-dienst. Vite kopieert de bijbehorende fonts, CMaps en beelddecoders vanuit de vastgelegde npm-versie naar `public/pdfjs/` en vervolgens `dist/`; deze gegenereerde map staat niet in Git. De worker wordt door Vite gebundeld. `npm run dev` en `npm run build` leveren daarmee de benodigde bestanden onder hetzelfde domein, ook op GitHub Pages.

`deliveryParser.ts` bewaart letterlijke artikelcodes en zet de gescheiden OCR-kolommen op basis van woordposities terug in rijen. `deliveryValidation.ts` controleert product, aantallen, verpakking, twee lezingen en bestemming. `destinationService.ts` voert de keuze van de medewerker uit; mogelijke `ProductLocationRule`-gegevens worden niet als automatische bestemming gebruikt. `deliveryService.ts` boekt de gehele ontvangst atomair. Dexie-schema 2 voegt historie en aliases toe en behoudt versie-1-voorraadgegevens.

Foto’s en PDF’s blijven alleen in het werkgeheugen van de pagina. In IndexedDB staan de gecontroleerde gegevens, ruwe productregels, paginanummers, controles, hashes en mutaties, nooit foto/video/PDF-bestanden of volledige OCR-documenttekst. Het bestaande veld `imageHash` bevat bij PDF’s de SHA-256-hash van het PDF-bestand, zodat dezelfde upload niet opnieuw wordt geboekt. Een demo-reset verwijdert ook pakbonhistorie en nieuwe koppelingen/producten. Er zijn geen accounts, centrale back-ups, synchronisatie of bewonersgegevens toegevoegd.

## Nog te testen

Camera, prestaties, afbeeldingsformaten en schermindeling op een echte iPad/Safari via HTTPS. De nieuwe route kon niet interactief in een browser worden getest omdat de automatische toestemmingscontrole die actie afwees. React-componenttests vervangen die praktijkcontrole niet. De echte afbeelding is als lokale OCR-proef onderzocht; correcte automatische verwerking van alle echte pakbonnen is daarmee niet bewezen.

Bronnen: [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [lokale worker-, core- en taalbestanden](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [Mozilla PDF.js canvas-rendering](https://mozilla.github.io/pdf.js/examples/), geraadpleegd 6 oktober 2026. De functionele afspraken volgen de uitbreidingsopdracht en de vijf antwoorden van de gebruiker op dezelfde datum.
