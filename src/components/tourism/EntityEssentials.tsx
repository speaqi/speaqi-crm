'use client'

import Link from 'next/link'
import { useState } from 'react'
import { presentationModel } from '@/lib/office/presentations'
import s from './tourism.module.css'

type Entity = { id: string; name: string; kind: string; type_code: string | null; website: string | null; email: string | null; phone: string | null }
type Contact = { id: string; name: string; company: string | null } | null
type Match = { contact_id: string; label: string }

/**
 * La scheda di un ente fa due cose, in ordine:
 * 1. crea il contatto nel CRM (o lo collega a uno che c'è già);
 * 2. crea la presentazione, partner o destinazione secondo il tipo di ente.
 */
export default function EntityEssentials({ entity, contact, matches, typeLabel, place, busy, onCreateContact, onPresentation }: {
  entity: Entity
  contact: Contact
  matches: Match[]
  typeLabel: string
  place: string
  busy: boolean
  onCreateContact: (fields: { email: string; website: string; contact_id?: string }) => void
  onPresentation: () => void
}) {
  const [email, setEmail] = useState(entity.email || '')
  const [website, setWebsite] = useState(entity.website || '')
  const fields = () => ({ email: entity.email ? '' : email.trim(), website: entity.website ? '' : website.trim() })
  const deckLabel = presentationModel(entity.type_code) === 'partner' ? 'Crea la presentazione partner' : 'Crea la presentazione destinazione'

  return (
    <section className={s.detailSection}>
      <p className={s.muted}>{typeLabel} · {place}</p>

      <h3>1. Contatto</h3>
      {contact ? (
        <p>
          ✓ Nei contatti: <Link href={`/contacts/${contact.id}`}>{contact.company || contact.name} ↗</Link>
        </p>
      ) : (
        <>
          <dl className={s.identityGrid}>
            <div>
              <dt>Sito</dt>
              <dd>
                {entity.website
                  ? <a href={entity.website} target="_blank" rel="noopener noreferrer">{entity.website} ↗</a>
                  : <input value={website} placeholder="www.esempio.it" onChange={(e) => setWebsite(e.target.value)} />}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                {entity.email || <input type="email" value={email} placeholder="info@…" onChange={(e) => setEmail(e.target.value)} />}
              </dd>
            </div>
            {entity.phone && (
              <div>
                <dt>Telefono</dt>
                <dd>{entity.phone}</dd>
              </div>
            )}
          </dl>
          <div className={s.actions}>
            <button className={s.primary} disabled={busy} onClick={() => onCreateContact(fields())}>
              Crea il contatto
            </button>
            {matches.map((m) => (
              <button key={m.contact_id} className={s.secondary} disabled={busy} onClick={() => onCreateContact({ ...fields(), contact_id: m.contact_id })}>
                È già nei contatti: {m.label}
              </button>
            ))}
          </div>
        </>
      )}

      <h3>2. Presentazione</h3>
      <div className={s.actions}>
        <button className={contact ? s.primary : s.secondary} disabled={!contact} onClick={onPresentation}>
          {deckLabel}
        </button>
        {!contact && <span className={s.muted}>Prima crea il contatto.</span>}
      </div>
    </section>
  )
}
