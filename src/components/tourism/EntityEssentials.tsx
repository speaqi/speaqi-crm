'use client'

import Link from 'next/link'
import { useState } from 'react'
import s from './tourism.module.css'

type Entity = { id: string; name: string; kind: string; status: string; version: number; website: string | null; email: string | null; phone: string | null }
type Contact = { id: string; name: string; company: string | null } | null

/**
 * La scheda essenziale: quello che serve per lavorare un ente. Nome, sito, email,
 * telefono e un gesto solo — «Conferma e aggiungi ai contatti» — che verifica la
 * scheda a nome del titolare e la porta nel CRM. Il resto sta in «Altri dettagli».
 */
export default function EntityEssentials({ entity, contact, typeLabel, place, busy, onActivate, onPresentation, onEdit, onArchive }: {
  entity: Entity
  contact: Contact
  typeLabel: string
  place: string
  busy: boolean
  onActivate: (fields: { email: string; website: string }) => void
  onPresentation: () => void
  onEdit: () => void
  onArchive: () => void
}) {
  const [email, setEmail] = useState(entity.email || '')
  const [website, setWebsite] = useState(entity.website || '')
  const organization = entity.kind === 'organization'
  const verified = entity.status === 'VERIFIED'

  return (
    <section className={s.detailSection}>
      <p className={s.muted}>
        {typeLabel} · {place} · {contact ? 'nei contatti' : verified ? 'verificato, non ancora nei contatti' : 'da confermare'}
      </p>
      <dl className={s.identityGrid}>
        <div>
          <dt>Sito</dt>
          <dd>
            {entity.website ? <a href={entity.website} target="_blank" rel="noopener noreferrer">{entity.website} ↗</a>
              : organization && !contact ? <input value={website} placeholder="www.esempio.it" onChange={(e) => setWebsite(e.target.value)} />
              : 'Non disponibile'}
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            {entity.email ? entity.email
              : organization && !contact ? <input type="email" value={email} placeholder="info@esempio.it" onChange={(e) => setEmail(e.target.value)} />
              : 'Non disponibile'}
          </dd>
        </div>
        <div>
          <dt>Telefono</dt>
          <dd>{entity.phone || 'Non disponibile'}</dd>
        </div>
        {contact && (
          <div>
            <dt>Contatto CRM</dt>
            <dd><Link href={`/contacts/${contact.id}`}>{contact.company || contact.name} ↗</Link></dd>
          </div>
        )}
      </dl>
      <div className={s.actions}>
        {organization && !contact && (
          <button className={s.primary} disabled={busy} onClick={() => onActivate({ email: entity.email ? '' : email.trim(), website: entity.website ? '' : website.trim() })}>
            Conferma e aggiungi ai contatti
          </button>
        )}
        {organization && (
          <button className={contact ? s.primary : s.secondary} onClick={onPresentation}>Crea la presentazione</button>
        )}
        <button className={s.secondary} onClick={onEdit}>Modifica</button>
        <button className={s.secondary} disabled={busy} onClick={onArchive}>Archivia</button>
      </div>
    </section>
  )
}
