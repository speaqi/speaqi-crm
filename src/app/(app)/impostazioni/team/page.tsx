'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { SalesLinkStatus } from '@/types'
import { useCRMContext } from '../../layout'

function formatDay(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TeamAdminPage() {
  const { teamMembers, isAdmin, createTeamMember, updateTeamMember, deleteTeamMember, showToast } = useCRMContext()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [salesLinks, setSalesLinks] = useState<Map<string, SalesLinkStatus>>(new Map())
  const [salesLinkBusy, setSalesLinkBusy] = useState<string | null>(null)
  // Il link completo si vede solo appena generato: sul database resta l'hash.
  const [revealed, setRevealed] = useState<{ memberId: string; url: string } | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let mounted = true
    apiFetch<{ links: SalesLinkStatus[] }>('/api/sales-links')
      .then((response) => {
        if (mounted) setSalesLinks(new Map((response.links || []).map((link) => [link.team_member_id, link])))
      })
      .catch(() => {
        // tabella non ancora migrata: la sezione link resta vuota
      })
    return () => {
      mounted = false
    }
  }, [isAdmin])

  async function handleGenerateSalesLink(id: string, memberName: string, regenerate: boolean) {
    if (regenerate && !window.confirm(`Rigenerare il link vendita di "${memberName}"? Quello attuale smette subito di funzionare.`)) return
    setSalesLinkBusy(id)
    try {
      const response = await apiFetch<{ url: string; link: SalesLinkStatus }>(`/api/team-members/${id}/sales-link`, {
        method: 'POST',
      })
      setSalesLinks((previous) => new Map(previous).set(id, response.link))
      setRevealed({ memberId: id, url: response.url })
    } catch (linkError) {
      showToast(`Errore: ${linkError instanceof Error ? linkError.message : 'link non generato'}`)
    } finally {
      setSalesLinkBusy(null)
    }
  }

  async function handleRevokeSalesLink(id: string, memberName: string) {
    if (!window.confirm(`Revocare il link vendita di "${memberName}"? Il link smette subito di funzionare.`)) return
    setSalesLinkBusy(id)
    try {
      await apiFetch(`/api/team-members/${id}/sales-link`, { method: 'DELETE' })
      setSalesLinks((previous) => {
        const next = new Map(previous)
        next.delete(id)
        return next
      })
      if (revealed?.memberId === id) setRevealed(null)
      showToast('Link vendita revocato')
    } catch (linkError) {
      showToast(`Errore: ${linkError instanceof Error ? linkError.message : 'revoca non riuscita'}`)
    } finally {
      setSalesLinkBusy(null)
    }
  }

  async function copyRecruitLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/diventa-commerciale`)
      showToast('Link copiato')
    } catch {
      showToast('Copia non riuscita')
    }
  }

  async function copyRevealed() {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed.url)
      showToast('Link copiato')
    } catch {
      showToast('Copia non riuscita: seleziona il link a mano')
    }
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError('')
    try {
      await createTeamMember({
        name: name.trim(),
        email: email.trim() || undefined,
        password: password.trim() || undefined,
      })
      setName('')
      setEmail('')
      setPassword('')
      showToast(password.trim() ? 'Collaboratore aggiunto con accesso' : 'Collaboratore aggiunto')
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

  async function handleSetAdmin(id: string, memberName: string) {
    if (!window.confirm(`Impostare "${memberName}" come admin della dashboard? La vista Oggi mostrerà di default solo i contatti assegnati a questo membro.`)) return
    try {
      await updateTeamMember(id, { make_admin: true })
      showToast(`${memberName} impostato come admin`)
    } catch (updateError) {
      showToast(`Errore: ${updateError instanceof Error ? updateError.message : 'admin non aggiornato'}`)
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
          Aggiungi i collaboratori che potranno essere assegnati ai contatti. Se imposti una password, crei anche il loro accesso.
        </p>
        <p className="page-subtitle">
          Pagina per chi vuole diventare commerciale:{' '}
          <a href="/diventa-commerciale" target="_blank" rel="noopener noreferrer">
            /diventa-commerciale
          </a>{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyRecruitLink}>
            Copia link
          </button>
          <br />
          Le candidature arrivano fra i contatti personali, categoria «Candidato commerciale», con una chiamata il giorno dopo.
        </p>
      </div>

      {!isAdmin ? (
        <div className="inline-error">Solo l&apos;admin può gestire il team.</div>
      ) : (
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
        <input
          type="password"
          placeholder="Password accesso (opzionale)"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          {saving ? 'Salvataggio…' : 'Aggiungi collaboratore'}
        </button>
      </form>
      )}

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
                <div className="team-row-title">
                  <strong>{member.name}</strong>
                  {member.is_current_admin && <span className="team-role-badge">Admin</span>}
                </div>
                {member.email && <span className="team-row-email">{member.email}</span>}
                {isAdmin && salesLinks.get(member.id) && (
                  <span className="team-row-email">
                    Link vendita attivo dal {formatDay(salesLinks.get(member.id)?.created_at)} (…
                    {salesLinks.get(member.id)?.token_hint})
                    {salesLinks.get(member.id)?.last_used_at
                      ? ` · ultimo uso ${formatDay(salesLinks.get(member.id)?.last_used_at)}`
                      : ''}
                  </span>
                )}
                {revealed?.memberId === member.id && (
                  <div className="team-sales-link-reveal">
                    <code>{revealed.url}</code>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={copyRevealed}>
                      Copia
                    </button>
                    <span>Visibile solo ora: se lo perdi, rigeneralo.</span>
                  </div>
                )}
              </div>
              <div className="team-row-actions">
                {isAdmin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={salesLinkBusy === member.id}
                    onClick={() => handleGenerateSalesLink(member.id, member.name, salesLinks.has(member.id))}
                    title="Link personale per creare preventivi davanti al cliente, senza login"
                  >
                    {salesLinks.has(member.id) ? 'Rigenera link vendita' : 'Link vendita'}
                  </button>
                )}
                {isAdmin && salesLinks.has(member.id) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={salesLinkBusy === member.id}
                    onClick={() => handleRevokeSalesLink(member.id, member.name)}
                  >
                    Revoca link
                  </button>
                )}
                {!member.is_current_admin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!isAdmin}
                    onClick={() => handleSetAdmin(member.id, member.name)}
                  >
                    Imposta admin
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!isAdmin}
                  onClick={() => handleRename(member.id, member.name)}
                >
                  Rinomina
                </button>
                <button
                  type="button"
                  className="btn btn-del btn-sm"
                  disabled={!isAdmin}
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
