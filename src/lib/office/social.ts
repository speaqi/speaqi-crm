import { safePublicUrl } from '../tourism'
import { officeIsNaples } from './director'
export const SOCIAL_PLATFORMS=['instagram','linkedin','facebook'] as const
export type SocialPlatform=typeof SOCIAL_PLATFORMS[number]
export type SocialGuide={id:string;slug:string;name:string;url:string;points:number|null;languages:string[]|null;routes:number|null;
  audio_minutes:number|null;photo_urls:string[];published_at:string|null;source_url:string;changes:string[]}
export type SocialCopy={text:string;hashtags:string[]}
export type SocialPost={guide_slug:string;guide_name:string;photo_url:string;platforms:Record<SocialPlatform,SocialCopy&{url:string}>;facts:SocialGuide;origin:'model'|'verified_fallback';warnings:string[]}
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
const photo=(value:unknown)=>typeof value==='string'&&value.startsWith('https://')&&safePublicUrl(value)?value:null

/** I target_languages sono intenzioni, non prova delle lingue completate. */
export function socialGuideFromPublic(catalog:any,payload:any,sourceUrl:string):SocialGuide|null {
  if(!catalog||typeof catalog.slug!=='string'||!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(catalog.slug)||!payload||payload.slug!==catalog.slug||payload.id!==catalog.id
    ||typeof payload.name!=='string'||!payload.name.trim()||payload.name.length>160||payload.visibility&&payload.visibility!=='public'||payload.is_draft===true
    ||officeIsNaples(catalog.slug,catalog.name,payload.slug,payload.name))return null
  const items=Array.isArray(payload.items)?payload.items:[]
  const photos=[...new Set([catalog.cover_image_url,payload.share_image_url,...items.flatMap((item:any)=>[item.thumb_url,item.qrcode?.image_url,item.qrcode?.map_thumbnail_url])].map(photo).filter((url):url is string=>!!url))].slice(0,20)
  if(!photos.length)return null
  const gated=(payload.is_paid===true || catalog.is_paid===true) && !['owner','purchased','active','unlocked','free'].includes(String(payload.access_status||''))
  // Solo un elenco esplicito di lingue effettivamente disponibili. Non si usa
  // il target della generazione e non si deduce una lingua da una sola scheda.
  const languages=Array.isArray(payload.available_languages)&&payload.available_languages.every((v:unknown)=>typeof v==='string'&&/^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(v))?[...new Set(payload.available_languages)] as string[]:null
  const published=typeof payload.published_at==='string'&&Number.isFinite(Date.parse(payload.published_at))?new Date(payload.published_at).toISOString():null
  return{id:catalog.id,slug:catalog.slug,name:payload.name,url:`https://guides.speaqi.com/maps/${catalog.slug}`,points:count(catalog.points),languages,
    routes:!gated&&Array.isArray(payload.routes)?payload.routes.filter((r:any)=>r&&['route','percorso'].includes(r.kind)).length:null,
    audio_minutes:count(payload.audio_minutes),photo_urls:photos,published_at:published,source_url:sourceUrl,changes:[]}
}
export function socialUtm(slug:string,platform:SocialPlatform) {
  const url=new URL(`https://guides.speaqi.com/maps/${slug}`)
  url.searchParams.set('utm_source',platform);url.searchParams.set('utm_medium','social');url.searchParams.set('utm_campaign','office_social');return url.toString()
}
const WORD_NUMBERS:Record<string,number>={zero:0,due:2,tre:3,quattro:4,cinque:5,sei:6,sette:7,otto:8,nove:9,dieci:10,undici:11,dodici:12,tredici:13,quattordici:14,quindici:15,sedici:16,diciassette:17,diciotto:18,diciannove:19,venti:20,trenta:30,quaranta:40,cinquanta:50,sessanta:60,settanta:70,ottanta:80,novanta:90,cento:100,mille:1000,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,hundred:100,thousand:1000}
const wordPattern=Object.keys(WORD_NUMBERS).join('|')
/** Ogni cifra è legata al dato giusto, non basta che appaia altrove nel JSON. */
export function socialNumbersAllowed(text:string,guide:SocialGuide) {
  let remaining=text.split(guide.name).join(' ')
  const expression=new RegExp(`\\b(\\d+(?:[.,]\\d+)*|${wordPattern})\\s+(luogh\\w*|punt\\w*|tappe|lingu\\w*|itinerari\\w*|percors\\w*|minut\\w*)\\b`,'gi')
  let valid=true
  remaining=remaining.replace(expression,(_match,raw:string,unit:string)=>{
    const value=WORD_NUMBERS[raw.toLowerCase()]??Number(raw.replace(',','.'))
    const expected=/^(luogh|punt|tappe)/i.test(unit)?guide.points:/^lingu/i.test(unit)?guide.languages?.length??null:/^(itinerari|percors)/i.test(unit)?guide.routes:guide.audio_minutes
    if(expected===null||value!==expected)valid=false
    return ' '
  })
  return valid&&!/\d/.test(remaining)&&!new RegExp(`\\b(?:${wordPattern}|mila)\\b`,'i').test(remaining)
}
export function validSocialCopy(value:unknown,guide:SocialGuide):SocialCopy|null {
  const row=value as SocialCopy
  if(!row||typeof row.text!=='string'||!row.text.trim()||row.text.length>2200||!Array.isArray(row.hashtags)||row.hashtags.length>5
    ||row.hashtags.some((h)=>typeof h!=='string'||!/^#[\p{L}_]+$/u.test(h))||new Set(row.hashtags).size!==row.hashtags.length)return null
  const text=row.text.trim()
  if(!text.includes(guide.name)||officeIsNaples(text)||/https?:\/\/|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\b|gratuit|gratis|miglior|imperdibil|perfett|garantit|illimitat|senza limiti/i.test(text)
    ||!socialNumbersAllowed(text,guide)||(!guide.changes.length&&/\b(nuov[oaie]|appena|aggiunt[oaie])\b/i.test(text)))return null
  return{text,hashtags:row.hashtags}
}
export function fallbackSocialCopy(guide:SocialGuide,platform:SocialPlatform,slot:number):SocialCopy {
  const lines=[`Esplora ${guide.name} con la guida Speaqi. Apri la mappa e scegli da dove iniziare.`,
    `Stai preparando una visita a ${guide.name}? Consulta la guida Speaqi e scegli i luoghi da conoscere.`,
    `${guide.name}, una tappa alla volta. La guida Speaqi ti aiuta a orientarti tra i luoghi della mappa.`]
  return{text:lines[(slot+SOCIAL_PLATFORMS.indexOf(platform))%lines.length],hashtags:['#Speaqi','#GuideDigitali']}
}
export function buildSocialPosts(value:unknown,guides:SocialGuide[]):SocialPost[] {
  if(!guides.length)return[]
  const candidates=Array.isArray((value as any)?.posts)?(value as any).posts:[]
  const total=Math.max(3,Math.min(5,guides.length))
  return Array.from({length:total},(_,slot)=>{
    const guide=guides[slot%guides.length];const matches=candidates.filter((p:any)=>p?.slot===slot)
    const proposed=matches.length===1?matches[0]:null
    const copies=Object.fromEntries(SOCIAL_PLATFORMS.map((p)=>[p,validSocialCopy(proposed?.[p],guide)])) as Record<SocialPlatform,SocialCopy|null>
    const valid=SOCIAL_PLATFORMS.every((p)=>copies[p]!==null)
    const platforms=Object.fromEntries(SOCIAL_PLATFORMS.map((p)=>[p,{...(valid?copies[p]!:fallbackSocialCopy(guide,p,slot)),url:socialUtm(guide.slug,p)}])) as SocialPost['platforms']
    return{guide_slug:guide.slug,guide_name:guide.name,photo_url:guide.photo_urls[slot%guide.photo_urls.length],platforms,facts:guide,
      origin:valid?'model':'verified_fallback',warnings:valid?[]:['Proposta del modello scartata: bozza ricostruita solo dai dati verificati.']}
  })
}
