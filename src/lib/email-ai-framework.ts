export type EmailAiFrameworkSettings = {
  speaqi_context?: string | null
  email_tone?: string | null
  email_target_audience?: string | null
  email_value_proposition?: string | null
  email_offer_details?: string | null
  email_proof_points?: string | null
  email_objection_notes?: string | null
  email_call_to_action?: string | null
  email_goal?: string | null
  email_strategy?: string | null
  email_positioning?: string | null
  email_do_not_say?: string | null
  email_case_studies?: string | null
  email_high_interest_segment?: string | null
  email_wine_core_message?: string | null
  email_public_sector_core_message?: string | null
}

/**
 * Master positioning for the wine vertical. It is NOT a template email: it is the
 * single concept every wine draft must carry, whatever angle the AI chooses.
 * Mental image: Cantina -> Speaqi -> tutto il mondo.
 */
const WINE_CORE_MESSAGE = [
  'MESSAGGIO CENTRALE — SPEAQI WINE',
  'Speaqi permette a una cantina di raccontare una volta il proprio mondo e renderlo accessibile a clienti, visitatori e buyer in oltre 50 lingue.',
  'Una cantina possiede gia un enorme patrimonio di informazioni e contenuti: storia aziendale, vini, schede tecniche, territorio, vitigni, abbinamenti, visite, degustazioni, fotografie, testi e video. Il problema e che queste informazioni sono distribuite tra sito, PDF, materiali commerciali, social e altri strumenti, e comunicarle in molti mercati significa tradurre, duplicare e aggiornare continuamente gli stessi contenuti.',
  'Speaqi parte da cio che la cantina possiede gia, lo organizza in un’unica base informativa e lo rende utilizzabile in molte lingue e attraverso diversi canali. Da un unico progetto la cantina puo avere: pagine web multilingua dedicate alla cantina e ai singoli vini; QR code su bottiglie, collarini, menu, materiale promozionale o in cantina; testi e schede prodotto multilingua; racconti audio nella lingua del cliente; video multilingua, anche partendo dai video gia realizzati; un AI Concierge che conosce la cantina, i vini e il territorio e risponde alle domande del cliente usando le informazioni del progetto.',
  'Il cliente non deve scaricare un’applicazione: arriva da una bottiglia, un QR, un link o una pagina web e accede ai contenuti nella propria lingua.',
  'Il QR non e il prodotto. La traduzione non e il prodotto. Il video non e il prodotto. L’AI Concierge non e il prodotto. Il valore di Speaqi e permettere alla cantina di avere un’unica fonte di conoscenza da cui distribuire tutto il proprio racconto, in ogni lingua e attraverso piu formati.',
  '',
  'CONCETTO DA FAR PASSARE NELLE EMAIL',
  'Immagine mentale: Cantina -> Speaqi -> tutto il mondo. La promessa si sintetizza cosi: “Voi raccontate la vostra cantina una volta. Speaqi la fa parlare con il mondo.” oppure “Tutto quello che gia raccontate della vostra cantina e dei vostri vini, disponibile in oltre 50 lingue.”',
  'Per rendere il concetto concreto usa l’esempio della bottiglia: un cliente prende una bottiglia, scansiona il QR e scopre nella propria lingua il vino, la cantina e il territorio, guarda un video, ascolta il racconto e fa domande all’AI Concierge.',
  '',
  'REGOLE PER LE EMAIL WINE',
  'Non presentare Speaqi come piattaforma di traduzione, generatore di QR code o “piattaforma AI”. Non aprire con un elenco di funzionalita. Non usare formule artificiali come “Ho notato che siete attivi nel settore vinicolo”, “potreste beneficiare di”, “soluzioni innovative per il settore”.',
  'Parti dal risultato per la cantina, poi rendi concreto il prodotto con uno scenario reale, passo dopo passo.',
  'Quando pertinente usa come prova sociale le cantine con cui Speaqi sta gia lavorando: San Salvatore, Dalibra e Leonarda Tardi. L’AI Concierge va citato come parte dell’esperienza, mai come prodotto principale.',
  'Per i contatti che hanno gia ricevuto una comunicazione precedente non ripresentare Speaqi da zero: richiama brevemente il contatto precedente e introduci qualcosa di nuovo o piu concreto. Se il contatto ha aperto ripetutamente le comunicazioni precedenti trattalo come lead ad alto interesse, ma non dichiarare mai di aver tracciato aperture, click o letture.',
  'L’obiettivo della prima risposta non e vendere l’abbonamento, ma ottenere un piccolo si: vedere un esempio, ricevere una demo o approfondire. CTA preferita: “Ti va se ti mando un esempio concreto?”. Se hai informazioni reali sulla cantina, personalizza l’esempio su un vino specifico: “Se vuoi, posso farti vedere direttamente come funzionerebbe su [Nome Vino]”.',
  '',
  'PRINCIPIO FINALE',
  'Prima di scrivere chiediti: “Sto vendendo una funzione di Speaqi oppure sto facendo capire alla cantina che tutto cio che gia racconta puo diventare accessibile al mondo nella lingua del cliente?”. Se stai vendendo QR, traduzioni, video o AI come elementi isolati, riscrivi l’email.',
  'Il messaggio che deve restare in testa al destinatario e: racconta la tua cantina una volta, Speaqi la fa parlare con il mondo.',
].join('\n')

