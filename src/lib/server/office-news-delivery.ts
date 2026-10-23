import { newsTelegramText } from '@/lib/office/news'
import { notificationChannel, sendNotificationText, type WhatsappSendResult } from './whatsapp'

/** Solo una rotta del titolare, mai il job pianificato, richiama questo invio. */
export async function deliverOfficeNews(admin:any,userId:string,outputId:string,options:{channel?:()=>string|null;send?:(text:string,options:{requiredChannel:'telegram'})=>Promise<WhatsappSendResult>}={}) {
  if((options.channel||notificationChannel)()!=='telegram') throw new Error('Configura il bot Telegram: nessun ripiego su WhatsApp')
  const claim=await admin.rpc('claim_office_news_delivery',{p_output_id:outputId,p_user_id:userId})
  if(claim.error) throw claim.error
  if(!claim.data?.claimed) return {sent:false,duplicate:true}
  let result:WhatsappSendResult
  try{result=await(options.send||sendNotificationText)(newsTelegramText(claim.data.body),{requiredChannel:'telegram'})}
  catch{result={ok:false,error:'Esito Telegram non verificabile'}}
  const recorded=await admin.rpc('record_office_news_delivery',{p_id:claim.data.id,p_user_id:userId,
    p_message_id:result.ok?result.providerMessageId||null:null,p_error:result.ok?null:result.error||'Esito incerto'})
  if(recorded.error) throw new Error('Esito Telegram da riconciliare: registrazione non riuscita, non riprovare automaticamente')
  if(!result.ok||!result.providerMessageId) throw new Error('Esito Telegram incerto: verificare il bot prima di qualsiasi nuovo tentativo')
  return {sent:true,duplicate:false}
}
