# Pakbon: uitgevoerde tests

6 oktober 2026, Windows, Node 24.19.0, npm 9.7.2, Vitest 5.0.3, jsdom 30.1.1, fake-indexeddb 6.2.5, Tesseract.js 7.0.0. Dit rapport betreft de uitbreiding; de oorspronkelijke 57 tests zijn behouden.

## Laatste complete run

**143 geslaagd, één overgeslagen**, acht testbestanden, inclusief 13 PDF-tests en vijf regressietests voor de status van de medewerkercontrole. De optionele test met de lokale echte foto is in deze run overgeslagen; die was vóór de PDF-uitbreiding geslaagd. Build en typecheck zijn succesvol. De build heeft een bestaande niet-blokkerende waarschuwing over de omvang van de hoofdbundel.

## Duidelijke medewerkercontrole

De status van een regel staat apart van automatische herkenningszekerheid. Drie domeintests controleren dat een handmatig bevestigde alias met onbevestigd demo-assortiment boekbaar is zonder automatische hoge zekerheid; dat afwijkende doosinhoud en ontbrekende bestemming ondanks vinkjes concrete blokkeringen blijven; en dat een code van een ander bestaand product blijft blokkeren.

Twee React-regressietests controleren de zichtbare status **Gecontroleerd**, de resterende volledigheidscontrole, ontvangst en aliasopslag. Het gemelde voorbeeld wordt nagebootst: **79167102 / TENA Pants Normal L / 4×18** gekoppeld aan **TENA Men Level 2 / 6×20** toont het naamverschil en de verpakkingsblokkering. Na keuze van Pants Normal Large en hernieuwde medewerkercontrole is de regel gereed, maar blijft ontvangst geblokkeerd totdat de hele pakbon is bevestigd. De automatische zekerheid blijft afzonderlijk zichtbaar en wordt niet door de vinkjes verhoogd.

## PDF-uitbreiding

PDF.js 6.4.299 rendert echte, in de tests opgebouwde fictieve PDF’s op een Node-canvas; dezelfde productie-renderfunctie en Tesseract-pipeline lezen daarna de pixels uit. Een tekst-PDF van twee pagina’s levert beide juiste artikelcodes en aantallen met hun paginanummers op. Een PDF met uitsluitend een ingesloten scan levert de drie verwachte artikelcodes en aantallen op. Dit zijn geen nagebootste herkenningsresultaten.

Aanvullende tests controleren: formaat en 20 MB-grens; maximaal 10 pagina’s; behoud van herhaalde artikelregels; een herhaald COL-totaal niet automatisch optellen; lege pagina’s melden; geheugen vrijgeven; annuleren; geen deelresultaat na een latere paginafout; verschillende pakbonnummers weigeren; en beschadigde PDF’s afwijzen.

Vier React-componenttests met nagebootste PDF-invoer controleren paginabladers, het uitlezen van alle pagina’s, verplichte medewerkercontrole, één daadwerkelijke lokale voorraadtransactie, paginanummers in de ontvangst, geen afbeeldingsdata in opslag, fout op pagina twee, annuleren en de melding bij een wachtwoordbeveiligde PDF. De bestaande voorraadtransactie is hierbij echt uitgevoerd met fake-indexeddb.

De productiebuild bevat de PDF-worker en de lokale fonts, CMaps en beelddecoders. Vite maakt deze resources vanuit de vastgelegde npm-versie aan. PDF-rendering en prestaties in Safari op een fysieke iPad zijn nog niet getest.

| Controle | Uitvoering en resultaat |
|---|---|
| Exacte, afwijkende en onbekende artikelcodes; gecontroleerde aliases | Geslaagd; suffixen worden niet afgesneden en onbekende namen geven geen definitieve match |
| OCR-spelfout of verkeerde variant/productnaam | Geslaagd; geen hoge zekerheid |
| Aantallen 1, 2 en 37; COL en losse verpakkingen | Geslaagd; expliciete omrekening, geen verwarring met stuks |
| 0, negatief, decimaal met punt/komma, ontbrekend, onzeker en overflow | Geslaagd; boeken geblokkeerd |
| Verpakkingsconflict en onbekende eenheid | Geslaagd; geen voorraadboeking |
| Ontbrekende of ongeldige bestemming; één/meerdere locatieregels | Geslaagd; nooit automatisch toegewezen, alleen geldige medewerkerkeuze |
| Conflicterende lezingen, herhaalde artikelen, onbekende/tegenstrijdige barcode | Geslaagd; geen hoge zekerheid of onbevestigde boeking |
| Opdrachtdatum naast leverdatum | Geslaagd; de opdrachtdatum wordt niet als leverdatum ingevuld |
| Twintig gelijktijdige bevestigingen | Drie afzonderlijke tests; telkens één ontvangst en één mutatie |
| Dezelfde bon, nieuwe operationId, veranderd nummer of dezelfde foto | Geslaagd; vorige verwerking getoond/weigering, geen tweede boeking |
| Schema-upgrade versie 1 naar 2 | Geslaagd; bestaande voorraad, producten en mutaties behouden |
| Sluiten/heropenen van database na commit | Geslaagd; dezelfde ontvangst teruggegeven, één mutatie |
| Fout tijdens tweede mutatie van een ontvangst | Geslaagd; hele voorraad, historie en ontvangst teruggedraaid; retry slaagt |
| Nieuwe producten/aliases, overslaan met reden, reset | Geslaagd; pas na bevestiging opgeslagen, auditspoor behouden |
| Volledige React-route: invoer, review, stand vóór/na, bevestiging, opslag | Drie afzonderlijke componenttests met echte lokale repository en nagebootste IndexedDB; geslaagd |
| Annuleren, wijziging na controle, onzekere uitkomst na commit, dubbele pakbon | Componenttests geslaagd; geen onbedoelde boeking |
| Pakboncamera na bewuste klik, geen audio, verlaten, late toestemming en weigering | Geslaagd met nagebootste camera; geen fysieke opname |
| Bestaande voorraad-, transactie-, barcode- en UI-functies | Alle oorspronkelijke 57 tests geslaagd |

