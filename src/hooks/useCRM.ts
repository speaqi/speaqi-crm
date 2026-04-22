'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { isClosedStatus, isHoldingContact, isPersonalContact } from '@/lib/data'
import { buildScheduledCalls, isCallTaskType } from '@/lib/schedule'
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
  TeamMember,
  VoiceNote,
} from '@/types'

const VOICE_NOTES_KEY = 'speaqi_voice_notes_v2'
type MutationOptions = { refresh?: boolean }

function compareNullableDateAsc(left?: string | null, right?: string | null) {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return new Date(left).getTime() - new Date(right).getTime()
}

function sortContacts(contacts: CRMContact[]) {
  return [...contacts].sort((left, right) => {
    const nextFollowupDiff = compareNullableDateAsc(left.next_followup_at, right.next_followup_at)
    if (nextFollowupDiff !== 0) return nextFollowupDiff

    const createdAtDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    if (createdAtDiff !== 0) return createdAtDiff

    return left.name.localeCompare(right.name)
  })
}

function buildTaskContactSnapshot(contact?: CRMContact | null) {
  if (!contact) return null

  return {
    id: contact.id,
    name: contact.name,
    status: contact.status,
    source: contact.source,
    category: contact.category,
    company: contact.company,
    phone: contact.phone,
    responsible: contact.responsible,
    event_tag: contact.event_tag,
    last_activity_summary: contact.last_activity_summary,
    contact_scope: contact.contact_scope,
    personal_section: contact.personal_section,
    priority: contact.priority,
    next_followup_at: contact.next_followup_at,
  }
}

function sortTasks(tasks: TaskWithContact[]) {
  return [...tasks].sort((left, right) => {
    const dueDateDiff = compareNullableDateAsc(left.due_date, right.due_date)
    if (dueDateDiff !== 0) return dueDateDiff
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  })
}

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

function extractMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export function useCRM() {
  const [state, setState] = useState<CRMState>({
    stages: [],
    contacts: [],
    tasks: [],
  })
  const [vNotes, setVNotes] = useState<VoiceNote[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  const crmContacts = useMemo(
    () => state.contacts.filter((contact) => !isHoldingContact(contact)),
    [state.contacts]
  )

  const holdingContacts = useMemo(
    () => state.contacts.filter((contact) => isHoldingContact(contact)),
    [state.contacts]
  )

  const personalContacts = useMemo(
    () => state.contacts.filter((contact) => isPersonalContact(contact)),
    [state.contacts]
  )

  const holdingContactIds = useMemo(
    () => new Set(holdingContacts.map((contact) => contact.id)),
    [holdingContacts]
  )

  const personalContactIds = useMemo(
    () => new Set(personalContacts.map((contact) => contact.id)),
    [personalContacts]
  )

  const visibleTasks = useMemo(
    () =>
      state.tasks.filter(
        (task) =>
          !holdingContactIds.has(task.contact_id) &&
          !personalContactIds.has(task.contact_id) &&
          !isHoldingContact({ contact_scope: task.contact?.contact_scope || 'crm' }) &&
          !isPersonalContact({ contact_scope: task.contact?.contact_scope || 'crm' })
      ),
    [holdingContactIds, personalContactIds, state.tasks]
  )

  const personalTasks = useMemo(
    () =>
      state.tasks.filter(
        (task) =>
          personalContactIds.has(task.contact_id) ||
          isPersonalContact({ contact_scope: task.contact?.contact_scope || 'crm' })
      ),
    [personalContactIds, state.tasks]
  )

  const speaqiContacts = useMemo(
    () => crmContacts.filter((contact) => contact.source === 'speaqi'),
    [crmContacts]
  )

  const scheduledCalls = useMemo(
    () => buildScheduledCalls(crmContacts, visibleTasks),
    [crmContacts, visibleTasks]
  )

  const openContactsWithoutQueue = useMemo(() => {
    const queuedContactIds = new Set(scheduledCalls.map((item) => item.contact.id))
    return crmContacts.filter(
      (contact) => !isClosedStatus(contact.status) && !queuedContactIds.has(contact.id)
    )
  }, [crmContacts, scheduledCalls])

  const dueTodayCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    return scheduledCalls.filter((item) => {
      const due = new Date(item.due_at)
      return due >= today && due < tomorrow
    }).length
  }, [scheduledCalls])

  const loadAll = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const shouldBlockUI = !background && !hasLoadedRef.current
    if (shouldBlockUI) setLoading(true)
    setError(null)

    let nextStages: PipelineStage[] | null = null
    let nextContacts: CRMContact[] | null = null
    let nextTasks: TaskWithContact[] | null = null
    const warnings: string[] = []

    try {
      const [stagesResult, contactsResult] = await Promise.allSettled([
        apiFetch<{ stages: PipelineStage[] }>('/api/pipeline-stages'),
        apiFetch<{ contacts: CRMContact[] }>('/api/contacts'),
      ])

      if (stagesResult.status === 'fulfilled') {
        nextStages = stagesResult.value.stages || []
      } else {
        warnings.push(`Stage: ${extractMessage(stagesResult.reason, 'Errore caricando gli stage')}`)
      }

      if (contactsResult.status === 'fulfilled') {
        nextContacts = contactsResult.value.contacts || []
      } else {
        warnings.push(`Contatti: ${extractMessage(contactsResult.reason, 'Errore caricando i contatti')}`)
      }

      if (nextContacts && !nextContacts.length) {
        try {
          await apiFetch<{ migrated_contacts: number; migrated_tasks: number }>('/api/import/legacy', {
            method: 'POST',
          })
          const reloadedContacts = await apiFetch<{ contacts: CRMContact[] }>('/api/contacts')
          nextContacts = reloadedContacts.contacts || []
        } catch (legacyError) {
          warnings.push(`Import legacy: ${extractMessage(legacyError, 'Errore importando i dati legacy')}`)
        }
      }

      try {
        const tasksResponse = await apiFetch<{ tasks: TaskWithContact[] }>('/api/tasks?status=pending')
        nextTasks = tasksResponse.tasks || []
      } catch (tasksError) {
        warnings.push(`Task: ${extractMessage(tasksError, 'Errore caricando i task')}`)
      }

      try {
        const teamResponse = await apiFetch<{ members: TeamMember[] }>('/api/team-members')
        setTeamMembers(teamResponse.members || [])
      } catch (teamError) {
        warnings.push(`Team: ${extractMessage(teamError, 'Errore caricando il team')}`)
      }

      setState((previous) => ({
        stages: nextStages ?? previous.stages,
        contacts: nextContacts ?? previous.contacts,
        tasks: nextTasks ?? previous.tasks,
      }))
      setVNotes(readVoiceNotes())
      setError(warnings.length ? warnings.join(' | ') : null)
    } catch (loadError) {
      setError(extractMessage(loadError, 'Impossibile caricare il CRM'))
    } finally {
      hasLoadedRef.current = true
      if (shouldBlockUI) setLoading(false)
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
    async (payload: ContactInput, options: MutationOptions = {}) => {
      const response = await apiFetch<{ contact: CRMContact }>('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setState((previous) => {
        const contacts = sortContacts([
          response.contact,
          ...previous.contacts.filter((contact) => contact.id !== response.contact.id),
        ])

        return {
          ...previous,
          contacts,
        }
      })

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }
      return response.contact
    },
    [loadAll]
  )

  const updateContact = useCallback(
    async (id: string, payload: Partial<ContactInput>, options: MutationOptions = {}) => {
      const response = await apiFetch<{ contact: CRMContact }>(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setState((previous) => {
        const contacts = sortContacts(
          previous.contacts.map((contact) => (contact.id === id ? response.contact : contact))
        )

        const tasks = sortTasks(
          previous.tasks.map((task) =>
            task.contact_id === id
              ? {
                  ...task,
                  contact: buildTaskContactSnapshot(response.contact),
                }
              : task
          )
        )

        return {
          ...previous,
          contacts,
          tasks,
        }
      })

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }
      return response.contact
    },
    [loadAll]
  )

  const deleteContact = useCallback(
    async (id: string, options: MutationOptions = {}) => {
      await apiFetch<{ success: boolean }>(`/api/contacts/${id}`, {
        method: 'DELETE',
      })

      setState((previous) => ({
        ...previous,
        contacts: previous.contacts.filter((contact) => contact.id !== id),
        tasks: previous.tasks.filter((task) => task.contact_id !== id),
      }))

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }
    },
    [loadAll]
  )

  const addActivity = useCallback(
    async (contactId: string, payload: ActivityInput, options: MutationOptions = {}) => {
      const response = await apiFetch(`/api/contacts/${contactId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setState((previous) => {
        const contacts = sortContacts(
          previous.contacts.map((contact) =>
            contact.id === contactId
              ? {
                  ...contact,
                  last_contact_at: new Date().toISOString(),
                  last_activity_summary: payload.content.trim(),
                  next_followup_at:
                    payload.next_followup_at !== undefined
                      ? payload.next_followup_at || null
                      : contact.next_followup_at,
                }
              : contact
          )
        )

        const updatedContact = contacts.find((contact) => contact.id === contactId) || null
        const nextTasks =
          response && typeof response === 'object' && 'task' in response && response.task
            ? sortTasks([
                ...previous.tasks,
                {
                  ...(response.task as TaskWithContact),
                  contact: buildTaskContactSnapshot(updatedContact),
                },
              ])
            : previous.tasks

        return {
          ...previous,
          contacts,
          tasks: nextTasks,
        }
      })

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }
      return response
    },
    [loadAll]
  )

  const addTask = useCallback(
    async (contactId: string, payload: TaskInput, options: MutationOptions = {}) => {
      const response = await apiFetch(`/api/contacts/${contactId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setState((previous) => {
        const contacts = sortContacts(
          previous.contacts.map((contact) =>
            contact.id === contactId
              ? {
                  ...contact,
                  next_followup_at: isCallTaskType(payload.type) ? payload.due_date : contact.next_followup_at,
                }
              : contact
          )
        )
        const updatedContact = contacts.find((contact) => contact.id === contactId) || null

        const nextTasks =
          response && typeof response === 'object' && 'task' in response && response.task
            ? sortTasks([
                ...previous.tasks,
                {
                  ...(response.task as TaskWithContact),
                  contact: buildTaskContactSnapshot(updatedContact),
                },
              ])
            : previous.tasks

        return {
          ...previous,
          contacts,
          tasks: nextTasks,
        }
      })

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }
      return response
    },
    [loadAll]
  )

  const completeTask = useCallback(
    async (taskId: string, options: MutationOptions = {}) => {
      const response = await apiFetch<{ task: TaskWithContact }>(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      })

      setState((previous) => ({
        ...previous,
        tasks:
          response.task.status === 'done'
            ? previous.tasks.filter((task) => task.id !== taskId)
            : sortTasks(
                previous.tasks.map((task) => (task.id === taskId ? { ...task, ...response.task } : task))
              ),
      }))

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }

      return response.task
    },
    [loadAll]
  )

  const updateTask = useCallback(
    async (
      taskId: string,
      payload: Partial<Pick<TaskInput, 'due_date' | 'priority' | 'note' | 'action'>> & {
        status?: 'pending' | 'done'
      },
      options: MutationOptions = {}
    ) => {
      const response = await apiFetch<{ task: TaskWithContact }>(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      setState((previous) => ({
        ...previous,
        tasks:
          response.task.status === 'done'
            ? previous.tasks.filter((task) => task.id !== taskId)
            : sortTasks(
                previous.tasks.map((task) =>
                  task.id === taskId
                    ? {
                        ...task,
                        ...response.task,
                        contact: task.contact,
                      }
                    : task
                )
              ),
      }))

      if (options.refresh !== false) {
        void loadAll({ background: true })
      }

      return response.task
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

  const createTeamMember = useCallback(async (payload: { name: string; email?: string; color?: string }) => {
    const response = await apiFetch<{ member: TeamMember }>('/api/team-members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setTeamMembers((previous) => [...previous, response.member].sort((a, b) => a.name.localeCompare(b.name)))
    return response.member
  }, [])

  const updateTeamMember = useCallback(async (id: string, payload: { name?: string; email?: string | null; color?: string | null }) => {
    const response = await apiFetch<{ member: TeamMember }>(`/api/team-members/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setTeamMembers((previous) =>
      previous.map((member) => (member.id === id ? response.member : member)).sort((a, b) => a.name.localeCompare(b.name))
    )
    return response.member
  }, [])

  const deleteTeamMember = useCallback(async (id: string) => {
    await apiFetch(`/api/team-members/${id}`, { method: 'DELETE' })
    setTeamMembers((previous) => previous.filter((member) => member.id !== id))
  }, [])

  return {
    ...state,
    contacts: crmContacts,
    allContacts: state.contacts,
    holdingContacts,
    personalContacts,
    tasks: visibleTasks,
    allTasks: state.tasks,
    personalTasks,
    speaqiContacts,
    scheduledCalls,
    openContactsWithoutQueue,
    dueTodayCount,
    vNotes,
    teamMembers,
    loading,
    error,
    userId,
    refresh: () => loadAll({ background: true }),
    createTeamMember,
    updateTeamMember,
    deleteTeamMember,
    createContact,
    updateContact,
    deleteContact,
    addActivity,
    addTask,
    updateTask,
    completeTask,
    loadContactDetail,
    addVoiceNote,
    deleteVoiceNote,
  }
}
