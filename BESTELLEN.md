# Bestellen en verdelen

Uitbreiding van 12 oktober 2026. Locaties heten Rood, Oranje en Groen. De interne sleutels H1, H2 en H3 blijven bestaan om voorraad en historie te behouden. Bestaande standaardnamen worden eenmalig gewijzigd; eigen ruimtenamen blijven intact.

## Werkwijze

1. Werk de drie bewonersoverzichten bij in Excel, laat de formules opnieuw berekenen en sla elk bestand op. Kies in **Bestellen & verdelen** per locatie het juiste XLSX- of XLSM-bestand, maximaal 20 MB.
2. De app neemt artikelnummer, productnaam, daggebruik en doosinhoud uit **Adviesbestelling in weken** over. Bewonersnamen, individuele bewonersregels, macro's en oorspronkelijke bestanden worden niet in de app opgeslagen. Macro's worden niet uitgevoerd. De Excel blijft ongewijzigd.
3. Aanvullende producten, zoals huidverzorging, hebben in deze werkmap soms geen daggebruik. Vul daarvoor het gecontroleerde daggebruik in of bevestig expliciet dat er voor die aanvullende producten geen behoefte is. Een ontbrekende formule-uitkomst wordt geweigerd; een daadwerkelijk opgeslagen uitkomst van nul blijft nul. Twee actieve regels met dezelfde artikelcode worden niet stil samengevoegd: corrigeer de bron bij een conflict.
4. Kies een gezamenlijke bestelperiode van 1 tot 52 hele weken; de startwaarde is 2. Vul leverancier en een uniek bestelnummer in. De periode uit ieder bronbestand staat apart bij de invoer; de gekozen app-periode wordt voor alle drie locaties gebruikt.
5. Controleer de huidige voorraad per locatie. De oorspronkelijke beginstanden blijven fictieve demo-invoer; corrigeer bestaande standen via de bestaande voorraadboekingen voordat je een echte bestelling maakt. Voor nieuwe producten toont de app invoer voor fysiek getelde beginvoorraad op alle drie locaties. Controleer artikelnummer, naam, doosinhoud en beginvoorraad en bevestig de toevoeging expliciet. Nul mag alleen wanneer er daadwerkelijk niets aanwezig is. Positieve nieuwe beginstanden krijgen een openingsmutatie.
6. Bekijk het gezamenlijke overzicht: totaal dozen en dozen voor Rood, Oranje en Groen. Per locatie staan de behoefte in verpakkingen, aanwezige voorraad en nog onderweg zijnde verpakkingen. Controleer alles en kies **Bestelplan opslaan**.
7. Download **Gezamenlijke Excel**. Dit is één XLSX met de totale bestelling en de drie locatiekolommen. Verstuur de bestelling zelf via jullie normale bestelwijze. De app verstuurt niets naar de leverancier. Kies vervolgens **Ik heb deze bestelling verstuurd**; de status wordt **Besteld** en de nog te ontvangen aantallen tellen mee bij een volgende berekening. Een concept telt nog niet als onderweg. Werk de status bij voordat je een nieuw bestelplan maakt voor dezelfde behoefte.
8. Bij binnenkomst open je **Pakbon verwerken** en kies je bij **Bijbehorende bestelling** het juiste bestelnummer. Upload de foto/PDF en lees die uit. Het bestelnummer kan afwijken van het pakbonnummer; kies bewust de juiste bestelling.
9. Koppel en controleer de producten op de pakbon, ook bij afwijkende artikelcodes. Bij een volledige productlevering is **Verdeling uit bestelling overnemen** beschikbaar. De app maakt bestemmingsregels met de bewaarde aantallen. De medewerker controleert vervolgens iedere regel opnieuw.
10. Bij een deellevering, afwijkend aantal of herhaalde productregel bepaalt de medewerker de verdeling. Vul per locatie ontvangen **verpakkingen** in en kies **Eigen verdeling toepassen**. De som moet exact overeenkomen met de werkelijk ontvangen hoeveelheid. De oorspronkelijke ruwe pakbonregel en het eventuele paginanummer blijven behouden.
11. Bevestig de volledige pakbon en kies **Ontvangst bevestigen**. Voorraad, mutaties, pakbon en ontvangen aantallen op de bestelling worden in één transactie bijgewerkt. Nog ontbrekende hoeveelheden blijven open; na volledige ontvangst wordt de status **Ontvangen**. Dezelfde ontvangst opnieuw proberen boekt en verwerkt niet dubbel.

