import type { OfficeOutput } from './office'
import { officeResultLink } from './office-activity'

export type InboxCategory = 'decisions' | 'documents' | 'notices'
export type InboxDocument = { id: string; title: string; status: string; version: number }
export type InboxOutput = OfficeOutput & { document?: InboxDocument | null }
export type InboxGroup = { id: string; category: InboxCategory; output: InboxOutput; ids: string[]; title: string; href: string | null }
export type InboxPage = { outputs: InboxOutput[]; total: number; offset: number }
export type InboxAction = 'acknowledge' | 'approved' | 'rejected'
export type InboxResult = { id: string; ok: boolean; error?: string }

/** Filtro PostgREST equivalente a officeOutputIsNotice, per i conteggi paginati. */
export const OFFICE_DECISIONS_FILTER = 'kind.neq.report,and(kind.eq.report,body->>action.not.is.null)'

/** Un rapporto senza azioni è un avviso, non un'autorizzazione operativa. */
export function officeOutputIsNotice(output: Pick<OfficeOutput, 'kind' | 'body'>) {
  return output.kind === 'report' && (output.body?.action === undefined || output.body?.action === null)
}
export function officeInboxGroups(outputs: InboxOutput[]): InboxGroup[] {
  const groups = new Map<string, InboxGroup>()
  for (const output of [...outputs].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))) {
    const notice = officeOutputIsNotice(output)
    const link = notice && output.target_table === 'tourism_decks' ? officeResultLink({ deck_id: output.target_id })
      : notice && output.target_table === 'invoices' ? officeResultLink({ invoice_id: output.target_id }) : null
    const key = link ? `${output.target_table}:${output.target_id}` : output.id
    const existing = groups.get(key)
    if (existing) { existing.ids.push(output.id); continue }
    groups.set(key, { id: key, output, ids: [output.id], category: link ? 'documents' : notice ? 'notices' : 'decisions',
      title: output.document?.title || output.title, href: link?.href || null })
  }
  return [...groups.values()]
}

export const INBOX_DOCUMENT_STATES: Record<string, string> = {
  ready: 'Da rivedere', approved: 'Già approvata', failed: 'Generazione da verificare', generating: 'In preparazione', draft: 'Bozza',
}
