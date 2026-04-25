import { Resend } from 'resend'

let resendClient: Resend | null = null

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }

  return resendClient
}

export async function sendFollowupEmail(to: string, contactName: string, cardName: string) {
  return getResendClient().emails.send({
    from: 'CRM <crm@speaqi.it>',
    to,
    subject: `Follow-up: ${cardName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#4f6ef7;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:20px">⚡ CRM</h1>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#374151">Ciao,</p>
          <p style="color:#374151">Questo è un promemoria di follow-up per <strong>${contactName}</strong> riguardo a <strong>${cardName}</strong>.</p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">Inviato da CRM</p>
        </div>
      </div>
    `,
  })
}

export async function sendReminderEmail(to: string, calls: Array<{ name: string; time: string }>) {
  const callList = calls
    .map(c => `<li style="margin-bottom:8px"><strong>${c.name}</strong>${c.time ? ` — ${c.time}` : ''}</li>`)
    .join('')

  return getResendClient().emails.send({
    from: 'CRM <crm@speaqi.it>',
    to,
    subject: `📅 Chiamate di oggi — ${new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#4f6ef7;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:20px">⚡ CRM — Reminder Chiamate</h1>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#374151">Ciao,</p>
          <p style="color:#374151">Ecco le chiamate pianificate per oggi:</p>
          <ul style="color:#374151;padding-left:20px">
            ${callList}
          </ul>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">Buon lavoro! — CRM</p>
        </div>
      </div>
    `,
  })
}

export async function sendCustomEmail(to: string, subject: string, html: string) {
  return getResendClient().emails.send({
    from: 'CRM <crm@speaqi.it>',
    to,
    subject,
    html,
  })
}

type QuoteContractMailPayload = {
  quoteNumber: string
  title: string
  customerName: string
  publicUrl: string
}

export async function sendQuoteContractAcceptanceEmail(
  to: string,
  { quoteNumber, title, customerName, publicUrl }: QuoteContractMailPayload
) {
  return getResendClient().emails.send({
    from: 'Speaqi <crm@speaqi.it>',
    to,
    subject: `Conferma accettazione contratto — Preventivo ${quoteNumber}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0f172a;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="color:#f8fafc;margin:0;font-size:18px">Speaqi</h1>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
          <p style="color:#374151">Ciao${customerName ? ` <strong>${customerName}</strong>` : ''},</p>
          <p style="color:#374151">abbiamo registrato l’accettazione delle condizioni contrattuali per l’offerta <strong>${title}</strong> (preventivo <strong>${quoteNumber}</strong>).</p>
          <p style="color:#374151">Puoi consultare in ogni momento il dettaglio qui:</p>
          <p><a href="${publicUrl}" style="color:#2563eb">Apri il preventivo</a></p>
          <p style="color:#6b7280;font-size:13px;margin-top:24px">TheBestItaly · Speaqi</p>
        </div>
      </div>
    `,
  })
}
