/** Letture mirate e paginate: nessun totale ricostruito da una pagina REST troncata. */
export async function officeRows<T>(admin: any, userId: string, table: string, columns = '*', filter?: (query: any) => any, idColumn = 'id'): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    let query = admin.from(table).select(columns).eq('user_id', userId).order(idColumn).range(from, from + 999)
    if (filter) query = filter(query)
    const { data, error } = await query
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) return rows
  }
}
