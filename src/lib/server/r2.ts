import { createHash, createHmac } from 'node:crypto'

/**
 * Upload su Cloudflare R2 (API S3, firma SigV4) senza SDK: il CRM non ne ha uno
 * e per un solo PutObject una dipendenza da decine di MB non si ripaga.
 * Serve al backup: una copia fuori da Supabase.
 */

export type R2Config = {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** Le quattro variabili del bucket dei backup. Tutte o niente: a meta' non si carica. */
export function r2BackupConfig(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accountId = String(env.R2_BACKUP_ACCOUNT_ID || '').trim()
  const bucket = String(env.R2_BACKUP_BUCKET || '').trim()
  const accessKeyId = String(env.R2_BACKUP_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.R2_BACKUP_SECRET_ACCESS_KEY || '').trim()
  return accountId && bucket && accessKeyId && secretAccessKey ? { accountId, bucket, accessKeyId, secretAccessKey } : null
}

/**
 * Descrizione per l'errore: bucket e lunghezze, mai i valori. Basta a vedere se
 * hai incollato la coppia S3 giusta (ID 32 caratteri, segreto 64) o il valore del token.
 */
export function describeR2Config(config: R2Config) {
  return `bucket=${config.bucket}, account=${config.accountId.length} car., idChiave=${config.accessKeyId.length} car., segreto=${config.secretAccessKey.length} car.`
}

const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

/** Chiave di firma SigV4: data → regione → servizio → "aws4_request". */
export function signingKey(secretAccessKey: string, day: string, region: string, service: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request')
}

const encodeKey = (key: string) => key.split('/').map((part) => encodeURIComponent(part)).join('/')

type R2Options = { now?: Date; fetchImpl?: typeof fetch }

/** Richiesta S3 firmata (SigV4). `key` vuoto = il bucket stesso; `query` gia' ordinata e codificata. */
async function r2Request(
  config: R2Config,
  method: 'PUT' | 'GET',
  key: string,
  query: string,
  body: Buffer | null,
  contentType: string | null,
  options: R2Options
) {
  const now = options.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const host = `${config.accountId}.r2.cloudflarestorage.com`
  const path = `/${config.bucket}${key ? `/${encodeKey(key)}` : ''}`
  const payloadHash = sha256(body ?? '')

  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  if (contentType) headers['content-type'] = contentType
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${day}/auto/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(config.secretAccessKey, day, 'auto', 's3')).update(stringToSign).digest('hex')

  return (options.fetchImpl ?? fetch)(`https://${host}${path}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      ...(contentType ? { 'Content-Type': contentType } : {}),
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
}

/** R2 risponde in XML: della risposta serve il codice (AccessDenied, SignatureDoesNotMatch, ...). */
async function r2ErrorText(response: Response) {
  const text = (await response.text().catch(() => '')).replace(/\s+/g, ' ')
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]
  return `R2 ${response.status} ${code || text.slice(0, 120)}${message && message !== code ? ` (${message.slice(0, 120)})` : ''}`
}

export async function putR2Object(config: R2Config, key: string, body: Buffer, contentType: string, options: R2Options = {}) {
  const response = await r2Request(config, 'PUT', key, '', body, contentType, options)
  if (!response.ok) throw new Error(await r2ErrorText(response))
}

/**
 * Prova di sola lettura sul bucket: serve a capire un AccessDenied in scrittura.
 * `ok` = le chiavi leggono (il token e' solo in lettura, o manca il permesso di scrittura);
 * un errore anche qui = il token non copre questo bucket.
 */
export async function probeR2Read(config: R2Config, options: R2Options = {}) {
  try {
    const response = await r2Request(config, 'GET', '', 'list-type=2&max-keys=1', null, null, options)
    return response.ok ? 'ok' : await r2ErrorText(response)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