/**
 * Master positioning for the public sector (Comuni, enti, territori).
 * Same logic as the wine one: one concept, not a template email.
 * Mental image: Comune -> Speaqi -> chiunque arrivi sul territorio.
 */
const PUBLIC_SECTOR_CORE_MESSAGE = [
  'MESSAGGIO CENTRALE — SPEAQI PUBBLICA AMMINISTRAZIONE',
  'Un Comune racconta una volta il proprio territorio e i propri servizi, e Speaqi li rende accessibili a visitatori e cittadini in oltre 50 lingue.',
  'Un Comune possiede gia un enorme patrimonio informativo: storia, monumenti, chiese, musei, sentieri e punti panoramici, prodotti tipici, itinerari, servizi al cittadino, orari, procedure, materiale turistico, fotografie e video. Il problema e che queste informazioni sono distribuite tra sito istituzionale, brochure, pannelli, totem, PDF, social e uffici, e renderle comprensibili a chi non parla italiano significa tradurre, ristampare e aggiornare continuamente gli stessi contenuti.',
  'Speaqi parte da cio che il Comune possiede gia, lo organizza in un’unica base informativa ufficiale e lo rende utilizzabile in molte lingue e su piu canali. Da un unico progetto il Comune puo avere: pagine multilingua su luoghi, itinerari e servizi; QR code su targhe, pannelli, materiale informativo e uffici; testi e schede multilingua; racconti audio nella lingua del visitatore; video multilingua, anche partendo dai video gia realizzati; un AI Concierge che risponde alle domande su territorio e servizi usando solo le informazioni presenti nel progetto.',
  'Il visitatore non deve scaricare un’applicazione: da un QR su una targa, da un link o da una pagina web accede ai contenuti nella propria lingua.',
  'Il QR non e il prodotto. La traduzione non e il prodotto. Il video non e il prodotto. L’AI Concierge non e il prodotto. Il valore di Speaqi e dare al Comune un’unica fonte ufficiale e aggiornabile da cui distribuire tutto il proprio racconto: un aggiornamento vale ovunque, senza ristampe e senza versioni divergenti.',
  '',
  'CONCETTO DA FAR PASSARE NELLE EMAIL',
  'Immagine mentale: Comune -> Speaqi -> chiunque arrivi sul territorio. La promessa si sintetizza cosi: “Il territorio lo raccontate una volta. Speaqi lo fa parlare con chi arriva, nella sua lingua.”',
  'Per rendere il concetto concreto usa uno scenario reale, passo dopo passo: un visitatore straniero davanti a una chiesa, a un punto panoramico o all’ingresso del paese inquadra il QR sulla targa e trova la storia del luogo nella propria lingua, ascolta il racconto, guarda un video e scopre cosa vedere nei dintorni. Variante altrettanto valida: un cittadino straniero che deve capire come funziona un servizio comunale lo trova spiegato nella sua lingua.',
  'Due leve specifiche del settore pubblico: accessibilita e inclusione (anche per i residenti stranieri, e contenuti audio per chi non legge o non vede bene) e nessuna ristampa di materiale quando un’informazione cambia.',
  '',
  'REGOLE PER LE EMAIL AL SETTORE PUBBLICO',
  'Non presentare Speaqi come piattaforma di traduzione, generatore di QR code o “piattaforma AI”. Non aprire con un elenco di funzionalita e non dire “La nostra piattaforma...”: parti dal risultato per il territorio.',
  'Vietate le formule artificiali: “Ho notato che...”, “potreste beneficiare di”, “soluzioni innovative”, “supportare le vostre esigenze comunicative”, “migliorare la vostra comunicazione digitale”. Sono frasi che qualunque fornitore potrebbe scrivere a qualunque Comune.',
  'Usa al massimo un elemento evergreen e verificato del territorio, mai eventi, feste, sagre o calendari stagionali. Se non hai un elemento verificato, non fingere: apri sul tema generale dei visitatori che non parlano italiano.',
  'Quando pertinente usa come prova sociale il Comune di Napoli e il GAL Molise, e la pagina dedicata https://speaqi.com/comuni. L’AI Concierge va citato come parte dell’esperienza, mai come prodotto principale.',
  'Forma sempre istituzionale (Lei, vostro Comune): mai dare del tu. Apri con “Buongiorno,” e, se non conosci il referente, chiedi cortesemente di essere indirizzato a chi segue turismo, cultura, comunicazione o accessibilita.',
  'CTA unica: una call di 15 minuti con la persona o l’ufficio competente. Non affiancarle altre richieste (“potrebbe avere senso approfondire”, “visiti il sito”, “mi faccia sapere”): una sola domanda a cui rispondere.',
  '',
  'PRINCIPIO FINALE',
  'Prima di scrivere chiediti: “Sto vendendo una funzione di Speaqi oppure sto facendo capire al Comune che tutto cio che gia racconta del proprio territorio puo diventare accessibile a chiunque arrivi, nella sua lingua?”. Se stai vendendo QR, traduzioni, video o AI come elementi isolati, riscrivi l’email.',
  'Il messaggio che deve restare in testa al destinatario e: il territorio lo raccontate una volta, Speaqi lo fa parlare con chi arriva.',
].join('\n')

