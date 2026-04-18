'use client'

import Link from 'next/link'
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { detectCsvColumns, parseCsvText } from '@/lib/csv-import'
import { useCRMContext } from '../layout'

interface ImportResponse {
  parsed_rows: number
  imported_contacts: number
  created_contacts: number
  updated_contacts: number
  matched_contacts: number
  created_tasks: number
  contact_scope?: 'crm' | 'holding'
  list_name?: string | null
  detected_mapping?: Record<string, string>
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function humanListName(filename: string) {
  const base = filename.replace(/\.[^.]+$/, '')
  const spaced = base.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return 'Import senza nome'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

type Step = 1 | 2 | 3

export default function ImportPage() {
  const { refresh, showToast } = useCRMContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [dragActive, setDragActive] = useState(false)

  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')

  const [listName, setListName] = useState('')
  const [eventTag, setEventTag] = useState('')
  const [importDate, setImportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sourceLabel, setSourceLabel] = useState('evento')
  const [addToPipeline, setAddToPipeline] = useState(true)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResponse | null>(null)

  const preview = useMemo(() => {
    if (!csvText.trim()) return null
    const rows = parseCsvText(csvText)
    if (!rows.length) return null
    return { rows, detection: detectCsvColumns(rows) }
  }, [csvText])

  function ingestFile(file: File) {
    setError('')
    setResult(null)
    setFileName(file.name)
    const inferredHuman = humanListName(file.name)
    const inferredSlug = slugify(file.name.replace(/\.[^.]+$/, ''))
    setListName(inferredHuman)
    setEventTag(inferredSlug)
    file.text().then((text) => {
      setCsvText(text)
      setStep(2)
    })
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) ingestFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file && (file.name.endsWith('.csv') || file.type.includes('csv'))) {
      ingestFile(file)
    } else {
      setError('Serve un file CSV.')
    }
  }

  async function handleImport() {
    if (!csvText.trim()) {
      setError('Nessun file caricato.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch<ImportResponse>('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_text: csvText,
          default_source: sourceLabel,
          default_category: eventTag || null,
          contact_scope: addToPipeline ? 'crm' : 'holding',
          list_name: listName,
          event_tag: eventTag || null,
          imported_at: importDate,
          file_name: fileName,
        }),
      })
      setResult(response)
      await refresh()
      setStep(3)
      showToast(`${response.imported_contacts} contatti importati in "${listName}"`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import non riuscito')
    } finally {
      setLoading(false)
    }
  }

  function resetWizard() {
    setStep(1)
    setFileName('')
    setCsvText('')
    setListName('')
    setEventTag('')
    setResult(null)
    setError('')
    setImportDate(new Date().toISOString().slice(0, 10))
    setSourceLabel('evento')
    setAddToPipeline(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const detectedFields = preview
    ? (Object.entries(preview.detection.mapping) as Array<[string, string | undefined]>)
        .filter(([, header]) => Boolean(header))
        .map(([field]) => field)
    : []

  return (
    <div className="import-wizard">
      <div className="import-steps">
        <div className={`import-step ${step >= 1 ? 'active' : ''}`}>
          <span className="import-step-num">1</span>
          <span>Carica CSV</span>
        </div>
        <div className="import-step-divider" />
        <div className={`import-step ${step >= 2 ? 'active' : ''}`}>
          <span className="import-step-num">2</span>
          <span>Conferma</span>
        </div>
        <div className="import-step-divider" />
        <div className={`import-step ${step >= 3 ? 'active' : ''}`}>
          <span className="import-step-num">3</span>
          <span>Fatto</span>
        </div>
      </div>

      {step === 1 && (
        <div
          className={`import-dropzone ${dragActive ? 'is-active' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="import-dropzone-emoji">📥</div>
          <h2>Trascina qui il CSV della fiera</h2>
          <p>oppure clicca per scegliere un file dal computer</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {error && <div className="import-error">{error}</div>}
        </div>
      )}

      {step === 2 && preview && (
        <div className="import-confirm">
          <div className="import-confirm-head">
            <div>
              <h2>{preview.rows.length} contatti pronti</h2>
              <p>da <strong>{fileName}</strong> · {detectedFields.length} campi riconosciuti</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetWizard}>
              Cambia file
            </button>
          </div>

          <div className="import-confirm-grid">
            <label className="import-field">
              <span>Nome lista</span>
              <input
                type="text"
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="Es. Vinitaly 2026"
              />
            </label>
            <label className="import-field">
              <span>Tag (slug)</span>
              <input
                type="text"
                value={eventTag}
                onChange={(event) => setEventTag(slugify(event.target.value))}
                placeholder="vinitaly-2026"
              />
            </label>
            <label className="import-field">
              <span>Data evento / import</span>
              <input
                type="date"
                value={importDate}
                onChange={(event) => setImportDate(event.target.value)}
              />
            </label>
            <label className="import-field">
              <span>Origine</span>
              <select value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)}>
                <option value="evento">Evento / fiera</option>
                <option value="vinitaly">Vinitaly</option>
                <option value="import">Import generico</option>
                <option value="manual">Manuale</option>
              </select>
            </label>
          </div>

          <label className="import-toggle">
            <input
              type="checkbox"
              checked={addToPipeline}
              onChange={(event) => setAddToPipeline(event.target.checked)}
            />
            <div>
              <strong>Aggiungi subito alla Pipeline</strong>
              <span>Consigliato. Disattiva solo per contatti da filtrare prima.</span>
            </div>
          </label>

          <div className="import-mapping">
            <div className="import-mapping-title">Colonne riconosciute</div>
            <div className="import-mapping-list">
              {detectedFields.length === 0 ? (
                <span className="import-muted">Nessuna colonna riconosciuta automaticamente.</span>
              ) : (
                detectedFields.map((field) => (
                  <span key={field} className="import-mapping-pill">
                    <strong>{field}</strong> ← {(preview.detection.mapping as Record<string, string | undefined>)[field]}
                  </span>
                ))
              )}
            </div>
            {preview.detection.unmatchedHeaders.length > 0 && (
              <div className="import-mapping-extra">
                Colonne ignorate: {preview.detection.unmatchedHeaders.join(', ')}
              </div>
            )}
          </div>

          {error && <div className="import-error">{error}</div>}

          <div className="import-confirm-actions">
            <button type="button" className="btn btn-ghost" onClick={resetWizard}>
              Annulla
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleImport}
              disabled={loading || !listName.trim()}
            >
              {loading ? 'Import in corso…' : `Importa ${preview.rows.length} contatti`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="import-success">
          <div className="import-success-emoji">✅</div>
          <h2>{result.imported_contacts} contatti pronti</h2>
          <p>
            in lista <strong>{listName}</strong> · tag <code>{eventTag || '—'}</code>
          </p>

          <div className="import-success-stats">
            <div>
              <strong>{result.created_contacts}</strong>
              <span>nuovi</span>
            </div>
            <div>
              <strong>{result.updated_contacts}</strong>
              <span>aggiornati</span>
            </div>
            <div>
              <strong>{result.matched_contacts}</strong>
              <span>match trovati</span>
            </div>
          </div>

          <div className="import-success-actions">
            <Link
              href={`/contacts?list=${encodeURIComponent(listName)}`}
              className="btn btn-primary"
            >
              Apri la lista →
            </Link>
            <Link href="/dashboard" className="btn btn-ghost">
              Torna a Oggi
            </Link>
            <button type="button" className="btn btn-ghost" onClick={resetWizard}>
              Altro import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
