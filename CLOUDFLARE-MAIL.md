# Online mail via Cloudflare en Resend

De mailfunctie is op 14 oktober 2026 gepubliceerd als Worker:

`https://surplus-mail.mustafaatalay1234.workers.dev`

De frontend blijft op `https://kadayif75.github.io/surplus/`. Cloudflare bewaart de servergeheimen en verzendbewijzen; Resend verstuurt de e-mails. Deze opzet gebruikt een SQLite-backed Durable Object dat beschikbaar is op het Workers Free-plan. Er wordt geen betaald abonnement of betaald opslagproduct door de deployment geactiveerd. De gratis quota van Cloudflare en Resend blijven gelden. [Cloudflare-prijzen](https://developers.cloudflare.com/workers/platform/pricing/), [Resend-prijzen](https://resend.com/pricing).

## In de app aanzetten

1. Open de GitHub Pages-app in de browser waarin de voorraad wordt bijgehouden.
2. Ga naar **Voorraadmeldingen → E-mailmeldingen → Verbinding met de mailserver**.
3. Zet de mailserver-URL op `https://surplus-mail.mustafaatalay1234.workers.dev`.
4. Gebruik als toegangscode de waarde van `APP_TOKEN` uit het lokale `.env.mail`, niet de Resend-sleutel.
5. Zet e-mailmeldingen aan en sla op. Stel ook de minimumvoorraden in en sla die op.

De ontvanger en Resend-sleutel staan uitsluitend als secrets bij Cloudflare. De afzender is `noreply@barbr.pw`. Een testmail is via de online functie door Resend geaccepteerd. De herhaalde aanvraag gaf hetzelfde verzendbewijs terug. De `/health`-controle met toegangscode slaagt; zonder toegangscode volgt HTTP 401. De preflight vanaf de GitHub Pages-origin volgt HTTP 204.

De lokale Node.js-mailserver hoeft voor online verzending niet te draaien. De app moet wel open zijn om lokale voorraadmeldingen aan de Worker door te geven. Voorraad en drempels blijven per browser opgeslagen; Cloudflare voegt geen centrale voorraadsynchronisatie toe. Zonder invoeren van de toegangscode in een nieuw tabblad kunnen meldingen klaar blijven staan.

## Ontwikkelen en opnieuw publiceren

Gebruik Node 24.15+ en de vastgelegde Wrangler-versie uit `package-lock.json`:

```text
npm ci
npx wrangler login
npx wrangler deploy --dry-run
npm run mail:deploy
```

Na een eerste publicatie kunnen de lokale geheimen veilig via stdin naar Cloudflare worden gezet:

```text
npm run mail:secrets
```

Dit leest uitsluitend `RESEND_API_KEY`, `APP_TOKEN` en `ALERT_TO` uit het genegeerde `.env.mail`. Het script toont de geheime waarden niet. Een normale nieuwe deployment behoudt bestaande secrets. Zet geen `.env.mail` of toegangscode in `wrangler.jsonc`, Git of `VITE_`-variabelen.

`wrangler.jsonc` bindt één vast `MailGateway`-object met de SQLite-migratie `v1`. De klasse hergebruikt de geteste gateway en bewaart elke melding onder een eigen sleutel, plus een globale dagteller. Requests worden binnen hetzelfde object geserialiseerd. Bewaar deze namespace en migratiehistorie; verwijderen zou verzendbewijzen wissen. Cloudflare ondersteunt de `manual`-redirectmodus; de gateway weigert redirects door niet-succesvolle responses als fout te behandelen en volgt ze niet met de Resend-sleutel.

`npm run mail:worker:dev` start de Worker lokaal op poort 8788. Voor lokale Worker-tests kun je geheimen in het genegeerde `.dev.vars` zetten. De oorspronkelijke `npm run mail:dev`-route blijft beschikbaar voor lokaal gebruik met Node.

## Grenzen

- Eén melding per lage-voorraadperiode en veilige retries; geen automatische leveranciersbestelling.
- E-mailacceptatie door Resend bewijst geen aflevering in de inbox.
- De server begrenst pogingen op 100 per UTC-dag. Dat verandert de quota van Resend niet.
- Resend-idempotentie geldt 24 uur; een onzekere poging ouder dan 23 uur wordt niet blind herhaald.
- Alleen de geconfigureerde website-origins en toegangscode mogen de functie gebruiken. Browser-origins bevatten geen pad zoals `/surplus/`.

Zie ook [VOORRAADMELDINGEN.md](VOORRAADMELDINGEN.md).

Controle bij oplevering: 209 tests geslaagd, drie optionele private-bijlagetests overgeslagen; typecontrole en productiebuild geslaagd. Ook de echte online mailproef, authenticatie, browser-preflight en herhaalde aanvraag met hetzelfde verzendbewijs zijn gecontroleerd. Geheimen zijn niet gevonden in repositorybestanden of de productiebuild. Fysiek iPad-gebruik en aflevering in de inbox zijn hiermee niet bewezen.
