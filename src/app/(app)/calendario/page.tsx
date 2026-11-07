import { redirect } from 'next/navigation'

// Follow-up e Oggi erano la stessa lista in due pagine: ora c'è solo Oggi.
export default function CalendarioRedirect() {
  redirect('/dashboard')
}
