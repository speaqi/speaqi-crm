'use client'

import { useId, useState } from 'react'
import { COMMISSION_DEFAULTS, COMMISSION_LIMITS, SALES_PROGRAM, commissionEstimate } from '@/lib/sales-program'

function euro(value: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

/** Campo numerico con − / +: dal telefono si tocca, non si digita. */
function Stepper({
  label,
  hint,
  value,
  min,
  max,
  rangeMax,
  onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  /** Fine corsa del cursore: piu' corta del massimo, se no ogni pixel salta di cinque. */
  rangeMax: number
  onChange: (next: number) => void
}) {
  const id = useId()
  // Il testo vive a parte mentre si scrive: svuotato il campo, un clamp immediato
  // lo riporterebbe a 1 e digitando "5" si otterrebbe "15".
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (next: number) => Math.min(max, Math.max(min, Number.isFinite(next) ? Math.floor(next) : min))

  return (
    <div className="recruit-calc-field">
      <label htmlFor={id}>{label}</label>
      <div className="recruit-calc-stepper">
        <button type="button" aria-label={`Meno ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft ?? value}
          onChange={(event) => {
            const raw = event.target.value
            setDraft(raw)
            if (raw.trim() !== '') onChange(clamp(Number(raw)))
          }}
          onBlur={() => setDraft(null)}
        />
        <button type="button" aria-label={`Più ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>
          +
        </button>
      </div>
      <input
        type="range"
        className="recruit-calc-range"
        aria-label={label}
        min={min}
        max={rangeMax}
        value={Math.min(value, rangeMax)}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
      />
      <small>{hint}</small>
    </div>
  )
}

export function CommissionCalculator() {
  const [clients, setClients] = useState(COMMISSION_DEFAULTS.clients)
  const [videosPerClient, setVideosPerClient] = useState(COMMISSION_DEFAULTS.videosPerClient)
  const estimate = commissionEstimate(clients, videosPerClient)

  return (
    <div className="recruit-calc">
      <div className="recruit-calc-inputs">
        <Stepper
          label="Clienti"
          hint="Attività o partner a cui vendi"
          value={clients}
          min={1}
          max={COMMISSION_LIMITS.clients}
          rangeMax={100}
          onChange={setClients}
        />
        <Stepper
          label="Video per cliente"
          hint="Quanti video compra ciascuno"
          value={videosPerClient}
          min={1}
          max={COMMISSION_LIMITS.videosPerClient}
          rangeMax={COMMISSION_LIMITS.videosPerClient}
          onChange={setVideosPerClient}
        />
      </div>

      <div className="recruit-calc-results" aria-live="polite">
        <div className="recruit-calc-result is-main">
          <span>Il primo anno</span>
          <strong>{euro(estimate.firstYear)}</strong>
          <small>
            {SALES_PROGRAM.firstYearPercent}% di {euro(estimate.revenue)} venduti · {estimate.videos} video
          </small>
        </div>
        <div className="recruit-calc-result">
          <span>Ogni anno dai rinnovi</span>
          <strong>{euro(estimate.renewalPerYear)}</strong>
          <small>{SALES_PROGRAM.renewalPercent}% finché i clienti restano</small>
        </div>
        <div className="recruit-calc-result">
          <span>In tre anni</span>
          <strong>{euro(estimate.threeYears)}</strong>
          <small>se tutti rinnovano due volte</small>
        </div>
      </div>
    </div>
  )
}
