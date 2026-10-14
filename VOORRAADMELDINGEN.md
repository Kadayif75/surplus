# Minimumvoorraad en e-mailmeldingen

14 oktober 2026. De lokale demo kan per product en voorraadruimte signaleren dat de voorraad op of onder het minimum staat. Een aparte lokale Node.js-server verstuurt de e-mail via Resend. Cloudflare is niet nodig.

## Gebruik

1. Open **Voorraadmeldingen**.
2. Geef Rood, Oranje en Groen ieder een standaardminimum in ongeopende verpakkingen. De standaard geldt voor ieder product in die ruimte. Een leeg veld betekent geen standaardgrens; `0` betekent melden zodra de voorraad nul is.
3. Gebruik desgewenst **Afwijkend minimum per product**. Een ingevuld productminimum vervangt de standaard voor dat product in die ruimte. Leeg laat de ruimtestandaard gelden.
4. Sla de minimumvoorraden op. Bestaande lage standen worden direct gesignaleerd. Het voorraadoverzicht markeert producten met **Bijbestellen**.
5. Stel onder **E-mailmeldingen** de mailserver en toegangscode in. Bij aanzetten wordt eerst de verbinding gecontroleerd. Daarna worden klaarstaande meldingen automatisch aangeboden.

Voorbeeld: minimum 5 geeft één melding bij 5 of minder. Verder afboeken naar 4 en 3 geeft geen extra mail. Na aanvullen boven 5 kan een volgende daling opnieuw een melding geven. Een pakbonontvangst telt mee als aanvulling. Een nieuwe instelling signaleert ook producten die al onder hun grens staan. Er worden geen bestellingen automatisch geplaatst.

Een nog niet verstuurde melding vervalt als de voorraad boven de grens komt of de grens wordt verwijderd. Een al verzonden of onderweg zijnde e-mail kan niet worden teruggehaald. De e-mail vermeldt daarom de voorraad en het tijdstip van signalering, en vraagt de actuele voorraad en openstaande bestellingen te controleren.

## Lokale mailserver instellen

Gebruik Node.js 24.15 of nieuwer. De mailserver gebruikt ingebouwde Node-functies; geen extra npm-pakketten zijn nodig.

1. Kopieer `.env.mail.example` naar `.env.mail` in de projectmap, tenzij dat bestand al bestaat.
2. Vul in `.env.mail` de instellingen in:
   - `RESEND_API_KEY`: een geldige, nieuwe Resend-sleutel met verzendrechten. Trek een in een chat gedeelde sleutel eerst in. Zet de sleutel nooit in `src`, `public`, een `VITE_`-variabele of GitHub-code.
   - `APP_TOKEN`: een aparte willekeurige toegangscode van minimaal 32 tekens. Bijvoorbeeld genereren met `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Gebruik hiervoor geen Resend-sleutel.
   - `ALERT_FROM`: `noreply@barbr.pw`. Het domein moet in Resend voor verzenden zijn geverifieerd.
   - `ALERT_TO`: de afgesproken ontvanger; meerdere adressen met komma's (maximaal vijf).
3. Start in een terminal `npm run mail:dev`. De mailserver luistert standaard uitsluitend op `http://127.0.0.1:8787`.
4. Start in een tweede terminal `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` en open `http://127.0.0.1:5173/surplus/`.
5. Vul in de app als mailserver `http://127.0.0.1:8787` in en als toegangscode de waarde van `APP_TOKEN`.
6. Kies **Testmail versturen** en controleer de inbox/ongewenste e-mail. Zet vervolgens e-mailmeldingen aan en sla op.

`.env.mail` en `server/.data/` worden door Git genegeerd. De app bewaart de toegangscode alleen in de sessie van het tabblad. Na sluiten van het tabblad kan opnieuw invoeren nodig zijn. De Resend-sleutel verlaat de server uitsluitend in het authenticatieverzoek naar Resend.

De mailserver ontvangt alleen productnaam, artikelnummer, ruimtenaam, minimum, gesignaleerde voorraad, tijdstip en melding-ID. Afzender en ontvangers worden uitsluitend op de server bepaald. Bewonersgegevens, Excel-documenten, pakbonfoto's en de volledige voorraad worden niet meegestuurd.

## Verzendgedrag en fouten

