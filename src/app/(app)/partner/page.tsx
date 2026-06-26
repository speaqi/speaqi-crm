'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// I partner ora vivono dentro /contacts come tab scope=partner.
// Questa route resta solo come redirect per non rompere link e bookmark esistenti.
export default function PartnerPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/contacts?scope=partner')
  }, [router])

  return null
}
