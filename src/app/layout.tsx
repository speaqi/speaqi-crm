import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Speaqi CRM — AI Multilingual Video per Cantine',
  description:
    'Da un video sorgente a 7+ lingue con lip-sync AI. Gestisci contatti, preventivi e video multilingual per la tua cantina. CRM operativo per cantine italiane.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  )
}
