import { NextRequest } from 'next/server'
import { sendQuoteContractAcceptanceEmail } from '@/lib/email'
import { errorMessage } from '@/lib/server/http'
import { createPublicServerClient } from '@/lib/server/supabase'

function absolutePublicUrl(request: NextRequest, token: string) {
  const q = `?id=${encodeURIComponent(token)}`
  try {
    const origin = new URL(request.url).origin
    if (origin && origin !== 'null') {
      return `${origin}/preventivo${q}`
    }
  } catch {
    // fall through
  }
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (base) {
    return `${base.replace(/\/$/, '')}/preventivo${q}`
  }
  return `/preventivo${q}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = String(body?.token || '').trim()
    const email = String(body?.email || '').trim().toLowerCase()

    if (!token) {
      return Response.json({ error: 'Token mancante' }, { status: 400 })
    }
    if (email.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Inserisci un indirizzo email valido' }, { status: 400 })
    }

    const supabase = createPublicServerClient()
    const { data, error } = await supabase.rpc('accept_public_quote_contract', {
      p_public_token: token,
      p_signer_email: email,
    })

    if (error) {
      return Response.json({ error: errorMessage(error, 'Operazione non riuscita') }, { status: 500 })
    }

    const row = data as {
      ok?: boolean
      error?: string
      already?: boolean
      quote_number?: string
      customer_name?: string
      title?: string
      signer_email?: string
    } | null

    if (!row?.ok) {
      if (row?.error === 'not_found') {
        return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })
      }
      if (row?.error === 'invalid_email') {
        return Response.json({ error: 'Inserisci un indirizzo email valido' }, { status: 400 })
      }
      return Response.json({ error: 'Operazione non riuscita' }, { status: 400 })
    }

    const publicUrl = absolutePublicUrl(request, token)
    if (!row.already) {
      try {
        await sendQuoteContractAcceptanceEmail(email, {
          quoteNumber: String(row.quote_number || ''),
          title: String(row.title || 'Preventivo Speaqi'),
          customerName: String(row.customer_name || ''),
          publicUrl,
        })
      } catch (mailError) {
        console.error('accept-contract: Resend', mailError)
        return Response.json(
          {
            success: true,
            warning: 'Accettazione registrata; l’email di conferma potrebbe non essere stata inviata. Contatta il team se necessario.',
            quote_number: row.quote_number,
          },
          { status: 200 }
        )
      }
    }

    return Response.json({
      success: true,
      already: Boolean(row.already),
      quote_number: row.quote_number,
      signer_email: row.signer_email,
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Operazione non riuscita') },
      { status: 500 }
    )
  }
}
