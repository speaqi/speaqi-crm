export const WORK_STAGES = {
  qualify: 'Da qualificare',
  contact: 'Da contattare',
  contacted: 'Contatto avviato',
  proposal: 'Proposta',
  agreement: 'Accordo',
  waiting: 'In attesa',
  archived: 'Archiviato',
} as const
export const WORK_KINDS = {
  partner: 'Partner',
  territory: 'Territorio',
  segment: 'Segmento',
  opportunity: 'Opportunità',
  task: 'Attività',
} as const
export type WorkItem = {
  checklist: { label: string; done: boolean }[]
  id: string
  user_id: string
  kind: keyof typeof WORK_KINDS
  title: string
  parent_id: string | null
  entity_id: string | null
  source_opportunity_id: string | null
  source_key: string | null
  responsible_id: string | null
  collaborator_ids: string[]
  stage: keyof typeof WORK_STAGES
  next_action: string
  due_on: string | null
  reason: string
  country_code: string
  segment: string
  shared_context: string
  website: string
  version: number
  created_at: string
  updated_at: string
  acknowledged_at: string | null
}
export type WorkNote = {
  id: string
  item_id: string
  body: string
  visibility: 'internal' | 'shared'
  document_url: string
  created_at: string
  actor_id: string
}
export type WorkEvent = {
  id: string
  event: string
  actor_id: string
  created_at: string
  changes: Record<string, unknown>
}
export type WorkIdentity = {
  member_id: string | null
  access_kind: 'internal' | 'external' | 'owner'
}
export type WorkMember = {
  id: string
  name: string
  enabled: boolean
  access_kind: 'internal' | 'external'
}
export type WorkRule = {
  id: string
  name: string
  country_code: string
  segment: string
  member_ids: string[]
  enabled: boolean
}
export const closedWork = (item: Pick<WorkItem, 'stage'>) =>
  ['agreement', 'archived'].includes(item.stage)
export function workFlags(
  item: WorkItem,
  today = new Date().toISOString().slice(0, 10),
) {
  const open = !closedWork(item)
  return {
    overdue: open && Boolean(item.due_on && item.due_on < today),
    today: open && item.due_on === today,
    fresh: open && !item.acknowledged_at,
    stale:
      open &&
      new Date(item.updated_at).getTime() <
        Date.parse(`${today}T00:00:00Z`) - 14 * 86400000,
  }
}
export function draftWorkBrief(item: WorkItem, notes: WorkNote[]) {
  return `${item.title}\nStato: ${WORK_STAGES[item.stage]}\nContesto condiviso: ${item.shared_context || 'Da completare'}\nProssima azione: ${item.next_action}\nScadenza: ${item.due_on || 'Non prevista'}\nUltimi riscontri:\n${
    notes
      .slice(0, 5)
      .map((n) => `- ${n.body}`)
      .join('\n') || 'Nessuno'
  }`
}
