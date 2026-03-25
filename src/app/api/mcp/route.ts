import { NextRequest } from 'next/server'
import { sendCustomEmail } from '@/lib/email'
import { requireRouteUser } from '@/lib/server/supabase'

const TOOLS = [
  {
    name: 'search_contacts',
    description: 'Cerca contatti nel CRM relazionale',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_pipeline_status',
    description: 'Restituisce la distribuzione della pipeline per stadio',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_tasks_due',
    description: 'Restituisce i task pending ordinati per scadenza',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'update_contact_status',
    description: 'Aggiorna lo stadio di pipeline di un contatto',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['contact_id', 'status'],
    },
  },
  {
    name: 'create_contact',
    description: 'Crea un nuovo contatto con follow-up',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        status: { type: 'string' },
        next_followup_at: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['name', 'next_followup_at'],
    },
  },
  {
    name: 'send_email',
    description: 'Invia un’email manuale',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
]

async function handleTool(request: NextRequest, name: string, args: Record<string, unknown>) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) throw new Error('Unauthorized')

  switch (name) {
    case 'search_contacts': {
      const query = String(args.query || '').toLowerCase()
      const { data, error } = await auth.supabase
        .from('contacts')
        .select('id, name, status, source, priority, next_followup_at')
        .eq('user_id', auth.user.id)
        .or(`name.ilike.%${query}%,email.ilike.%${query}%,note.ilike.%${query}%`)
        .limit(10)

      if (error) throw error
      return JSON.stringify({ results: data || [] }, null, 2)
    }

    case 'get_pipeline_status': {
      const [{ data: stages, error: stagesError }, { data: contacts, error: contactsError }] =
        await Promise.all([
          auth.supabase.from('pipeline_stages').select('name, color').eq('user_id', auth.user.id).order('order', { ascending: true }),
          auth.supabase.from('contacts').select('status, priority, value').eq('user_id', auth.user.id),
        ])

      if (stagesError) throw stagesError
      if (contactsError) throw contactsError

      const summary = (stages || []).map((stage: any) => {
        const stageContacts = (contacts || []).filter((contact: any) => contact.status === stage.name)
        return {
          name: stage.name,
          count: stageContacts.length,
          high_priority: stageContacts.filter((contact: any) => Number(contact.priority) >= 3).length,
          value: stageContacts.reduce((sum: number, contact: any) => sum + Number(contact.value || 0), 0),
        }
      })

      return JSON.stringify({ pipeline: summary }, null, 2)
    }

    case 'get_tasks_due': {
      const { data, error } = await auth.supabase
        .from('tasks')
        .select('id, type, due_date, status, note, contact:contacts(name, status)')
        .eq('user_id', auth.user.id)
        .eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20)

      if (error) throw error
      return JSON.stringify({ tasks: data || [] }, null, 2)
    }

    case 'update_contact_status': {
      const { data, error } = await auth.supabase
        .from('contacts')
        .update({ status: String(args.status || '') })
        .eq('user_id', auth.user.id)
        .eq('id', String(args.contact_id || ''))
        .select('id, name, status')
        .single()

      if (error) throw error
      return JSON.stringify({ contact: data }, null, 2)
    }

    case 'create_contact': {
      const { data, error } = await auth.supabase
        .from('contacts')
        .insert({
          user_id: auth.user.id,
          name: String(args.name || '').trim(),
          status: String(args.status || 'New'),
          source: String(args.source || 'manual'),
          priority: 0,
          next_followup_at: String(args.next_followup_at || ''),
        })
        .select('id, name, status, next_followup_at')
        .single()

      if (error) throw error
      return JSON.stringify({ contact: data }, null, 2)
    }

    case 'send_email': {
      await sendCustomEmail(
        String(args.to || ''),
        String(args.subject || ''),
        `<p>${String(args.body || '')}</p>`
      )
      return JSON.stringify({ success: true }, null, 2)
    }

    default:
      return JSON.stringify({ error: `Tool "${name}" non riconosciuto` }, null, 2)
  }
}

export async function GET() {
  return Response.json({
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'speaqi-crm', version: '3.0.0' },
      tools: TOOLS,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
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
            serverInfo: { name: 'speaqi-crm', version: '3.0.0' },
          },
        })

      case 'tools/list':
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        })

      case 'tools/call': {
        const result = await handleTool(request, params?.name, params?.arguments || {})
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: result }],
          },
        })
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
      error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
    })
  }
}
