'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  contactId: string
  contactName: string
  onDismiss: (contactId: string, status: string, nextFollowupAt: string | null) => void
  disabled?: boolean
}

function monthsFromNow(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

export function QuickDismissMenu({ contactId, contactName, onDismiss, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  function handleSelect(status: string, followupMonths: number | null) {
    setOpen(false)
    const followupAt = followupMonths ? monthsFromNow(followupMonths) : null
    onDismiss(contactId, status, followupAt)
  }

  return (
    <div className="quick-dismiss" ref={ref}>
      <button
        type="button"
        className="quick-dismiss-trigger"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={disabled}
        title={`Azioni rapide per ${contactName}`}
        aria-label={`Azioni rapide per ${contactName}`}
      >
        ⋮
      </button>
      {open && (
        <div className="quick-dismiss-dropdown">
          <button
            type="button"
            className="quick-dismiss-option is-lost"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Lost', null)
            }}
          >
            ❌ Perso
          </button>
          <button
            type="button"
            className="quick-dismiss-option is-waiting"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Waiting', 3)
            }}
          >
            ⏳ Richiama tra 3 mesi
          </button>
          <button
            type="button"
            className="quick-dismiss-option is-waiting"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Waiting', 6)
            }}
          >
            📅 Richiama tra 6 mesi
          </button>
        </div>
      )}
    </div>
  )
}
