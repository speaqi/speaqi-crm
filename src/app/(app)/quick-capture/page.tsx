'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PRIORITY_OPTIONS, fromDatetimeLocalValue, toDatetimeLocalValue } from '@/lib/data'
import { useCRMContext } from '../layout'

const SESSION_COUNT_KEY = 'speaqi_quick_capture_count_v1'
const CAPTURE_DEFAULTS_KEY = 'speaqi_quick_capture_defaults_v1'

type QuickCaptureFormState = {
  name: string
  company: string
  phone: string
  email: string
  eventTag: string
  note: string
  followupAt: string
  priority: number
  followupLabel: string
}

type CaptureDefaults = Pick<QuickCaptureFormState, 'eventTag' | 'followupAt' | 'priority' | 'followupLabel'>

function buildDefaultFollowup() {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(10, 0, 0, 0)
  return toDatetimeLocalValue(next.toISOString())
}

function readCaptureDefaults(): CaptureDefaults | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(CAPTURE_DEFAULTS_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CaptureDefaults>
    return {
      eventTag: String(parsed.eventTag || ''),
      followupAt: String(parsed.followupAt || buildDefaultFollowup()),
      priority: Number.isFinite(Number(parsed.priority)) ? Number(parsed.priority) : 2,
      followupLabel: String(parsed.followupLabel || ''),
    }
  } catch {
    return null
  }
}

function buildEmptyForm(defaults?: Partial<CaptureDefaults>): QuickCaptureFormState {
  return {
    name: '',
    company: '',
    phone: '',
    email: '',
    eventTag: defaults?.eventTag || '',
    note: '',
    followupAt: defaults?.followupAt || buildDefaultFollowup(),
    priority: defaults?.priority ?? 2,
    followupLabel: defaults?.followupLabel || '',
  }
}

function focusAllowed() {
  if (typeof window === 'undefined') return false
  return !window.matchMedia('(max-width: 860px)').matches
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || 'Salvataggio non riuscito')
  }
  return 'Salvataggio non riuscito'
}

function normalizeText(value: string) {
  return value.trim().toLowerCase()
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, '')
}

function parsePastedContact(raw: string) {
  const cleaned = raw.replace(/\r/g, '').trim()
  const emailMatch = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  const phoneMatch = cleaned.match(/(?:\+?\d[\d\s()./-]{6,}\d)/)
  const email = emailMatch?.[0] || ''
  const phone = phoneMatch?.[0] || ''

  const stripped = cleaned
    .replace(email, ' ')
    .replace(phone, ' ')
    .replace(/\s[|•;]\s/g, '\n')
    .replace(/\s[-–—]\s/g, '\n')

  const segments = stripped
    .split('\n')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const [name = '', company = '', ...rest] = segments

  return {
    name,
    company,
    email,
    phone,
    note: rest.join('\n'),
  }
}

function shiftFollowupDays(currentValue: string, days: number) {
  const base = currentValue ? new Date(currentValue) : new Date()
  if (Number.isNaN(base.getTime())) {
    return buildDefaultFollowup()
  }

  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return toDatetimeLocalValue(next.toISOString())
}

