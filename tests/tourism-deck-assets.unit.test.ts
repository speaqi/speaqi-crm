import assert from 'node:assert/strict'
import test from 'node:test'
import { crc32, deflateRawSync } from 'node:zlib'
import { documentText, extractDocxText, safeFileName, sniffUpload } from '../src/lib/server/tourism-deck-assets'

/** Zip minimo con una voce, per provare il lettore dei .docx. */
function zip(name: string, content: string, deflate: boolean) {
  const raw = Buffer.from(content, 'utf8')
  const data = deflate ? deflateRawSync(raw) : raw
  const n = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(deflate ? 8 : 0, 8)
  local.writeUInt32LE(crc32(raw), 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(n.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(deflate ? 8 : 0, 10)
  central.writeUInt32LE(crc32(raw), 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(n.length, 28)
  central.writeUInt32LE(0, 42)
  const cdOffset = local.length + n.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + n.length, 12)
  end.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, n, data, central, n, end])
}

const XML = '<w:document><w:body><w:p><w:r><w:t>Capri &amp; Anacapri</w:t></w:r></w:p><w:p><w:r><w:t>Seconda riga</w:t></w:r></w:p></w:body></w:document>'

test('un docx si legge, compresso o no', () => {
  for (const deflate of [true, false]) {
    assert.equal(extractDocxText(zip('word/document.xml', XML, deflate)), 'Capri & Anacapri\nSeconda riga')
  }
})

test('uno zip senza word/document.xml non è un documento', () => {
  assert.throws(() => extractDocxText(zip('altro.xml', XML, true)), /senza testo/)
  assert.throws(() => extractDocxText(Buffer.from('non uno zip')), /non leggibile/)
})

test('il tipo si decide dai byte, non dal nome', () => {
  assert.equal(sniffUpload(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.png')?.mime, 'image/jpeg')
  assert.equal(sniffUpload(Buffer.from('%PDF-1.7 ...'), 'x.txt')?.doc, 'pdf')
  assert.equal(sniffUpload(Buffer.from('<?php echo 1;'), 'foto.jpg'), null)
  assert.equal(sniffUpload(Buffer.from('MZ\u0090\u0000'), 'x.pdf'), null)
  assert.equal(sniffUpload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'x.docx')?.doc, 'docx')
  assert.equal(sniffUpload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'x.zip'), null)
})

test('un testo con byte nulli non passa per testo', () => {
  assert.equal(sniffUpload(Buffer.from([0x61, 0x00, 0x62]), 'a.txt'), null)
  assert.equal(sniffUpload(Buffer.from('ciao à'), 'a.md')?.doc, 'text')
})

test('un documento lungo si tronca e lo dice', () => {
  const r = documentText(Buffer.from('a'.repeat(50_000)), 'text')
  assert.equal(r.text.length, 40_000)
  assert.equal(r.truncated, true)
})

test('il nome non porta percorsi né caratteri di controllo', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('a\u0000b<c>.pdf'), 'abc.pdf')
  assert.equal(safeFileName('   '), 'file')
})
