/**
 * Client Supabase finto, in memoria: abbastanza per esercitare il motore
 * campagne senza rete. Copre solo la parte di query builder che il codice usa
 * davvero — se una chiamata non e supportata, fallisce forte invece di
 * restituire silenziosamente un risultato sbagliato.
 */

type Row = Record<string, any>
type Filter = (row: Row) => boolean

export type RpcHandler = (args: Row) => any

export class FakeSupabase {
  tables: Record<string, Row[]>
  rpcs: Record<string, RpcHandler>
  calls: Array<{ rpc: string; args: Row }> = []
  private sequence = 0

  constructor(tables: Record<string, Row[]> = {}, rpcs: Record<string, RpcHandler> = {}) {
    this.tables = tables
    this.rpcs = rpcs
  }

  private rows(table: string) {
    if (!this.tables[table]) this.tables[table] = []
    return this.tables[table]
  }

  nextId(prefix: string) {
    this.sequence += 1
    return `${prefix}-${String(this.sequence).padStart(4, '0')}`
  }

  rpc(name: string, args: Row) {
    this.calls.push({ rpc: name, args })
    const handler = this.rpcs[name]
    if (!handler) return Promise.resolve({ data: null, error: { message: `rpc ${name} non simulata` } })
    try {
      return Promise.resolve({ data: handler(args), error: null })
    } catch (error) {
      return Promise.resolve({ data: null, error })
    }
  }

  from(table: string) {
    return new FakeQuery(this, table, this.rows(table))
  }
}

class FakeQuery {
  private filters: Filter[] = []
  private sortKey: { column: string; ascending: boolean } | null = null
  private max = Infinity
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: Row[] = []
  private conflict = ''
  private ignoreDuplicates = false
  private selected = true
  private headCount = false

  constructor(private db: FakeSupabase, private table: string, private source: Row[]) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (options?.head) this.headCount = true
    this.selected = true
    return this
  }

  insert(rows: Row | Row[]) {
    this.mode = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.selected = false
    return this
  }

  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.mode = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.conflict = options.onConflict || ''
    this.ignoreDuplicates = Boolean(options.ignoreDuplicates)
    this.selected = false
    return this
  }

  update(patch: Row) {
    this.mode = 'update'
    this.payload = [patch]
    this.selected = false
    return this
  }

  eq(column: string, value: any) { this.filters.push((row) => row[column] === value); return this }
  gt(column: string, value: any) { this.filters.push((row) => row[column] > value); return this }
  is(column: string, value: any) { this.filters.push((row) => (row[column] ?? null) === value); return this }
  in(column: string, values: any[]) { const set = new Set(values); this.filters.push((row) => set.has(row[column])); return this }

  not(column: string, operator: string, value: any) {
    if (operator === 'is') this.filters.push((row) => (row[column] ?? null) !== value)
    else if (operator === 'in') {
      const list = String(value).replace(/^\(|\)$/g, '').split(',').map((entry) => entry.trim())
      const set = new Set(list)
      this.filters.push((row) => !set.has(row[column]))
    } else throw new Error(`operatore not.${operator} non simulato`)
    return this
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.sortKey = { column, ascending: options.ascending !== false }
    return this
  }

  limit(count: number) { this.max = count; return this }

  private matching() {
    let rows = this.source.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.sortKey) {
      const { column, ascending } = this.sortKey
      rows = [...rows].sort((left, right) =>
        (left[column] > right[column] ? 1 : left[column] < right[column] ? -1 : 0) * (ascending ? 1 : -1)
      )
    }
    return rows.slice(0, this.max)
  }

  private conflictKey(row: Row) {
    return this.conflict.split(',').map((column) => String(row[column.trim()])).join('|')
  }

  private run() {
    if (this.mode === 'select') {
      const rows = this.matching()
      return this.headCount ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null }
    }
    if (this.mode === 'update') {
      const rows = this.matching()
      for (const row of rows) Object.assign(row, this.payload[0])
      return { data: rows, error: null }
    }
    const written: Row[] = []
    const existing = this.conflict ? new Set(this.source.map((row) => this.conflictKey(row))) : new Set<string>()
    for (const candidate of this.payload) {
      if (this.conflict && existing.has(this.conflictKey(candidate))) {
        if (this.ignoreDuplicates) continue
        const target = this.source.find((row) => this.conflictKey(row) === this.conflictKey(candidate))
        Object.assign(target!, candidate)
        written.push(target!)
        continue
      }
      const row = { id: candidate.id || this.db.nextId(this.table), created_at: new Date().toISOString(), ...candidate }
      this.source.push(row)
      if (this.conflict) existing.add(this.conflictKey(row))
      written.push(row)
    }
    return { data: written, error: null }
  }

  maybeSingle() { const result = this.run(); return Promise.resolve({ data: (result.data || [])[0] ?? null, error: result.error }) }
  single() { const result = this.run(); return Promise.resolve({ data: (result.data || [])[0] ?? null, error: result.error }) }
  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject)
  }
}
