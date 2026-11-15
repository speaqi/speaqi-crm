// Le scene dell'ufficio (/ufficio) sono isolate in un iframe sandbox.
// Three.js e i controlli sono inclusi nel bundle, senza CDN o font remoti.
// La rotta serve il documento al titolare senza leggere file a runtime.
// Uso: node scripts/ufficio/build.mjs  (dopo aver modificato i sorgenti in scripts/ufficio/)
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

// Due scene: il nuovo ufficio (open space) e il campus di prima, tenuto per confronto.
const SCENES = [
  { dir: './', out: 'ufficio-scene.ts', name: 'UFFICIO_SCENE_HTML' },
  { dir: './campus/', out: 'ufficio-campus-scene.ts', name: 'UFFICIO_CAMPUS_SCENE_HTML' },
]
for (const scene of SCENES) {
  const result = await build({ entryPoints: [new URL(`${scene.dir}scene.js`, import.meta.url).pathname], bundle: true,
    write: false, minify: true, format: 'iife', target: 'es2020', legalComments: 'inline', loader: { '.png': 'dataurl', '.woff2': 'dataurl' } })
  const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
  const html = readFileSync(new URL(`${scene.dir}scena.html`, import.meta.url), 'utf8').replace('<!-- SCENE_SCRIPT -->', () => `<script>${script}</script>`)
  writeFileSync(
    new URL(`../../src/lib/server/${scene.out}`, import.meta.url),
    `// Generato da scripts/ufficio/build.mjs: non modificare a mano.\nexport const ${scene.name} = ${JSON.stringify(html)}\n`
  )
  console.log(`${scene.out}: ${html.length} caratteri`)
}
