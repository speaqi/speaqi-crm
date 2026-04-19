'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useCRMContext } from '../../layout'

export default function TeamAdminPage() {
  const { teamMembers, createTeamMember, updateTeamMember, deleteTeamMember, showToast } = useCRMContext()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      await createTeamMember({ name: name.trim(), email: email.trim() || undefined })
      setName('')
      setEmail('')
      showToast('Collaboratore aggiunto')
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Errore')
    } finally {
      setSaving(false)
    }
  }

  async function handleRename(id: string, currentName: string) {
    const next = window.prompt('Nuovo nome collaboratore:', currentName)?.trim()
    if (!next || next === currentName) return
    try {
      await updateTeamMember(id, { name: next })
      showToast('Nome aggiornato')
    } catch (updateError) {
      showToast(`Errore: ${updateError instanceof Error ? updateError.message : 'rinomina'}`)
    }
  }

  async function handleDelete(id: string, memberName: string) {
    if (!window.confirm(`Rimuovere "${memberName}" dal team? I contatti già assegnati mantengono il nome, ma non sarà più selezionabile.`)) return
    try {
      await deleteTeamMember(id)
      showToast('Collaboratore rimosso')
    } catch (deleteError) {
      showToast(`Errore: ${deleteError instanceof Error ? deleteError.message : 'rimozione'}`)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="team-breadcrumb">
          <Link href="/impostazioni">← Impostazioni</Link>
        </div>
        <h1>Team</h1>
        <p className="page-subtitle">
          Aggiungi i collaboratori che potranno essere assegnati ai contatti. Solo questi nomi compaiono nei menu "Assegnato a".
        </p>
      </div>

      <form className="team-add" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Nome e cognome *"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Email (opzionale)"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          {saving ? 'Salvataggio…' : 'Aggiungi collaboratore'}
        </button>
      </form>

      {error && <div className="inline-error">{error}</div>}

      <div className="team-list">
        {teamMembers.length === 0 ? (
          <div className="team-empty">
            <p>Nessun collaboratore ancora.</p>
            <p className="team-muted">Aggiungi il primo qui sopra.</p>
          </div>
        ) : (
          teamMembers.map((member) => (
            <div key={member.id} className="team-row">
              <div className="team-row-avatar">
                {member.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="team-row-body">
                <strong>{member.name}</strong>
                {member.email && <span className="team-row-email">{member.email}</span>}
              </div>
              <div className="team-row-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleRename(member.id, member.name)}
                >
                  Rinomina
                </button>
                <button
                  type="button"
                  className="btn btn-del btn-sm"
                  onClick={() => handleDelete(member.id, member.name)}
                >
                  Rimuovi
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