export default function QuickCapturePage() {
  const { createContact, allContacts, showToast } = useCRMContext()
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const [form, setForm] = useState<QuickCaptureFormState>(() => buildEmptyForm(readCaptureDefaults() || undefined))
  const [sessionCount, setSessionCount] = useState(() => {
    if (typeof window === 'undefined') return 0
    const storedCount = Number(window.sessionStorage.getItem(SESSION_COUNT_KEY) || 0)
    return Number.isFinite(storedCount) ? storedCount : 0
  })
  const [lastSavedName, setLastSavedName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(SESSION_COUNT_KEY, String(sessionCount))
  }, [sessionCount])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      CAPTURE_DEFAULTS_KEY,
      JSON.stringify({
        eventTag: form.eventTag,
        followupAt: form.followupAt,
        priority: form.priority,
        followupLabel: form.followupLabel,
      } satisfies CaptureDefaults)
    )
  }, [form.eventTag, form.followupAt, form.priority, form.followupLabel])

  useEffect(() => {
    if (!focusAllowed()) return
    noteRef.current?.focus()
  }, [])

  const duplicateMatches = useMemo(() => {
    const email = normalizeText(form.email)
    const phone = digitsOnly(form.phone)
    const name = normalizeText(form.name)
    const company = normalizeText(form.company)

    if (!email && !phone && !name) return []

    return allContacts
      .filter((contact) => {
        const sameEmail = email && normalizeText(contact.email || '') === email
        const samePhone = phone && digitsOnly(contact.phone || '') === phone
        const sameNameCompany =
          name &&
          normalizeText(contact.name || '') === name &&
          company &&
          normalizeText(contact.company || '') === company

        return !!(sameEmail || samePhone || sameNameCompany)
      })
      .slice(0, 4)
  }, [allContacts, form.company, form.email, form.name, form.phone])

  function handleSmartPaste(text: string) {
    const parsed = parsePastedContact(text)

    setForm((current) => ({
      ...current,
      name: current.name || parsed.name,
      company: current.company || parsed.company,
      email: current.email || parsed.email,
      phone: current.phone || parsed.phone,
      note: [current.note, parsed.note].filter(Boolean).join(current.note && parsed.note ? '\n' : ''),
    }))

    showToast('Dati incollati e distribuiti nei campi')
  }

  async function handleSaveAndNext() {
    const name = form.name.trim()
    const nextFollowupAt = fromDatetimeLocalValue(form.followupAt)

    if (!name) {
      setError('Il nome è obbligatorio per salvare il contatto.')
      return
    }

    if (!nextFollowupAt) {
      setError('Imposta una data di follow-up valida.')
      return
    }

    setSaving(true)
    setError('')

    try {
      const contact = await createContact({
        name,
        company: form.company.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        event_tag: form.eventTag.trim(),
        note: form.note.trim(),
        status: 'New',
        source: 'evento',
        priority: form.priority,
        next_followup_at: nextFollowupAt,
        initial_task_note: form.followupLabel.trim(),
      })

      setSessionCount((current) => current + 1)
      setLastSavedName(contact.name)
      setForm((current) => ({
        ...buildEmptyForm({
          eventTag: current.eventTag,
          followupAt: current.followupAt,
          priority: current.priority,
          followupLabel: current.followupLabel,
        }),
        eventTag: current.eventTag,
        followupAt: current.followupAt,
        priority: current.priority,
        followupLabel: current.followupLabel,
      }))
      showToast(`Contatto salvato: ${contact.name}`)

      if (focusAllowed()) {
        window.requestAnimationFrame(() => noteRef.current?.focus())
      }
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const helperCopy = form.eventTag.trim()
    ? `Sessione evento attiva: ${form.eventTag.trim()}`
    : 'Imposta l’evento una volta e continua a inserire contatti in sequenza.'

  return (
    <div className="dash-content">
      <div className="detail-header">
        <div>
          <h1 className="detail-title">Quick Capture</h1>
          <div className="detail-subtitle">
            Inserimento rapido post-fiera: nome, contesto, follow-up e prossimo contatto senza cambiare schermata.
          </div>
        </div>
        <div className="capture-counter" aria-live="polite">
          <strong>{sessionCount}</strong>
          <span>contatti aggiunti in questa sessione</span>
        </div>
      </div>

      <div className="capture-grid">
        <div className="dash-card capture-card">
          <div className="dash-card-title">Nuovo contatto da evento</div>

          {error ? <div className="inline-error capture-inline-message">{error}</div> : null}
          {duplicateMatches.length > 0 ? (
            <div className="capture-duplicates" aria-live="polite">
              <strong>Possibili duplicati</strong>
              <div className="capture-duplicate-list">
                {duplicateMatches.map((contact) => (
                  <div key={contact.id} className="capture-duplicate-item">
                    <span>{contact.name}</span>
                    <span>{contact.company || contact.email || contact.phone || 'Scheda esistente'}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="dash-meta-grid" style={{ marginBottom: 20 }}>
            <div className="meta-card meta-card-strong">
              <strong>{sessionCount}</strong>
              <span>salvati in questa sessione</span>
            </div>
            <div className="meta-card">
              <strong>{form.eventTag.trim() || 'Nessuno'}</strong>
              <span>tag evento attivo</span>
            </div>
            <div className="meta-card">
              <strong>{PRIORITY_OPTIONS.find((option) => option.value === form.priority)?.label || 'Media'}</strong>
              <span>priorità predefinita</span>
            </div>
            <div className="meta-card">
              <strong>{form.followupAt ? form.followupAt.slice(0, 16).replace('T', ' ') : 'Non impostato'}</strong>
              <span>follow-up iniziale</span>
            </div>
          </div>

          <form
            className="capture-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSaveAndNext()
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void handleSaveAndNext()
              }
            }}
          >
            <div className="frow">
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-name">
                  Nome *
                </label>
                <input
                  id="quick-capture-name"
                  className="fi"
                  name="name"
                  autoComplete="off"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  onPaste={(event) => {
                    const pastedText = event.clipboardData.getData('text/plain')
                    if (!pastedText || !(pastedText.includes('@') || /\d{6,}/.test(pastedText) || pastedText.includes('\n'))) {
                      return
                    }
                    event.preventDefault()
                    handleSmartPaste(pastedText)
                  }}
                  placeholder="Es. Mario Rossi"
                />
                <div className="capture-helper">
                  Incolla qui una scheda contatto completa e il parser prova a estrarre nome, azienda, email e telefono.
                </div>
              </div>
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-company">
                  Azienda
                </label>
                <input
                  id="quick-capture-company"
                  className="fi"
                  name="company"
                  autoComplete="organization"
                  value={form.company}
                  onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
                  placeholder="Es. Acme SRL"
                />
              </div>
            </div>

            <div className="frow">
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-phone">
                  Telefono
                </label>
                <input
                  id="quick-capture-phone"
                  className="fi"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+39 333 1234567"
                />
              </div>
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-email">
                  Email
                </label>
                <input
                  id="quick-capture-email"
                  className="fi"
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="nome@azienda.it"
                />
              </div>
            </div>

            <div className="fg">
              <label className="fl" htmlFor="quick-capture-event-tag">
                Event Tag
              </label>
              <input
                id="quick-capture-event-tag"
                className="fi"
                name="event_tag"
                autoComplete="off"
                value={form.eventTag}
                onChange={(event) => setForm((current) => ({ ...current, eventTag: event.target.value }))}
                placeholder="Es. Fiera Milano 2026"
              />
            </div>

            <div className="fg">
              <label className="fl" htmlFor="quick-capture-note">
                Note Raw
              </label>
              <textarea
                id="quick-capture-note"
                ref={noteRef}
                className="fi capture-note-input"
                name="note"
                rows={7}
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Met at booth 12, interested in pricing, richiamare martedi dopo le 15…"
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="frow">
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-followup">
                  Follow-up
                </label>
                <input
                  id="quick-capture-followup"
                  className="fi"
                  name="followup_at"
                  type="datetime-local"
                  value={form.followupAt}
                  onChange={(event) => setForm((current) => ({ ...current, followupAt: event.target.value }))}
                />
                <div className="capture-chip-row">
                  <button
                    className="filter-chip"
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, followupAt: shiftFollowupDays(current.followupAt, 1) }))}
                  >
                    +1g
                  </button>
                  <button
                    className="filter-chip"
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, followupAt: shiftFollowupDays(current.followupAt, 3) }))}
                  >
                    +3g
                  </button>
                  <button
                    className="filter-chip"
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, followupAt: shiftFollowupDays(current.followupAt, 7) }))}
                  >
                    +7g
                  </button>
                </div>
              </div>
              <div className="fg">
                <label className="fl" htmlFor="quick-capture-priority">
                  Priorità
                </label>
                <select
                  id="quick-capture-priority"
                  className="fi"
                  name="priority"
                  value={String(form.priority)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, priority: Number(event.target.value) }))
                  }
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="fg">
              <label className="fl" htmlFor="quick-capture-followup-label">
                Label Follow-up
              </label>
              <input
                id="quick-capture-followup-label"
                className="fi"
                name="followup_label"
                autoComplete="off"
                value={form.followupLabel}
                onChange={(event) => setForm((current) => ({ ...current, followupLabel: event.target.value }))}
                placeholder="Es. Invia pricing"
              />
            </div>

            <div className="capture-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() =>
                  setForm((current) =>
                    buildEmptyForm({
                      eventTag: current.eventTag,
                      followupAt: current.followupAt,
                      priority: current.priority,
                      followupLabel: current.followupLabel,
                    })
                  )
                }
                disabled={saving}
              >
                Resetta
              </button>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? 'Salvataggio…' : 'Save & Next'}
              </button>
            </div>
          </form>
        </div>

        <div className="dash-card capture-sidecard">
          <div className="dash-card-title">Flusso rapido</div>
          <div className="capture-sidecopy">
            <p>{helperCopy}</p>
            <p>Le note restano sempre visibili e vengono salvate anche nella timeline attività del contatto.</p>
            <p>Il pulsante Save &amp; Next pulisce i campi del contatto ma mantiene evento e follow-up predefiniti per l’inserimento in sequenza.</p>
            <p>`Cmd/Ctrl + Enter` salva subito il contatto. I pulsanti `+1g`, `+3g`, `+7g` accelerano la pianificazione del prossimo step.</p>
            <p>{lastSavedName ? `Ultimo contatto salvato: ${lastSavedName}` : 'Nessun contatto salvato in questa sessione.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
