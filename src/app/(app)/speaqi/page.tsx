'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// I "Lead inbound" (source=speaqi) ora vivono dentro /contacts come tab scope=inbound.
// Questa route resta solo come redirect per non rompere link e bookmark esistenti.
export default function SpeaqiPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/contacts?scope=inbound')
  }, [router])

  return null
}
