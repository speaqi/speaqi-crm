// Ensure Next.js binds to all interfaces
process.env.HOSTNAME = '0.0.0.0'
require('./.next/standalone/server.js')
