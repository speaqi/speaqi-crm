import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reconcileDestinationDraft, sendDestinationEmail } from '../src/lib/server/trade-fair-destination-email'
import { FAIR_EMAIL_COPIES, fairEmailAudience } from '../src/lib/trade-fair-destination-email'

function database(overrides: Record<string, unknown> = {}, contact: any = null) {
  let row: any = {
    id: 'one', user_id: 'owner', name: 'APT Trento', country: 'Italia', organization_type: 'dmo',
    status: 'new', email: ' Ente@example.it ', notes: [], outreach: {}, updated_at: 'before', ...overrides,
  }
  const db = {
    read: () => structuredClone(row),
    from(table: string) {
      if (table === 'contacts') {
        const query = { select() { return query }, eq() { return query }, async maybeSingle() { return { data: contact, error: null } } }
        return query
      }
      let patch: any
      const filters: Array<[string, unknown]> = []
      const query = {
        select() { return query },
        update(value: any) { patch = value; return query },
        eq(key: string, value: unknown) { filters.push([key, value]); return query },
        is(key: string, value: unknown) { filters.push([key, value]); return query },
        async maybeSingle() {
          assert.equal(table, 'trade_fair_exhibitors')
          const matches = filters.every(([key, value]) => {
            if (key === 'outreach->destination_email') return row.outreach.destination_email == null
            if (key === 'outreach->destination_email->>token') return row.outreach.destination_email?.token === value
            if (key === 'outreach->destination_email->>status') return row.outreach.destination_email?.status === value
            return row[key] === value
          })
          if (!matches) return { data: null, error: null }
          if (patch) row = { ...row, ...structuredClone(patch) }
          return { data: structuredClone(row), error: null }
        },
        then(resolve: any, reject: any) { return query.maybeSingle().then(resolve, reject) },
      }
      return query
    },
  }
  return db
}

function dependencies(send: (input: any) => Promise<any> = async () => ({ message_id: 'gmail-1', account_email: 'sender@example.it', thread_id: 'thread-1' })) {
  return {
    signature: async () => ({ text: 'Massimo Morgante\nFirma salvata nel CRM', html: '<p>Massimo Morgante<br>Firma salvata nel CRM</p>', source: 'settings' as const }),
    sender: async () => 'sender@example.it',
    send: async (_db: any, _user: string, input: any) => send(input),
  }
}

const input = { id: 'one', subject: 'Incontro TTG', text: 'Buongiorno, possiamo incontrarci?' }

test('invia al destinatario nel workspace con la firma CRM e registra l’esito', async () => {
  const db = database()
  let message: any
  const result = await sendDestinationEmail(db, 'owner', input, dependencies(async (value) => {
    message = value
    return { message_id: 'gmail-1', account_email: 'sender@example.it', thread_id: null }
  }))
  assert.equal(message.to, 'ente@example.it')
  assert.match(message.text, /Firma salvata nel CRM/)
  assert.match(message.html, /<p>Massimo Morgante/)
  assert.equal(result.exhibitor.status, 'contacted')
  assert.equal(db.read().outreach.destination_email.status, 'sent')
  assert.equal(db.read().outreach.destination_email.message_id, 'gmail-1')
  assert.equal(db.read().notes.length, 1)
  await assert.rejects(sendDestinationEmail(db, 'owner', input, dependencies()), /già stata inviata/)
})

test('due richieste contemporanee inviano una sola email', async () => {
  const db = database()
  let sends = 0
  const deps = dependencies(async () => { sends++; return { message_id: 'one', account_email: 'sender', thread_id: null } })
  const results = await Promise.allSettled([sendDestinationEmail(db, 'owner', input, deps), sendDestinationEmail(db, 'owner', input, deps)])
  assert.equal(sends, 1)
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
})

