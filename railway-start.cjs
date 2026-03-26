const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const port = parseInt(process.env.PORT || '3000', 10)
const host = '0.0.0.0'
const childHost = '127.0.0.1'
const childPort = parseInt(process.env.RAILWAY_CHILD_PORT || String(port + 1), 10)
const target = path.join(__dirname, '.next', 'standalone', 'server.js')
const maxLogLines = 200
const healthcheckPath = '/api/railway-health'

let child = null
let childReady = false
let probeTimer = null
let statusMessage = 'Bootstrap server starting'
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

function diagnosticsPayload() {
  return {
    status: childReady ? 'ok' : 'booting',
    reason: statusMessage,
    target,
    exists: fs.existsSync(target),
    cwd: process.cwd(),
    node: process.version,
    ports: {
      public: port,
      child: childPort,
    },
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

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload, null, 2))
}

function sendHtml(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>SPEAQI CRM bootstrap status</title>
        <style>
          body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #111827; color: #f9fafb; margin: 0; padding: 24px; }
          h1 { font-family: system-ui, sans-serif; font-size: 28px; margin: 0 0 16px; }
          p { font-family: system-ui, sans-serif; color: #d1d5db; }
          pre { background: #030712; border: 1px solid #374151; border-radius: 12px; padding: 16px; overflow: auto; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <h1>SPEAQI CRM bootstrap status</h1>
        <p>The Next.js child process is not ready yet. Diagnostics are below.</p>
        <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
      </body>
    </html>
  `)
}

function setReady(reason) {
  if (childReady) return
  childReady = true
  statusMessage = reason
  pushLog('bootstrap', reason)
  if (probeTimer) {
    clearInterval(probeTimer)
    probeTimer = null
  }
}

function setBooting(reason) {
  childReady = false
  statusMessage = reason
  pushLog('bootstrap', reason)
}

function proxyRequest(req, res) {
  const upstream = http.request(
    {
      hostname: childHost,
      port: childPort,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: `${childHost}:${childPort}`,
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    }
  )

  upstream.on('error', (error) => {
    setBooting(`Proxy error: ${error.message}`)
    const payload = diagnosticsPayload()
    if ((req.url || '').startsWith('/api/')) {
      sendJson(res, 503, payload)
      return
    }
    sendHtml(res, 503, payload)
  })

  req.pipe(upstream)
}

function probeChild() {
  if (!child || childReady) return

  const request = http.get(
    {
      hostname: childHost,
      port: childPort,
      path: '/api/health',
      timeout: 1500,
    },
    (res) => {
      res.resume()
      if ((res.statusCode || 500) < 500) {
        setReady(`Next child is healthy on ${childHost}:${childPort}`)
      }
    }
  )

  request.on('timeout', () => request.destroy(new Error('healthcheck timeout')))
  request.on('error', (error) => {
    pushLog('probe', error.message)
  })
}

function startStandalone() {
  if (!fs.existsSync(target)) {
    setBooting('Standalone server.js not found')
    return
  }

  child = spawn(process.execPath, [target], {
    cwd: __dirname,
    env: {
      ...process.env,
      HOSTNAME: childHost,
      PORT: String(childPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  pushLog('spawn', `pid=${child.pid} target=${target} child=${childHost}:${childPort}`)

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    pushLog('stdout', chunk)
    if (String(chunk).includes('Ready in')) {
      setReady(`Next child reported ready on ${childHost}:${childPort}`)
    }
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
    pushLog('stderr', chunk)
  })

  child.on('error', (error) => {
    setBooting(`Spawn error: ${error.message}`)
  })

  child.on('exit', (code, signal) => {
    setBooting(`Standalone process exited (code=${code}, signal=${signal})`)
  })

  probeTimer = setInterval(probeChild, 1000)
  probeChild()
}

const bootstrapServer = http.createServer((req, res) => {
  if (req.url === healthcheckPath) {
    sendJson(res, 200, diagnosticsPayload())
    return
  }

  if (childReady) {
    proxyRequest(req, res)
    return
  }

  const payload = diagnosticsPayload()
  if (req.url === '/api/health' || (req.url || '').startsWith('/api/')) {
    sendJson(res, 503, payload)
    return
  }

  sendHtml(res, 503, payload)
})

bootstrapServer.listen(port, host, () => {
  console.error(`[railway-start] bootstrap server listening on ${host}:${port}`)
  startStandalone()
})

function shutdown(signal) {
  if (probeTimer) clearInterval(probeTimer)
  if (child) child.kill(signal)
  bootstrapServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
