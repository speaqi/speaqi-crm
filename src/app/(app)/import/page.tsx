'use client'

import Link from 'next/link'
import { ChangeEvent, useMemo, useState } from 'react'
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

export default function ImportPage() {
  const { refresh, showToast } = useCRMContext()
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [defaultSource, setDefaultSource] = useState('vinitaly')
  const [defaultCategory, setDefaultCategory] = useState('vinitaly-winery')
  const [separateList, setSeparateList] = useState(true)
  const [listName, setListName] = useState('')
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const preview = useMemo(() => {
    if (!csvText.trim()) return null
    const rows = parseCsvText(csvText)
    if (!rows.length) return null
    return {
      rows,
      detection: detectCsvColumns(rows),
    }
  }, [csvText])

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setResult(null)
    setFileName(file.name)
    setCsvText(await file.text())
    setListName(file.name.replace(/\.[^.]+$/, ''))
  }

  async function handleImport() {
    if (!csvText.trim()) {
      setError('Carica prima il file contacts_import.csv')
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
          default_source: defaultSource,
          default_category: defaultCategory,
          contact_scope: separateList ? 'holding' : 'crm',
          list_name: listName,
          file_name: fileName,
        }),
      })

      setResult(response)
      await refresh()
      showToast(
        separateList
          ? `Import completato: ${response.imported_contacts} contatti in lista separata`
          : `Import completato: ${response.imported_contacts} contatti`
      )
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import non riuscito')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20 }}>
      <div className="dash-card" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="dash-card-title" style={{ marginBottom: 6 }}>Import CSV nel CRM</div>
            <p style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.5 }}>
              Carica un CSV reale e il sistema proverà a riconoscere automaticamente colonne come <strong>Nome</strong>,
              <strong>Cognome</strong>, <strong>Azienda</strong>, <strong>Email</strong>, <strong>Telefono</strong>,
              <strong>Priorità</strong> e <strong>Note</strong>. Se scegli una lista separata, i contatti restano fuori dal CRM operativo.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/vinitaly" className="btn btn-ghost btn-sm">
              Apri liste separate
            </Link>
            <Link href="/contacts" className="btn btn-ghost btn-sm">
              Vai ai contatti
            </Link>
          </div>
        </div>

        <div className="meta-card">
          <strong style={{ fontSize: 15 }}>Prima dell&apos;import</strong>
          <span>
            Se il file contiene header non standard, qui sotto vedi subito come verranno mappati. Se attivi la lista separata,
            i contatti non entrano in pipeline e follow-up finché non li promuovi o non arriva una reply.
          </span>
        </div>

        <div className="detail-grid" style={{ marginTop: 0 }}>
          <div className="fg">
            <label className="fl">Origine di default</label>
            <input
              className="fi"
              value={defaultSource}
              onChange={(event) => setDefaultSource(event.target.value)}
              placeholder="vinitaly"
            />
          </div>
          <div className="fg">
            <label className="fl">Categoria di default</label>
            <input
              className="fi"
              value={defaultCategory}
              onChange={(event) => setDefaultCategory(event.target.value)}
              placeholder="vinitaly-winery"
            />
          </div>
        </div>

        <label className="meta-card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={separateList}
            onChange={(event) => setSeparateList(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong style={{ display: 'block', marginBottom: 4 }}>Tieni separato da CRM e pipeline</strong>
            I contatti vengono importati in una lista dedicata e restano fuori da pipeline, calendario e follow-up automatici.
          </span>
        </label>

        {separateList && (
          <div className="fg">
            <label className="fl">Nome lista</label>
            <input
              className="fi"
              value={listName}
              onChange={(event) => setListName(event.target.value)}
              placeholder="Es. Fiera Verona Aprile 2026"
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={loading || !csvText.trim()}>
            {loading ? 'Import in corso...' : 'Importa in Supabase'}
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {fileName ? `File selezionato: ${fileName}` : 'Nessun file selezionato'}
        </div>

        {preview && (
          <div className="dash-meta-grid" style={{ marginTop: 4 }}>
            <div className="meta-card meta-card-strong">
              <strong>{preview.rows.length}</strong>
              <span>righe rilevate nel file</span>
            </div>
            <div className="meta-card">
              <strong>{preview.detection.mapping.name || preview.detection.mapping.first_name || 'non trovato'}</strong>
              <span>colonna nome riconosciuta</span>
            </div>
            <div className="meta-card">
              <strong>{preview.detection.mapping.email || 'non trovata'}</strong>
              <span>colonna email riconosciuta</span>
            </div>
            <div className="meta-card">
              <strong>{preview.detection.mapping.phone || 'non trovata'}</strong>
              <span>colonna telefono riconosciuta</span>
            </div>
          </div>
        )}

        {preview && (
          <div className="meta-card">
            <strong style={{ fontSize: 15 }}>Matching colonne</strong>
            <span>
              {Object.entries(preview.detection.mapping).length === 0
                ? 'Nessuna colonna riconosciuta automaticamente.'
                : Object.entries(preview.detection.mapping)
                    .map(([field, header]) => `${field} → ${header}`)
                    .join(' · ')}
            </span>
            {preview.detection.unmatchedHeaders.length > 0 && (
              <span style={{ marginTop: 6 }}>
                Colonne non agganciate: {preview.detection.unmatchedHeaders.join(', ')}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="inline-error">
            <strong>Errore:</strong> {error}
          </div>
        )}
      </div>

      {result && (
        <div className="dash-meta-grid">
          <div className="meta-card meta-card-strong">
            <strong>{result.parsed_rows}</strong>
            <span>Righe lette dal CSV</span>
          </div>
          <div className="meta-card meta-card-strong">
            <strong>{result.imported_contacts}</strong>
            <span>Contatti importati o aggiornati</span>
          </div>
          <div className="meta-card">
            <strong>{result.created_contacts}</strong>
            <span>contatti nuovi</span>
          </div>
          <div className="meta-card">
            <strong>{result.updated_contacts}</strong>
            <span>contatti aggiornati</span>
          </div>
          <div className="meta-card">
            <strong>{result.matched_contacts}</strong>
            <span>match trovati via email / telefono / nome+azienda</span>
          </div>
          <div className="meta-card">
            <strong>{result.created_tasks}</strong>
            <span>Task follow-up creati</span>
          </div>
          <div className="meta-card">
            <strong>{result.contact_scope === 'holding' ? 'Lista separata' : 'CRM live'}</strong>
            <span>
              {result.contact_scope === 'holding'
                ? `I dati vanno nella vista Liste separate${result.list_name ? ` (${result.list_name})` : ''} e restano fuori da Pipeline, Contatti e Attività finché non li promuovi o non arriva una reply.`
                : 'I dati sono subito visibili in Pipeline, Contatti e Attività.'}
            </span>
          </div>
          {result.contact_scope === 'holding' && result.list_name && (
            <div className="meta-card">
              <strong>{result.list_name}</strong>
              <span>nome lista assegnato</span>
              <Link href={`/vinitaly?list=${encodeURIComponent(result.list_name)}`} className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}>
                Apri questa lista
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
