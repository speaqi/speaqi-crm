export type QualityInventory = { slug: string; city: string; total: number }
export type QualitySample = { key: string; name: string; text: string; sources: Array<{ ref: string; data: string }> }
export type QualityIssue = { code: string; place_key: string; severity: 'warning' | 'serious'; message: string; proposal?: unknown }
export type QualityReport = { slug: string; city: string; total: number; read_only: true; naples: boolean; fingerprint: string;
  findings: QualityIssue[]; groups: Record<string,QualityIssue[]>; warnings: string[]; sample: QualitySample[]; translations_checked: number }

/** Campione di 20 luoghi sull'insieme delle mappe, a rotazione giornaliera. */
export function qualityAssignments(maps: QualityInventory[], dayNumber: number): Map<string,number[]> {
  const total=maps.reduce((sum,map)=>sum+map.total,0);const assigned=new Map<string,number[]>();
  if(!total) return assigned;
  for(let i=0;i<Math.min(20,total);i++) {
    let index=(dayNumber*20+i)%total;
    for(const map of maps) { if(index<map.total){const rows=assigned.get(map.slug)||[];rows.push(index);assigned.set(map.slug,rows);break} index-=map.total }
  }
  return assigned;
}

export function qualityInventory(raw: any): QualityInventory[] {
  if(!Array.isArray(raw?.maps) || raw.maps.length>10000) throw new Error('Catalogo qualità non valido')
  const seen=new Set<string>();
  for(const map of raw.maps) {
    if(!map || typeof map.slug!=='string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(map.slug) || typeof map.city!=='string'
      || !Number.isSafeInteger(map.total) || map.total<0 || map.total>10_000_000 || seen.has(map.slug)) throw new Error('Riga catalogo qualità non valida')
    seen.add(map.slug)
  }
  return raw.maps.slice().sort((a:QualityInventory,b:QualityInventory)=>a.slug.localeCompare(b.slug))
}
export function qualityReport(raw: any, slug: string, maxSamples: number): QualityReport {
  if(!raw || raw.slug!==slug || raw.read_only!==true || typeof raw.naples!=='boolean' || typeof raw.city!=='string'
    || !Number.isSafeInteger(raw.total) || raw.total<0 || typeof raw.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint)
    || !Array.isArray(raw.findings) || !Array.isArray(raw.warnings) || !raw.warnings.every((x:unknown)=>typeof x==='string')
    || !Array.isArray(raw.sample) || raw.sample.length>maxSamples || !Number.isSafeInteger(raw.translations_checked)
    || raw.translations_checked<0 || raw.translations_checked>raw.total) throw new Error('Rapporto StudioMap non valido')
  if(raw.findings.some((f:any)=>!f || typeof f.code!=='string' || typeof f.place_key!=='string' || typeof f.message!=='string' || !['warning','serious'].includes(f.severity))) throw new Error('Segnalazioni StudioMap non valide')
  if(raw.sample.some((s:any)=>!s || typeof s.key!=='string' || typeof s.name!=='string' || typeof s.text!=='string'
    || !Array.isArray(s.sources) || s.sources.some((p:any)=>!p || typeof p.ref!=='string' || typeof p.data!=='string'))) throw new Error('Campione StudioMap non valido')
  if(new Set(raw.sample.map((s:QualitySample)=>s.key)).size!==raw.sample.length) throw new Error('Campione qualità duplicato')
  return raw
}

/** Il modello può solo citare frasi presenti nel testo e riferimenti ricevuti. */
export function qualityModelFindings(value:unknown, sample:QualitySample[]): QualityIssue[] {
  const issues=(value as {issues?:unknown})?.issues;if(!Array.isArray(issues)) return []
  const seen=new Set<string>();const result:QualityIssue[]=[]
  for(const row of issues.slice(0,40)) {
    if(!row || typeof row!=='object') continue
    const {place_key,sentence,source_refs}=row as Record<string,unknown>
    const place=sample.find((p)=>p.key===place_key)
    if(!place || typeof sentence!=='string' || sentence.trim().length<10 || sentence.length>1000 || !place.text.includes(sentence)
      || !Array.isArray(source_refs) || source_refs.some((ref)=>!place.sources.some((s)=>s.ref===ref))) continue
    const key=`${place_key}:${sentence}`;if(seen.has(key)) continue;seen.add(key)
    result.push({code:'unsupported_claim',place_key:place.key,severity:'warning',message:`Frase da verificare contro le fonti salvate: «${sentence}»`})
  }
  return result
}

export const QUALITY_RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['place_key', 'sentence', 'source_refs'],
        properties: {
          place_key: { type: 'string' }, sentence: { type: 'string' },
          source_refs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
