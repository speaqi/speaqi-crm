/** Il contenuto di un'uscita dell'ufficio (bozza, proposta, report), leggibile da chi decide. */
const BODY_LABELS: Record<string, string> = { testo: 'Testo', text: 'Testo', subject: 'Oggetto', body: 'Contenuto', summary: 'Riepilogo', points: 'Punti', sources: 'Fonti', evidence: 'Fonti', proposal: 'Proposta',
  contact: 'Contatto', name: 'Nome', role: 'Ruolo', company: 'Azienda / ente', email: 'Email', phone: 'Telefono', website: 'Sito', city: 'Città', country: 'Paese',
  perche: 'Perché', card_text: 'Bigliettino', scartati: 'Dati lasciati fuori', ente_nel_catalogo: 'Ente nel catalogo', possibili_doppioni: 'Possibili doppioni', dopo_il_clic: 'Dopo il clic', brief: 'Richiesta' }
/** Campi tecnici del nuovo contatto: servono al server, non a chi decide. */
export const CONTACT_HIDDEN_KEYS = new Set(['action', 'order_id', 'category', 'entity_id', 'duplicate_ids', 'claimed_at'])

export function OutputBody({ value, hide }: { value: unknown; hide?: Set<string> }) {
  if (value === null || value === undefined) return <span>—</span>
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><OutputBody value={item} hide={hide} /></li>)}</ul>
  if (typeof value === 'object') return <dl>{Object.entries(value).filter(([key, item]) => !hide || (!hide.has(key) && item !== null && !(Array.isArray(item) && !item.length))).map(([key, item]) => <div key={key}><dt>{BODY_LABELS[key] || key.replace(/_/g, ' ')}</dt><dd><OutputBody value={item} hide={hide} /></dd></div>)}</dl>
  return <p>{typeof value === 'boolean' ? value ? 'Sì' : 'No' : String(value)}</p>
}
