import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export type AutomationContext = {
  workspaceUserId: string
  senderUserId: string
  timezone: string
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function validateAutomationSecret(request: NextRequest) {
  const configured = process.env.AUTOMATION_SECRET || ''
  const received = request.headers.get('x-automation-secret') || ''
  return configured.length > 0 && received.length > 0 && safeEqual(configured, received)
}

export function automationContext(): AutomationContext | null {
  const workspaceUserId = String(process.env.AUTOMATION_WORKSPACE_USER_ID || '').trim()
  const senderUserId = String(process.env.AUTOMATION_SENDER_USER_ID || workspaceUserId).trim()
  if (!workspaceUserId || !senderUserId) return null
  return {
    workspaceUserId,
    senderUserId,
    timezone: String(process.env.AUTOMATION_TIMEZONE || 'Europe/Rome').trim(),
  }
}

export function requireAutomation(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return { response: Response.json({ ok: false, error: 'Unauthorized automation' }, { status: 401 }) }
  }
  const context = automationContext()
  if (!context) {
    return {
      response: Response.json(
        { ok: false, error: 'Automation workspace not configured' },
        { status: 503 }
      ),
    }
  }
  return { context }
}
