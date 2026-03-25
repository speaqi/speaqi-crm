'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { SEED_CARDS, SEED_CONTACTS, SEED_SPEAQI } from '@/lib/data'
import type { Card, Contact, SpeaqiContact, VoiceNote, CRMState } from '@/types'

function uid(prefix: string) {
  return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
}

export function useCRM() {
  const [state, setState] = useState<CRMState>({
    cards: [],
    contacts: [],
    speaqi: [],
    vNotes: [],
    callDone: {},
    callScheduled: {},
  })
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  const persist = useCallback(async (newState: CRMState, uid_: string) => {
    const supabase = createClient()
    await supabase.from('user_state').upsert({
      user_id: uid_,
      cards: newState.cards,
      contacts: newState.contacts,
      speaqi: newState.speaqi,
      voice_notes: newState.vNotes,
      call_done: newState.callDone,
      call_scheduled: newState.callScheduled,
      updated_at: new Date().toISOString(),
    })
  }, [])

  const loadState = useCallback(async (uid_: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('user_state')
      .select('*')
      .eq('user_id', uid_)
      .single()

    const hasData = data && (data.cards?.length > 0 || data.contacts?.length > 0)

    if (hasData) {
      const loaded: CRMState = {
        cards: data.cards || [],
        contacts: data.contacts || [],
        speaqi: data.speaqi || [],
        vNotes: data.voice_notes || [],
        callDone: data.call_done || {},
        callScheduled: data.call_scheduled || {},
      }
      setState(loaded)
    } else {
      // First access: load seed data
      const newState: CRMState = {
        cards: SEED_CARDS.map((c, i) => ({ ...c, _u: 'c' + i })),
        contacts: SEED_CONTACTS.map((c, i) => ({ ...c, _u: 'k' + i })),
        speaqi: SEED_SPEAQI.map((c, i) => ({ ...c, _u: 's' + i })),
        vNotes: [],
        callDone: {},
        callScheduled: {},
      }
      setState(newState)
      await persist(newState, uid_)
    }
    setLoading(false)
  }, [persist])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id)
        loadState(session.user.id)
      } else {
        setLoading(false)
      }
    })
  }, [loadState])

  const updateState = useCallback(async (updater: (prev: CRMState) => CRMState) => {
    setState(prev => {
      const next = updater(prev)
      if (userId) persist(next, userId)
      return next
    })
  }, [userId, persist])

  // ── CARDS ──────────────────────────────────────────

  const addCard = useCallback((card: Omit<Card, '_u'>) => {
    updateState(prev => ({
      ...prev,
      cards: [...prev.cards, { ...card, _u: uid('c') }],
    }))
  }, [updateState])

  const updateCard = useCallback((_u: string, updates: Partial<Card>) => {
    updateState(prev => ({
      ...prev,
      cards: prev.cards.map(c => c._u === _u ? { ...c, ...updates } : c),
    }))
  }, [updateState])

  const deleteCard = useCallback((_u: string) => {
    updateState(prev => ({
      ...prev,
      cards: prev.cards.filter(c => c._u !== _u),
    }))
  }, [updateState])

  const moveCard = useCallback((_u: string, newStatus: string) => {
    updateState(prev => ({
      ...prev,
      cards: prev.cards.map(c => c._u === _u ? { ...c, s: newStatus } : c),
    }))
  }, [updateState])

  // ── CONTACTS ───────────────────────────────────────

  const addContact = useCallback((contact: Omit<Contact, '_u'>) => {
    updateState(prev => ({
      ...prev,
      contacts: [...prev.contacts, { ...contact, _u: uid('k') }],
    }))
  }, [updateState])

  const updateContact = useCallback((_u: string, updates: Partial<Contact>) => {
    updateState(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => c._u === _u ? { ...c, ...updates } : c),
    }))
  }, [updateState])

  const deleteContact = useCallback((_u: string) => {
    updateState(prev => ({
      ...prev,
      contacts: prev.contacts.filter(c => c._u !== _u),
    }))
  }, [updateState])

  // ── SPEAQI ─────────────────────────────────────────

  const addSpeaqi = useCallback((contact: Omit<SpeaqiContact, '_u'>) => {
    updateState(prev => ({
      ...prev,
      speaqi: [...prev.speaqi, { ...contact, _u: uid('s') }],
    }))
  }, [updateState])

  const updateSpeaqi = useCallback((_u: string, updates: Partial<SpeaqiContact>) => {
    updateState(prev => ({
      ...prev,
      speaqi: prev.speaqi.map(c => c._u === _u ? { ...c, ...updates } : c),
    }))
  }, [updateState])

  const deleteSpeaqi = useCallback((_u: string) => {
    updateState(prev => ({
      ...prev,
      speaqi: prev.speaqi.filter(c => c._u !== _u),
    }))
  }, [updateState])

  // ── VOICE NOTES ────────────────────────────────────

  const addVoiceNote = useCallback((note: Omit<VoiceNote, '_u'>) => {
    updateState(prev => ({
      ...prev,
      vNotes: [{ ...note, _u: uid('v') }, ...prev.vNotes],
    }))
  }, [updateState])

  const deleteVoiceNote = useCallback((_u: string) => {
    updateState(prev => ({
      ...prev,
      vNotes: prev.vNotes.filter(v => v._u !== _u),
    }))
  }, [updateState])

  // ── CALLS ─────────────────────────────────────────

  const toggleCallDone = useCallback((cardUid: string, dateStr: string) => {
    updateState(prev => {
      const key = cardUid + '_' + dateStr
      const next = { ...prev.callDone }
      if (next[key]) delete next[key]
      else next[key] = true
      return { ...prev, callDone: next }
    })
  }, [updateState])

  const scheduleCall = useCallback((cardUid: string, dateStr: string) => {
    updateState(prev => ({
      ...prev,
      callScheduled: { ...prev.callScheduled, [cardUid]: dateStr },
    }))
  }, [updateState])

  const unscheduleCall = useCallback((cardUid: string) => {
    updateState(prev => {
      const next = { ...prev.callScheduled }
      delete next[cardUid]
      return { ...prev, callScheduled: next }
    })
  }, [updateState])

  const scheduleAll = useCallback(() => {
    const callCards = state.cards.filter(c => c.s === 'Da Richiamare' || c.s === 'Da fare')
    const unscheduled = callCards.filter(c => !state.callScheduled[c._u!])
    if (!unscheduled.length) return 0

    const sorted = [...unscheduled].sort((a, b) => {
      const po: Record<string, number> = { Alta: 0, Media: 1, '': 2, Bassa: 3 }
      return (po[a.p || ''] ?? 2) - (po[b.p || ''] ?? 2)
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let day = new Date(today)
    const dayCount: Record<string, number> = {}
    const newScheduled = { ...state.callScheduled }
    let i = 0

    while (i < sorted.length) {
      const dk = day.toISOString().split('T')[0]
      const dow = day.getDay()
      if (dow === 0 || dow === 6) { day.setDate(day.getDate() + 1); continue }
      const existing = callCards.filter(c => newScheduled[c._u!] === dk).length
      const used = (dayCount[dk] || 0) + existing
      if (used < 5) {
        newScheduled[sorted[i]._u!] = dk
        dayCount[dk] = (dayCount[dk] || 0) + 1
        i++
      } else { day.setDate(day.getDate() + 1) }
    }

    updateState(prev => ({ ...prev, callScheduled: newScheduled }))
    return sorted.length
  }, [state, updateState])

  return {
    ...state,
    loading,
    userId,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    addContact,
    updateContact,
    deleteContact,
    addSpeaqi,
    updateSpeaqi,
    deleteSpeaqi,
    addVoiceNote,
    deleteVoiceNote,
    toggleCallDone,
    scheduleCall,
    unscheduleCall,
    scheduleAll,
    setState,
  }
}
