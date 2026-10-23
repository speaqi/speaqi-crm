// La scena dell'ufficio (/ufficio) è isolata in un iframe sandbox.
// Three.js e i controlli sono inclusi nel bundle, senza CDN o font remoti.
// La rotta serve il documento al titolare senza leggere file a runtime.
// Uso: node scripts/ufficio/build.mjs  (dopo aver modificato scripts/ufficio/scena.html)
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

const result = await build({ entryPoints: [new URL('./scene.js', import.meta.url).pathname], bundle: true,
  write: false, minify: true, format: 'iife', target: 'es2020', legalComments: 'inline', loader: { '.png': 'dataurl' } })
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync(new URL('./scena.html', import.meta.url), 'utf8').replace('<!-- SCENE_SCRIPT -->', () => `<script>${script}</script>`)
writeFileSync(
  new URL('../../src/lib/server/ufficio-scene.ts', import.meta.url),
  `// Generato da scripts/ufficio/build.mjs: non modificare a mano.\nexport const UFFICIO_SCENE_HTML = ${JSON.stringify(html)}\n`
)
console.log(`ufficio-scene.ts: ${html.length} caratteri`)
