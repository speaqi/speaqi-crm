'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// Le "Liste separate" (ex Vinitaly) ora vivono dentro /contacts come tab scope=holding.
// Questa route resta solo come redirect per non rompere link e bookmark esistenti.
function VinitalyRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = new URLSearchParams({ scope: 'holding' })
    const list = searchParams.get('list')
    if (list) params.set('list', list)
    router.replace(`/contacts?${params.toString()}`)
  }, [router, searchParams])

  return null
}

export default function VinitalyPage() {
  return (
    <Suspense fallback={null}>
      <VinitalyRedirect />
    </Suspense>
  )
}
