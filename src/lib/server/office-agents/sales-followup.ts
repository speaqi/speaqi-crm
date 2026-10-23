import { createEmailDraftRecord, type GeneratedEmail } from '../email-drafts'
import { callModel, type AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeRows } from '../office-read'
import { selectByIdChunks } from '../http'
import { addOfficeOutputOnce, officeEmailDraft } from './shared'
import { officeRomeDay } from '@/lib/office/finance'
import { SALES_DAILY_CAP, selectSalesCandidates, salesDraftNumbersAllowed, type SalesMessage, type SalesSignature } from '@/lib/office/sales-followup'
import { RAI3_FOOTER_TEXT, SPEAQI_COMUNI_URL, SPEAQI_RAI3_URL } from '../email-draft-context'
import type { CRMContact, Deal, GmailMessage, Quote, Task } from '@/types'

function ilikeEmail(email: string) { return email.trim().replace(/[\\%_]/g, (v) => `\\${v}`) }
export function salesFollowupHandler(admin: any, options: { now?: () => Date; generate?: typeof createEmailDraftRecord } = {}): AgentHandler {
  return async (ctx) => {
    const now = options.now?.() || new Date()
    const userId = ctx.agent.user_id
    const contacts = await officeRows<CRMContact>(admin, userId, 'contacts', '*', (q) => q.eq('contact_scope','crm').eq('hidden',false).is('email_unsubscribed_at',null))
    const ids = contacts.map((c) => c.id)
    const byIds = <T>(table: string, columns = '*', filter?: (query: any) => any) => selectByIdChunks<T>(ids, 100, (group, range) => {
      let query = admin.from(table).select(columns).eq('user_id', userId).in('contact_id', group).order('id').range(range.from,range.to)
      if (filter) query=filter(query)
      return query
    })
    const [quotes, deals, tasks, messages, pending, previous, quota] = await Promise.all([
      byIds<Quote>('quotes'), byIds<Deal>('deals','*',(q) => q.is('closed_at',null)), byIds<Task>('tasks','id,contact_id,due_date,status',(q) => q.eq('status','pending')),
      byIds<SalesMessage>('gmail_messages','id,contact_id,direction,sent_at,from_email,to_emails,created_at'),
      byIds<{ contact_id: string }>('email_drafts','id,contact_id',(q) => q.eq('status','pending')),
      officeRows<{ office_key: string; created_at: string }>(admin,userId,'email_drafts','id,office_key,created_at',(q) => q.eq('office_agent_id','sales_followup')),
      admin.from('office_agent_daily_quotas').select('used_count').eq('user_id',userId).eq('agent_id','sales_followup').eq('day',officeRomeDay(now)).maybeSingle(),
    ])
    const signatures = await selectByIdChunks<SalesSignature>(quotes.map((q) => q.id),100,(group,range) => admin.from('quote_signatures').select('quote_id,signed_at,id').eq('user_id',userId).in('quote_id',group).order('id').range(range.from,range.to))
    if (quota.error) throw quota.error
    const createdToday = Math.max(Number(quota.data?.used_count) || 0, previous.filter((d) => officeRomeDay(new Date(d.created_at)) === officeRomeDay(now)).length)
    const candidates = selectSalesCandidates({ contacts, quotes, deals, tasks, messages, signatures, pendingContactIds: pending.map((d) => d.contact_id), existingKeys: previous.map((d) => d.office_key), createdToday },now)
    const counts = { unsigned:0, unpaid:0, renewal:0, followup:0, stale_deal:0 }
    let created=0
    const draftIds: string[]=[]
    for (const candidate of candidates) {
      const hasNewReply = async () => {
        const { data, error }=await admin.from('gmail_messages').select('id').eq('user_id',userId).eq('direction','inbound')
          .ilike('from_email',ilikeEmail(candidate.contact.email!)).gt('sent_at',candidate.latestOutbound || '1970-01-01T00:00:00Z').limit(1)
        if (error) throw error
        return Boolean(data?.length)
      }
      if (await hasNewReply()) continue
      const { data: recent, error: recentError }=await admin.from('gmail_messages').select('*').eq('user_id',userId).eq('contact_id',candidate.contact.id).order('sent_at',{ascending:false}).limit(50)
      if (recentError) throw recentError
      const sourceData=JSON.stringify({ contact:candidate.contact, note:candidate.note, quotes:quotes.filter((q) => q.contact_id===candidate.contact.id), deals:deals.filter((d) => d.contact_id===candidate.contact.id), messages:recent,
        condizioni_verificate: 'Piattaforma 99 EUR/mese o 990 EUR/anno per progetto; appuntamento proposto di 15 minuti', footer_verificato:RAI3_FOOTER_TEXT, links:[SPEAQI_COMUNI_URL,SPEAQI_RAI3_URL] })
      const result=await (options.generate || createEmailDraftRecord)(admin,userId,candidate.contact,candidate.note,{
        forceFollowup:true, source:'office', skipPublicResearch:true, messages:[...(recent || [])].reverse() as GmailMessage[],
        modelCall: async ({system,user}) => {
          const response=await callModel(ctx,{ model: typeof ctx.agent.settings.model==='string' ? ctx.agent.settings.model : ctx.agent.model,
            input:`${system}\n\n${user}`, maxOutputTokens:4096 })
          return response.text
        },
        persist: async (generated: GeneratedEmail) => {
          if (!salesDraftNumbersAllowed(`${generated.subject}\n${generated.body_text}`,sourceData)) throw new Error('Bozza scartata: contiene numeri senza riscontro nelle fonti CRM')
          const allowedLinks=new Set(sourceData.match(/https?:[^\s"<>]+/g) || [])
          const links=generated.body_text.match(/https?:\/\/[^\s<>]+/g) || []
          if (links.some((url) => !allowedLinks.has(url.replace(/[),.;]+$/,'')))) throw new Error('Bozza scartata: link non presente nelle fonti')
          if (await hasNewReply()) return { draftId:null,created:false }
          const draft=await officeEmailDraft(admin,ctx,{ contactId:candidate.contact.id,key:candidate.key,subject:generated.subject,text:generated.body_text,note:candidate.note })
          return { draftId:draft.id,created:draft.created }
        },
      })
      if ('error' in result && result.error) throw new Error(result.error)
      if ('created' in result && result.created && result.draftId) {
        created++; counts[candidate.reason]++; draftIds.push(result.draftId)
        await addOfficeOutputOnce(admin,ctx,`output:${candidate.key}`,{ kind:'draft_email',title:`Bozza da rivedere: ${candidate.contact.company || candidate.contact.name}`,
          body:{ motivo:candidate.note,email_draft_id:result.draftId,fonti:{contact_id:candidate.contact.id,quote_id:candidate.quoteId || null,deal_id:candidate.dealId || null} },target_table:'email_drafts',target_id:result.draftId })
      }
      if (created+createdToday>=SALES_DAILY_CAP) break
    }
    await addOfficeOutputOnce(admin,ctx,`sales:report:${officeRomeDay(now)}:${ctx.runId}`,{kind:'report',title:'Bozze commerciali preparate',body:{bozze_create:created,dettaglio:counts,email_draft_ids:draftIds,nota:'Solo bozze locali da rivedere e inviare a mano.'}})
    return {summary:`Preparate ${created} bozze: ${counts.unsigned} preventivi da firmare, ${counts.unpaid} pagamenti, ${counts.followup+counts.stale_deal} follow-up, ${counts.renewal} rinnovi`}
  }
}
export const runSalesFollowup: AgentHandler = (ctx) => salesFollowupHandler(createServiceRoleClient())(ctx)
