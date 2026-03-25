import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase'
import { sendCustomEmail } from '@/lib/email'

// ── MCP Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_contacts',
    description: 'Cerca contatti, card kanban, o nella rete SPEAQI',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termine di ricerca' },
        type: {
          type: 'string',
          enum: ['cards', 'contacts', 'speaqi', 'all'],
          description: 'Tipo di ricerca (default: all)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_pipeline_status',
    description: 'Restituisce lo stato attuale del kanban pipeline con statistiche per colonna',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_calls_today',
    description: 'Restituisce le chiamate pianificate per oggi',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_call',
    description: 'Pianifica una chiamata per una card specifica',
    inputSchema: {
      type: 'object',
      properties: {
        card_uid: { type: 'string', description: 'UID della card' },
        date: { type: 'string', description: 'Data in formato YYYY-MM-DD' },
        note: { type: 'string', description: 'Nota opzionale' },
      },
      required: ['card_uid', 'date'],
    },
  },
  {
    name: 'update_card_status',
    description: 'Cambia lo stato di una card nel kanban',
    inputSchema: {
      type: 'object',
      properties: {
        card_uid: { type: 'string', description: 'UID della card' },
        new_status: {
          type: 'string',
          enum: ['Da fare', 'Da Richiamare', 'In Attesa', 'In corso', 'Revisione', 'Completato', 'Non Interessato', 'Perso'],
          description: 'Nuovo stato',
        },
        note: { type: 'string', description: 'Nota opzionale sul cambio stato' },
      },
      required: ['card_uid', 'new_status'],
    },
  },
  {
    name: 'send_email',
    description: 'Invia un\'email a un contatto',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Email destinatario' },
        subject: { type: 'string', description: 'Oggetto email' },
        body: { type: 'string', description: 'Corpo email in HTML o testo' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'create_card',
    description: 'Crea una nuova card nel kanban',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'string', description: 'Nome della card (es. nome azienda/contatto)' },
        s: {
          type: 'string',
          enum: ['Da fare', 'Da Richiamare', 'In Attesa', 'In corso', 'Revisione', 'Completato', 'Non Interessato', 'Perso'],
          description: 'Stato iniziale (default: Da fare)',
        },
        p: { type: 'string', enum: ['Alta', 'Media', 'Bassa', ''], description: 'Priorità' },
        r: { type: 'string', description: 'Responsabile' },
        note: { type: 'string', description: 'Note' },
        price: { type: 'number', description: 'Valore in euro' },
      },
      required: ['n'],
    },
  },
  {
    name: 'get_high_priority',
    description: 'Restituisce tutti i contatti alta priorità da richiamare',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// ── Helper: get user state ────────────────────────────────────────────────────

async function getUserState() {
  const supabase = createClient()
  const { data: states } = await supabase
    .from('user_state')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)

  return states?.[0] || { cards: [], contacts: [], speaqi: [], call_done: {}, call_scheduled: {} }
}

