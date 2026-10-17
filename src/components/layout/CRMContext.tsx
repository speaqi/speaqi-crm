'use client'

import { createContext, useContext } from 'react'
import type { useCRM } from '@/hooks/useCRM'

export interface CRMContextType extends ReturnType<typeof useCRM> {
  showToast: (message: string) => void
}

export const CRMContext = createContext<CRMContextType | null>(null)

export function useCRMContext() {
  const context = useContext(CRMContext)
  if (!context) throw new Error('useCRMContext must be used inside CRMContext.Provider')
  return context
}
