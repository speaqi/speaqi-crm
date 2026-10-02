/**
 * Pianificatore delle automazioni (ex n8n): gli orari devono essere quelli di
 * prima, nel fuso italiano anche dopo il cambio dell'ora, e un job non deve
 * mai partire due volte nello stesso minuto.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  AUTOMATION_JOBS,
  dueJobs,
  localTime,
  parseCron,
  slotOf,
  type ScheduledJob,
} from '../src/lib/automation-schedule'
import { runJob, type SchedulerDeps, type StepResult } from '../src/lib/server/automation-scheduler'

const ROME = 'Europe/Rome'
const names = (date: string) => dueJobs(new Date(date), ROME).map((job) => job.name).sort()

describe('orari', () => {
  test('ogni job ha un cron valido, un nome unico e chiama solo endpoint di automazione', () => {
    const seen = new Set<string>()
    for (const job of AUTOMATION_JOBS) {
      assert.doesNotThrow(() => parseCron(job.cron), job.name)
      assert.ok(!seen.has(job.name), `nome doppio: ${job.name}`)
      seen.add(job.name)
      assert.ok(job.steps.length > 0)
      for (const step of job.steps) assert.match(step.path, /^\/api\/automation\/[a-z-]+$/)
    }
  })

  test('alle 8 italiane di un giovedi estivo (06:00 UTC) parte l orchestratore', () => {
    assert.deepEqual(names('2026-10-01T06:00:00Z'), [
      'commercial-outreach',
      'db-maintenance',
      'followups',
      'orchestrator',
      'replies',
      'wine-project',
    ])
  })

  test('d inverno le 8 italiane sono le 07:00 UTC', () => {
    assert.ok(names('2026-12-03T07:00:00Z').includes('orchestrator'))
    assert.ok(!names('2026-12-03T06:00:00Z').includes('orchestrator'))
  })

  test('niente orchestratore ne invii holding nel fine settimana', () => {
    // Sabato 3 ottobre 2026.
    assert.ok(!names('2026-10-03T06:00:00Z').includes('orchestrator'))
    assert.ok(!names('2026-10-03T07:00:00Z').includes('send-holding'))
    assert.ok(names('2026-10-03T07:00:00Z').includes('stale-leads'))
  })

  test('il recap settimanale parte solo il lunedi alle 7:30', () => {
    assert.ok(names('2026-09-28T05:30:00Z').includes('weekly-recap'))
    assert.ok(!names('2026-09-29T05:30:00Z').includes('weekly-recap'))
  })

  test('il riepilogo notifiche gira dalle 7:05 alle 21:35 italiane', () => {
    assert.ok(names('2026-10-01T05:05:00Z').includes('notifications-digest'))
    assert.ok(names('2026-10-01T19:35:00Z').includes('notifications-digest'))
    assert.ok(!names('2026-10-01T20:05:00Z').includes('notifications-digest'))
    assert.ok(!names('2026-10-01T04:35:00Z').includes('notifications-digest'))
  })

  test('backup alle 3 di notte italiane', () => {
    assert.ok(names('2026-10-01T01:00:00Z').includes('backup'))
  })

  test('l ora locale tiene conto del cambio dell ora', () => {
    assert.equal(localTime(new Date('2026-07-01T10:00:00Z'), ROME).hour, 12)
    assert.equal(localTime(new Date('2026-01-01T10:00:00Z'), ROME).hour, 11)
  })

  test('liste, intervalli e passi', () => {
    const cron = parseCron('5,35 7-21 * * 1-5')
    assert.deepEqual([...cron.minute.values], [5, 35])
    assert.equal(cron.hour.values.size, 15)
    assert.throws(() => parseCron('61 * * * *'))
    assert.throws(() => parseCron('* * *'))
  })

  test('lo slot e il minuto UTC senza secondi', () => {
    assert.equal(slotOf(new Date('2026-10-01T06:00:42.123Z')), '2026-10-01T06:00:00.000Z')
  })
})

function fakeDeps(overrides: Partial<SchedulerDeps> = {}) {
  const claimed = new Set<string>()
  const calls: string[] = []
  const finished: Array<{ job: string; ok: boolean; steps: StepResult[] }> = []
  const alerts: string[] = []
  const deps: SchedulerDeps = {
    baseUrl: 'http://crm.test',
    secret: 's3cret',
    fetch: (async (url: string, init: any) => {
      calls.push(url)
      assert.equal(init.headers['x-automation-secret'], 's3cret')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as any,
    claim: async (job, slot) => {
      const key = `${job}@${slot}`
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    },
    finish: async (job, _slot, result) => {
      finished.push({ job, ok: result.ok, steps: result.steps })
    },
    alert: async (job) => {
      alerts.push(job)
    },
    ...overrides,
  }
  return { deps, calls, finished, alerts }
}

const chain: ScheduledJob = {
  name: 'test-chain',
  cron: '* * * * *',
  description: 'test',
  steps: [{ path: '/api/automation/a' }, { path: '/api/automation/b' }],
}

describe('corse', () => {
  test('due repliche nello stesso minuto: parte una volta sola', async () => {
    const { deps, calls } = fakeDeps()
    const slot = '2026-10-01T06:00:00.000Z'
    await runJob(deps, chain, slot)
    const second = await runJob(deps, chain, slot)
    assert.deepEqual(second, { skipped: 'claimed' })
    assert.equal(calls.length, 2)
  })

  test('un passo fallito non ferma il successivo, e l errore viene registrato e segnalato', async () => {
    const { deps, finished, alerts } = fakeDeps({
      fetch: (async (url: string) =>
        url.endsWith('/a')
          ? new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
          : new Response('{}', { status: 200 })) as any,
    })
    const job = { ...chain, name: 'test-failing' }
    await runJob(deps, job, '2026-10-01T06:10:00.000Z')
    assert.equal(finished[0].ok, false)
    assert.equal(finished[0].steps[0].error, 'boom')
    assert.equal(finished[0].steps[1].ok, true)
    assert.deepEqual(alerts, ['test-failing'])

    // Lo stesso job che fallisce di nuovo poco dopo non manda una seconda email.
    await runJob(deps, job, '2026-10-01T06:20:00.000Z')
    assert.deepEqual(alerts, ['test-failing'])
  })

  test('un job ancora in corso salta il turno invece di accavallarsi', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { deps } = fakeDeps({
      fetch: (async () => {
        await gate
        return new Response('{}', { status: 200 })
      }) as any,
    })
    const job = { ...chain, name: 'test-slow' }
    const first = runJob(deps, job, '2026-10-01T06:00:00.000Z')
    const second = await runJob(deps, job, '2026-10-01T06:10:00.000Z')
    assert.deepEqual(second, { skipped: 'running' })
    release()
    await first
  })
})
