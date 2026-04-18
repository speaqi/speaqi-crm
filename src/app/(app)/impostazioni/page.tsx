'use client'

import Link from 'next/link'

const SETTINGS_ITEMS = [
  {
    href: '/gmail',
    icon: '✉️',
    title: 'Gmail',
    description: 'Collega account per sincronizzare thread ai contatti.',
  },
  {
    href: '/voice',
    icon: '🎤',
    title: 'Note vocali',
    description: 'Registra promemoria rapidi da trascrivere.',
  },
  {
    href: '/vinitaly',
    icon: '🗃️',
    title: 'Vinitaly (legacy)',
    description: 'Vecchia lista separata. In fase di migrazione a tag.',
  },
  {
    href: '/speaqi',
    icon: '⚡',
    title: 'Lead inbound (legacy)',
    description: 'Vecchia lista inbound. In fase di migrazione a tag.',
  },
  {
    href: '/quick-capture',
    icon: '⚡',
    title: 'Cattura rapida',
    description: 'Form veloce per nuovi lead senza CSV.',
  },
  {
    href: '/calendario',
    icon: '📅',
    title: 'Calendario',
    description: 'Vista calendario dei follow-up.',
  },
  {
    href: '/attivita',
    icon: '📋',
    title: 'Attività (legacy)',
    description: 'Elenco task in forma lista. Diventerà parte di Pipeline.',
  },
]

export default function ImpostazioniPage() {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Impostazioni</h1>
        <p className="page-subtitle">
          Integrazioni, strumenti e sezioni secondarie.
        </p>
      </div>

      <div className="settings-grid">
        {SETTINGS_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="settings-card">
            <div className="settings-card-icon">{item.icon}</div>
            <div className="settings-card-body">
              <div className="settings-card-title">{item.title}</div>
              <div className="settings-card-description">{item.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
