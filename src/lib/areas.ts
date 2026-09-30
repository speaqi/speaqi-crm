// Aree del CRM abilitabili per singolo collaboratore (Impostazioni → Team).
// Modulo puro, condiviso da client e server: niente import, solo sintassi
// TypeScript cancellabile (viene caricato anche da `node --test`).

export const AREAS = [
  { key: 'oggi', label: 'Oggi', paths: ['/dashboard', '/operativo'], alwaysOn: true, defaultOn: true },
  { key: 'todo', label: 'To Do', paths: ['/todo'], alwaysOn: false, defaultOn: false },
  { key: 'pipeline', label: 'Pipeline', paths: ['/kanban'], alwaysOn: false, defaultOn: true },
  {
    key: 'contatti',
    label: 'Contatti',
    paths: ['/contacts', '/personali', '/partner', '/vinitaly', '/speaqi', '/quick-capture', '/voice'],
    alwaysOn: false,
    defaultOn: true,
  },
  { key: 'followup', label: 'Follow-up', paths: ['/calendario'], alwaysOn: false, defaultOn: true },
  { key: 'email', label: 'Email', paths: ['/email', '/gmail'], alwaysOn: false, defaultOn: false },
  { key: 'preventivi', label: 'Preventivi', paths: ['/preventivi'], alwaysOn: false, defaultOn: false },
  { key: 'analytics', label: 'Analytics', paths: ['/attivita'], alwaysOn: false, defaultOn: false },
  { key: 'finanza', label: 'Finanza', paths: ['/finanza'], alwaysOn: false, defaultOn: false },
  { key: 'marketing', label: 'Marketing', paths: ['/marketing'], alwaysOn: false, defaultOn: false },
  { key: 'progetti', label: 'Progetti', paths: ['/progetti'], alwaysOn: false, defaultOn: false },
  { key: 'navigazione', label: 'Navigazione', paths: ['/navigazione'], alwaysOn: false, defaultOn: false },
  { key: 'import', label: 'Import', paths: ['/import'], alwaysOn: false, defaultOn: false },
  { key: 'impostazioni', label: 'Impostazioni', paths: ['/impostazioni'], alwaysOn: false, defaultOn: false },
] as const

export type AreaKey = (typeof AREAS)[number]['key']

export const ALL_AREA_KEYS: AreaKey[] = AREAS.map((area) => area.key)

// Riservati al proprietario del workspace: non delegabili dal pannello.
export const SUPER_ADMIN_PATHS = [
  '/acumbamail',
  '/hospitality',
  '/commerciale',
  '/incassi',
  '/impostazioni/wine-project',
  '/impostazioni/whatsapp',
  '/impostazioni/team',
]

export function isAreaKey(value: unknown): value is AreaKey {
  return typeof value === 'string' && (ALL_AREA_KEYS as string[]).includes(value)
}

// null/non-array = mai configurato → default. Array (anche vuoto) = esattamente quelle aree.
export function resolveAllowedAreas(raw: unknown, isAdmin: boolean): AreaKey[] {
  if (isAdmin) return ALL_AREA_KEYS
  const granted = Array.isArray(raw) ? raw.filter(isAreaKey) : null
  return AREAS.filter((area) =>
    area.alwaysOn ? true : granted ? granted.includes(area.key) : area.defaultOn
  ).map((area) => area.key)
}

function cleanPath(pathname: string) {
  return pathname.split(/[?#]/)[0]
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function areaForPath(pathname: string): AreaKey | null {
  const path = cleanPath(pathname)
  let best: { key: AreaKey; length: number } | null = null
  for (const area of AREAS) {
    for (const prefix of area.paths) {
      if (matchesPrefix(path, prefix) && (!best || prefix.length > best.length)) {
        best = { key: area.key, length: prefix.length }
      }
    }
  }
  return best ? best.key : null
}

// `areas === null` = aree non note lato client (chiamata team fallita): non si blocca,
// le API restano la barriera.
export function canAccessPath(pathname: string, areas: AreaKey[] | null, isAdmin: boolean): boolean {
  const path = cleanPath(pathname)
  if (SUPER_ADMIN_PATHS.some((prefix) => matchesPrefix(path, prefix))) return isAdmin
  if (isAdmin || areas === null) return true
  const area = areaForPath(path)
  return area === null || areas.includes(area)
}
