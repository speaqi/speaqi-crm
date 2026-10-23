import { getSettings, loadProject } from './agency'
import { getTemplate, loadDeck } from './tourism-decks'
import { normalizeQuoteTemplate, quoteDraftFromTemplate } from '../commercial-proposal'
import { isUuid } from '../tourism'

/** Precompilazione autenticata: il destinatario viene dalla risorsa, mai dall'URL. */
export async function proposalQuoteContext(sb: any, userId: string, type: 'agency' | 'tourism', id: string) {
  if (!isUuid(id)) throw new Error('Riferimento proposta non valido')
  if (type === 'agency') {
    const [project, settings] = await Promise.all([loadProject(sb, userId, id), getSettings(sb, userId)])
    const { data: categories, error } = await sb.from('agency_service_categories').select('slug,name,description').eq('user_id', userId).in('slug', project.services)
    if (error) throw error
    const vars = { cliente: project.client_name, progetto: project.title, contatto: settings.contact, servizi: (categories || []).map((c: any) => c.name).join(', ') }
    return {
      type, id, title: project.title, client_name: project.client_name, contact_id: project.contact_id,
      draft: { ...quoteDraftFromTemplate(normalizeQuoteTemplate(settings.quote_template, type), vars, (categories || []).map((c: any) => ({ description: c.name, details: `${c.description}\n[DA VERIFICARE: perimetro e consegne]`, quantity: 1, unit_price: null }))), title: project.title }
    }
  }
  const deck = await loadDeck(sb, userId, id)
  // Il preventivo parte dal modello della base da cui è nata la presentazione.
  const { template } = await getTemplate(sb, userId, deck.template_kind)
  const name = deck.input.ente || deck.destination
  const vars = { ...template.vars, ...Object.fromEntries(Object.entries(deck.input).filter(([,v]) => v)), cliente: name, progetto: deck.title, destinazione: deck.destination }
  return {
    type, id, title: deck.title, client_name: name, contact_id: null,
    draft: {
      ...quoteDraftFromTemplate(normalizeQuoteTemplate(template.quote_template, type), vars, [{ description: `Progetto Tourism — ${name}`, details: '[DA VERIFICARE: modello economico, perimetro, inclusioni ed esclusioni]', quantity: 1, unit_price: null }]),
      title: deck.title, customer_name: name, customer_company: name
    }
  }
}
