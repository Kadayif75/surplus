# Bestellen en verdelen: uitgevoerde tests

12 oktober 2026. Windows, Node 24.19.0, npm 9.7.2, Vitest 5.0.3, jsdom, fake-indexeddb en ExcelJS 4.4.0.

## Resultaat

**169 tests geslaagd, één overgeslagen**, tien testbestanden. De aangeleverde XLSM is in deze run meegenomen via een optionele lokale test. De optionele echte pakbonfoto is overgeslagen. De standaardrun zonder lokale bijlagen heeft **168 geslaagde tests en twee overgeslagen tests**. De eerdere voorraad-, barcode-, OCR-, PDF- en pakbonregressies slagen nog steeds.

Typecheck en productiebuild slagen. npm-audit meldt nul bekende kwetsbaarheden. De build bevat een bestaande omvangwaarschuwing; ExcelJS wordt als aparte bundel pas op aanvraag geladen.

## Nieuwe controles

| Controle | Waarneming |
|---|---|
| Behoefte in daggebruik, weken en verpakkingen | Correct omgerekend; aanwezige voorraad eerst afgetrokken en dan per locatie op dozen afgerond |
| Genoeg voorraad of nulbehoefte | Geen negatieve of onnodige bestelling; een overschot wordt niet automatisch naar een andere locatie geschoven |
| Ontbrekende locatie, negatief daggebruik en overflow | Berekening geweigerd met uitleg |
| Dubbele actieve artikelcode en conflicterende productnaam | Niet stil samengevoegd of aan een verkeerd assortimentproduct gekoppeld |
| Viercijferige aanvullende artikelcode | Letterlijk behouden, ook bij pakbonparsing; geen nullen toegevoegd |
| Tien gelijktijdige opslagpogingen | Eén bestelplan, bestaande voorraad ongewijzigd, gewijzigde inhoud bij hetzelfde id geweigerd |
| Ontbrekende medewerkercontrole of onbevestigde nieuwe producten | Opslaan geblokkeerd |
| Nieuwe producten met fysiek getelde beginvoorraad | Beginstanden verlagen het tekort en krijgen openingsmutaties; bestaande standen blijven intact |
| Veranderde voorraad na opstellen | Oud bestelplan geweigerd |
| Concept en Besteld | Concept telt niet als onderweg; Besteld telt het nog te ontvangen restant mee |
| Deellevering en nieuwe bestelberekening | Ontvangen deel zit in actuele voorraad; alleen restant telt als onderweg, geen dubbeltelling |
| Fout bij toevoeging van een nieuw product | Hele bestelplan en nieuwe gegevens teruggedraaid |
| Volledige ontvangst over drie locaties | Exacte verdeling en één boeking bij herhaling; bestelling wordt Ontvangen |
| Deellevering en retry | Ontvangen deel slechts eenmaal verwerkt; restant blijft open |
| Te veel ontvangen, onbekend bestelproduct, ongeldige verdeelsom of bestemming | Ontvangst geblokkeerd |
| Opslagfout na orderbijwerking | Order, ontvangst, mutaties en voorraad samen teruggedraaid |
| Database-upgrade van schema 2 naar 3 | Stand 17 blijft 17, nieuwe besteltabel leeg, standaardnamen aangepast en eigen naam behouden |
| Demo-reset | Bestellingen verwijderd; locaties blijven Rood, Oranje en Groen |
| Opgeslagen formule-uitkomst nul en ontbrekende uitkomst | Nul blijft geldig; ontbrekende berekening wordt niet als nul overgenomen |
| Aangeleverde XLSM | Werkelijk lokaal gelezen; producttotalen en aanvullende ontbrekende dagtotalen herkend, zonder macro-uitvoering of bronbewerking |
| XLSX-export | Opnieuw als Excel geopend; totaal 11 dozen, verdeling 3/4/4, artikelcode als tekst en aantallen numeriek, één tabblad met bestelling en verdeling |

Vier React-componenttests controleren de route met nagebootste bestandselectie en de echte lokale services: drie locatie-invoeren, verplichte controle, één bestelplan, markeren als verstuurd, gekoppelde pakbon, automatische volledige verdeling, handmatige deellevering, expliciete nulbevestiging voor ontbrekend aanvullend gebruik en hernieuwde controle na periodewijziging.

De volledige schermtest boekt 18 verpakkingen naar Rood, 24 naar Oranje en 24 naar Groen en controleert de ontvangstaandelen op de opgeslagen bestelling. Alleen bevestiging schrijft de voorraad. De daadwerkelijke Excel-reader en export worden apart met gegenereerde fictieve gegevens en de bestaande lokale XLSM getest; alleen productgegevens komen terug uit de reader.

## Grenzen van het bewijs

Er zijn nog geen drie werkelijk ingevulde locatiebestanden, echte bestellingen of leveranciersontvangsten als praktijkproef verwerkt. Een fysieke iPad/Safari en native Excel-weergave van het exportbestand zijn niet getest. Schermtests lopen in React/jsdom, Excel-export wordt inhoudelijk opnieuw geopend; dit vervangt geen praktijkcontrole van download, afdruk en iPad-prestaties.

De voorraad blijft lokaal per browser. Geen server, account, synchronisatie, back-up, automatische verzending, voorraadtransfer of automatische behandeling van meerleveringen/vervangende producten is toegevoegd. Bestaande beginstanden blijven fictief; een medewerker moet de fysieke voorraad controleren voordat een echte bestelling wordt gemaakt.
