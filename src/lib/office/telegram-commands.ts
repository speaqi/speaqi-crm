/**
 * I comandi slash del bot Telegram: scorciatoie già pronte per gli ordini al Direttore.
 *
 * Un comando non apre una strada nuova: diventa la stessa frase che il titolare
 * scriverebbe a mano («/presentazione Visit Bergamo» → «Prepara la presentazione per
 * Visit Bergamo») e passa dal Direttore con le sue regole (prove, Napoli, budget, clic).
 * Le uniche eccezioni sono `/scheda`, che cerca e risponde con i link senza spendere,
 * `/todo`, che va al To Do anche col bot in modalità Direttore, e l'aiuto.
 *
 * Logica pura: la usa il webhook e la registrazione del menu (`setMyCommands`).
 */

export type TelegramCommandResult =
  /** Una frase da lavorare come ordine al Direttore. */
  | { kind: 'director'; command: string; text: string }
  /** Una frase per il To Do, anche con il bot in modalità Direttore. */
  | { kind: 'todo'; command: string; text: string }
  /** Una ricerca senza modello: risponde con i link alle schede. */
  | { kind: 'search'; command: string; query: string }
  /** Una risposta già scritta (aiuto, comando incompleto o sconosciuto). */
  | { kind: 'reply'; command: string; text: string }

type CommandSpec = {
  command: string
  /** La riga nel menu di Telegram (max 256 caratteri, qui sempre corta). */
  description: string
  /** L'esempio mostrato quando manca l'argomento e nell'aiuto. */
  usage: string
  /** Gruppo dell'aiuto. */
  group: 'Presentazioni' | 'Contatti ed enti' | 'Mappe' | 'Soldi' | 'Situazione' | 'Altro'
  /** Argomento obbligatorio? Senza, `build` riceve la stringa vuota. */
  needsArg: boolean
  build: (arg: string, options: { photo: boolean }) => TelegramCommandResult | null
}

const director = (command: string, text: string): TelegramCommandResult => ({ kind: 'director', command, text })

/** «Venezia 5», «5 Venezia», «Venezia»: la città e quanti partner (1-10, default 5). */
export function cityAndCount(arg: string, fallback = 5): { city: string; count: number } {
  let count = fallback
  const city = arg
    .replace(/(?:^|\s)(\d{1,2})(?=\s|$)/, (_, n) => {
      count = Math.min(10, Math.max(1, Number(n)))
      return ' '
    })
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim()
  return { city, count }
}

const MY_MAPS_LINK = /https?:\/\/\S+/i

