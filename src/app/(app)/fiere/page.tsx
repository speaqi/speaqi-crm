import { redirect } from 'next/navigation'

// Le fiere vivono dentro Tourism Intelligence (scheda «Fiere» e filtro «Fiera» nella directory).
export default function FierePage() {
  redirect('/tourism?tab=fiere')
}
