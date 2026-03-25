const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const port = parseInt(process.env.PORT || '3000', 10)
const host = '0.0.0.0'
const target = path.join(__dirname, '.next', 'standalone', 'server.js')
const maxLogLines = 200

let fallbackStarted = false
let child = null
const bootLogs = []

function pushLog(prefix, chunk) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${prefix}] ${line}`)

  bootLogs.push(...lines)
  if (bootLogs.length > maxLogLines) {
    bootLogs.splice(0, bootLogs.length - maxLogLines)
  }
}

function diagnosticsPayload(reason) {
  return {
    status: 'degraded',
    reason,
    target,
    exists: fs.existsSync(target),
    cwd: process.cwd(),
    node: process.version,
    env: {
      PORT: process.env.PORT || null,
      NODE_ENV: process.env.NODE_ENV || null,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      AUTOMATION_SECRET: !!process.env.AUTOMATION_SECRET,
      SPEAQI_WEBHOOK_SECRET: !!process.env.SPEAQI_WEBHOOK_SECRET,
    },
    recentLogs: bootLogs,
  }
}

function startFallback(reason) {
  if (fallbackStarted) return
  fallbackStarted = true

  const payload = diagnosticsPayload(reason)
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(payload, null, 2))
      return
    }

    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>SPEAQI CRM bootstrap error</title>
          <style>
            body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #111827; color: #f9fafb; margin: 0; padding: 24px; }
            h1 { font-family: system-ui, sans-serif; font-size: 28px; margin: 0 0 16px; }
            p { font-family: system-ui, sans-serif; color: #d1d5db; }
            pre { background: #030712; border: 1px solid #374151; border-radius: 12px; padding: 16px; overflow: auto; white-space: pre-wrap; }
          </style>
        </head>
        <body>
          <h1>SPEAQI CRM bootstrap error</h1>
          <p>The Next.js process crashed before becoming healthy. Diagnostics are below.</p>
          <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
        </body>
      </html>
    `)
  })

  server.listen(port, host, () => {
    console.error(`[railway-start] fallback server listening on ${host}:${port}`)
  })
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function startStandalone() {
  if (!fs.existsSync(target)) {
    startFallback('Standalone server.js not found')
    return
  }

  child = spawn(process.execPath, [target], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOSTNAME: host,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    pushLog('stdout', chunk)
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    pushLog('stderr', chunk)
  })

  child.on('error', (error) => {
    pushLog('spawn', error.stack || error.message)
    startFallback(`Spawn error: ${error.message}`)
  })

  child.on('exit', (code, signal) => {
    pushLog('exit', `code=${code} signal=${signal}`)
    startFallback(`Standalone process exited (code=${code}, signal=${signal})`)
  })
}

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM')
  process.exit(0)
})

process.on('SIGINT', () => {
  if (child) child.kill('SIGINT')
  process.exit(0)
})

startStandalone()