export const TELEGRAM_COMMANDS: CommandSpec[] = [
  {
    command: 'presentazione', group: 'Presentazioni', needsArg: true,
    description: 'Presentazione per un ente (anche più nomi, o con foto)',
    usage: '/presentazione Visit Bergamo',
    build: (arg, { photo }) => director('presentazione', photo ? `Foto per la presentazione di ${arg}` : `Prepara la presentazione per ${arg}`),
  },
  {
    command: 'presentazioni', group: 'Presentazioni', needsArg: false,
    description: 'Scelgo io N destinazioni senza presentazione',
    usage: '/presentazioni 5',
    build: (arg) => {
      const n = Math.min(5, Math.max(1, Number.parseInt(arg, 10) || 5))
      return director('presentazioni', `Preparami ${n} presentazioni di destinazioni`)
    },
  },
  {
    command: 'presentazione_partner', group: 'Presentazioni', needsArg: true,
    description: 'Presentazione con la base Partner',
    usage: '/presentazione_partner Hotel Laguna, guida di Venezia',
    build: (arg) => director('presentazione_partner', `Presentazione partner per ${arg}`),
  },
  {
    command: 'manda', group: 'Presentazioni', needsArg: true,
    description: 'Rimandami il PDF di una presentazione',
    usage: '/manda Bibione',
    build: (arg) => director('manda', `Mandami la presentazione di ${arg}`),
  },
  {
    command: 'contatto', group: 'Contatti ed enti', needsArg: false,
    description: 'Nuovo contatto (anche con la foto del bigliettino)',
    usage: '/contatto Mario Rossi, Hotel Laguna, info@hotellaguna.it',
    build: (arg, { photo }) => (arg || photo ? director('contatto', arg ? `Nuovo contatto: ${arg}` : 'Nuovo contatto dal bigliettino') : null),
  },
  {
    command: 'ente', group: 'Contatti ed enti', needsArg: true,
    description: 'Aggiungi un ente a Tourism Intelligence e ai contatti',
    usage: '/ente Venezuela Tourism, sito venezuelatuya.com',
    build: (arg) => director('ente', `Aggiungi ${arg} a Tourism Intelligence e ai contatti`),
  },
  {
    command: 'partner', group: 'Contatti ed enti', needsArg: true,
    description: 'Trovami N partner per una città (max 10)',
    usage: '/partner Venezia 5',
    build: (arg) => {
      const { city, count } = cityAndCount(arg)
      return city ? director('partner', `Trovami ${count} partner per la mappa di ${city}`) : null
    },
  },
  {
    command: 'rinomina', group: 'Contatti ed enti', needsArg: true,
    description: 'Rinomina un ente (il vecchio nome resta alias)',
    usage: '/rinomina Vecchio nome in Nuovo nome',
    build: (arg) => (/\s+in\s+/i.test(arg) ? director('rinomina', `Rinomina ${arg}`) : null),
  },
  {
    command: 'scheda', group: 'Contatti ed enti', needsArg: true,
    description: 'Cerca contatto, ente o mappa e ti do il link',
    usage: '/scheda SNAV',
    build: (arg) => ({ kind: 'search', command: 'scheda', query: arg }),
  },
  {
    command: 'mappa', group: 'Mappe', needsArg: true,
    description: 'Costruisci una mappa (con il link My Maps)',
    usage: '/mappa Marsiglia https://www.google.com/maps/d/…',
    build: (arg) => {
      const link = MY_MAPS_LINK.exec(arg)?.[0] || null
      const city = arg.replace(MY_MAPS_LINK, ' ').replace(/[\s,;]+/g, ' ').trim()
      if (!city) return null
      return director('mappa', link ? `Costruisci la mappa di ${city}, ${link}` : `Costruisci la mappa di ${city}`)
    },
  },
  {
    command: 'controlla', group: 'Mappe', needsArg: true,
    description: 'Controllo qualità di una mappa',
    usage: '/controlla Barcellona',
    build: (arg) => director('controlla', `Controlla la mappa di ${arg}`),
  },
  {
    command: 'fattura', group: 'Soldi', needsArg: true,
    description: 'Bozza di fattura da un preventivo (non la invio)',
    usage: '/fattura PREV-2026-0012',
    build: (arg) => director('fattura', `Fammi la fattura per ${arg}`),
  },
  {
    command: 'approvato', group: 'Soldi', needsArg: true,
    description: 'Preventivo approvato: lo segno e preparo la fattura',
    usage: '/approvato PREV-2026-0012',
    build: (arg) => director('approvato', `Il cliente ha approvato ${arg}, fai la fattura`),
  },
  {
    command: 'stato', group: 'Situazione', needsArg: false,
    description: 'Come stiamo: piano di oggi, trattative, agenti',
    usage: '/stato',
    build: () => director('stato', 'Come stiamo?'),
  },
  {
    command: 'fiere', group: 'Situazione', needsArg: false,
    description: 'Prossime fiere, eventi e bandi',
    usage: '/fiere',
    build: () => director('fiere', 'Quali sono le prossime fiere?'),
  },
  {
    command: 'todo', group: 'Altro', needsArg: true,
    description: 'Attività nel To Do (anche aggiornamenti)',
    usage: '/todo domani chiamo Rossi',
    build: (arg) => ({ kind: 'todo', command: 'todo', text: arg }),
  },
  {
    command: 'ricorda', group: 'Altro', needsArg: true,
    description: 'Promemoria nel To Do e in Google Calendar',
    usage: '/ricorda venerdì alle 10 chiamare SNAV',
    build: (arg) => director('ricorda', `Ricordami ${arg}`),
  },
  {
    command: 'direttore', group: 'Altro', needsArg: false,
    description: 'Qualsiasi altra richiesta al Direttore',
    usage: '/direttore trovami gli enti del turismo del Portogallo',
    build: (arg, { photo }) => (arg || photo ? director('direttore', arg) : null),
  },
  {
    command: 'aiuto', group: 'Altro', needsArg: false,
    description: 'Elenco dei comandi',
    usage: '/aiuto',
    build: () => ({ kind: 'reply', command: 'aiuto', text: telegramCommandsHelp() }),
  },
]

