'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import 'swagger-ui-react/swagger-ui.css'

const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false })

export default function ApiDocsPage() {
  return (
    <main
      style={{
        height: '100vh',
        width: '100%',
        overflow: 'auto',
        background: '#f5f7fb',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748b', marginBottom: 8 }}>
                Speaqi Call
              </div>
              <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.1, color: '#0f172a' }}>API Documentation</h1>
              <p style={{ margin: '12px 0 0', color: '#475569', maxWidth: 780 }}>
                Swagger UI per lead, activity, task, AI endpoint, automazioni e webhook inbound necessari
                all’integrazione `Speaqi Call`.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/api/openapi/speaqi-call" className="btn btn-ghost btn-sm">
                OpenAPI JSON
              </Link>
              <Link href="/" className="btn btn-primary btn-sm">
                Torna al CRM
              </Link>
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.08)',
          }}
        >
          <SwaggerUI
            url="/api/openapi/speaqi-call"
            docExpansion="list"
            defaultModelsExpandDepth={-1}
            persistAuthorization
            displayRequestDuration
            filter
          />
        </div>
      </div>
    </main>
  )
}
