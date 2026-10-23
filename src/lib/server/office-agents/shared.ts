import type { AgentContext, AgentOutputInput } from '../office-agents'

/** Una segnalazione stabile non si moltiplica facendo ripartire l'agente.
 * La corsa unica e il controllo SQL sul run scaduto proteggono la verifica.
 */
export async function addOfficeOutputOnce(admin: any, ctx: AgentContext, key: string, output: AgentOutputInput) {
  const { data, error } = await admin.from('office_agent_outputs').select('id').eq('user_id', ctx.agent.user_id)
    .eq('agent_id', ctx.agent.id).eq('output_key', key).limit(1)
  if (error) throw error
  if (data?.length) return { id: data[0].id as string, created: false }
  return { id: await ctx.addOutput({ ...output, key }), created: true }
}

export function draftHtml(text: string) {
  return text.split('\n').map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') || '<br>'}</p>`).join('')
}

export async function officeEmailDraft(admin: any, ctx: AgentContext, input: { contactId: string; key: string; subject: string; text: string; note: string }) {
  const { data, error } = await admin.rpc('create_office_email_draft', { p_run_id: ctx.runId, p_contact_id: input.contactId,
    p_key: input.key, p_subject: input.subject, p_text: input.text, p_html: draftHtml(input.text), p_note: input.note })
  if (error) throw error
  return data as { id: string | null; created: boolean; reason?: string }
}
