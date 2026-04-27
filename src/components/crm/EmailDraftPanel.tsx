'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { ScheduledCall } from '@/lib/schedule'
import type { ContactInput, CRMContact } from '@/types'

type DraftResult = {
  contact_id: string
  draft_id?: string
  error?: string
}

interface Props {
  todayCalls: ScheduledCall[]
  updateContact: (id: string, payload: Partial<ContactInput>) => Promise<CRMContact>
  showToast: (message: string) => void
}

export function EmailDraftPanel({ todayCalls, updateContact, showToast }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [commonNote, setCommonNote] = useState('')
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<DraftResult[] | null>(null)

  const contactsWithEmail = todayCalls.filter((call) => call.contact.email)
  const hasAnyEmail = contactsWithEmail.length > 0

  async function handleGenerate() {
    if (!hasAnyEmail || generating) return

    const drafts = contactsWithEmail
      .filter((call) => {
        const note = notes[call.contact.id]?.trim()
        return note
      })
      .map((call) => ({
        contact_id: call.contact.id,
        note: notes[call.contact.id]?.trim() || undefined,
      }))

    if (!drafts.length && !commonNote.trim()) {
      showToast('Inserisci almeno una nota per generare le bozze')
      return
    }

    // Include contacts without notes if commonNote is present
    if (commonNote.trim()) {
      for (const call of contactsWithEmail) {
        if (!drafts.find((d) => d.contact_id === call.contact.id)) {
          drafts.push({
            contact_id: call.contact.id,
            note: notes[call.contact.id]?.trim() || undefined,
          })
        }
      }
    }

    setGenerating(true)
    setResults(null)

    try {
      const response = await apiFetch<{
        results: DraftResult[]
        created: number
        failed: number
      }>('/api/ai/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts,
          common_note: commonNote.trim() || undefined,
        }),
      })

      setResults(response.results || [])

      // Save notes to contacts
      for (const call of todayCalls) {
        const note = notes[call.contact.id]?.trim()
        if (note && note !== (call.contact.email_draft_note || '')) {
          await updateContact(call.contact.id, {
            email_draft_note: note,
          } as ContactInput).catch(() => {})
        }
      }

      if (response.failed > 0) {
        showToast(`${response.created} bozze create, ${response.failed} errori`)
      } else {
        showToast(`${response.created} bozze create in Gmail`)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Errore generazione bozze')
    } finally {
      setGenerating(false)
    }
  }

  function getResult(contactId: string) {
    return results?.find((r) => r.contact_id === contactId) || null
  }

  if (!todayCalls.length) {
    return (
      <section className="oggi-email-draft">
        <div className="oggi-email-draft-head">
          <h2>✉️ Bozze email per oggi</h2>
        </div>
        <p className="oggi-muted">Nessun contatto in scadenza oggi.</p>
      </section>
    )
  }

  return (
    <section className="oggi-email-draft">
      <div className="oggi-email-draft-head">
        <h2>✉️ Bozze email per oggi</h2>
        <span className="oggi-email-draft-count">
          {contactsWithEmail.length}/{todayCalls.length} con email
        </span>
      </div>

      <div className="oggi-email-draft-common">
        <textarea
          className="oggi-email-draft-common-input"
          placeholder="Nota comune a tutte le bozze (es. contesto, offerta, CTA)..."
          value={commonNote}
          onChange={(e) => setCommonNote(e.target.value)}
          rows={2}
        />
      </div>

      <div className="oggi-email-draft-list">
        {todayCalls.map((call) => {
          const contact = call.contact
          const result = getResult(contact.id)
          const hasEmail = !!contact.email

          return (
            <div
              key={contact.id}
              className={`oggi-email-draft-row ${!hasEmail ? 'no-email' : ''} ${result ? (result.error ? 'has-error' : 'has-draft') : ''}`}
            >
              <div className="oggi-email-draft-info">
                <strong className="oggi-email-draft-name">{contact.name}</strong>
                {contact.company && (
                  <span className="oggi-email-draft-company">{contact.company}</span>
                )}
                {!hasEmail && <span className="oggi-email-draft-noemail">senza email</span>}
                {contact.email && (
                  <span className="oggi-email-draft-addr">{contact.email}</span>
                )}
              </div>

              {hasEmail && (
                <input
                  type="text"
                  className="oggi-email-draft-note"
                  placeholder="Suggerimento bozza..."
                  value={notes[contact.id] || ''}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [contact.id]: e.target.value }))
                  }
                  disabled={generating}
                />
              )}

              {result && (
                <span
                  className={`oggi-email-draft-status ${result.error ? 'status-error' : 'status-ok'}`}
                  title={result.error || `Draft Gmail: ${result.draft_id}`}
                >
                  {result.error ? '✗' : '✓'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="oggi-email-draft-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={!hasAnyEmail || generating}
        >
          {generating ? 'Generazione in corso...' : 'Genera bozze'}
        </button>

        {results && !generating && (
          <span className="oggi-email-draft-summary">
            {results.filter((r) => r.draft_id).length} create,{' '}
            {results.filter((r) => r.error).length} errori
          </span>
        )}
      </div>
    </section>
  )
}
