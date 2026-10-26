// Prova nello standalone finale: deve avviarsi il Chromium realmente distribuito.
import assert from 'node:assert/strict'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'],
  executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(), headless: 'shell', timeout: 20_000 })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><meta charset="utf-8"><style>@page{size:1920px 1080px;margin:0}body{margin:0}</style><h1>Speaqi · PDF àèìòù €</h1>')
  const pdf = Buffer.from(await page.pdf({ width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true }))
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  assert.match(pdf.toString('latin1'), /\/MediaBox\s*\[\s*0\s+0\s+1440\s+810\s*\]/)
  console.log('PDF runtime verified: Chromium generated a valid 16:9 PDF.')
} finally {
  await browser.close()
}
