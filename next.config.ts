import path from 'path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Railway's Metal builder has a tight memory limit. A single compiler
    // worker avoids the build being killed while Next.js is optimizing.
    cpus: 1,
  },
}

export default nextConfig
