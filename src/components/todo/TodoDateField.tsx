'use client'

import { useEffect, useRef, useState } from 'react'
import { dateInputToIso, dateInputValue } from '@/lib/todo'

interface TodoDateFieldProps {
  /** Data corrente in ISO (quella salvata sul task). */
  value?: string | null
  onCommit: (iso: string | null) => void
  label?: string
  disabled?: boolean
  className?: string
  title?: string
}

/**
 * Campo data delle attività.
 *
 * Un `input[type=date]` emette un `change` a ogni segmento digitato e finché la
 * data non è completa il valore letto è la stringa vuota. Salvando a ogni
 * evento si scriveva quindi `due_date: null` mentre l'utente stava ancora
 * scrivendo, il componente si ri-renderizzava con il campo vuoto e i segmenti
 * già digitati sparivano: si riusciva a inserire una cifra per volta. Qui il
 * valore vive in locale e si salva solo quando la data è **completa**, oppure
 * all'uscita dal campo quando è stata svuotata davvero.
 */
export function TodoDateField({ value, onCommit, label, disabled, className, title }: TodoDateFieldProps) {
  const incoming = dateInputValue(value)
  const [draft, setDraft] = useState(incoming)
  const committed = useRef(incoming)

  // Il task può cambiare da fuori (salvataggio, altra scheda, ricarica): allora
  // il campo si riallinea. Il confronto è sul valore già salvato, così una
  // risposta del server identica a quanto digitato non azzera la digitazione.
  useEffect(() => {
    if (incoming !== committed.current) {
      committed.current = incoming
      setDraft(incoming)
    }
  }, [incoming])

  function commit(next: string) {
    if (next === committed.current) return
    committed.current = next
    onCommit(dateInputToIso(next))
  }

  return (
    <input
      className={className || 'fi'}
      type="date"
      aria-label={label}
      title={title}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        // Vuoto = data ancora incompleta: si aspetta, non si cancella nulla.
        if (next) commit(next)
      }}
      onBlur={() => commit(draft)}
    />
  )
}
