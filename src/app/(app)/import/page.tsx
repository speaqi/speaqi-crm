'use client'

import Link from 'next/link'
import { ChangeEvent, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

interface ImportResponse {
  parsed_rows: number
  imported_contacts: number
  created_tasks: number
  contact_scope?: 'crm' | 'holding'
}

export default function ImportPage() {
  const { refresh, showToast } = useCRMContext()
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
  const [defaultSource, setDefaultSource] = useState('vinitaly')
  const [defaultCategory, setDefaultCategory] = useState('vinitaly-winery')
  const [separateList, setSeparateList] = useState(true)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')
    setResult(null)
    setFileName(file.name)
    setCsvText(await file.text())
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
              Carica il file <strong>contacts_import.csv</strong> generato dall&apos;analisi. Per Vinitaly puoi tenerlo in una
              lista separata: resta fuori da pipeline e follow-up finché non arriva una risposta email.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/vinitaly" className="btn btn-ghost btn-sm">
              Apri Vinitaly
            </Link>
            <Link href="/contacts" className="btn btn-ghost btn-sm">
              Vai ai contatti
            </Link>
          </div>
        </div>

        <div className="meta-card">
          <strong style={{ fontSize: 15 }}>Prima dell&apos;import</strong>
          <span>
            Usa il CSV pulito, non il file legacy sporco. Se attivi la lista separata Vinitaly, i contatti non entrano nel CRM operativo
            e non generano task finché non risponde qualcuno via email.
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
            I contatti vengono importati in una lista Vinitaly dedicata e vengono promossi nel CRM operativo solo dopo una reply email.
          </span>
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={loading || !csvText.trim()}>
            {loading ? 'Import in corso...' : 'Importa in Supabase'}
          </button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {fileName ? `File selezionato: ${fileName}` : 'Nessun file selezionato'}
        </div>

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
            <strong>{result.created_tasks}</strong>
            <span>Task follow-up creati</span>
          </div>
          <div className="meta-card">
            <strong>{result.contact_scope === 'holding' ? 'Lista separata' : 'CRM live'}</strong>
            <span>
              {result.contact_scope === 'holding'
                ? 'I dati vanno nella vista Vinitaly e restano fuori da Pipeline, Contatti e Attività finché non arriva una reply.'
                : 'I dati sono subito visibili in Pipeline, Contatti e Attività.'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
