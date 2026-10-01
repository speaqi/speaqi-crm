import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
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