/** Nomi alternativi accettati ma non mostrati nel menu. */
const ALIASES: Record<string, string> = {
  start: 'aiuto', help: 'aiuto', comandi: 'aiuto',
  deck: 'presentazione', pres: 'presentazione',
  nuovo: 'contatto', bigliettino: 'contatto',
  cerca: 'scheda', trova: 'scheda',
  qualita: 'controlla', stats: 'stato', status: 'stato',
  eventi: 'fiere', promemoria: 'ricorda', fatture: 'fattura',
}

/** Quello che si passa a `setMyCommands`: Telegram ne mostra al massimo 100. */
export function telegramMenu(): Array<{ command: string; description: string }> {
  return TELEGRAM_COMMANDS.map(({ command, description }) => ({ command, description: description.slice(0, 256) }))
}

export function telegramCommandsHelp(): string {
  const groups = new Map<string, CommandSpec[]>()
  for (const spec of TELEGRAM_COMMANDS) groups.set(spec.group, [...(groups.get(spec.group) || []), spec])
  const lines = ['Comandi pronti (tocca / per il menu). Funziona anche scrivere normalmente o mandare un vocale.', '']
  for (const [group, specs] of groups) {
    lines.push(group)
    for (const spec of specs) lines.push(`• ${spec.usage} — ${spec.description}`)
    lines.push('')
  }
  lines.push('Le proposte arrivano con «Approva» e «Rifiuta». Niente parte da solo: email, SDI, pubblicazioni e Napoli restano a te.')
  return lines.join('\n')
}

/**
 * «/presentazione Visit Bergamo» → l'ordine per il Direttore. `null` se il testo non è un
 * comando: si prosegue come prima (Direttore o To Do). Accetta «/cmd@NomeBot» dei gruppi.
 */
export function parseTelegramCommand(text: string, options: { photo?: boolean } = {}): TelegramCommandResult | null {
  const match = /^\s*\/([a-z_]+)(?:@\w+)?(?=\s|$)\s*([\s\S]*)$/i.exec(text || '')
  if (!match) return null
  const name = match[1].toLowerCase()
  const arg = match[2].trim().slice(0, 1000)
  const photo = !!options.photo
  const spec = TELEGRAM_COMMANDS.find((c) => c.command === (ALIASES[name] || name))
  if (!spec) {
    return { kind: 'reply', command: name, text: `Non conosco /${name}.\n\n${telegramCommandsHelp()}` }
  }
  const usage = () => ({ kind: 'reply' as const, command: spec.command, text: `Manca un pezzo. Scrivi così:\n${spec.usage}` })
  if (spec.needsArg && !arg) return usage()
  return spec.build(arg, { photo }) || usage()
}

type SearchContact = { id: string; name: string | null; company: string | null; status?: string | null }
type SearchEntity = { id: string; name: string; kind: string; country_code: string | null; contact_id: string | null }
type SearchMap = { name: string; stage_label: string; url: string | null }

/** La risposta di /scheda: un link per riga, nell'ordine contatti → enti → mappe. */
export function formatSchedaReply(
  query: string,
  found: { contacts: SearchContact[]; entities: SearchEntity[]; maps: SearchMap[] },
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/+$/, '')
  const lines: string[] = []
  if (found.contacts.length) {
    lines.push('Contatti')
    for (const c of found.contacts.slice(0, 6)) {
      const label = [c.name, c.company && c.company !== c.name ? c.company : null].filter(Boolean).join(' · ') || 'Senza nome'
      lines.push(`• ${label}${c.status ? ` (${c.status})` : ''}\n  ${base}/scheda/${c.id}`)
    }
  }
  if (found.entities.length) {
    if (lines.length) lines.push('')
    lines.push('Tourism Intelligence')
    for (const e of found.entities.slice(0, 5)) {
      const where = e.country_code ? ` · ${e.country_code}` : ''
      const crm = e.contact_id ? ` — nel CRM: ${base}/scheda/${e.contact_id}` : ''
      lines.push(`• ${e.name}${where}\n  ${base}/tourism?entity=${e.id}${crm}`)
    }
  }
  if (found.maps.length) {
    if (lines.length) lines.push('')
    lines.push('Mappe')
    for (const m of found.maps.slice(0, 5)) lines.push(`• ${m.name} — ${m.stage_label}${m.url ? `\n  ${m.url}` : ''}`)
  }
  if (!lines.length) return `Non trovo niente per «${query}». Prova con un altro nome, l’email o il telefono.`
  return [`Risultati per «${query}»:`, '', ...lines].join('\n')
}
