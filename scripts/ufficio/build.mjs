// La scena dell'ufficio (/ufficio) nasce come pagina HTML a sé, con three.js da CDN.
// Questo script la impacchetta come stringa in un modulo TS, così la rotta la serve
// solo al titolare senza dipendere da file letti a runtime nello standalone.
// Uso: node scripts/ufficio/build.mjs  (dopo aver modificato scripts/ufficio/scena.html)
import { readFileSync, writeFileSync } from 'node:fs'

const body = readFileSync(new URL('./scena.html', import.meta.url), 'utf8')
const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>html,body{margin:0}[hidden]{display:none!important}</style></head><body>${body}</body></html>`
writeFileSync(
  new URL('../../src/lib/server/ufficio-scene.ts', import.meta.url),
  `// Generato da scripts/ufficio/build.mjs: non modificare a mano.\nexport const UFFICIO_SCENE_HTML = ${JSON.stringify(html)}\n`
)
console.log(`ufficio-scene.ts: ${html.length} caratteri`)
