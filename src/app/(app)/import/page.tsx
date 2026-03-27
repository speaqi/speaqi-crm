'use client'

import Link from 'next/link'
import { ChangeEvent, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

interface ImportResponse {
  parsed_rows: number
  imported_contacts: number
  created_tasks: number
}

export default function ImportPage() {
  const { refresh, showToast } = useCRMContext()
  const [fileName, setFileName] = useState('')
  const [csvText, setCsvText] = useState('')
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
        body: JSON.stringify({ csv_text: csvText }),
      })

      setResult(response)
      await refresh()
      showToast(`Import completato: ${response.imported_contacts} contatti`)
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
              Carica il file <strong>contacts_import.csv</strong> generato dall&apos;analisi. L&apos;import fa upsert dei contatti
              in Supabase e crea i follow-up mancanti.
            </p>
          </div>
          <Link href="/contacts" className="btn btn-ghost btn-sm">
            Vai ai contatti
          </Link>
        </div>

        <div className="meta-card">
          <strong style={{ fontSize: 15 }}>Prima dell&apos;import</strong>
          <span>Usa il CSV pulito, non il file legacy sporco. I contatti aperti devono avere un follow-up: il file generato lo include già.</span>
        </div>

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
            <strong>CRM live</strong>
            <span>I dati sono subito visibili in Pipeline, Contatti e Attività.</span>
          </div>
        </div>
      )}
    </div>
  )
}
