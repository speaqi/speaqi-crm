import type { CRMContact } from '@/types'

export function buildEmailSegmentGuidance(contact: CRMContact) {
  const source = String(contact.source || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const listName = String(contact.list_name || '').toLowerCase()
  const company = String(contact.company || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const name = String(contact.name || '').trim()
  const notes = String(contact.note || '').toLowerCase()

  const guidance: string[] = []

  if (
    source.includes('vinitaly') ||
    category.includes('vitigno') ||
    listName.includes('vinitaly') ||
    listName.includes('vitigno')
  ) {
    guidance.push(
      'Segmento vino/eventi: collega Speaqi a un caso d uso concreto come QR o link multilingua per schede prodotto, degustazioni, materiali fiera, export o visite in cantina.',
      'Non dire che il destinatario ha aperto o cliccato una precedente email e non fingere di averlo incontrato in fiera.'
    )
  }

  if (
    company.includes('comune') ||
    email.includes('.gov.') ||
    email.includes('comune.') ||
    email.startsWith('sindaco@') ||
    notes.includes('regione:')
  ) {
    guidance.push(
      'Ente pubblico o destinazione: usa il Lei e collega Speaqi a informazioni turistiche, culturali o di servizio accessibili in piu lingue tramite un solo link o QR.',
      'Evita tono da vendita aggressiva e non attribuire progetti o priorita specifiche non presenti nei dati.',
      'Se il contatto e un Comune, un ente o una casella istituzionale senza un referente personale certo, apri con “Buongiorno,” senza inventare un nome. Non presumere che chi legge sia il decisore: chiedi cortesemente se e possibile organizzare una call di 15 minuti con la persona o l’ufficio che segue turismo, cultura, comunicazione o accessibilita.'
    )
  }

  if (notes.includes('sales & marketing') || notes.includes('marketing manager')) {
    guidance.push(
      'Ruolo marketing/commerciale: concentra il messaggio sulla distribuzione internazionale di contenuti e materiali commerciali senza duplicare versioni e link.'
    )
  }

  if (/^[^\s]{18,}$/.test(name) || !name.includes(' ')) {
    guidance.push(
      'Il nome potrebbe essere concatenato, incompleto o aziendale: evita di usarlo nel saluto se non sei certo del nome proprio.'
    )
  }

  if (!contact.company && !contact.category && !contact.event_tag && !contact.email_draft_note) {
    guidance.push(
      'Il contesto e limitato: non simulare una personalizzazione. Usa il segmento o la provenienza disponibile e proponi un esempio concreto da valutare.'
    )
  }

  return guidance.join('\n')
}