Bij producten die niet besteld zijn of een hoeveelheid boven het openstaande locatie-aantal blokkeert de gekoppelde ontvangst. Onderzoek zo'n afwijking eerst; deze versie heeft geen automatische verwerking van extra of vervangende producten. Zonder bestelplan blijft de bestaande handmatige bestemmingroute beschikbaar.

## Berekening

Per product en locatie:

```
behoefte in verpakkingen = naar boven afronden(daggebruik × 7 × weken / stuks per verpakking)
tekort = maximaal(0, behoefte - aanwezige verpakkingen - nog te ontvangen verpakkingen)
te bestellen dozen = naar boven afronden(tekort / verpakkingen per doos)
```

Daarna worden de dozen van de drie locaties opgeteld voor de gezamenlijke bestelling. Er wordt geen veiligheidsbuffer toegevoegd of voorraad tussen locaties verschoven. Hele dozen per locatie maken de fysieke verdeling eenvoudiger, maar kunnen tot meer bestelde verpakkingen leiden dan alleen het gezamenlijke tekort afronden.

Bijvoorbeeld: behoefte 28 verpakkingen per locatie en aanwezige voorraad Rood 10, Oranje 6, Groen 4. Bij 6 verpakkingen per doos is de bestelling 3 + 4 + 4 = 11 dozen. Bij volledige ontvangst gaan 18 verpakkingen naar Rood, 24 naar Oranje en 24 naar Groen. Dit voorbeeld is fictief.

## Opslag en techniek

Dexie-schema 3 voegt een besteltabel toe. Bestaande voorraad, koppelingen, pakbonnen en mutaties blijven behouden. Het bestelplan bewaart alleen productgegevens, producttotalen, bronhashes, periode, leverancier, bestelnummer, gecontroleerde voorraad, aantallen per locatie en ontvangststanden. Nieuwe producten en hun beginstanden worden pas na expliciete controle toegevoegd. Bestaande voorraad wordt door het maken van een bestelplan niet verhoogd.

ExcelJS 4.4.0 wordt pas geladen wanneer Excel-invoer of export nodig is. De browser verwerkt de bestanden lokaal. De `uuid`-afhankelijkheid van ExcelJS is vastgelegd op 11.1.1; de gebruikte v4-interface is compatibel en de npm-audit is gecontroleerd. Er zijn geen extra API-kosten of leverancierskoppelingen toegevoegd.

De oorspronkelijke Excel bevat een aantal viercijferige aanvullende artikelcodes. Die worden letterlijk ondersteund; de app vult geen nullen aan en verwijdert geen suffixen. Productnaam- en doosinhoudconflicten worden geweigerd. Bestelberekening en opslaan controleren de actuele voorraad en onderweg zijnde bestellingen opnieuw om gewijzigde invoer te signaleren.

Dit blijft een lokale demo: alle drie bestanden en de ontvangsten moeten in dezelfde browserdataset worden verwerkt. Verschillende apparaten delen geen voorraad of bestelplannen. Er is geen centrale database, back-up of synchronisatie gebouwd.

## Validatie

De invoer van de werkelijk aangeleverde XLSM is lokaal gecontroleerd zonder wijzigingen of macro-uitvoering. Tests controleren formule-uitkomsten, nul versus ontbrekend, berekening, onderweg zijnde voorraad, gecontroleerde nieuwe producten, beginvoorraad, gelijktijdige opslag, volledige en gedeeltelijke ontvangst, retries, rollback en de database-upgrade. Een React-componenttest doorloopt drie Excel-invoeren tot verdeelde ontvangst met echte lokale transacties in fake-indexeddb. Export wordt als XLSX opnieuw geopend en inhoudelijk gecontroleerd. Zie **BESTELLEN-TESTRESULTATEN.md** voor aantallen en beperkingen.

Een fysieke iPad/Safari, de oorspronkelijke Excel-macro's, native Excel-weergave van het exportbestand en levering bij een leverancier zijn niet getest. De geautomatiseerde tests bewijzen de appregels en opslag, geen fysieke productherkenning of operationele gereedheid.

Bron voor de browser- en formule-interface: [ExcelJS 4.4.0 documentatie](https://github.com/exceljs/exceljs/tree/v4.4.0#browser), geraadpleegd 12 oktober 2026. De berekeningsopbouw is gecontroleerd in het aangeleverde tabblad **Adviesbestelling in weken**, met dagtotalen in kolom D, verpakkingen per doos in E, stuks per verpakking in F en weken in J4. De functionele afspraken volgen de antwoorden van de gebruiker.
