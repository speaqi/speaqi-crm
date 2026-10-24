import { createHash } from 'node:crypto'
import { officeMapQueue, officeMapSlot } from '@/lib/office/maps'
import { officeIsNaples } from '@/lib/office/director'
import type { AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeStudioRequest } from './maps-bridge'
import { addOfficeOutputOnce } from './shared'

function requestId(key: string) {
  const hex=createHash('sha256').update(key).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
/**
 * Quale mappa importare in questa corsa: si parte dalla posizione del turno
 * (rotazione equa fra i turni) e si salta chi è già stato importato nel turno.
 */
export function nextMapToImport(mapKeys: string[], slot: number, done: Set<string>): number | null {
  for (let step = 0; step < mapKeys.length; step += 1) {
    const index = (slot + step) % mapKeys.length
    if (!done.has(`mymaps:${slot}:${mapKeys[index]}`)) return index
  }
  return null
}
export function myMapsHandler(admin: any, options: { now?: () => Date; bridge?: typeof officeStudioRequest } = {}): AgentHandler {
  return async (ctx) => {
    const queue=officeMapQueue(ctx.agent.settings.queue || [])
    if (!queue.length) return {summary:'Nessuna My Maps in coda: nessuna spesa.'}
    const slot=officeMapSlot(options.now?.() || new Date())
    // Un import per mappa e per turno, non uno per turno in tutto: con la chiave
    // del solo turno una città accodata dopo il primo import aspettava due giorni.
    const keys=queue.map((map) => `mymaps:${slot}:${map.key}`)
    const existing=await admin.from('office_agent_outputs').select('output_key').eq('user_id',ctx.agent.user_id).eq('agent_id',ctx.agent.id).in('output_key',keys)
    if (existing.error) throw existing.error
    const done=new Set<string>((existing.data || []).map((row: { output_key: string }) => row.output_key))
    const next=nextMapToImport(queue.map((map) => map.key),slot,done)
    if (next===null) return {summary:'Ogni mappa in coda è già stata importata in questo turno di due giorni.'}
    const map=queue[next]
    const key=keys[next]
    // L'importazione riusa solo parser e store: nessuna chiamata a pagamento.
    // Ogni corsa importa una sola mappa, quindi il limite è 150 nuovi in totale.
    const ledger=await ctx.reserve(0)
    const result=await (options.bridge || officeStudioRequest)('/api/office/mymaps/run',{
      request_id:requestId(`${ctx.agent.user_id}:${key}:${map.key}`),slug:map.slug,city:map.city,...(map.source ? {source:map.source} : {})})
    const counts=['read','created','existing','duplicates','skipped','remaining'] as const
    if (!result || result.requested_slug!==map.slug || typeof result.slug!=='string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(result.slug)
      || officeIsNaples(result.slug) || result.city!==map.city || result.cost_cents!==0 || typeof result.ready!=='boolean'
      || counts.some((field) => !Number.isSafeInteger(result[field]) || result[field]<0) || result.created>150) throw new Error('Ricevuta import StudioMap non valida')
    await ctx.settle(ledger,0)
    const summary=`${map.city}: ${result.read} luoghi letti, ${result.created} nuovi, ${result.existing} già presenti, ${result.duplicates} scartati (doppioni); ${result.remaining} rimasti.`
    await addOfficeOutputOnce(admin,ctx,key,{kind:'report',title:`Import My Maps: ${map.city}`,body:{...result,summary,
      nota:'Costo 0 €: testi e verifica editoriale restano alla pipeline esistente; nessuna pubblicazione.'},target_table:'studiomap_maps',target_id:result.slug})
    if (result.ready) await addOfficeOutputOnce(admin,ctx,`mymaps:publish:${map.slug}:${slot}`,{kind:'proposal',title:`Pubblicare ${map.city}`,
      body:{map_slug:result.slug,ready:true,nota:'Gate StudioMap superato. La pubblicazione resta manuale.'},target_table:'studiomap_maps',target_id:result.slug})
    return {summary}
  }
}
export const runMyMaps: AgentHandler = (ctx) => myMapsHandler(createServiceRoleClient())(ctx)