/**
 * Baseline shared by the Email AI settings screen and every drafting path.
 * A user can refine any individual field; an empty field deliberately falls
 * back to this policy so a draft never reverts to generic marketing copy.
 */
export const DEFAULT_EMAIL_AI_FRAMEWORK: Required<EmailAiFrameworkSettings> = {
  speaqi_context:
    'Speaqi aiuta organizzazioni pubbliche e private a rendere il proprio patrimonio informativo accessibile, aggiornabile e distribuibile in qualsiasi lingua e su qualsiasi canale. Non e un semplice sistema di traduzione e non vende solo QR code. Trasforma contenuti, luoghi, prodotti, servizi, itinerari, eventi e informazioni in una base informativa unica, sempre aggiornata, distribuibile via web, QR code, audio, video e strumenti di intelligenza artificiale. L’utente accede automaticamente ai contenuti nella propria lingua, senza cercare versioni diverse o scaricare app. Per chi gestisce i contenuti significa un unico punto di aggiornamento, distribuzione centralizzata e analytics. Si applica a Comuni, Regioni, musei, enti culturali, GAL e DMO, consorzi, cantine, hotel, imprese, eventi, fiere, universita e organizzazioni multilingua. Non descrivere mai Speaqi come piattaforma AI: l’AI e uno strumento interno, non il valore principale. Il valore e una fonte informativa unica, affidabile e facilmente distribuibile. Non partire dalle funzionalita: parti dal problema del destinatario e presenta le funzioni solo dopo il beneficio. Il risultato e far percepire Speaqi come soluzione strategica, non come semplice software.',
  email_target_audience:
    'Prima identifica il destinatario e il suo ruolo. Adatta linguaggio, problema e valore: Pubbliche Amministrazioni (territorio, accessibilita, turismo, cultura, dati, inclusione); consorzi/associazioni (promozione, soci, internazionalizzazione); cantine/produttori (un unico racconto della cantina e dei singoli vini accessibile a clienti, visitatori e buyer in molte lingue: export, enoturismo, bottiglia e sala degustazione — vedi il messaggio centrale Wine); hotel (esperienza ospiti, richieste ripetitive, recensioni, upselling); musei/siti culturali (audioguide, multilingua, permanenza); aziende (comunicazione internazionale, fiere, onboarding, formazione).',
  email_value_proposition:
    'Parla del risultato, non delle funzionalita: rendere il territorio o il patrimonio accessibile a visitatori internazionali; una fonte ufficiale e un solo contenuto aggiornabile; meno duplicazioni, ristampe, tempi e costi operativi; distribuzione coerente ovunque; piu visibilita, accessibilita e dati utili. Non parlare di AI se non e strettamente necessario.',
  email_offer_details:
    'Non cercare di vendere direttamente. Proponi un primo passo semplice e pertinente: demo di 15 minuti, esempio reale sul loro territorio, primo contenuto gratuito, test su un QR, caso studio, presentazione dedicata o confronto senza impegno. Lo scopo e iniziare una conversazione, non ottenere un acquisto.',
  email_proof_points:
    'Usa soltanto prove presenti nel contesto o verificabili. Proof point fisso da citare nel footer di ogni email: Speaqi raccontato da Rai 3 (Mezzogiorno Italia) — https://www.youtube.com/watch?v=HMb5XQEY4cM. Altre prove ammesse se verificate: casi studio pubblicati, demo online, enti pubblici, turismo, formazione, partnership, QR o esempi visitabili. Non inventare mai numeri, clienti, risultati, partnership o casi studio.',
  email_objection_notes:
    'Anticipa i dubbi senza essere difensivo e senza criticare strumenti esistenti. Se hanno gia un sito: Speaqi non lo sostituisce, lo rende piu accessibile e distribuibile. Se hanno traduzioni: il tema e gestirle, aggiornarle e distribuirle. Se sembra complesso: un caricamento e un link. Se non hanno budget: proponi un pilota. Se non hanno stranieri: utile anche per italiani, accessibilita e crescita futura.',
  email_call_to_action:
    'Usa sempre una sola CTA, semplice e concreta, per ottenere un riscontro umano: chiedi se e possibile fissare una call di 15 minuti con la persona o l’ufficio piu adatto. Per esempio: “Sarebbe possibile organizzare una call di 15 minuti con la persona che segue questi temi?” oppure “Può indicarmi il referente con cui confrontarci 15 minuti?”. Non inserire piu di una richiesta e non chiedere l’acquisto.',
  email_tone:
    'Sembra scritta da una persona, mai da un software. Massimo 180 parole, paragrafi brevi, una sola idea per paragrafo. Niente marketing aggressivo, superlativi, punti esclamativi, emoji, formule standard (“Spero che questa email la trovi bene”), “leader di mercato”, “rivoluzionario” o “innovativo”. Personalizza sempre l’apertura e chiudi con una richiesta semplice.',
  email_goal:
    'L’obiettivo non e descrivere Speaqi o spiegare tutto: e far nascere curiosita e ottenere una risposta. L’email deve dimostrare di aver capito il destinatario, mettere a fuoco un suo problema, suggerire un miglioramento credibile e lasciare qualcosa da approfondire in call.',
  email_strategy:
    'Prima analizza destinatario, ruolo e contesto; individua il problema principale; collega Speaqi a quel problema. Parla prima del risultato e solo dopo presenta Speaqi come lo strumento che lo rende possibile. Se il contesto non consente una personalizzazione reale, non fingere: usa un aggancio onesto basato su settore, ruolo o provenienza. Per un follow-up, riprendi il filo della conversazione invece di ricominciare da capo.',
  email_positioning:
    'Speaqi non compete sui QR code, sulle traduzioni o sui chatbot: compete sulla gestione e distribuzione del patrimonio informativo. La narrativa deve essere sempre Problema → Visione → Beneficio → Speaqi. Mai Speaqi → Funzioni → Prezzo. Adatta il posizionamento: per una Regione e un’infrastruttura digitale territoriale; per un Comune, valorizzazione del territorio e accessibilita; per un museo, migliore fruizione del patrimonio; per una cantina, un unico racconto (storia, vini, territorio, visite) reso accessibile a clienti, visitatori e buyer in oltre 50 lingue, senza duplicare o ritradurre ogni volta; per un hotel, esperienza ospiti; per un’azienda, distribuzione di contenuti multilingua senza duplicazioni.',
  email_do_not_say:
    'Non usare mai: “siamo leader”, “rivoluzionario”, “innovativo”, “migliore piattaforma”, “soluzione unica al mondo”, “intelligenza artificiale avanzata”, “trasformazione digitale”. Evita termini troppo commerciali, superlativi e promesse non dimostrabili. Non parlare male dei concorrenti, non dire che Speaqi sostituisce sistemi esistenti: presentalo come uno strato che valorizza cio che il cliente possiede gia.',
  email_case_studies:
    'Referenze disponibili da proporre solo quando pertinenti: GAL Molise; Comune di Napoli; servizio Rai 3 (https://www.youtube.com/watch?v=HMb5XQEY4cM). Per il settore vino le cantine con cui Speaqi sta gia lavorando sono San Salvatore, Dalibra e Leonarda Tardi: citale come prova sociale, senza attribuire loro numeri o risultati non forniti. Per i soli contatti Comune (non per altri segmenti) puoi anche rimandare a https://speaqi.com/comuni. Non inventare progetti, risultati, numeri, link o allegati: se manca un dettaglio, limita l’email a proporre l’invio della referenza o del materiale di approfondimento.',
  email_high_interest_segment:
    'Il destinatario ha gia ricevuto una precedente comunicazione via email e l’ha aperta ripetutamente o cliccata: non trattarlo come un cold lead e non ripresentare Speaqi da zero. L’obiettivo e trasformare l’interesse gia manifestato in una conversazione. ' +
    'Vietato in qualsiasi forma, anche indiretta: dire o lasciare intuire che hai notato/tracciato un’apertura, un click, una lettura o un’interazione con una campagna/email/newsletter. Frasi come “ho notato che hai cliccato”, “ho visto che hai aperto”, “hai mostrato interesse per la nostra campagna/soluzione” sono vietate, con o senza numeri. ' +
    'Vietato inventare di aver incontrato il destinatario a una fiera, evento, stand o incontro se questo non e specificato esplicitamente nel contesto fornito: il nome di una lista o campagna CRM (es. “Vinitaly”, “Vinovino”, nomi di liste) e un’etichetta gestionale interna, mai la prova di un evento reale. Non citarlo come se fosse un evento a cui avete partecipato insieme. ' +
    'Apri il corpo presentandoti per nome e ruolo, per esempio “sono Massimo Morgante, fondatore di Speaqi”, poi richiama in modo naturale la comunicazione precedente e dai un motivo concreto per riscrivere (es. “perche credo sia molto piu semplice mostrarti concretamente cosa possiamo fare” invece di rispiegarlo a parole): “Ti avevo gia scritto qualche tempo fa…”, “Riprendo velocemente la mail che ti avevo mandato…”. ' +
    'Non aggiungere un blocco firma con nome e ruolo alla fine del corpo: lo aggiunge automaticamente il CRM con la firma Gmail collegata. Presentati per nome solo nell’apertura. ' +
    'Porta un esempio molto concreto e visivo di come funziona nella pratica (una situazione reale, passo dopo passo) invece di descrivere Speaqi in astratto o elencarne le funzionalita: per esempio “un cliente prende una vostra bottiglia, scansiona il QR e scopre il vino, la cantina e il territorio nella propria lingua, con testo, audio e video, e puo fare domande e ricevere risposte”. L’esempio serve a far capire il concetto centrale (raccontate la cantina una volta, Speaqi la fa parlare con il mondo), non a vendere il QR, la traduzione, il video o l’AI Concierge. ' +
    'Cita le referenze in modo naturale, come cantine con cui state gia lavorando sullo stesso modello: per il settore vino privilegia San Salvatore, Dalibra e Leonarda Tardi quando pertinenti. ' +
    'Se coerente con il contesto, menziona che avete selezionato un gruppo ristretto di cantine a cui offrire di provare il sistema gratuitamente se rispondono a questa email o vi contattano direttamente. ' +
    'CTA: per questo segmento non chiedere una call, offri invece di mandare un esempio concreto (“Ti va se ti mando un esempio concreto?”): se conosci un vino reale della cantina personalizzala (“Se vuoi, posso farti vedere direttamente come funzionerebbe su [Nome Vino]”). Deve restare una sola domanda semplice a cui sia facile rispondere: l’obiettivo e un piccolo si, non spiegare di nuovo il prodotto. ' +
    'Struttura: apertura con nome e motivo per riscrivere, poi l’esempio concreto, poi eventualmente le referenze e l’offerta di prova gratuita, poi la CTA a bassa frizione.',
  email_wine_core_message: WINE_CORE_MESSAGE,
  email_public_sector_core_message: PUBLIC_SECTOR_CORE_MESSAGE,
}

