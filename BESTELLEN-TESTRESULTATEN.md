# Excel samenvoegen: uitgevoerde tests

13 oktober 2026. Windows, Node 24.19.0, Vitest 5.0.3, jsdom, fake-indexeddb, JSZip 3.10.1. ExcelJS wordt alleen als extra lezer bij controles en bestaande services gebruikt; het samengevoegde bestand wordt niet opnieuw opgebouwd door ExcelJS.

## Resultaat

De definitieve run heeft **175 geslaagde tests en één overgeslagen test**, elf testbestanden, inclusief de lokale XLSM-proeven en de regressietest voor **Zakken**. Zonder de lokale bijlagen zijn dat **173 geslaagde tests en drie overgeslagen optionele tests**. De optionele echte pakbonfoto is in de definitieve run overgeslagen.

Typecheck en productiebuild zijn geslaagd; npm-audit meldt nul bekende kwetsbaarheden. De JSZip-bundel wordt pas geladen bij Excel-invoer. De bestaande omvangwaarschuwing van de hoofdbundel blijft aanwezig.

## Documentbehoud en samenvoeging

- Alle bewoners uit de drie bronnen worden meegenomen, inclusief hun dag- en nachtregels en invoer in productkolommen.
- Ingevulde bestellingen 2, 3 en 4 worden samen 9 in de oorspronkelijke kolom M; de locatieverdeling blijft 2/3/4.
- Een ingevulde nul wordt niet door een advies vervangen. Bij een lege bestelling wordt het bronadvies uit het werkelijke bewonersgebruik berekend, ook wanneer een opgeslagen verbruikscache verouderd is.
- Dozen en Zakken houden hun betekenis. Verpakkingen worden bij ontvangst niet ten onrechte opnieuw als dozen vermenigvuldigd.
- Bij meer bewoners worden rijopmaak, samengevoegde cellen, residentformules, validatie en afdrukbereik uitgebreid.
- Gedeelde residentformules worden naar de juiste nieuwe celverwijzingen vertaald. De formules voor dag-/nachtidentificatie en rijverwijzingen zijn gecontroleerd.
- Herhaald samenvoegen verandert de ingelezen bron niet en verdubbelt geen reeds samengevoegde gegevens.
- Het echte aangeleverde XLSM is als drie lokale testinvoeren gelezen. De bewonersaantallen tellen exact op. Alle zes oorspronkelijke tabbladen en de verborgen tabbladstatus blijven aanwezig.
- Alle package-onderdelen behalve de twee bewerkte worksheets en workbook.xml zijn inhoudelijk byte voor byte gelijk aan de eerste bron, inclusief VBA, stijlen, tekeningen, afbeeldingen en relaties.

De oorspronkelijke kop en adviesbestellijst zijn gerenderd en visueel vergeleken met het samengevoegde resultaat: groene TENA-opmaak, logo en productafbeeldingen, kolombreedtes, tabelkoppen en bestaande advies-/bestelkolommen blijven behouden. Alleen de afdelingsaanduiding en samengevoegde inhoud veranderen.

## Eenvoudig scherm en ontvangst

Drie React-componenttests gebruiken de echte samenvoegfunctie en lokale diensten: er staan alleen drie bestandsvelden, zonder vinkjes of extra metadata-invoer. Na drie bestanden is de download beschikbaar; een onleesbare vervanging maakt het oude resultaat ongeldig en toont één melding; ook een lege bestelling kan worden gedownload.

Bij downloaden wordt de productverdeling eenmaal opgeslagen. De test controleert dat bewonersnamen niet in IndexedDB terechtkomen en dat voorraad en assortiment intact blijven. De nieuwe samenvoeging is bij pakbonverwerking te kiezen. Een gedeeltelijke ontvangst op een samenvoeging wordt atomair verwerkt en houdt het resterende aantal open. De bestaande voorraad-, barcode-, OCR-, PDF-, retry-, rollback- en database-upgradetests blijven van toepassing.

## Beperkingen

De drie echte ingevulde locatiebestanden zijn nog niet als praktijkproef beschikbaar. De echte-templateproef gebruikt drie kopieën om behoud en optelling te controleren; dit is geen bestelling voor echte locaties. Alleen synthetische fixtures staan in het project. De aangeleverde XLSM en de lokale QA-uitvoer zijn niet in Git opgenomen.

Native Excel-macro-uitvoering, Excel-afdruk en een fysieke iPad/Safari zijn nog niet getest. Macrobestanden zijn behouden en visuele layout is gerenderd; daarmee is niet bewezen dat iedere macro een uitgebreid bewonersbereik automatisch ondersteunt. De app blijft lokaal per browser.

## Deployherstel: afzonderlijke testprocessen

13 oktober 2026: GitHub-run `38319191874` stopte tijdens `npm test` met `Segmentation fault (core dumped)` en exitcode 139; de bouw- en publicatiestappen werden daardoor overgeslagen. Vitest gebruikte threads terwijl de PDF-tests native canvas laden. De testopdracht gebruikt nu `--pool forks`, de door Vitest beschreven oplossing voor native-modulecrashes in workerthreads. Er zijn geen tests uitgezet en de workflow blijft tests en typecontrole verplicht uitvoeren.

De volledige lokale controle met deze opdracht slaagt: **173 tests geslaagd, drie optionele tests overgeslagen**, elf testbestanden. Typecontrole en productiebuild slagen eveneens. De drie overgeslagen tests gebruiken private lokale bijlagen die niet op GitHub staan.
