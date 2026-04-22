'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createContext, useContext } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { Toast } from '@/components/ui/Toast'
import { useCRM } from '@/hooks/useCRM'
import { isPipelineVisible } from '@/lib/data'
import { createClient } from '@/lib/supabase'

interface CRMContextType extends ReturnType<typeof useCRM> {
  showToast: (message: string) => void
}

const CRMContext = createContext<CRMContextType | null>(null)

export function useCRMContext() {
  const context = useContext(CRMContext)
  if (!context) throw new Error('useCRMContext must be used inside CRMContext.Provider')
  return context
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const crm = useCRM()
  const [authChecked, setAuthChecked] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToastMessage(message)
    toastTimer.current = setTimeout(() => setToastMessage(''), 3500)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) router.push('/login')
      else setAuthChecked(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (!authChecked || crm.loading) {
    return (
      <div className="loading-screen">
        <BrandLockup tone="dark" size="hero" centered />
        <div className="loading-text">Apertura in corso…</div>
      </div>
    )
  }

  const counts = {
    kanban: crm.contacts.filter(isPipelineVisible).length,
    contacts: crm.contacts.length,
    personal: crm.personalContacts.length,
    vinitaly: crm.holdingContacts.length,
    speaqi: crm.speaqiContacts.length,
    oggi: crm.dueTodayCount,
    tasks: crm.tasks.length,
  }

  const contextValue: CRMContextType = {
    ...crm,
    showToast,
  }

  return (
    <CRMContext.Provider value={contextValue}>
      <div className="app-layout">
        <Sidebar counts={counts} />
        <div className="app-main">
          <Topbar pathname={pathname} />
          <div className="page-content">
            {crm.error && (
              <div className="inline-error">
                <strong>Qualcosa è andato storto:</strong> {crm.error}
              </div>
            )}
            {children}
          </div>
        </div>
        {toastMessage && <Toast message={toastMessage} onHide={() => setToastMessage('')} />}
      </div>
    </CRMContext.Provider>
  )
}
