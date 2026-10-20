import assert from 'node:assert/strict'
import test from 'node:test'
import { describeR2Config, probeR2Read, putR2Object, r2BackupConfig, signingKey } from '../src/lib/server/r2'

test('la chiave di firma SigV4 coincide con l\'esempio ufficiale AWS', () => {
  const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'iam')
  assert.equal(key.toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9')
})

test('senza tutte e quattro le variabili il bucket dei backup non e configurato', () => {
  const env = { R2_BACKUP_ACCOUNT_ID: 'a', R2_BACKUP_BUCKET: 'b', R2_BACKUP_ACCESS_KEY_ID: 'k' } as unknown as NodeJS.ProcessEnv
  assert.equal(r2BackupConfig(env), null)
  assert.deepEqual(r2BackupConfig({ ...env, R2_BACKUP_SECRET_ACCESS_KEY: 's' } as unknown as NodeJS.ProcessEnv), {
    accountId: 'a',
    bucket: 'b',
    accessKeyId: 'k',
    secretAccessKey: 's',
  })
})

test('il PUT va al bucket giusto con firma e hash del contenuto', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return new Response('', { status: 200 })
  }) as unknown as typeof fetch
  await putR2Object({ accountId: 'acc', bucket: 'bk', accessKeyId: 'AKID', secretAccessKey: 'secret' }, 'crm/file 1.json.gz', Buffer.from('ciao'), 'application/gzip', {
    now: new Date('2026-10-20T04:30:00Z'),
    fetchImpl,
  })
  assert.ok(seen)
  const { url, init } = seen as { url: string; init: RequestInit }
  assert.equal(url, 'https://acc.r2.cloudflarestorage.com/bk/crm/file%201.json.gz')
  const headers = init.headers as Record<string, string>
  assert.equal(headers['x-amz-date'], '20261020T043000Z')
  assert.equal(headers['x-amz-content-sha256'], 'b133a0c0e9bee3be20163d2ad31d6248db292aa6dcb1ee087a2aa50e0fc75ae2')
  assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKID\/20261020\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
})

test('un errore di R2 diventa un\'eccezione con il codice', async () => {
  const fetchImpl = (async () => new Response('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 })) as unknown as typeof fetch
  await assert.rejects(
    putR2Object({ accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' }, 'x', Buffer.from('1'), 'text/plain', { fetchImpl }),
    /R2 403 AccessDenied \(Access Denied\)$/
  )
})

test('la descrizione per l\'errore mostra lunghezze e bucket, mai i valori', () => {
  const text = describeR2Config({ accountId: 'a'.repeat(32), bucket: 'bk', accessKeyId: 'k'.repeat(32), secretAccessKey: 'SEGRETO-DI-PROVA' })
  assert.equal(text, 'bucket=bk, account=32 car., idChiave=32 car., segreto=16 car.')
  assert.ok(!text.includes('SEGRETO'))
})

test('la prova di lettura firma un GET sul bucket e riporta il codice di R2', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const ok = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return new Response('<ListBucketResult/>', { status: 200 })
  }) as unknown as typeof fetch
  const cfg = { accountId: 'acc', bucket: 'bk', accessKeyId: 'AKID', secretAccessKey: 'secret' }
  assert.equal(await probeR2Read(cfg, { now: new Date('2026-10-20T04:30:00Z'), fetchImpl: ok }), 'ok')
  const { url, init } = seen as unknown as { url: string; init: RequestInit }
  assert.equal(url, 'https://acc.r2.cloudflarestorage.com/bk?list-type=2&max-keys=1')
  assert.equal(init.method, 'GET')
  assert.match((init.headers as Record<string, string>).Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/)
  const denied = (async () => new Response('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', { status: 403 })) as unknown as typeof fetch
  assert.match(await probeR2Read(cfg, { fetchImpl: denied }), /R2 403 AccessDenied/)
})
