import type { ReactNode } from 'react'
import { OfficeLockGate } from './OfficeLockGate'

/** Scena 3D e /ufficio/agenti passano entrambe dal lucchetto dell'Ufficio. */
export default function UfficioLayout({ children }: { children: ReactNode }) {
  return <OfficeLockGate>{children}</OfficeLockGate>
}
