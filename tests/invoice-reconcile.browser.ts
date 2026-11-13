/** L'interfaccia registra una fattura esterna senza chiamare l'API di invio. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.CRM_STARTUP_TEST_URL || 'http://127.0.0.1:3100'
const owner = '11111111-1111-4111-8111-111111111111'
async function main() {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  await context.addInitScript(({ owner }) => {
    const access_token = btoa(JSON.stringify({ alg:'none',typ:'JWT' })) + '.' + btoa(JSON.stringify({ sub:owner,exp:Math.floor(Date.now()/1000)+3600 })) + '.test'
    localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{ id:owner,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z' } }))
  }, { owner })
  let saved: any = null
  const calls: string[] = []
  const quote = { id:'q-1',quote_number:'PREV-1',title:'Sito',customer_name:'Cliente',customer_company:null,total_amount:120,status:'paid',payment_state:'paid',paid_at:'2026-01-03',accepted_at:'2026-01-01' }
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const json = (x:unknown) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
    if (route.request().method() !== 'GET') { calls.push(url.pathname); if (url.pathname === '/api/invoices/reconcile') { saved=route.request().postDataJSON(); return json({invoice:{id:'i-1'}}) } return route.fulfill({status:400,body:'Unexpected write'}) }
    if (url.pathname === '/api/team-members') return json({members:[],is_admin:true})
    if (url.pathname === '/api/pipeline-stages') return json({stages:[]})
    if (url.pathname === '/api/contacts') return json({contacts:[{ id:'c-1',name:'Cliente',status:'New',source:'manual',contact_scope:'crm',priority:0,created_at:'2026-01-01',updated_at:'2026-01-01' }]})
    if (url.pathname === '/api/contacts/summary') return json({counts:{total:1}})
    if (url.pathname === '/api/invoices') return json({invoices:[],to_invoice:saved?[]:[quote],outside_quotes:[],aruba:{configured:false,env:'production'},settings_saved:false})
    if (url.pathname === '/api/receivables') return json({receivables:[]})
    return json({tasks:[],columns:[]})
  })
  const page = await context.newPage()
  try {
    await page.goto(`${base}/fatture`,{waitUntil:'domcontentloaded'})
    await page.getByRole('button',{name:'Già fatturata'}).click()
    await page.getByLabel('Numero fattura').fill('17/2026')
    await page.getByLabel('Data emissione').fill('2026-01-02')
    await page.locator('form').filter({has: page.getByLabel('Numero fattura')}).locator('select').first().selectOption('paid')
    await page.getByLabel('Data incasso').fill('2026-01-03')
    await page.getByRole('button',{name:'Registra',exact:true}).click()
    await page.getByText('Fattura esterna registrata', { exact:false }).waitFor()
    assert.equal(saved.quote_id,'q-1'); assert.equal(saved.payment_state,'paid'); assert.equal(saved.paid_at,'2026-01-03')
    assert.deepEqual(calls,['/api/invoices/reconcile'])
    console.log('PASS: fattura esterna incassata senza invio SDI')
  } finally { await browser.close() }
}
main().catch(e => {console.error(e);process.exitCode=1})