async function saveUserState(state: Record<string, unknown>) {
  const supabase = createClient()
  const { data: existing } = await supabase
    .from('user_state')
    .select('user_id')
    .order('updated_at', { ascending: false })
    .limit(1)

  if (existing?.[0]) {
    await supabase.from('user_state').update({
      ...state,
      updated_at: new Date().toISOString(),
    }).eq('user_id', existing[0].user_id)
  }
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

type Card = { _u?: string; id?: string; n: string; s: string; p?: string; r?: string; d?: string; $?: string; note?: string }
type Contact = { _u?: string; n: string; ref?: string; role?: string; comune?: string; st: string; p?: string; cat: string; notes?: string }
type SpeaqiContact = { _u?: string; n: string; role?: string; cat: string; st: string; p?: string; note?: string }

async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  const state = await getUserState()
  const cards: Card[] = state.cards || []
  const contacts: Contact[] = state.contacts || []
  const speaqi: SpeaqiContact[] = state.speaqi || []
  const callScheduled: Record<string, string> = state.call_scheduled || {}
  const callDone: Record<string, boolean> = state.call_done || {}

  switch (name) {

    case 'search_contacts': {
      const query = String(args.query || '').toLowerCase()
      const type = String(args.type || 'all')
      const results: Record<string, unknown[]> = {}

      if (type === 'all' || type === 'cards') {
        results.cards = cards.filter(c =>
          c.n.toLowerCase().includes(query) ||
          (c.r || '').toLowerCase().includes(query) ||
          (c.note || '').toLowerCase().includes(query)
        ).slice(0, 10).map(c => ({
          uid: c._u, id: c.id, nome: c.n, stato: c.s, priorita: c.p, responsabile: c.r,
        }))
      }

      if (type === 'all' || type === 'contacts') {
        results.contacts = contacts.filter(c =>
          c.n.toLowerCase().includes(query) ||
          (c.role || '').toLowerCase().includes(query) ||
          (c.comune || '').toLowerCase().includes(query)
        ).slice(0, 10).map(c => ({
          uid: c._u, nome: c.n, ruolo: c.role, comune: c.comune, stato: c.st, cat: c.cat,
        }))
      }

      if (type === 'all' || type === 'speaqi') {
        results.speaqi = speaqi.filter(c =>
          c.n.toLowerCase().includes(query) ||
          (c.role || '').toLowerCase().includes(query)
        ).slice(0, 10).map(c => ({
          uid: c._u, nome: c.n, ruolo: c.role, cat: c.cat, stato: c.st,
        }))
      }

      const total = Object.values(results).reduce((s, arr) => s + arr.length, 0)
      return JSON.stringify({ query, total_results: total, ...results }, null, 2)
    }

    case 'get_pipeline_status': {
      const COLS = ['Da fare', 'Da Richiamare', 'In Attesa', 'In corso', 'Revisione', 'Completato', 'Non Interessato', 'Perso']
      const byCol = COLS.reduce((acc, col) => {
        const colCards = cards.filter(c => c.s === col)
        const value = colCards.filter(c => c.$).reduce((s, c) => s + Number(c.$), 0)
        acc[col] = { count: colCards.length, value, alta: colCards.filter(c => c.p === 'Alta').length }
        return acc
      }, {} as Record<string, { count: number; value: number; alta: number }>)

      const totalValue = cards.filter(c => c.$).reduce((s, c) => s + Number(c.$), 0)
      const altaPriority = cards.filter(c => c.p === 'Alta').length

      return JSON.stringify({
        pipeline: byCol,
        totale_card: cards.length,
        totale_valore: `€${totalValue.toLocaleString('it')}`,
        alta_priorita: altaPriority,
      }, null, 2)
    }

    case 'get_calls_today': {
      const todayStr = new Date().toISOString().split('T')[0]
      const callCards = cards.filter(c => c.s === 'Da Richiamare' || c.s === 'Da fare')
      const todayCalls = callCards.filter(c => callScheduled[c._u!] === todayStr)
      const done = todayCalls.filter(c => callDone[c._u! + '_' + todayStr])

      return JSON.stringify({
        data: todayStr,
        totale_chiamate: todayCalls.length,
        completate: done.length,
        da_fare: todayCalls.length - done.length,
        chiamate: todayCalls.map(c => ({
          uid: c._u,
          nome: c.n,
          responsabile: c.r,
          priorita: c.p,
          completata: !!callDone[c._u! + '_' + todayStr],
        })),
      }, null, 2)
    }

    case 'schedule_call': {
      const { card_uid, date, note: callNote } = args
      const card = cards.find(c => c._u === String(card_uid))
      if (!card) return JSON.stringify({ error: `Card ${card_uid} non trovata` })

      const newScheduled = { ...callScheduled, [String(card_uid)]: String(date) }
      await saveUserState({ ...state, call_scheduled: newScheduled })

      return JSON.stringify({
        success: true,
        message: `Chiamata per "${card.n}" pianificata il ${date}`,
        note: callNote,
      })
    }

    case 'update_card_status': {
      const { card_uid, new_status, note: statusNote } = args
      const cardIdx = cards.findIndex(c => c._u === String(card_uid))
      if (cardIdx === -1) return JSON.stringify({ error: `Card ${card_uid} non trovata` })

      const oldStatus = cards[cardIdx].s
      const updatedCards = [...cards]
      updatedCards[cardIdx] = { ...updatedCards[cardIdx], s: String(new_status) }
      await saveUserState({ ...state, cards: updatedCards })

      return JSON.stringify({
        success: true,
        card: cards[cardIdx].n,
        da: oldStatus,
        a: new_status,
        note: statusNote,
      })
    }

    case 'send_email': {
      const { to, subject, body: emailBody } = args
      const html = String(emailBody || '').includes('<') ? String(emailBody) : `<p>${String(emailBody)}</p>`
      await sendCustomEmail(String(to), String(subject), html)

      return JSON.stringify({
        success: true,
        message: `Email inviata a ${to}`,
      })
    }

    case 'create_card': {
      const newCard: Card = {
        _u: 'c' + Date.now(),
        id: '',
        n: String(args.n || ''),
        s: String(args.s || 'Da fare'),
        p: String(args.p || ''),
        r: String(args.r || ''),
        d: '',
        $: args.price ? String(args.price) : '',
        note: String(args.note || ''),
      }

      const updatedCards = [...cards, newCard]
      await saveUserState({ ...state, cards: updatedCards })

      return JSON.stringify({
        success: true,
        card: { uid: newCard._u, nome: newCard.n, stato: newCard.s },
        message: `Card "${newCard.n}" creata in "${newCard.s}"`,
      })
    }

    case 'get_high_priority': {
      const hotCards = cards.filter(c => c.p === 'Alta' && c.s === 'Da Richiamare')
      const hotContacts = contacts.filter(c => c.p === 'Alta')
      const hotSpeaqi = speaqi.filter(c => c.p === 'Alta' && c.st === 'da-contattare')

      return JSON.stringify({
        card_da_richiamare: hotCards.map(c => ({
          uid: c._u, id: c.id, nome: c.n, responsabile: c.r, note: c.note,
        })),
        contatti_alta: hotContacts.slice(0, 10).map(c => ({
          uid: c._u, nome: c.n, ruolo: c.role, comune: c.comune, cat: c.cat,
        })),
        speaqi_da_contattare: hotSpeaqi.map(c => ({
          uid: c._u, nome: c.n, ruolo: c.role, cat: c.cat,
        })),
      }, null, 2)
    }

    default:
      return JSON.stringify({ error: `Tool "${name}" non riconosciuto` })
  }
}

// ── MCP JSON-RPC 2.0 handler ─────────────────────────────────────────────────

export async function GET() {
  // Return MCP server info + tools list
  return Response.json({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'speaqi-crm', version: '2.0.0' },
      tools: TOOLS,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { jsonrpc, id, method, params } = body

    if (jsonrpc !== '2.0') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Invalid Request' },
      })
    }

    switch (method) {

      case 'initialize':
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'speaqi-crm', version: '2.0.0' },
          },
        })

      case 'tools/list':
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        })

      case 'tools/call': {
        const { name, arguments: toolArgs } = params || {}
        if (!name) {
          return Response.json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' },
          })
        }

        try {
          const result = await handleTool(name, toolArgs || {})
          return Response.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: result }],
            },
          })
        } catch (toolError) {
          return Response.json({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32603,
              message: `Tool error: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
            },
          })
        }
      }

      case 'notifications/initialized':
        return Response.json({ jsonrpc: '2.0', id, result: {} })

      default:
        return Response.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
    }
  } catch (error) {
    return Response.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    }, { status: 400 })
  }
}
