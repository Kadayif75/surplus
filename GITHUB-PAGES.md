# Eén compleet project op GitHub

Dit pakket bevat de broncode, testgevallen, het npm-lockbestand, documentatie en `.github/workflows/deploy.yml`. Die workflow laat GitHub bibliotheken installeren, tests uitvoeren, de website bouwen en de geslaagde build publiceren. De build controleert ook TypeScript.

Een apart bestand `Surplus-Voorraad-GitHub-Pages.zip` is met deze route niet nodig. Dat oudere pakket was een alternatief voor het rechtstreeks uploaden van een al gebouwde website. Meng de twee routes niet: bij dit project kies je **GitHub Actions** als Pages-bron.

## Uploaden via de GitHub-website

1. Pak `Surplus-Voorraad-Compleet-GitHub.zip` uit op je computer. Upload niet het ZIP-bestand zelf; GitHub pakt een geüpload ZIP-bestand niet automatisch uit tot projectbestanden.
2. Maak op GitHub een nieuwe **Public** repository, bijvoorbeeld `surplus-voorraad`. Voeg bij het aanmaken een README toe, zodat er een standaardbranch bestaat. Voor GitHub Free gebruikt deze handleiding een openbare repository.
3. Ga eerst naar **Settings → Pages**. Kies bij **Build and deployment → Source** voor **GitHub Actions**.
4. Ga terug naar **Code → Add file → Upload files**. Sleep alle uitgepakte projectbestanden en mappen in het uploadvenster. Upload rechtstreeks in de hoofdmap; `package.json` en `index.html` moeten daar staan, niet binnen nog een map `surplus-voorraad-poc`.
5. Controleer dat ook de map **`.github`** wordt meegenomen. Daarin moet `.github/workflows/deploy.yml` staan. Upload tevens `src`, `public`, `package.json`, `package-lock.json`, de configuratiebestanden en documentatie. `node_modules`, `.git` en een vooraf gemaakte `dist` horen niet bij dit uploadpakket.
6. Klik **Commit changes** en sla op de standaardbranch op. De workflow volgt de ingestelde standaardbranch; de naam hoeft niet per se `main` te zijn.
7. Bekijk het tabblad **Actions**. De taak **Surplus Voorraad publiceren** installeert, test, bouwt en publiceert. Wacht tot beide jobs groen zijn.
8. Ga naar **Settings → Pages** en open de getoonde website-URL. Die heeft doorgaans de vorm `https://<gebruikersnaam>.github.io/<repositorynaam>/`.
9. Open die HTTPS-URL in een eigen browsertab op de iPad. Cameratoestemming en apparaatbeleid moeten cameragebruik toestaan; fysieke iPad-scans zijn nog niet getest.

Zet je Pages pas na de upload aan, of is een eerste publicatie mislukt? Zet Source alsnog op GitHub Actions. Open **Actions → Surplus Voorraad publiceren → Run workflow**, selecteer de standaardbranch en start opnieuw. Controleer bij fouten de mislukte stap.

Als tegelijk een automatische taak **pages build and deployment** vanuit een branch loopt, controleer dan opnieuw de Pages-bron. Die route kan de broncode publiceren en de gebouwde website overschrijven. Een groene workflow alleen bewijst daarom nog niet dat de juiste website online staat. Deze instelling vereist beheerrechten voor Pages; schrijfrechten om code te pushen zijn daarvoor niet voldoende.

## Belangrijk bij deze demo

De repository en website zijn openbaar. Het pakket bevat uitsluitend de fictieve voorraaddemo; upload geen bewonerswerkmap of andere vertrouwelijke bijlagen. Hosting verandert de opslag niet: elke browser/apparaat heeft een eigen lokale voorraad. De website is geen gedeeld voorraadsysteem en bevat nu lokale pakbon-OCR, maar geen accounts of Microsoft-koppeling.

De Vite-configuratie gebruikt `base: '/surplus/'`, passend bij de huidige repository `Kadayif75/surplus`. De gebouwde HTML verwijst naar CSS, JavaScript en het favicon onder `/surplus/`. Gebruik je een andere repositorynaam, pas dan dit pad in `vite.config.ts` aan. Er is geen extra router of GitHub-redirect nodig voor de huidige schermen. Als later een router met echte URL-paden wordt toegevoegd, moet de publicatie opnieuw worden beoordeeld.

## Bij volgende wijzigingen

Werk de broncode in deze repository bij en commit op de standaardbranch. GitHub voert dezelfde tests en build opnieuw uit en publiceert na succes. Je hoeft geen nieuwe gebouwde ZIP of `dist` te uploaden.

## Lokale controles

Node.js 24.15+ is nodig. De huidige bouwomgeving gebruikt Node 24.19.0. De workflow kiest Node 24.

```text
npm ci
npm test
npm run build
```

Op 13 oktober 2026 is [GitHub-run 38451070287](https://github.com/Kadayif75/surplus/actions/runs/38451070287) geslaagd, inclusief tests, typecontrole, build en publicatie. Bij deze controle stond de Pages-bron nog op branchpublicatie en werd op de live URL bron-HTML gevonden. Kies GitHub Actions als bron en voer de workflow daarna opnieuw uit. De site hoort te laden vanaf https://kadayif75.github.io/surplus/; de gepubliceerde HTML moet naar `/surplus/assets/index-...js` verwijzen en niet naar `/src/main.tsx`.

De eerdere run stopte met `Segmentation fault (core dumped)` (exitcode 139) tijdens native PDF/canvas-tests. `npm test` gebruikt daarom nu `--pool forks`, zodat deze tests in afzonderlijke processen draaien. Alle tests blijven actief. Lokaal slagen 173 tests en de productiebuild; drie optionele tests met private bijlagen worden overgeslagen. Zie ook `BESTELLEN-TESTRESULTATEN.md` voor de verificatie en beperkingen.

Bronnen geraadpleegd op 30 september 2026: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [publicatiebron instellen](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [Vite-publicatie op GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages).
