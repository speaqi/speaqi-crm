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
}

/**
 * Baseline shared by the Email AI settings screen and every drafting path.
 * A user can refine any individual field; an empty field deliberately falls
 * back to this policy so a draft never reverts to generic marketing copy.
 */
export const DEFAULT_EMAIL_AI_FRAMEWORK: Required<EmailAiFrameworkSettings> = {
  speaqi_context:
    'Speaqi aiuta organizzazioni pubbliche e private a rendere il proprio patrimonio informativo accessibile, aggiornabile e distribuibile in qualsiasi lingua e su qualsiasi canale. Non e un semplice sistema di traduzione e non vende solo QR code. Trasforma contenuti, luoghi, prodotti, servizi, itinerari, eventi e informazioni in una base informativa unica, sempre aggiornata, distribuibile via web, QR code, audio, video e strumenti di intelligenza artificiale. L’utente accede automaticamente ai contenuti nella propria lingua, senza cercare versioni diverse o scaricare app. Per chi gestisce i contenuti significa un unico punto di aggiornamento, distribuzione centralizzata e analytics. Si applica a Comuni, Regioni, musei, enti culturali, GAL e DMO, consorzi, cantine, hotel, imprese, eventi, fiere, universita e organizzazioni multilingua. Non descrivere mai Speaqi come piattaforma AI: l’AI e uno strumento interno, non il valore principale. Il valore e una fonte informativa unica, affidabile e facilmente distribuibile. Non partire dalle funzionalita: parti dal problema del destinatario e presenta le funzioni solo dopo il beneficio. Il risultato e far percepire Speaqi come soluzione strategica, non come semplice software.',
  email_target_audience:
    'Prima identifica il destinatario e il suo ruolo. Adatta linguaggio, problema e valore: Pubbliche Amministrazioni (territorio, accessibilita, turismo, cultura, dati, inclusione); consorzi/associazioni (promozione, soci, internazionalizzazione); cantine/produttori (export, storytelling, enoturismo, QR in bottiglia); hotel (esperienza ospiti, richieste ripetitive, recensioni, upselling); musei/siti culturali (audioguide, multilingua, permanenza); aziende (comunicazione internazionale, fiere, onboarding, formazione).',
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
    'Speaqi non compete sui QR code, sulle traduzioni o sui chatbot: compete sulla gestione e distribuzione del patrimonio informativo. La narrativa deve essere sempre Problema → Visione → Beneficio → Speaqi. Mai Speaqi → Funzioni → Prezzo. Adatta il posizionamento: per una Regione e un’infrastruttura digitale territoriale; per un Comune, valorizzazione del territorio e accessibilita; per un museo, migliore fruizione del patrimonio; per una cantina, storytelling e internazionalizzazione; per un hotel, esperienza ospiti; per un’azienda, distribuzione di contenuti multilingua senza duplicazioni.',
  email_do_not_say:
    'Non usare mai: “siamo leader”, “rivoluzionario”, “innovativo”, “migliore piattaforma”, “soluzione unica al mondo”, “intelligenza artificiale avanzata”, “trasformazione digitale”. Evita termini troppo commerciali, superlativi e promesse non dimostrabili. Non parlare male dei concorrenti, non dire che Speaqi sostituisce sistemi esistenti: presentalo come uno strato che valorizza cio che il cliente possiede gia.',
  email_case_studies:
    'Referenze disponibili da proporre solo quando pertinenti: GAL Molise; Comune di Napoli; servizio Rai 3 (https://www.youtube.com/watch?v=HMb5XQEY4cM). Per i soli contatti Comune (non per altri segmenti) puoi anche rimandare a https://speaqi.com/comuni. Non inventare progetti, risultati, numeri, link o allegati: se manca un dettaglio, limita l’email a proporre l’invio della referenza o del materiale di approfondimento.',
  email_high_interest_segment:
    'Se il destinatario ha gia ricevuto una precedente comunicazione e l’ha aperta ripetutamente o cliccata, non trattarlo come un cold lead e non ripresentare Speaqi da zero: l’obiettivo e trasformare l’interesse gia manifestato in una conversazione. Non dire esplicitamente che ha aperto la mail piu volte o quante volte, puo risultare invasivo: fai invece riferimento naturale alla comunicazione precedente, per esempio “Ti avevo scritto qualche giorno fa…”, “Riprendo velocemente la mail che ti avevo mandato…”, “Ti riscrivo perche credo che per la vostra cantina possa esserci un’applicazione molto concreta.” Porta subito un elemento nuovo: esempio reale, applicazione concreta, referenza dello stesso settore, demo o possibilita di vedere Speaqi applicato a uno dei loro vini. Per il settore vino privilegia come referenze San Salvatore 1988, Dalibra e Leonarda Tardi quando pertinenti. Non descrivere di nuovo tutte le funzionalita di Speaqi: il destinatario ha gia ricevuto una prima comunicazione. Struttura: richiamo alla precedente email, poi motivo concreto per cui riscrivi, poi una prova/esempio, poi una CTA molto semplice. Usa una sola CTA, preferibilmente una domanda a cui sia facile rispondere: l’obiettivo e ottenere una risposta, non spiegare di nuovo il prodotto.',
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