- De browser legt de melding en de voorraadmutatie in één IndexedDB-transactie vast. Een mislukte boeking veroorzaakt geen melding of gedeeltelijke mutatie.
- Automatisch verzenden gebeurt terwijl de app open is. Zonder verbinding blijft de wachtrij lokaal bewaard. Opnieuw proberen heeft oplopende wachttijden tot een uur. Online komen of heropenen hervat verwerking wanneer de toegangscode aanwezig is.
- Een lease beschermt tegen dubbele verwerking door meerdere tabbladen. Een onzekere netwerkuitkomst gebruikt bij retry dezelfde melding-ID en exact dezelfde inhoud.
- De server bewaart een verzendlogboek op schijf en geeft bij herhaling hetzelfde Resend-ID terug. Behoud `server/.data/mail-ledger.json`, ook na herstart. Draai één serverproces per logboek; dit is geen oplossing voor meerdere replicas.
- Resend bewaart idempotentiesleutels 24 uur. Een poging zonder opgeslagen verzendbewijs wordt daarom na 23 uur niet opnieuw naar Resend gestuurd. De app toont **Verzending onzeker** met de melding-ID. Controleer dan het verzendresultaat in Resend en regel de bestelling zo nodig handmatig.
- **Aangeboden aan Resend** bevestigt acceptatie door de API, niet aflevering in de inbox. Bounces en afleverstatussen worden nog niet via webhooks verwerkt.
- `MAIL_DAILY_LIMIT` beperkt standaard het aantal pogingen naar Resend tot 100 per UTC-dag, inclusief testmails en retries. Dit is een beschermingslimiet van deze server, geen weergave van je Resend-abonnement. Resend-quota gelden daarnaast.
- Een demo-reset wist ook minimumvoorraden en de lokale meldingenwachtrij. Het serverlogboek wordt niet door de app gewist.

## Lokaal en online

Een domein bij Resend dient voor de e-mailafzender; Resend host deze voorraadapp of Node.js-server niet. GitHub Pages kan de frontend blijven hosten. Voor verzenden vanaf de online app is een bereikbare HTTPS-mailserver nodig, met vaste opslag voor het logboek, geheimen in de hostingomgeving en de Pages-origin in `ALLOWED_ORIGINS`. Een lokale server op een pc is niet vanzelf bereikbaar vanaf een andere iPad.

Voor deze uitbreiding is lokaal gebruik afgesproken. De voorraad blijft per browser/apparaat opgeslagen. Er zijn geen centrale voorraadsynchronisatie, geplande achtergrondherinneringen bij een gesloten app of garantie dat medewerkers tijdig bestellen. E-mail is een signaal om voorraad en bestellingen te controleren.

## Techniek

Dexie-schema 4 voegt `alertSettings`, `alertStates` en `stockAlerts` toe zonder bestaande voorraad te verwijderen. `captureStockAlerts` wordt binnen de transacties voor handmatig boeken, pakbonontvangst en bestaande bestelservice uitgevoerd. `alertSender` verstuurt pas na vastlegging. `server/mailGateway.ts` controleert authenticatie, toegestane origins, invoer, vaste ontvangers en idempotentie. `server/fileStore.ts` schrijft het logboek via een tijdelijk bestand en atomische bestandsvervanging. Geheimen en servercode worden niet in de Vite-browserbundel opgenomen.

Tests: `src/tests/alerts.test.ts`, `src/tests/alerts.ui.test.tsx` en `src/tests/mailGateway.test.ts`. De server wordt met een nagebootste Resend-API getest; deze tests versturen geen echte e-mails.

Verificatie op 14 oktober 2026: 205 tests geslaagd, drie optionele private-bijlagetests overgeslagen, veertien testbestanden geslaagd. Typecontrole en productiebuild slagen. De 32 nieuwe tests controleren onder meer grenswaarden, productafwijkingen, herstel na aanvullen, rollback, dubbele tabbladen, retries, authenticatie, vaste ontvangers, persistent verzendbewijs en de onzekere uitkomst na de idempotentietermijn. Daarnaast heeft de lokaal ingestelde Resend-dienst één echte testmail geaccepteerd; aflevering in de inbox is niet door deze API-respons bewezen. Een controle van Git-kandidaten en de productiebuild vond geen Resend-sleutel of toegangscode.

Bron voor de idempotentietermijn: [Resend-documentatie](https://resend.com/docs/dashboard/emails/idempotency-keys).