## OCR met afbeeldingen

Dezelfde productie-parser en OCR-pipeline worden in Node met de echte Tesseract-worker uitgevoerd. De browserversie gebruikt dezelfde herkenningsstappen, maar de browser-WebAssembly-loading en Safari zijn nog niet interactief getest.

De duidelijke **synthetische** bon met drie artikelen is binnen een test **drie keer met een nieuw aangemaakte worker** gelezen. Beide lezingen hebben identieke artikelcodes, aantallen en verpakkingen. Met expliciet bevestigde testproducten en gekozen bestemming zijn alle controles waar en is de classificatie stabiel **Hoge zekerheid**. De synthetische fixture gebruikt 1 COL van 6×30p, 3 COL van 6×24p en 1 COL van 8×30p.

Zes andere synthetische afbeeldingen zijn daadwerkelijk door OCR gelezen: scheef, donker, onscherp, afgesneden, onbekend product en moeilijke aantallen. Geen van de gevonden regels kan zonder medewerkercontrole en bestemming worden geboekt. De onbekende artikelcode blijft zichtbaar als onbekend. Deze tests bewijzen de blokkeringen, niet dat elke slechte foto juist wordt gelezen of dat ontbrekende regels altijd automatisch worden ontdekt; daarom is volledigheidscontrole verplicht.

De **echte aangeleverde foto** is eerst drie keer verkend met twee lezingen en daarna in de geautomatiseerde productie-pipeline telkens drie keer gelezen. Negen artikelregels zijn aanwezig en de gelezen artikel-/hoeveelheidsvelden zijn stabiel tussen runs. De afwijkende codes worden niet automatisch aan de acht demoartikelen gekoppeld. Geen echte regel is zonder controle als hoge zekerheid geclassificeerd of geboekt. De verkennende OCR las een zichtbare 3×30p-verpakking als 3×50p; de herhalingen van diezelfde fout gelden expliciet niet als juistheidsbewijs. De oorspronkelijke foto is niet in het project, ZIP of Git opgenomen.

Tesseract gaf bij de echte foto interne native diagnostiek over tekstvakken. De herkenningsaanroepen voltooiden en de veiligheidsasserties slaagden. Die meldingen zijn geen bewijs van volledige of correcte herkenning. De normale app toont de OCR-debuguitvoer niet.

## Gevonden en verholpen fouten

De eerste proef met een automatische tabeluitsnede herkende op de synthetische bon de tweede lezing niet goed. Deze aanpak is vervangen door twee volledige lezingen met verschillende pagina-indelingen (AUTO en SINGLE_COLUMN), gevolgd door woordpositie- en databasecontrole. De kritieke test is opnieuw uitgevoerd en slaagt nu met identieke velden.

Vijf eerste UI-testasserties liepen vóór het einde van de asynchrone opslag. De tests wachten nu op de echte ontvangsttransactie. Alle elf componenttests slagen. Een typecheckfout in een constructor en ontbrekende Node-testtypen zijn opgelost; bouw en typecheck opnieuw geslaagd. Ook de voorraadpreview bij een onzekere opslaguitkomst blijft bij een veranderende live snapshot de oorspronkelijke ontvangst tonen; een componenttest controleert dat 10 → 22 niet ten onrechte 22 → 34 wordt. Geen bekende testfout blijft open.

## Niet uitgevoerd

- Interactieve browsercontrole van de nieuwe route: automatische goedkeuringscontrole wees het openen van de lokale testwebsite af wegens geweigerde toestemming.
- Fysieke iPad/Safari, iPadOS-versies, portret/landschap, camerafoto en mobiele HTTPS-prestaties.
- Publicatie van deze versie op GitHub en uitvoering van de GitHub Actions-workflow.
- Meerdere echte pakbonformaten, fysieke laaglicht-/onscherpteproeven en praktijkproeven met medewerkers.
- PDF-invoer op een fysieke iPad/Safari, gedeelde voorraad, back-up/herstel, offline-herladen en productierijpheid.

## Tests opnieuw uitvoeren

`npm test` draait de meegeleverde synthetische fixtures en alle regressietests. De echte afbeelding is bewust optioneel en wordt in GitHub Actions overgeslagen. Voor de echte test stel je lokaal `SV_REAL_PAKBON` in op je eigen afbeeldingspad en voer je `npm test` uit. Deel de echte foto niet in een publieke repository.

De herhalingen voor duidelijke OCR, volledige componentroute en concurrent bevestigen zitten in de tests zelf. Testfoto's in `src/tests/fixtures/delivery/` zijn duidelijk synthetisch.