export function withEmailAiFramework<T extends EmailAiFrameworkSettings>(settings?: T | null) {
  return {
    ...DEFAULT_EMAIL_AI_FRAMEWORK,
    ...Object.fromEntries(
      Object.entries(settings || {}).filter(([, value]) => String(value || '').trim())
    ),
  } as Required<EmailAiFrameworkSettings> & T
}

export function buildEmailAiPolicy(settings?: EmailAiFrameworkSettings | null) {
  const effective = withEmailAiFramework(settings)
  return [
    `## Identita e Posizionamento di Speaqi\n${effective.speaqi_context}`,
    `## Posizionamento\n${effective.email_positioning}`,
    `## Cose da non dire\n${effective.email_do_not_say}`,
    `## Target ideale\n${effective.email_target_audience}`,
    `## Valore da comunicare\n${effective.email_value_proposition}`,
    `## Offerta / proposta\n${effective.email_offer_details}`,
    `## Prove e credibilita\n${effective.email_proof_points}`,
    `## Casi studio e referenze disponibili\n${effective.email_case_studies}\nSe pertinente, usa al massimo una referenza per rendere concreta l’email o proponine l’invio. Non citare una referenza senza essere certo che sia reale e adatta al destinatario.`,
    `## Obiezioni e limiti\n${effective.email_objection_notes}`,
    `## CTA preferita\n${effective.email_call_to_action}`,
    `## Tono email\n${effective.email_tone}`,
    `## Obiettivo dell’email\n${effective.email_goal}`,
    `## Strategia\n${effective.email_strategy}`,
  ].join('\n\n')
}
