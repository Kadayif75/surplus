# Geteste versies

30 september 2026. Windows, Node.js 24.19.0, npm 9.7.2. Node.js 24.15+ is vereist voor deze verzameling bouw- en testbibliotheken.

| Pakket | Geïnstalleerde versie |
|---|---|
| react | 19.3.0 |
| react-dom | 19.3.0 |
| vite | 8.3.1 |
| typescript | 6.0.3 |
| @vitejs/plugin-react | 6.1.1 |
| @zxing/browser | 0.2.1 |
| @zxing/library | 0.23.0 |
| dexie | 4.4.6 |
| jsbarcode | 3.12.3 |
| vitest | 5.0.3 |
| fake-indexeddb | 6.2.5 |
| jsdom | 30.1.1 |

Alle transitieve afhankelijkheden staan in package-lock.json. Gebruik npm ci.

Uitbreiding 6 oktober 2026: tesseract.js 7.0.0; tesseract.js-core 7.0.0; source-map-js 1.2.2. Exacte versies en afhankelijkheden staan in het bijgewerkte lockbestand.

PDF-uitbreiding 6 oktober 2026: pdfjs-dist 6.4.299; @napi-rs/canvas 1.0.10 (alleen voor de Node-testomgeving, niet voor de webapp).

Besteluitbreiding 12 oktober 2026: exceljs 4.4.0 (lokaal lezen en exporteren van Excel); uuid 11.1.1 als compatibele override voor de ExcelJS-afhankelijkheid. ExcelJS is een afzonderlijke, op aanvraag geladen browserbundel.

Vereenvoudiging 13 oktober 2026: jszip 3.10.1 en browser-DOM voor behoud van het bestaande XLSM/XLSX-pakket. De nieuwe samenvoegroute gebruikt de oorspronkelijke werkmap; de eigen Excel-export is verwijderd. ExcelJS blijft beschikbaar voor bestaande lees-/rekentests en wordt niet door het nieuwe samenvoegscherm geladen.

Deployherstel 13 oktober 2026: Vitest draait met `--pool forks`, zodat de native canvas- en PDF-tests in afzonderlijke Node-processen draaien. Met `--pool threads` crashte de Ubuntu-build op GitHub tijdens de tests met `Segmentation fault (core dumped)` (exitcode 139). Alle tests blijven actief; de test- en bouwstappen blijven vereist voor publicatie. Zie de [Vitest-uitleg over native modules](https://vitest.dev/guide/common-errors#segfaults-and-native-code-errors).
