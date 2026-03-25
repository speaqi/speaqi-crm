'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import type {
  ActivityInput,
  ContactDetail,
  ContactInput,
  CRMContact,
  CRMState,
  PipelineStage,
  TaskInput,
  TaskWithContact,
  VoiceNote,
} from '@/types'

const VOICE_NOTES_KEY = 'speaqi_voice_notes_v2'

function readVoiceNotes() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(VOICE_NOTES_KEY)
    return raw ? (JSON.parse(raw) as VoiceNote[]) : []
  } catch {
    return []
  }
}

function writeVoiceNotes(notes: VoiceNote[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(VOICE_NOTES_KEY, JSON.stringify(notes))
}

export function useCRM() {
  const [state, setState] = useState<CRMState>({
    stages: [],
    contacts: [],
    tasks: [],
  })
  const [vNotes, setVNotes] = useState<VoiceNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const speaqiContacts = useMemo(
    () => state.contacts.filter((contact) => contact.source === 'speaqi'),
    [state.contacts]
  )

  const dueTodayCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    return state.tasks.filter((task) => {
      if (task.status !== 'pending' || !task.due_date) return false
      const due = new Date(task.due_date)
      return due >= today && due < tomorrow
    }).length
  }, [state.tasks])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [stagesResponse, contactsResponse, tasksResponse] = await Promise.all([
        apiFetch<{ stages: PipelineStage[] }>('/api/pipeline-stages'),
        apiFetch<{ contacts: CRMContact[] }>('/api/contacts'),
        apiFetch<{ tasks: TaskWithContact[] }>('/api/tasks?status=pending'),
      ])

      let contacts = contactsResponse.contacts || []
      let tasks = tasksResponse.tasks || []

      if (!contacts.length) {
        await apiFetch<{ migrated_contacts: number; migrated_tasks: number }>('/api/import/legacy', {
          method: 'POST',
        })

        const [reloadedContacts, reloadedTasks] = await Promise.all([
          apiFetch<{ contacts: CRMContact[] }>('/api/contacts'),
          apiFetch<{ tasks: TaskWithContact[] }>('/api/tasks?status=pending'),
        ])

        contacts = reloadedContacts.contacts || []
        tasks = reloadedTasks.tasks || []
      }

      setState({
        stages: stagesResponse.stages || [],
        contacts,
        tasks,
      })
      setVNotes(readVoiceNotes())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare il CRM')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (session?.user) {
        setUserId(session.user.id)
        loadAll()
      } else {
        setLoading(false)
      }
    })

    return () => {
      mounted = false
    }
  }, [loadAll])

  const createContact = useCallback(
    async (payload: ContactInput) => {
      const response = await apiFetch<{ contact: CRMContact }>('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadAll()
      return response.contact
    },
    [loadAll]
  )

  const updateContact = useCallback(
    async (id: string, payload: Partial<ContactInput>) => {
      const response = await apiFetch<{ contact: CRMContact }>(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadAll()
      return response.contact
    },
    [loadAll]
  )

  const deleteContact = useCallback(
    async (id: string) => {
      await apiFetch<{ success: boolean }>(`/api/contacts/${id}`, {
        method: 'DELETE',
      })
      await loadAll()
    },
    [loadAll]
  )

  const addActivity = useCallback(
    async (contactId: string, payload: ActivityInput) => {
      const response = await apiFetch(`/api/contacts/${contactId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadAll()
      return response
    },
    [loadAll]
  )

  const addTask = useCallback(
    async (contactId: string, payload: TaskInput) => {
      const response = await apiFetch(`/api/contacts/${contactId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await loadAll()
      return response
    },
    [loadAll]
  )

  const completeTask = useCallback(
    async (taskId: string) => {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })
      await loadAll()
    },
    [loadAll]
  )

  const loadContactDetail = useCallback(async (id: string) => {
    return apiFetch<ContactDetail>(`/api/contacts/${id}`)
  }, [])

  const addVoiceNote = useCallback((note: Omit<VoiceNote, '_u'>) => {
    setVNotes((previous) => {
      const next = [{ ...note, _u: `v${Date.now()}` }, ...previous]
      writeVoiceNotes(next)
      return next
    })
  }, [])

  const deleteVoiceNote = useCallback((uid: string) => {
    setVNotes((previous) => {
      const next = previous.filter((note) => note._u !== uid)
      writeVoiceNotes(next)
      return next
    })
  }, [])

  return {
    ...state,
    speaqiContacts,
    dueTodayCount,
    vNotes,
    loading,
    error,
    userId,
    refresh: loadAll,
    createContact,
    updateContact,
    deleteContact,
    addActivity,
    addTask,
    completeTask,
    loadContactDetail,
    addVoiceNote,
    deleteVoiceNote,
  }
}
