# Client Acumbamail

Client per l'API Acumbamail v1. Nessuna dipendenza oltre a `fetch`: la
cartella si copia intera in un altro progetto TypeScript e funziona.

```ts
import { createRecipientList, addSubscribers, createCampaign } from '@/lib/acumbamail'

const token = process.env.ACUMBAMAIL_AUTH_TOKEN!

const listId = await createRecipientList(token, {
  name: 'Campagna · 2026-09-01',
  senderEmail: 'nome@tuodominio.it',
  mergeTags: ['first_name', 'company', 'landing_url'],
})

await addSubscribers(token, listId, [
  { email: 'cliente@example.com', first_name: 'Anna', company: 'Acme', landing_url: 'https://…' },
])

// ATTENZIONE: questa chiamata invia. Non esiste una bozza.
const campaignId = await createCampaign(token, {
  listId,
  name: 'Campagna · 2026-09-01',
  subject: 'Oggetto',
  html: '<p>Buongiorno *|first_name|*…</p>',
  fromName: 'Nome Mittente',
  fromEmail: 'nome@tuodominio.it',
})
```

Serve solo `ACUMBAMAIL_AUTH_TOKEN`. Il mittente deve essere un indirizzo già
verificato nel pannello Acumbamail, altrimenti la creazione lista fallisce.

## Le cinque trappole

Sono tutte costate un guasto in produzione. Vale la pena leggerle prima di
riusare il modulo altrove.

**1. `field_type` accetta solo `text`.** `char`, `string` e `varchar` sembrano
ragionevoli e vengono rifiutati con `400 "<tipo> is not a valid data type"`.
Poiché una risposta non 2xx interrompe la creazione della lista, un tipo
sbagliato blocca l'intera campagna prima ancora di aggiungere i destinatari:
la lista resta creata e vuota, la campagna non nasce, e nessuna email parte.
È esattamente il modo in cui un invio da 100 destinatari è fallito in
silenzio.

**2. `createCampaign` invia, non prepara.** Al ritorno della chiamata le email
sono già in consegna. Ogni verifica va fatta prima: destinatari giusti, lista
non vuota, testo giusto. Dopo non si ferma.

**3. I merge tag vanno creati prima dei destinatari.** I valori inviati per
campi che non esistono nella lista vengono scartati senza errore, e la
campagna parte con i segnaposto vuoti.

**4. L'id di ritorno ha forme diverse a seconda della funzione.**
`createList` risponde `{"list_id": "…"}`, altre funzioni rispondono con un
numero nudo, con `{"id": …}`, con un oggetto annidato sotto `data`/`result`/
`response`, o con un oggetto la cui unica chiave è l'id stesso.
`acumbamailResponseId` le copre tutte. Non presumere una forma sola:
una creazione riuscita lato server letta come fallimento lascia risorse
orfane e interrompe la catena a metà.

**5. Ogni risposta non 2xx va trattata come fatale.** `callAcumbamail` lancia
`AcumbamailError` con stato e payload. Le funzioni che ignorano lo stato
falliscono in silenzio e il guasto si scopre molto più avanti, sotto forma di
lista vuota o statistiche che non tornano.

## Verificare senza inviare

`batchAddSubscribers` e `getListStats` non spediscono nulla. Per provare la
catena su una lista di scarto:

```ts
const listId = await createRecipientList(token, { name: 'ZZ prova', senderEmail: '…', mergeTags: ['first_name'] })
await addSubscribers(token, listId, [{ email: 'tu@example.com', first_name: 'Prova' }])
console.log(await getListStats(token, listId)) // total_subscribers deve essere 1
await deleteList(token, listId)
```

Se `total_subscribers` resta 0, i destinatari non sono entrati: fermarsi lì,
perché `createCampaign` su lista vuota fallisce dopo aver già creato la
campagna.

## Cosa non c'è

Il parsing dei payload del webhook (aperture, click, bounce, disiscrizioni)
resta fuori: è modellato sulle tabelle del CRM e non sarebbe portabile. La
registrazione del callback c'è, in `configureListWebhook`.
