# Excel samenvoegen

Vereenvoudigd op 13 oktober 2026: drie ingevulde bewonersoverzichten inlezen en één document downloaden met de oorspronkelijke vormgeving. Het resultaat bevat ook alle bewonersregels. Locaties blijven Rood, Oranje en Groen.

## Gebruik

1. Kies **Excel samenvoegen** en selecteer voor Rood, Oranje en Groen hun ingevulde XLSM- of XLSX-bestand (maximaal 20 MB per bestand).
2. De app voegt de bestanden automatisch samen. Er verschijnt een kort overzicht van de te bestellen producten en aantallen.
3. Kies **Samengevoegd Excel downloaden**. Het bestand bevat de oorspronkelijke tabbladen, opmaak, logo's, keuzelijsten, formules en macrobestanden. De bewonersregels worden achter elkaar opgenomen, met hun dag- en nachtregels. De gezamenlijke bestelaantallen staan in de bestaande kolom **Bestelling**.

Er zijn geen extra velden voor leverancier, bestelnummer, voorraad of productcontrole en geen verplichte vinkjes in deze stap. Bij een onbruikbaar bestand, afwijkende productlijsten, verschillende weken of verschillende besteleenheden staat er één korte foutmelding. Gebruik dezelfde versie van het bewonersoverzicht voor alle drie locaties.

Ingevulde bestelaantallen in kolom M worden overgenomen en opgeteld. Een daadwerkelijk ingevulde nul blijft nul. Bij een lege bestelling wordt het bestaande advies voor de locatie gebruikt, op basis van haar bewonersgebruik en het aantal weken uit de Excel. De besteleenheid **Dozen** of **Zakken** uit cel M9 blijft behouden. De app trekt in deze samenvoegstap geen demo-voorraad af; voorraadcorrecties die al in de Excel-bestelling zijn verwerkt worden dus niet opnieuw toegepast.

Ook als er niets te bestellen is, kan het gecombineerde bewonersdocument worden gedownload. De bestaande bronbestanden worden niet gewijzigd.

## Ontvangst en locatieverdeling

Bij downloaden bewaart de app automatisch alleen de productverdeling per locatie, met een automatisch aangemaakte referentie en datum. Bewonersnamen en complete Excel-bestanden komen niet in IndexedDB. Er wordt geen assortiment of voorraad toegevoegd door samenvoegen of downloaden.

Bij binnenkomst kies je de bijbehorende **Samengevoegd**-vermelding in **Pakbon verwerken**. De eerder afgesproken ontvangstcontrole blijft bestaan: volledige productleveringen kunnen de locatieverdeling overnemen, deelleveringen worden door de medewerker verdeeld, en pas **Ontvangst bevestigen** voegt voorraad toe. Onbekende producten en afwijkende artikelcodes worden daarbij bewust gekoppeld of toegevoegd. Een gedeeltelijke ontvangst houdt het resterende aantal open; volledige ontvangst sluit de bestelling.

Het document wordt door de medewerker via jullie gebruikelijke bestelwijze gebruikt. De app verzendt geen bestelling naar een leverancier.

## Behoud van het document

Het bestand van Rood is de basis. De app maakt geen nieuwe werkmap of eigen besteltabblad. Ze wijzigt alleen de XML van **Bewonersoverzicht**, **Adviesbestelling in weken** en de noodzakelijke werkmapinstellingen voor bereikuitbreiding en herberekening. Alle andere onderdelen van de eerste werkmap worden inhoudelijk byte voor byte overgenomen: stijlen, afbeeldingen, verborgen bladen, VBA, relaties, macroknoppen en overige documentonderdelen.

Bij meer bewoners wordt het bestaande bewonersgedeelte met dezelfde rijopmaak uitgebreid. Samenvoegingen, residentformules, keuzelijsten, benoemde bereiken en het afdrukbereik worden waar nodig meegenomen. Formules behouden hun structuur en Excel wordt gevraagd bij openen volledig te herberekenen. De cel **Afdeling** vermeldt Rood / Oranje / Groen.

XLSM blijft XLSM; een XLSX-basis blijft XLSX. De browser voert geen macro's uit. De oorspronkelijke VBA-bestanden blijven in het XLSM-resultaat aanwezig; uitvoering in native Excel moet nog in de praktijk worden gecontroleerd, vooral bij een uitgebreider bewonersbereik.

## Privacy en lokale opslag

De bronbestanden en alle bewonersgegevens blijven tijdelijk in het geheugen van deze pagina. Het gedownloade document bevat de samengevoegde bewonersgegevens zoals gevraagd. De website uploadt die gegevens nergens en bewaart alleen productverdeling, bronhashes, datum en ontvangststanden lokaal.

Alle drie bestanden en latere ontvangsten horen in dezelfde browserdataset. Verschillende apparaten delen nog geen voorraad of samenvoegingen. Bewaar het gedownloade bestand via jullie normale werkwijze; de app bewaart het bestand niet voor een latere herdownload na sluiten van de pagina.

## Techniek en verificatie

JSZip 3.10.1 leest en schrijft het bestaande Excel-pakket. DOMParser/XMLSerializer bewerken de noodzakelijke XML-onderdelen. De oorspronkelijke TENA-layout is voor en na samenvoegen visueel vergeleken, en tests openen het resultaat opnieuw als Excel en controleren alle niet-gewijzigde onderdelen. Zie [BESTELLEN-TESTRESULTATEN.md](BESTELLEN-TESTRESULTATEN.md).

De eerdere reken- en ontvangstservices en historische bestelplannen blijven ondersteund. De nieuwe samenvoegpagina gebruikt de aantallen uit de werkboeken en vereist hun eerdere controleformulieren niet.
