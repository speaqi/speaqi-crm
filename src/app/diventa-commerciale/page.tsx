import type { Metadata } from 'next'
import Link from 'next/link'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { SALES_PROGRAM, commissionExamples, salesProgramProduct } from '@/lib/sales-program'
import { ApplicationForm } from './ApplicationForm'

export const metadata: Metadata = {
  title: 'Diventa commerciale Speaqi',
  description:
    'Porta il Video nella mappa di Speaqi nelle attività della tua zona: provvigioni sul primo anno e su ogni rinnovo, vendita in presenza con firma e pagamento dal tablet.',
}

function euro(value: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

const STEPS = [
  {
    title: 'Ti candidi',
    text: 'Compili il modulo in fondo alla pagina: bastano due minuti.',
  },
  {
    title: 'Ci conosciamo',
    text: 'Ti richiamiamo per una chiacchierata: ti presentiamo il prodotto e capiamo insieme la tua zona.',
  },
  {
    title: 'Ricevi il tuo link personale',
    text: 'Un link riservato, da aprire su telefono o tablet: niente password, niente app da installare.',
  },
  {
    title: 'Vendi in presenza',
    text: 'Inserisci i dati dell’attività, il titolare firma col dito e paga con carta. Il rinnovo lo gestisce Stripe ogni anno.',
  },
]

const FAQ = [
  {
    q: 'Devo avere la partita IVA?',
    a: 'Non per candidarti. Ne parliamo al colloquio: la forma di collaborazione dipende da quanto vuoi lavorare con noi.',
  },
  {
    q: 'Quando vengono pagate le provvigioni?',
    a: `Le provvigioni maturano sui pagamenti incassati e vengono liquidate ${SALES_PROGRAM.payoutTerms}.`,
  },
  {
    q: 'E se il cliente disdice?',
    a: 'La provvigione sul primo anno resta tua. Quella sui rinnovi matura solo finché il cliente rinnova.',
  },
  {
    q: 'Devo gestire contratti o incassi?',
    a: 'No. Firma e pagamento avvengono online dal tuo link: il cliente riceve la conferma via email e tu vedi la vendita registrata.',
  },
]

export default function DiventaCommercialePage() {
  const product = salesProgramProduct()
  const examples = commissionExamples(10)

  return (
    <main className="public-quote-page">
      <section className="public-quote-shell recruit-shell">
        <header className="public-quote-header">
          <BrandLockup tone="light" size="hero" title={null} />
          <Link href="#candidatura" className="public-quote-pay recruit-cta-small">
            Candidati
          </Link>
        </header>

        <div className="public-quote-hero recruit-hero">
          <div>
            <p className="public-quote-kicker">Lavora con Speaqi</p>
            <h1 className="public-quote-customer-title">Porta Speaqi nelle attività della tua zona</h1>
            <p className="recruit-lead">
              Cerchiamo commerciali sul territorio che propongano a bar, ristoranti, negozi e strutture il loro video
              nelle mappe Speaqi. Guadagni sul primo anno e su ogni rinnovo, finché il cliente resta.
            </p>
            <Link href="#candidatura" className="public-quote-pay recruit-cta">
              Candidati ora
            </Link>
          </div>
        </div>

        <section className="public-quote-card recruit-section">
          <h2>Cosa vendi</h2>
          <div className="recruit-product">
            <div>
              <h3>{product.label}</h3>
              <p>
                Il video dell’attività pubblicato dentro le mappe Speaqi: chi esplora il territorio la trova, la vede e
                la raggiunge, nella sua lingua. Un prodotto semplice da spiegare, con un prezzo accessibile.
              </p>
            </div>
            <div className="recruit-price">
              {product.listPrice ? <s>{euro(product.listPrice)}</s> : null}
              <strong>{euro(product.netPrice)} + IVA</strong>
              <span>all’anno, rinnovo automatico</span>
            </div>
          </div>
        </section>

        <section className="public-quote-card recruit-section">
          <h2>Quanto guadagni</h2>
          <div className="recruit-grid">
            <div className="recruit-stat">
              <strong>{SALES_PROGRAM.firstYearPercent}%</strong>
              <span>sul primo anno di ogni cliente</span>
              <small>{euro(examples.perSale.firstYear)} per ogni abbonamento venduto</small>
            </div>
            <div className="recruit-stat">
              <strong>{SALES_PROGRAM.renewalPercent}%</strong>
              <span>su ogni rinnovo, finché il cliente resta</span>
              <small>{euro(examples.perSale.renewal)} all’anno per cliente</small>
            </div>
          </div>
          <p className="recruit-example">
            Con <strong>{examples.portfolio.clients} clienti</strong>: {euro(examples.portfolio.firstYear)} il primo anno,
            poi {euro(examples.portfolio.renewalPerYear)} ogni anno dai soli rinnovi, senza doverli rivendere.
          </p>
          <p className="public-quote-muted">
            Provvigioni calcolate sull’importo netto (IVA esclusa) effettivamente incassato, liquidate{' '}
            {SALES_PROGRAM.payoutTerms}.
          </p>
        </section>

        <section className="public-quote-card recruit-section">
          <h2>Come funziona</h2>
          <ol className="recruit-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="recruit-step-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="public-quote-card recruit-section">
          <h2>Chi cerchiamo</h2>
          <ul className="recruit-list">
            <li>Ti piace parlare con le persone e conosci le attività della tua zona.</li>
            <li>Hai uno smartphone o un tablet: tutto il resto è online.</li>
            <li>Vuoi un’entrata che cresce nel tempo, grazie ai rinnovi.</li>
            <li>Esperienza commerciale utile, ma non indispensabile: ti formiamo noi.</li>
          </ul>
        </section>

        <section className="public-quote-card recruit-section">
          <h2>Domande frequenti</h2>
          <div className="recruit-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="public-quote-card recruit-section" id="candidatura">
          <h2>Candidati</h2>
          <p className="public-quote-muted">Ti richiamiamo entro pochi giorni.</p>
          <ApplicationForm />
        </section>

        <p className="public-quote-legal-footer">
          Speaqi di TheBestItaly · P.IVA: 10831191217 · C.F.: 95125440636
          <br />
          <a href="mailto:info@speaqi.com" className="public-quote-contact-link">
            Hai domande? Scrivici
          </a>
        </p>
      </section>
    </main>
  )
}
