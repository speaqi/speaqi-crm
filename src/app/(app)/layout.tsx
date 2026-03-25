'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'
import { Toast } from '@/components/ui/Toast'
import { useCRM } from '@/hooks/useCRM'
import type { CRMState } from '@/types'

// Context
import { createContext, useContext } from 'react'

interface CRMContextType extends ReturnType<typeof useCRM> {
  showToast: (msg: string) => void
}

export const CRMContext = createContext<CRMContextType | null>(null)

export function useCRMContext() {
  const ctx = useContext(CRMContext)
  if (!ctx) throw new Error('useCRMContext must be used within CRMContext.Provider')
  return ctx
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const crm = useCRM()
  const [authChecked, setAuthChecked] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = setTimeout(() => setToastMsg(''), 3500)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.push('/login')
      } else {
        setAuthChecked(true)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (!authChecked || crm.loading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">⚡</div>
        <div className="loading-text">Caricamento...</div>
      </div>
    )
  }

  // Calculate badge counts
  const todayStr = new Date().toISOString().split('T')[0]
  const callCards = crm.cards.filter(c => c.s === 'Da Richiamare' || c.s === 'Da fare')
  const todayCount = callCards.filter(c =>
    crm.callScheduled[c._u!] === todayStr && !crm.callDone[c._u! + '_' + todayStr]
  ).length

  const counts = {
    kanban: crm.cards.length,
    contacts: crm.contacts.length,
    speaqi: crm.speaqi.length,
    oggi: todayCount,
  }

  function handleExportCSV() {
    const rows = [['ID', 'Nome', 'Stato', 'Priorità', 'Responsabile', 'Scadenza', 'Prezzo €', 'Note']]
    crm.cards.forEach(c => rows.push([c.id || '', c.n, c.s, c.p || '', c.r || '', c.d || '', c.$ || '', c.note || '']))
    const csv = rows.map(r => r.map(v => '"' + (v || '').replace(/"/g, '""') + '"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }))
    a.download = 'speaqi-export.csv'
    a.click()
    showToast('CSV esportato!')
  }

  const ctxValue: CRMContextType = { ...crm, showToast }

  return (
    <CRMContext.Provider value={ctxValue}>
      <div className="app-layout">
        <Sidebar
          counts={counts}
          onQuickRecord={() => router.push('/voice')}
        />
        <div className="app-main">
          <Topbar
            pathname={pathname}
            onExportCSV={handleExportCSV}
            onNewCard={pathname === '/kanban' ? undefined : undefined}
          />
          <div className="page-content">
            {children}
          </div>
        </div>
        {toastMsg && (
          <Toast message={toastMsg} onHide={() => setToastMsg('')} />
        )}
      </div>
    </CRMContext.Provider>
  )
}
