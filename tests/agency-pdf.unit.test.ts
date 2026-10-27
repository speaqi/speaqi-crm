import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENCY_BUCKET } from '../src/lib/server/agency-assets'
import { getOrCreatePresentationPdf, presentationPdfPath } from '../src/lib/server/agency-pdf'
import type { PresentationRow } from '../src/lib/server/agency'

test('il primo PDF senza allegati crea il bucket privato e si scarica anche dalla cache', async () => {
  const row = { id: 'presentation', user_id: 'owner', project_id: 'project', public_token: 'a'.repeat(64), status: 'approved', version: 15 } as PresentationRow
  const pdf = Buffer.from('%PDF-1.7 documento')
  let bucketExists = false
  let renders = 0
  let creations = 0
  const files = new Map<string, Buffer>()
  const service = {
    storage: {
      getBucket: async (name: string) => {
        assert.equal(name, AGENCY_BUCKET)
        return { data: bucketExists ? { id: name } : null }
      },
      createBucket: async (name: string, options: { public: boolean }) => {
        assert.equal(name, AGENCY_BUCKET)
        assert.equal(options.public, false)
        bucketExists = true
        creations++
        return { error: null }
      },
      from: (name: string) => {
        assert.equal(name, AGENCY_BUCKET)
        return {
          download: async (path: string) => ({
            data: files.has(path) ? new Blob([new Uint8Array(files.get(path)!)]) : null,
            error: files.has(path) ? null : { message: bucketExists ? 'Object not found' : 'Bucket not found' }
          }),
          upload: async (path: string, buffer: Buffer) => {
            if (!bucketExists) return { error: { message: 'Bucket not found' } }
            files.set(path, buffer)
            return { error: null }
          },
          list: async () => ({ data: [] })
        }
      }
    }
  }
  const render = async () => { renders++; return pdf }
  const downloads = await Promise.all(Array.from({ length: 3 }, () => getOrCreatePresentationPdf(service, row, 'v15-test', render)))
  assert.ok(downloads.every((file) => file.equals(pdf)))
  assert.deepEqual(await getOrCreatePresentationPdf(service, row, 'v15-test', render), pdf)
  assert.deepEqual(files.get(presentationPdfPath(row, 'v15-test')), pdf)
  assert.equal(creations, 1)
  assert.equal(renders, 1)
})
