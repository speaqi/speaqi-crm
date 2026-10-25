import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  // Chromium per il PDF delle presentazioni (@sparticuz/chromium): non si impacchetta
  // e i suoi binari, che il tracciamento dei file non vede, vanno copiati a mano
  // nell'output standalone, solo per le rotte che lo usano.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/tourism/decks/[id]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/tourism/decks/[id]/approve': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/presentazione/[token]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/agency/presentations/[id]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/proposta/[token]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
    // Il PDF della bozza parte anche verso Telegram: dagli ordini al Direttore, dalle
    // corse degli agenti e dai pulsanti del bot.
    '/api/integrations/telegram/webhook': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/office/director/orders': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/office/agents/[id]/run-now': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/automation/agents/[id]/run': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/office/outputs/[id]': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
  // La pagina di reclutamento commerciali si e' spostata su Speaqi Guides
  // (stesso indirizzo di SALES_RECRUIT_URL). Le candidature continuano ad
  // arrivare qui, su /api/candidature-commerciali.
  async redirects() {
    return [
      {
        source: '/diventa-commerciale',
        destination: 'https://guides.speaqi.com/diventa-commerciale',
        permanent: true,
      },
    ]
  },
  experimental: {
    // Railway's Metal builder has a tight memory limit. A single compiler
    // worker avoids the build being killed while Next.js is optimizing.
    cpus: 1,
  },
}

export default nextConfig