test('non invia fuori dal workspace, a tipologie escluse, senza indirizzo o a non interessati', async () => {
  let sends = 0
  const deps = dependencies(async () => { sends++; return {} })
  for (const overrides of [{ user_id: 'other' }, { organization_type: 'hotel' }, { email: 'errato' }, { status: 'not_interested' }]) {
    await assert.rejects(sendDestinationEmail(database(overrides), 'owner', input, deps))
  }
  assert.equal(sends, 0)
})

test('tre email abbinate a italiani, esteri e tour operator, con lingua corretta', async () => {
  assert.deepEqual(Object.keys(FAIR_EMAIL_COPIES), ['italiane', 'estere', 'operatori'])
  const cases = [
    [{}, 'italiane'],
    [{ country: 'Francia' }, 'estere'],
    [{ organization_type: 'tour_operator' }, 'operatori'],
    [{ organization_type: 'dmc' }, 'operatori'],
    [{ country: 'Italia', category: 'ENTI DEL TURISMO ESTERI' }, 'estere'],
  ] as const
  for (const [overrides, audience] of cases) {
    const db = database(overrides)
    assert.equal(fairEmailAudience(db.read()), audience)
    const copy = FAIR_EMAIL_COPIES[audience]
    let sent: any
    await sendDestinationEmail(db, 'owner', { id: 'one', subject: copy.subject, text: copy.body }, dependencies(async (message) => {
      sent = message
      return { message_id: 'ok', account_email: 'sender', thread_id: null }
    }))
    assert.equal(sent.subject, copy.subject)
    assert.ok(sent.text.startsWith(copy.body))
    assert.match(sent.text, /Firma salvata nel CRM/)
    assert.match(sent.text, audience === 'estere' ? /reply “no thanks”/ : /rispondete «no grazie»/)
  }
})

test('firma o Gmail mancanti non prenotano un invio', async () => {
  const noSignature = database()
  await assert.rejects(sendDestinationEmail(noSignature, 'owner', input, { ...dependencies(), signature: async () => { throw new Error('Firma mancante') } }))
  assert.equal(noSignature.read().outreach.destination_email, undefined)
  const noGmail = database()
  await assert.rejects(sendDestinationEmail(noGmail, 'owner', input, { ...dependencies(), sender: async () => null }), /Gmail non collegato/)
  assert.equal(noGmail.read().outreach.destination_email, undefined)
})

test('non invia a un contatto collegato disiscritto o escluso', async () => {
  let sends = 0
  for (const contact of [{ status: 'unsubscribed' }, { email_unsubscribed_at: '2026-10-01' }, { marketing_eligibility: 'suppressed' }, null]) {
    const db = database({ contact_id: 'contact' }, contact)
    await assert.rejects(sendDestinationEmail(db, 'owner', input, dependencies(async () => { sends++; return {} })))
    assert.equal(db.read().outreach.destination_email, undefined)
  }
  assert.equal(sends, 0)
})

test('un errore durante l’invio conserva lo stato da verificare e impedisce duplicati', async () => {
  const db = database()
  await assert.rejects(sendDestinationEmail(db, 'owner', input, dependencies(async () => { throw new Error('Timeout') })), /Verifica in Gmail/)
  assert.equal(db.read().outreach.destination_email.status, 'unknown')
  let sends = 0
  await assert.rejects(sendDestinationEmail(db, 'owner', input, dependencies(async () => { sends++; return {} })), /Invio già avviato/)
  assert.equal(sends, 0)
})

