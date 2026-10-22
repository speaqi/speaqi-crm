import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { normalizeAgencySettings, normalizeAnalysis } from '../src/lib/agency'
import { normalizeQuoteTemplate, quoteDraftFromTemplate } from '../src/lib/commercial-proposal'

// API intercettate: verifica UI e passaggio dei dati, senza toccare clienti reali.
const base = process.env.AGENCY_TEST_URL || 'http://127.0.0.1:3000'
const output = '/tmp/speaqi-commercial-proposals'
const owner = '11111111-1111-4111-8111-111111111111'
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const contact = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Anna Test', company: 'Alfa', email: 'anna@example.com', status: 'New', contact_scope: 'crm', category: 'Speaqi Agency', industry: '', responsible: '', note: '', created_at: '2026-01-01T00:00:00Z', billing_tax_id: '12345678901' }
let settings = normalizeAgencySettings({ contact: 'Responsabile · info@example.com' })
let savedQuote: any = null

async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', headless: true, args: ['--no-sandbox'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1000 } })
    await context.addInitScript(({ owner }) => {
      const token = btoa('{"alg":"none","typ":"JWT"}') + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.test'
      localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token: token, refresh_token: 'test', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
    }, { owner })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (!url.href.startsWith(base)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const method = route.request().method()
      const json = (v: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) })
      if (url.pathname === '/api/agency/overview') return json({ settings, categories: [], projects: [], presentations: [], quotes: [] })
      if (url.pathname === `/api/agency/projects/${projectId}`) return json({ id: projectId, user_id: owner, title: 'Nuovo sito Alfa', client_name: 'Alfa', contact_id: contact.id, contact, settings, categories: [], brief: '', services: [], stage: 'brief', analysis: normalizeAnalysis({}), client_brand: { name: 'Alfa', accent: null, logo_asset_id: null }, assets: [], quotes: [], presentations: [], deal: null })
      if (url.pathname === '/api/agency/settings') { settings = normalizeAgencySettings(route.request().postDataJSON()); return json({ settings }) }
      if (url.pathname === '/api/proposal-quote-context') return json({
        type: 'agency', id: projectId, title: 'Nuovo sito Alfa', client_name: 'Alfa', contact_id: contact.id,
        draft: { ...quoteDraftFromTemplate(normalizeQuoteTemplate(settings.quote_template, 'agency'), { cliente: 'Alfa', progetto: 'Nuovo sito Alfa' }), title: 'Nuovo sito Alfa' }
      })
      if (url.pathname === `/api/contacts/${contact.id}`) return json({ contact })
      if (url.pathname === '/api/quotes') {
        if (method === 'POST') { savedQuote = route.request().postDataJSON(); return json({ quote: { id: 'q1', ...savedQuote } }) }
        return json({ quotes: [] })
      }
      if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 1 } })
      if (url.pathname.startsWith('/api/contacts')) return json({ contacts: [contact] })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
    page.on('dialog', d => d.accept())
    await page.goto(base + '/agency?tab=template')
    await page.screenshot({ path: output + '/agency-initial.png', fullPage: false })
    await page.getByRole('heading', { name: 'Base commerciale Speaqi Agency' }).waitFor({ timeout: 15000 }).catch(async e => {
      await page.screenshot({ path: output + '/agency-failed.png' })
      console.error(await page.locator('body').innerText())
      throw e
    })
    await page.getByText('Preventivo e contratto riutilizzabili', { exact: true }).click()
    await page.getByLabel('Contratto di base').fill('Accordo Agency approvato per {{cliente}} — {{progetto}}')
    await page.getByRole('button', { name: '＋ Voce riutilizzabile' }).click()
    await page.getByLabel('Servizio 1', { exact: true }).fill('Design per {{cliente}}')
    await page.getByLabel('Prezzo unitario, IVA esclusa').fill('1500')
    await page.getByRole('button', { name: 'Salva la base Agency' }).click()
    await page.getByText('Identità salvata:', { exact: false }).waitFor()
    await page.screenshot({ path: output + '/agency-base.png', fullPage: false })
    assert.equal(settings.quote_template?.items[0].unit_price, 1500)
    await page.goto(base + `/preventivi?agency_project=${projectId}`)
    await page.waitForFunction(() => (document.querySelector('textarea[maxlength="30000"]') as HTMLTextAreaElement)?.value.includes('Accordo Agency approvato per Alfa'))
    assert.equal(await page.getByLabel('Contratto abbinato al preventivo').inputValue(), 'Accordo Agency approvato per Alfa — Nuovo sito Alfa')
    await page.screenshot({ path: output + '/agency-quote.png', fullPage: false })
    await page.getByRole('button', { name: 'Genera preventivo', exact: true }).click()
    await page.waitForURL(`**/agency/${projectId}`)
    assert.equal(savedQuote.agency_project_id, projectId)
    assert.equal(savedQuote.items[0].unit_price, 1500)
    assert.equal(savedQuote.customer_tax_id, contact.billing_tax_id)
    assert.equal(savedQuote.status, 'draft')
    assert.deepEqual(errors, [])
    console.log('OK: base Agency salvata e riusata nel preventivo con contratto e dati fiscali')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exit(1) })
