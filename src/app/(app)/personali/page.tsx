'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// I contatti personali ora vivono dentro /contacts come tab scope=personal.
// Questa route resta solo come redirect per non rompere link e bookmark esistenti.
export default function PersonaliPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/contacts?scope=personal')
  }, [router])

  return null
}
