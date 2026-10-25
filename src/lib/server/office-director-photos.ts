import type { UploadedFile } from './tourism-decks'

// Le foto di un ordine al Direttore (dal CRM o da Telegram) stanno nel bucket privato
// del Direttore. Da qui passano nei materiali di una presentazione.

export const DIRECTOR_BUCKET = 'office-director'

/** Un percorso del bucket del Direttore che appartiene a quel proprietario: `<utente>/<ordine>/<foto>.jpg`. */
export function isDirectorPhotoPath(userId: string, path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(`${userId}/`) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path)
}

/** Le foto dell'ordine pronte per addAssets. Un percorso estraneo o illeggibile si salta. */
export async function directorPhotoFiles(service: any, userId: string, paths: unknown[]): Promise<UploadedFile[]> {
  const files: UploadedFile[] = []
  for (const path of paths) {
    if (!isDirectorPhotoPath(userId, path)) continue
    const { data, error } = await service.storage.from(DIRECTOR_BUCKET).download(path)
    if (error || !data) continue
    files.push({ name: `telegram-${files.length + 1}.jpg`, buffer: Buffer.from(await data.arrayBuffer()), source: 'telegram', source_url: `${DIRECTOR_BUCKET}:${path}` })
  }
  return files
}
