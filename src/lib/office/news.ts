import { load } from 'cheerio'
import { safePublicUrl } from '../tourism'

export type NewsArticle={url:string;title:string;published_at:string;excerpt:string;feed_url:string}
export type NewsItem=NewsArticle&{summary:string;why:string}
export const NEWS_COMPETITORS=['STQRY','Cuseum','SmartGuide','VoiceMap','Locatify']

export function newsUrl(raw:unknown,base?:string):string|null {
  if(typeof raw!=='string') return null
  try {
    const url=new URL(raw,base)
    if(!safePublicUrl(url.href) || (url.port && !['80','443'].includes(url.port))) return null
    url.hash=''
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
    return url.href
  }catch{return null}
}
export function newsTitle(value:string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
}
export function similarNewsTitles(a:string,b:string) {
  const left=new Set(newsTitle(a).split(' ').filter(Boolean));const right=new Set(newsTitle(b).split(' ').filter(Boolean))
  if(!left.size||!right.size) return false
  if(newsTitle(a)===newsTitle(b)) return true
  return left.size>=4&&right.size>=4&&[...left].filter((word)=>right.has(word)).length/Math.max(left.size,right.size)>=.9
}
const text=(value:string)=>load(`<div>${value}</div>`).text().replace(/\s+/g,' ').replace(/\u0000/g,'').trim()
function date(raw:string):string|null {
  // Non trasformare tempi relativi o numeri arbitrari in date inventate.
  if(!/\d{4}/.test(raw)) return null
  const ms=Date.parse(raw);return Number.isFinite(ms)?new Date(ms).toISOString():null
}
/** RSS, Atom e pagine con data pubblicata esplicita: nessuna data dedotta. */
export function parseNewsPage(body:string,feedUrl:string):NewsArticle[] {
  const result:NewsArticle[]=[]
  const add=(url:unknown,title:string,published:string,excerpt:string)=>{
    const cleanUrl=newsUrl(url,feedUrl);const publishedAt=date(published);const cleanTitle=text(title).slice(0,240)
    if(cleanUrl&&publishedAt&&cleanTitle) result.push({url:cleanUrl,title:cleanTitle,published_at:publishedAt,excerpt:text(excerpt).slice(0,1200),feed_url:feedUrl})
  }
  const xml=load(body,{xmlMode:true})
  xml('item,entry').slice(0,100).each((_,node)=>{
    const item=xml(node);const link=item.find('link[rel="alternate"]').attr('href') || item.find('link[href]').attr('href') || item.find('link').first().text()
    add(link,item.find('title').first().text(),item.find('pubDate,published,dc\\:date').first().text(),item.find('description,summary,content,content\\:encoded').first().text())
  })
  if(result.length) return result
  const $=load(body)
  $('article').slice(0,100).each((_,node)=>{
    const article=$(node);const anchor=article.find('h1 a,h2 a,h3 a,a[rel="bookmark"]').first()
    add(anchor.attr('href'),article.find('h1,h2,h3').first().text(),article.find('time[datetime]').first().attr('datetime')||'',article.find('p').text())
  })
  const published=$('meta[property="article:published_time"],meta[itemprop="datePublished"]').first().attr('content')
  if(published) add($('link[rel="canonical"]').attr('href')||feedUrl,$('meta[property="og:title"]').attr('content')||$('title').text(),published,$('meta[name="description"]').attr('content')||$('article').text())
  const walk=(value:any,depth=0)=>{
    if(depth>8||!value||typeof value!=='object') return
    if(Array.isArray(value)){for(const item of value.slice(0,100))walk(item,depth+1);return}
    if(/^(NewsArticle|Article|BlogPosting)$/.test(String(value['@type']))) add(value.url||value.mainEntityOfPage?.['@id']||feedUrl,String(value.headline||''),String(value.datePublished||''),String(value.description||value.articleBody||''))
    if(value['@graph'])walk(value['@graph'],depth+1)
  }
  $('script[type="application/ld+json"]').slice(0,20).each((_,node)=>{try{walk(JSON.parse($(node).text()))}catch{/* Dato strutturato invalido: non si inventa una data. */}})
  return result
}

export function newsRelevance(article:NewsArticle,competitors=NEWS_COMPETITORS) {
  const content=`${article.title} ${article.excerpt} ${article.url} ${article.feed_url}`.toLowerCase()
  if(competitors.some((name)=>content.includes(name.toLowerCase()))) return 'Novità di un concorrente nelle guide digitali.'
  if(/openai|gemini|openrouter|modelli? ai|ai model|intelligenza artificiale|artificial intelligence/.test(content)) return 'Tecnologia o costi AI da valutare per Speaqi.'
  if(/turis|touris|croci[ée]r|cruise|hospitality|muse[oui]|finanziament|funding|band[oi]|guide digital|digital guide|digital map|mappe digital/.test(content)) return 'Novità utile alle guide e alle destinazioni Speaqi.'
  return null
}
export function selectNews(articles:NewsArticle[],seen:Array<{url:string;title:string}>,now:Date,competitors=NEWS_COMPETITORS) {
  const kept:NewsArticle[]=[];const urls=new Set(seen.map((row)=>newsUrl(row.url)).filter(Boolean))
  for(const article of [...articles].sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.url.localeCompare(b.url))) {
    const age=now.getTime()-Date.parse(article.published_at)
    if(!Number.isFinite(age)||age<0||age>48*3600_000||!newsUrl(article.url)||!newsRelevance(article,competitors)||urls.has(article.url)
      ||seen.some((row)=>similarNewsTitles(row.title,article.title))||kept.some((row)=>similarNewsTitles(row.title,article.title))) continue
    kept.push(article);urls.add(article.url)
    if(kept.length>=24) break
  }
  return kept
}
export function validateNewsSummary(value:unknown,articles:NewsArticle[]):NewsItem[] {
  const rows=(value as {news?:unknown})?.news;if(!Array.isArray(rows)) return []
  const kept:NewsItem[]=[];const seen=new Set<string>()
  for(const row of rows) {
    const article=articles.find((a)=>row&&row.url===a.url)
    if(!article||seen.has(article.url)||typeof row.summary!=='string'||typeof row.why!=='string') continue
    const summary=row.summary.trim();const why=row.why.trim()
    if(!summary||!why||summary.length>300||why.length>200||/[\r\n]|https?:\/\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\b/i.test(summary+why)) continue
    const allowedNumbers=new Set((`${article.title} ${article.excerpt}`.match(/\d+(?:[.,]\d+)*/g)||[]))
    if((`${summary} ${why}`.match(/\d+(?:[.,]\d+)*/g)||[]).some((n)=>!allowedNumbers.has(n))) continue
    kept.push({...article,summary,why});seen.add(article.url);if(kept.length>=8) break
  }
  return kept
}
export function newsTelegramText(body:{articles?:NewsItem[]}) {
  let value='Novità di oggi\n'
  for(const row of body.articles||[]) {
    const item=`\n${row.title.slice(0,90)}\n${row.summary.slice(0,110)} ${row.why.slice(0,90)}\n${row.url}\n`
    if(value.length+item.length>3800){value+='\nRassegna completa nel CRM.';break}
    value+=item
  }
  return value
}
