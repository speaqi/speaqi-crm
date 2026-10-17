// Next's standalone output omits public/ and .next/static. Package both so
// npm start and the existing Docker COPY work with the local world basemap.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const standalone = path.join(root, '.next', 'standalone')
if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  throw new Error('Standalone server missing: run next build before packaging assets')
}
fs.cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), { recursive: true })
if (fs.existsSync(path.join(root, 'public'))) {
  fs.cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
}
console.log('Standalone assets prepared: .next/static and public/')