test('prepara una bozza Gmail con firma, senza inviare o segnare contattato', async () => {
  const db = database()
  let sends = 0
  let drafts = 0
  let content: any
  const deps = { ...dependencies(async () => { sends++; return {} }), draft: async (_db: any, _user: string, message: any) => {
    drafts++; content = message
    return { draftId: 'draft-1', messageId: 'message-1' }
  }, draftUpdate: async (_db: any, _user: string, draftId: string, message: any) => {
    assert.equal(draftId, 'draft-1')
    content = message
    return { draftId, messageId: 'message-2' }
  } }
  const result = await sendDestinationEmail(db, 'owner', { ...input, mode: 'draft' }, deps)
  assert.equal(result.sent, false)
  assert.match(result.url || '', /https:\/\/mail.google.com\/mail\/u\/sender%40example.it\/#drafts\?compose=message-1/)
  assert.match(content.text, /Firma salvata nel CRM/)
  assert.match(content.html, /<p>Massimo Morgante/)
  assert.match(content.messageIdHeader, /@speaqi.crm>$/)
  assert.equal(db.read().status, 'new')
  assert.equal(db.read().notes.length, 0)
  assert.equal(db.read().outreach.destination_email.status, 'draft')
  assert.equal(sends, 0)

  const reopened = await sendDestinationEmail(db, 'owner', { ...input, text: 'Testo modificato nel CRM', mode: 'draft' }, deps)
  assert.notEqual(reopened.url, result.url)
  assert.equal(drafts, 1)
  assert.equal(db.read().outreach.destination_email.body, content.text)
  assert.equal(db.read().outreach.destination_email.original_text, 'Testo modificato nel CRM')
  await assert.rejects(sendDestinationEmail(db, 'owner', input, deps), /Invio già avviato/)
})

test('due creazioni concorrenti preparano una sola bozza', async () => {
  const db = database()
  let drafts = 0
  const deps = { ...dependencies(), draft: async () => { drafts++; return { draftId: 'draft', messageId: 'message' } } }
  const results = await Promise.allSettled([sendDestinationEmail(db, 'owner', { ...input, mode: 'draft' }, deps), sendDestinationEmail(db, 'owner', { ...input, mode: 'draft' }, deps)])
  assert.equal(drafts, 1)
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
})

test('una bozza cancellata, ancora presente o non verificabile non viene segnata come inviata', async () => {
  for (const state of ['draft', 'missing', 'unavailable'] as const) {
    const db = database({ outreach: { destination_email: { status: 'draft', token: 'token', to: 'ente@example.it', subject: 'Oggetto', body: 'Testo' } } })
    await reconcileDestinationDraft(db, 'owner', 'one', async () => ({ state }))
    assert.equal(db.read().outreach.destination_email.status, 'draft')
    assert.equal(db.read().status, 'new')
    assert.equal(db.read().notes.length, 0)
  }
})

test('la conferma da Inviati aggiorna CRM e contenuto una sola volta', async () => {
  const db = database({ outreach: { destination_email: { status: 'draft', token: 'token', to: 'ente@example.it', subject: 'Oggetto', body: 'Testo' } } })
  let inspections = 0
  const inspect = async () => { inspections++; return { state: 'sent' as const, id: 'sent-1', sentAt: '2026-10-14T07:00:00Z', subject: 'Oggetto definitivo', text: 'Testo modificato da Gmail' } }
  await reconcileDestinationDraft(db, 'owner', 'one', inspect)
  assert.equal(db.read().outreach.destination_email.status, 'sent')
  assert.equal(db.read().outreach.destination_email.message_id, 'sent-1')
  assert.equal(db.read().outreach.destination_email.body, 'Testo modificato da Gmail')
  assert.equal(db.read().status, 'contacted')
  await reconcileDestinationDraft(db, 'owner', 'one', inspect)
  assert.equal(inspections, 1)
  assert.equal(db.read().notes.length, 1)
})

test('la riconciliazione rispetta il workspace e la preparazione incerta non crea doppioni', async () => {
  await assert.rejects(reconcileDestinationDraft(database({ user_id: 'other' }), 'owner', 'one', async () => ({ state: 'missing' })), /non trovato/)
  const db = database()
  const deps = { ...dependencies(), draft: async () => { throw new Error('Timeout') } }
  await assert.rejects(sendDestinationEmail(db, 'owner', { ...input, mode: 'draft' }, deps), /Verifica in Gmail/)
  assert.equal(db.read().outreach.destination_email.status, 'unknown')
  await assert.rejects(sendDestinationEmail(db, 'owner', { ...input, mode: 'draft' }, deps), /Invio già avviato/)
})
