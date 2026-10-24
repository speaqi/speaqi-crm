import { redirect } from 'next/navigation'

// «Da incassare» vive in Fatture, sotto l'elenco delle fatture.
export default function IncassiPage() {
  redirect('/fatture#da-incassare')
}
