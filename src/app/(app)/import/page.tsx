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

interface OcrResponse {
  files_processed: number
  extracted_contacts: number
  csv_text: string
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
type ImportMode = 'csv' | 'ocr'

export default function ImportPage() {
  const { refresh, showToast, teamMembers } = useCRMContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ocrInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [dragActive, setDragActive] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('csv')

  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [ocrFiles, setOcrFiles] = useState<string[]>([])

  const [listName, setListName] = useState('')
  const [eventTag, setEventTag] = useState('')
  const [importDate, setImportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [sourceLabel, setSourceLabel] = useState('evento')
  const [addToPipeline, setAddToPipeline] = useState(true)
  const [assignTo, setAssignTo] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResponse | null>(null)

  const preview = useMemo(() => {
    if (!csvText.trim()) return null
    const rows = parseCsvText(csvText)
    if (!rows.length) return null
    return { rows, detection: detectCsvColumns(rows) }
  }, [csvText])

  function prepareImportText(params: {
    fileName: string
    csvText: string
    mode: ImportMode
    fileLabels?: string[]
  }) {
    const inferredHuman = humanListName(params.fileName)
    const inferredSlug = slugify(params.fileName.replace(/\.[^.]+$/, ''))
    setImportMode(params.mode)
    setFileName(params.fileName)
    setCsvText(params.csvText)
    setOcrFiles(params.fileLabels || [])
    setListName(inferredHuman)
    setEventTag(inferredSlug)
    setSourceLabel(params.mode === 'ocr' ? 'ocr' : 'evento')
    setResult(null)
    setError('')
    setStep(2)
  }

  function ingestFile(file: File) {
    file.text().then((text) => {
      prepareImportText({
        fileName: file.name,
        csvText: text,
        mode: 'csv',
      })
    })
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) ingestFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])

    if (importMode === 'ocr') {
      if (files.length === 0) {
        setError('Carica almeno un’immagine.')
        return
      }
      void ingestOcrFiles(files)
      return
    }

    const file = files[0]
    if (file && (file.name.endsWith('.csv') || file.type.includes('csv'))) {
      ingestFile(file)
      return
    }

    setError('Serve un file CSV.')
  }

  async function ingestOcrFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) {
      setError('Carica immagini JPG, PNG o WebP.')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      for (const file of imageFiles) {
        formData.append('files', file)
      }

      const response = await apiFetch<OcrResponse>('/api/import/ocr', {
        method: 'POST',
        body: formData,
      })

      const syntheticName =
        imageFiles.length === 1
          ? imageFiles[0].name.replace(/\.[^.]+$/, '') + '-ocr.csv'
          : `ocr-${new Date().toISOString().slice(0, 10)}.csv`

      prepareImportText({
        fileName: syntheticName,
        csvText: response.csv_text,
        mode: 'ocr',
        fileLabels: imageFiles.map((file) => file.name),
      })
    } catch (ocrError) {
      setError(ocrError instanceof Error ? ocrError.message : 'OCR non riuscito')
    } finally {
      setLoading(false)
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
          default_responsible: assignTo || null,
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
    setImportMode('csv')
    setFileName('')
    setCsvText('')
    setOcrFiles([])
    setListName('')
    setEventTag('')
    setResult(null)
    setError('')
    setImportDate(new Date().toISOString().slice(0, 10))
    setSourceLabel('evento')
    setAddToPipeline(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (ocrInputRef.current) ocrInputRef.current.value = ''
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
        <div className="import-entry">
          <div className="import-mode-switch">
            <button
              type="button"
              className={`import-mode-pill ${importMode === 'csv' ? 'active' : ''}`}
              onClick={() => {
                setImportMode('csv')
                setError('')
              }}
            >
              CSV
            </button>
            <button
              type="button"
              className={`import-mode-pill ${importMode === 'ocr' ? 'active' : ''}`}
              onClick={() => {
                setImportMode('ocr')
                setError('')
              }}
            >
              OCR immagini
            </button>
          </div>

          <div
            className={`import-dropzone ${dragActive ? 'is-active' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => {
              if (importMode === 'ocr') ocrInputRef.current?.click()
              else fileInputRef.current?.click()
            }}
          >
            <div className="import-dropzone-emoji">{importMode === 'ocr' ? '📸' : '📥'}</div>
            <h2>
              {importMode === 'ocr'
                ? 'Trascina qui i biglietti da visita o le foto dei contatti'
                : 'Trascina qui il CSV della fiera'}
            </h2>
            <p>
              {importMode === 'ocr'
                ? 'Puoi caricare piu immagini: l’OCR estrae i campi e li prepara per l’import.'
                : 'oppure clicca per scegliere un file dal computer'}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <input
              ref={ocrInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || [])
                if (files.length > 0) void ingestOcrFiles(files)
              }}
              style={{ display: 'none' }}
            />

            {loading && importMode === 'ocr' && (
              <div className="import-helper">Analizzo le immagini e costruisco il CSV…</div>
            )}
            {error && <div className="import-error">{error}</div>}
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="import-confirm">
          <div className="import-confirm-head">
            <div>
              <h2>{preview.rows.length} contatti pronti</h2>
              <p>
                da <strong>{fileName}</strong> · {detectedFields.length} campi riconosciuti
                {importMode === 'ocr' ? ` · OCR su ${ocrFiles.length || 1} immagini` : ''}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetWizard}>
              Cambia file
            </button>
          </div>

          {importMode === 'ocr' && ocrFiles.length > 0 && (
            <div className="import-helper">
              Immagini elaborate: {ocrFiles.join(', ')}
            </div>
          )}

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
            {teamMembers.length > 0 && (
              <label className="import-field">
                <span>Assegna a</span>
                <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}>
                  <option value="">— Nessuna assegnazione —</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.name}>{member.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="import-field">
              <span>Origine</span>
              <select value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)}>
                <option value="evento">Evento / fiera</option>
                <option value="ocr">OCR / biglietto da visita</option>
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
