import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { officeSceneEvents } from '../../src/lib/office-scene-events'
import { BRAND, STATE_COLOR, esc, short, loadFonts, loadLogos, onLogos, setLevels, untrack, dropPool, iconSvg, glow, mesh, geo, sparkleTex } from './kit.js'
import { ROOM, SIGN, buildRoom, LOUNGE } from './room.js'
import { buildZones, updateLive, refreshStation, animateStations, label, PHASES, PHASE_COLOR } from './zones.js'
import { applyState, stepPerson } from './people.js'
import { buildPets } from './pets.js'
import { zoneOf, STATE_NAME, STATE_ICON, activityLine } from './catalog.js'

// L'ufficio Speaqi in 3D: un open space visto a spaccato. Le persone sono gli agenti veri del CRM.
// Tre regole: si capisce chi fa cosa (cartellini, schermi, «Adesso in ufficio»), si capisce dove cliccare
// (il cursore, il suggerimento al passaggio, la barra delle zone), e niente è inventato: una zona senza agenti è vuota.

const $ = (id) => document.getElementById(id)
const send = (message) => window.parent.postMessage(message, '*')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const romeHour = () => Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const clock = (iso) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const LIGHT = {
  day: { bg: '#e7e8ee', sky: '#fff1dc', ground: '#c4b29c', hemi: 0.78, sun: '#ffd9ac', sunPower: 3.3, fill: 0.45, env: 0.42, glow: 1, pool: 0.5, exposure: 0.96, bloom: 0.22, points: 0 },
  night: { bg: '#2c3c66', sky: '#5c6fa3', ground: '#1a1d2b', hemi: 0.46, sun: '#8fa8e6', sunPower: 0.55, fill: 0.14, env: 0.15, glow: 1.75, pool: 1.9, exposure: 1.12, bloom: 0.5, points: 1 },
}

let snapshot = null, focused = null, selected = null, light = romeHour() >= 7 && romeHour() < 19 ? 'day' : 'night', dataError = ''
let renderer, composer, bloom, labels, scene, camera, controls, sun, hemi, fill, groundMat, shadowMat, resizeObserver, W = null, signature = '', fontsReady = false
let tween = null, stageWidth = 1, stageHeight = 1, lastFrame = 0, lastRaf = 0, lastInteraction = 0, lastScreens = 0, clockStart = performance.now()
let webglFailed = false, down = null, dirty = true, hovered = null, hints = [], hintsDone = false, cityOpen = null
let packets = [], replay = null, replayTimer = null, hoverRing = null, selectRing = null, showLabels = true
let quality = typeof window.__OFFICE_QUALITY__ === 'number' ? window.__OFFICE_QUALITY__ : 2, qualityLocked = typeof window.__OFFICE_QUALITY__ === 'number', slow = 0
const deliveredEvents = new Set()

function fail3D() { webglFailed = true; $('fallback').hidden = false; $('loading').hidden = true; send({ type: 'office:failed' }) }

/* ---------- motore ---------- */
function init3D() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fail3D() })
    $('stage').appendChild(renderer.domElement)
    labels = new CSS2DRenderer(); labels.domElement.className = 'labels'
    $('stage').appendChild(labels.domElement)
    scene = new THREE.Scene()
    scene.background = new THREE.Color(LIGHT[light].bg); scene.fog = new THREE.Fog(LIGHT[light].bg, 75, 190)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose()
    loadLogos(); onLogos(() => { dirty = true })
    camera = new THREE.PerspectiveCamera(30, 1, 0.5, 500)
    camera.position.set(30, 34, 58)
    hemi = new THREE.HemisphereLight('#fff4e4', '#cdbba4', 0.95); scene.add(hemi)
    // Il sole entra dalle finestre di sinistra: le ombre cadono verso destra, come nel disegno.
    sun = new THREE.DirectionalLight('#ffdcb2', 2.9)
    sun.position.set(-44, 40, 18); sun.target.position.set(0, 0, 0); sun.castShadow = true
    const big = renderer.capabilities.maxTextureSize >= 8192 && Math.max(screen.width, screen.height) > 1000
    sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048)
    Object.assign(sun.shadow.camera, { left: -26, right: 24, top: 24, bottom: -22, near: 10, far: 130 })
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3
    scene.add(sun); scene.add(sun.target)
    fill = new THREE.DirectionalLight('#bcd6f2', 0.5); fill.position.set(26, 20, 30); scene.add(fill)
    // Il piano attorno al plastico ha lo stesso colore dello sfondo (nessun orizzonte); le ombre le raccoglie un secondo piano.
    groundMat = new THREE.MeshBasicMaterial({ color: LIGHT[light].bg }); groundMat.userData.shared = true
    shadowMat = new THREE.ShadowMaterial({ opacity: 0.2 }); shadowMat.userData.shared = true
    hoverRing = ringMarker(); selectRing = ringMarker()
    if (renderer.capabilities.isWebGL2) try {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2())
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }))
      composer.addPass(new RenderPass(scene, camera))
      bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.75, 1.0)
      composer.addPass(bloom); composer.addPass(new OutputPass())
    } catch { composer = null }
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.dampingFactor = 0.09
    controls.minDistance = 5; controls.maxDistance = 130
    controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.42
    controls.minAzimuthAngle = -0.45; controls.maxAzimuthAngle = 1.25
    controls.screenSpacePanning = false; controls.zoomSpeed = 0.9
    controls.addEventListener('start', () => { tween = null; lastInteraction = performance.now(); clearHints() })
    controls.addEventListener('change', () => { dirty = true; lastInteraction = performance.now() })
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; lastInteraction = performance.now() })
    canvas.addEventListener('pointercancel', () => { down = null })
    canvas.addEventListener('pointerup', pick)
    canvas.addEventListener('pointermove', hover)
    canvas.addEventListener('pointerleave', () => setHover(null))
    canvas.addEventListener('wheel', () => { lastInteraction = performance.now(); clearHints() }, { passive: true })
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe($('stage'))
    applyLight(); resize()
    renderer.setAnimationLoop(frame)
  } catch { fail3D() }
}
function ringMarker() {
  const m = mesh(geo('marker-ring', () => new THREE.RingGeometry(0.56, 0.66, 40)), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }), scene, 0, 0.03, 0, false)
  m.rotation.x = -Math.PI / 2; m.renderOrder = 4; m.visible = false
  return m
}
function applyLight() {
  if (!renderer || !hemi) return
  const L = LIGHT[light]
  scene.background.set(L.bg); scene.fog.color.set(L.bg); groundMat.color.set(L.bg)
  hemi.intensity = L.hemi; hemi.color.set(L.sky); hemi.groundColor.set(L.ground)
  sun.intensity = L.sunPower; sun.color.set(L.sun); fill.intensity = L.fill
  renderer.toneMappingExposure = L.exposure
  if (bloom) bloom.strength = L.bloom
  setLevels({ env: L.env, glow: L.glow, pool: L.pool })
  if (W) for (const l of W.lights) l.light.intensity = L.points ? l.night : l.day
  document.querySelector('.viewport').dataset.light = light
  dirty = true
}
function setQuality(level) {
  quality = level
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, level === 2 ? 1.75 : level === 1 ? 1.25 : 1))
  if (level === 0) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null }
  resize()
}

/* ---------- costruzione ---------- */
function newWorld() {
  return { root: new THREE.Group(), pick: [], tick: [], sway: [], lights: [], tall: [], zones: [], persons: [], stations: [], groundMat, shadowMat, lounge: null }
}
function disposeWorld() {
  if (!W) return
  W.root.traverse((o) => {
    if ((o.isMesh || o.isPoints || o.isSprite) && o.geometry && !o.geometry.userData.shared) o.geometry.dispose()
    if (o.userData.pool) dropPool(o.userData.pool)
    for (const m of [o.material].flat()) if (m && !m.userData.shared) { untrack(m); for (const key of ['map', 'emissiveMap']) if (m[key] && !m[key].userData.shared) m[key].dispose(); m.dispose() }
    if (o.isCSS2DObject) o.element.remove()
  })
  scene.remove(W.root)
  for (const p of packets) scene.remove(p.m)
  packets = []; hints = []; W = null; hovered = null
}
const structureKey = () => JSON.stringify(snapshot.departments.map((d) => [d.id, d.name, d.color, d.agents.map((a) => [a.id, a.name])]))
function buildOffice() {
  if (!scene || webglFailed || !snapshot || !fontsReady) return
  const key = structureKey()
  if (key !== signature || !W) {
    signature = key
    disposeWorld()
    W = newWorld(); scene.add(W.root)
    buildRoom(W); buildZones(W, snapshot)
    buildPets(W, { cx: LOUNGE.x, cz: LOUNGE.z + 0.3, rx: 4.6, rz: 4.1 }, { cx: 7.6, cz: 8.5, rx: 1.9, rz: 0.9 })
    W.root.updateMatrixWorld(true)
    for (const zone of W.zones) for (const rec of zone.people) rec.tag.element.onclick = () => focusDepartment(zone.id, rec.agent.id)
    for (const zone of W.zones) zone.tag.element.onclick = () => focusDepartment(focused === zone.id ? null : zone.id)
    W.kiosk.el.onclick = () => send({ type: 'office:navigate' })
    W.cityTable.el.onclick = () => send({ type: 'office:cities' })
    W.cityCard.element.addEventListener('click', (event) => {
      const b = event.target.closest('button'); if (!b) return
      if (b.dataset.close !== undefined) openCity(null); else if (b.dataset.slug) send({ type: 'office:cities', slug: b.dataset.slug })
    })
    for (const st of W.stations) refreshStation(st)
    applyLight()
    $('loading').classList.add('done')
    if (!hintsDone) setTimeout(showHints, 900)
  } else syncAgents()
  updateLive(W, snapshot); openCity(cityOpen); updateTags(); updateFocus(); renderHud()
  dirty = true
}
/** I dati cambiano, la stanza resta: chi cambia stato si rimette in posa, senza ricostruire niente. */
function syncAgents() {
  const agents = new Map(snapshot.departments.flatMap((d) => d.agents).map((a) => [a.id, a]))
  for (const rec of W.persons) {
    const next = agents.get(rec.agent.id); if (!next) continue
    const changed = next.status !== rec.agent.status || next.blocked !== rec.agent.blocked
    rec.agent = next; rec.station.agent = next
    if (changed) { applyState(rec); refreshStation(rec.station) }
  }
  for (const zone of W.zones) zone.sector = snapshot.departments.find((d) => d.id === zone.id) || zone.sector
}

/* ---------- cartellini ---------- */
function personTag(rec) {
  const agent = rec.agent, playing = replay?.current?.agentId === agent.id ? replay.current : null
  const line = playing ? `${clock(playing.at)} · ${playing.summary || playing.label}` : activityLine(agent)
  const el = rec.tag.element
  el.dataset.state = playing ? 'replay' : agent.status
  rec.hot = agent.status === 'running' || agent.status === 'attention'
  el.classList.toggle('task', rec.hot)
  el.title = rec.role.does
  el.innerHTML = `<i style="--c:${STATE_COLOR[agent.status]}"></i><b>${esc(agent.name)}</b><span>${esc(rec.role.does)}</span><span class="line">${esc(short(line, 84))}</span>`
}
function zoneCounts(sector) {
  const working = sector.agents.filter((a) => a.status === 'running').length + (sector.id === 'mappe' && snapshot.command && !snapshot.command.done ? 1 : 0)
  const stuck = sector.agents.filter((a) => a.status === 'attention').length
  return { working, stuck, total: sector.agents.length, on: sector.agents.filter((a) => a.enabled).length }
}
const zoneSummary = (sector) => { const c = zoneCounts(sector); return [c.total ? plural(c.total, 'agente', 'agenti') : 'nessun agente', c.working ? `${c.working} al lavoro` : '', c.stuck ? `${c.stuck} da verificare` : ''].filter(Boolean).join(' · ') }
function updateTags() {
  for (const rec of W.persons) personTag(rec)
  for (const zone of W.zones) {
    const c = zoneCounts(zone.sector), el = zone.tag.element
    el.innerHTML = `<i></i>${esc(zone.sector.name)}<b>${c.stuck ? `⚠ ${plural(c.stuck, 'fermo', 'fermi')}` : c.working ? `● ${c.working} al lavoro` : zone.top ? `Tu e ${c.total === 1 ? 'il Direttore' : plural(c.total, 'agente', 'agenti')}` : plural(c.total, 'agente', 'agenti')}</b>`
    el.classList.toggle('alarm', c.stuck > 0); el.classList.toggle('busy', !c.stuck && c.working > 0)
  }
}
function updateFocus() {
  if (!W) return
  for (const zone of W.zones) {
    const el = zone.tag.element
    el.setAttribute('aria-pressed', String(focused === zone.id))
    el.classList.toggle('dim', Boolean(focused) && focused !== zone.id); el.classList.toggle('cur', focused === zone.id)
    for (const rec of zone.people) {
      const mine = focused === zone.id
      rec.tag.visible = true
      rec.tag.element.classList.toggle('near', mine); rec.tag.element.classList.toggle('sel', rec.agent.id === selected)
      // Nella zona aperta i cartellini si alternano su due altezze, così i vicini non si coprono.
      rec.tag.position.y = mine ? 2.45 + (rec.index % 2) * 0.62 : 2.42
    }
  }
  document.querySelector('.viewport').dataset.far = String(!focused)
  if (W.ceo) W.ceo.tag.visible = focused === 'direzione'
  declutterAt = 0; dirty = true
}
/** Le etichette che si accavallano: resta la più importante (cosa aspetta te, chi lavora), le altre lasciano il posto. */
let declutterAt = 0
function declutter(time) {
  if (!W) return true
  if (time - declutterAt < 220) return false
  declutterAt = time
  const items = []
  const add = (object, priority) => { const el = object.element; if (object.visible && el.style.display !== 'none' && !el.hidden) items.push({ el, priority }) }
  add(W.kiosk.tag, 100); add(W.cityTable.tag, 40)
  for (const zone of W.zones) {
    if (focused !== zone.id) add(zone.tag, focused ? 30 : 90)
    for (const rec of zone.people) {
      const a = rec.agent, state = a.status === 'attention' ? 3 : a.status === 'running' ? 2 : a.status === 'ready' ? 1 : 0
      add(rec.tag, rec.agent.id === selected || replay?.current?.agentId === a.id ? 120 : focused === zone.id ? 105 + state : 50 + state * 10)
    }
  }
  for (const key of ['studio', 'sys', 'money']) if (W[key]) add(W[key].tag, 45)
  const kept = []
  for (const item of items.sort((x, y) => y.priority - x.priority)) {
    const r = item.el.getBoundingClientRect()
    const hit = r.width > 0 && kept.some((k) => r.left < k.right + 4 && r.right > k.left - 4 && r.top < k.bottom + 3 && r.bottom > k.top - 3)
    item.el.classList.toggle('yield', hit)
    if (!hit && r.width > 0) kept.push(r)
  }
  return true
}

/* ---------- interfaccia sopra la scena ---------- */
function renderHud() {
  if (!snapshot) return
  syncNow()
  const all = snapshot.departments.flatMap((d) => d.agents.map((agent) => ({ agent, sector: d })))
  const by = (status) => all.filter((x) => x.agent.status === status)
  const stuck = by('attention'), busy = by('running'), ready = by('ready'), off = by('off')
  $('now-count').innerHTML = `<i style="--c:${STATE_COLOR.running}" title="Al lavoro">${busy.length}</i><i style="--c:${STATE_COLOR.attention}" title="Da verificare">${stuck.length}</i>`
  const rows = [...stuck, ...busy], shown = rows.slice(0, 5)
  let html = shown.map(({ agent, sector }) => `<li><button type="button" class="now-row" data-agent="${esc(agent.id)}" data-dept="${esc(sector.id)}" data-state="${agent.status}" aria-label="Vai da ${esc(agent.name)}"><span class="ico" style="--c:${STATE_COLOR[agent.status]}">${iconSvg(agent.blocked ? 'hand' : STATE_ICON[agent.status], 13)}</span><span><b>${esc(agent.name)}</b><span>${esc(activityLine(agent))}</span></span><span class="go">→</span></button></li>`).join('')
  if (!rows.length) html = `<li class="now-empty">${all.length ? 'Tutto tranquillo: nessuno sta lavorando e niente è fermo.' : 'Nessun agente installato.'}</li>`
  html += `<li class="now-rest">${rows.length > shown.length ? `<i style="--c:#fff">e altri ${rows.length - shown.length}</i>` : ''}<i style="--c:${STATE_COLOR.ready}">${plural(ready.length, 'disponibile', 'disponibili')}</i><i style="--c:${STATE_COLOR.off}">${plural(off.length, 'spento', 'spenti')}</i></li>`
  if (dataError) html += `<li class="now-error" role="alert">${esc(dataError)} I dati sono dell’ultimo aggiornamento riuscito.</li>`
  $('now-list').innerHTML = html
  // Barra delle zone.
  const n = snapshot.pendingCount
  $('dock').innerHTML = `<button type="button" class="dock-chip wait${n ? '' : ' zero'}" data-wait aria-label="Apri le cose da decidere (${n})">${iconSvg('inbox', 14)}<span class="nm">Aspetta te</span><em>${n}</em></button><span class="dock-sep"></span>`
    + snapshot.departments.map((sector) => { const c = zoneCounts(sector), z = zoneOf(sector)
      return `<button type="button" class="dock-chip" data-dept="${esc(sector.id)}" aria-pressed="${focused === sector.id}" title="${esc(z.title)} · ${esc(zoneSummary(sector))}" aria-label="Vai a ${esc(sector.name)}, ${esc(zoneSummary(sector))}"><span class="sw" style="--c:${sector.color}">${iconSvg(z.icon, 12)}</span><span class="nm">${esc(sector.name)}</span>${c.stuck ? `<em class="warn">${c.stuck}</em>` : ''}${c.working ? `<em class="run">${c.working}</em>` : ''}</button>` }).join('')
  const sector = snapshot.departments.find((d) => d.id === focused)
  $('crumb').hidden = !sector
  if (sector) { const z = zoneOf(sector); $('crumb').innerHTML = `<button type="button" data-back aria-label="Torna a tutto l’ufficio">← Tutto l’ufficio</button><span class="sw" style="--c:${sector.color}">${iconSvg(z.icon, 14)}</span><div><b>${esc(z.title)}</b><span>${esc(sector.name)} · ${esc(zoneSummary(sector))}</span></div>` }
}
$('legend').innerHTML = ['running', 'ready', 'attention', 'off'].map((s) => `<span><i style="--c:${STATE_COLOR[s]}">${iconSvg(STATE_ICON[s], 10)}</i>${{ running: 'Sta lavorando: scrive, lo schermo è verde', ready: 'Disponibile: aspetta il turno, ogni tanto va in lounge', attention: 'Da verificare: è in piedi, aspetta te', off: 'Spento: dorme sulla scrivania' }[s]}</span>`).join('')
  + '<small>Clicca una zona o una persona · trascina per ruotare · rotella per lo zoom · Esc per tornare</small>'
$('now-list').addEventListener('click', (event) => { const b = event.target.closest('[data-agent]'); if (b) focusDepartment(b.dataset.dept, b.dataset.agent) })
// Il riquadro «Adesso»: aperto dove c'è posto, chiuso su telefono e, su palco stretto, quando si entra in una zona
// (lì coprirebbe le persone). Chi lo apre o lo chiude a mano decide lui, finché non cambia vista.
let nowChoice = null, nowFocus = false
function syncNow() {
  if (nowFocus !== Boolean(focused)) { nowFocus = Boolean(focused); nowChoice = null }
  const width = stageWidth > 1 ? stageWidth : innerWidth
  const shut = nowChoice !== null ? nowChoice : (width < 700 || (width < 940 && Boolean(focused)))
  $('now').classList.toggle('shut', shut); $('now-toggle').setAttribute('aria-expanded', String(!shut)); $('now-toggle').textContent = shut ? '▾' : '▴'
}
$('now-toggle').onclick = () => { nowChoice = !$('now').classList.contains('shut'); syncNow() }
syncNow()
$('dock').addEventListener('click', (event) => {
  const b = event.target.closest('button'); if (!b) return
  if (b.dataset.wait !== undefined) send({ type: 'office:navigate' }); else focusDepartment(focused === b.dataset.dept ? null : b.dataset.dept)
})
$('crumb').addEventListener('click', (event) => { if (event.target.closest('[data-back]')) focusDepartment(null) })
$('reset').onclick = () => focusDepartment(null)
// «Etichette»: con l'interruttore spento il 3D resta pulito, senza nessuna etichetta. Insegne, schermi e fumetti restano, perché sono nella scena.
function setLabels(on, tell = true) {
  showLabels = on
  document.querySelector('.viewport').classList.toggle('nolabels', !on)
  $('labels-toggle').setAttribute('aria-pressed', String(on)); $('labels-toggle').title = on ? 'Nascondi tutte le etichette' : 'Mostra le etichette'
  if (!on) clearHints()
  if (tell) send({ type: 'office:pref', labels: on })
  dirty = true
}
$('labels-toggle').onclick = () => setLabels(!showLabels)
$('help').onclick = () => { const open = $('legend').hidden; $('legend').hidden = !open; $('help').setAttribute('aria-expanded', String(open)) }
document.querySelectorAll('[data-light]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.light === light))
  button.onclick = () => {
    light = button.dataset.light
    document.querySelectorAll('[data-light]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    applyLight()
  }
})
// Esc torna alla vista completa e, se la pagina è a schermo intero, lo chiude: il tasto premuto qui non arriva alla pagina da solo.
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { focusDepartment(null); send({ type: 'office:escape' }) } })

/* Suggerimento al passaggio: cos'è la cosa sotto il cursore e cosa succede cliccandola. */
function tipHtml(target) {
  const head = (icon, color, title, state = '') => `<div class="th"><span class="ico" style="--c:${color}">${iconSvg(icon, 14)}</span><b>${esc(title)}</b>${state}</div>`
  const click = (text) => `<small>${iconSvg('arrow', 12)}${esc(text)}</small>`
  if (target.type === 'agent') {
    const rec = W.persons.find((r) => r.agent.id === target.id); if (!rec) return ''
    const a = rec.agent
    return head(rec.role.icon, rec.sector.color, a.name, `<span class="st" style="--c:${STATE_COLOR[a.status]}">${esc(a.activityLabel || STATE_NAME[a.status])}</span>`)
      + `<p>${esc(rec.role.does)}</p><p class="nowline">${esc(short(activityLine(a), 120))}</p>${click('Clicca per aprire la sua scheda')}`
  }
  if (target.type === 'dept') {
    const zone = W.zones.find((z) => z.id === target.id); if (!zone) return ''
    const z = zoneOf(zone.sector)
    return head(z.icon, zone.sector.color, z.title) + `<p>${esc(zone.sector.name)} · ${esc(zoneSummary(zone.sector))}</p>${click(focused === zone.id ? 'Clicca una persona per la sua scheda' : 'Clicca per entrare nella zona')}`
  }
  if (target.type === 'kiosk') {
    const n = snapshot.pendingCount, titles = snapshot.outputs.slice(0, 3).map((o) => `<p>· ${esc(short(o.title, 48))}</p>`).join('')
    return head('inbox', BRAND.orange, 'Aspetta te') + `<p class="nowline">${n ? `${plural(n, 'cosa', 'cose')} da decidere` : 'Niente da decidere adesso'}</p>${titles}${click('Clicca per aprirle nel pannello')}`
  }
  if (target.type === 'city') {
    const city = snapshot.production?.available && snapshot.production.cities[target.k]; if (!city) return ''
    return head('city', '#62a9da', city.name) + `<p>${city.live ? 'Online' : 'In produzione'} · ${city.done}/8 fasi</p><div class="dots">${PHASES.map((name, i) => `<i style="background:${PHASE_COLOR[city.phases[i]] || PHASE_COLOR.t}"></i>`).join('')}</div><p class="nowline">${esc(city.next ? `Manca: ${city.next}` : 'Allineata, niente da fare')}</p>${click('Clicca per i dettagli')}`
  }
  if (target.type === 'cities') { const P = snapshot.production; return head('city', '#62a9da', 'Plastico delle città') + `<p>${P?.available ? `${P.totals.in_progress} in produzione · ${P.totals.live} online. Più alto il palazzo, più avanti la città; la bandierina vuol dire online.` : 'Le città di StudioMap.'}</p>${click('Clicca una città, o l’etichetta per la sala «Città»')}` }
  if (target.type === 'info') { const info = W[target.name === 'system' ? 'sys' : target.name]?.info; if (!info) return ''; return head(target.name === 'money' ? 'euro' : target.name === 'system' ? 'server' : 'map', info.bad ? '#ff4d3d' : '#5b6a7d', info.title) + info.lines.map((l) => `<p>${esc(l)}</p>`).join('') }
  return ''
}
function showTip(event) {
  const tip = $('tip'), html = hovered ? tipHtml(hovered) : ''
  if (!html || event.pointerType === 'touch') { tip.hidden = true; return }
  if (tip.dataset.key !== hovered.key) { tip.innerHTML = html; tip.dataset.key = hovered.key }
  tip.hidden = false
  const rect = $('stage').getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight
  let x = event.clientX - rect.left + 16, y = event.clientY - rect.top + 18
  if (x + w > rect.width - 8) x = event.clientX - rect.left - w - 14
  if (y + h > rect.height - 8) y = event.clientY - rect.top - h - 14
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`
}

/* Tre suggerimenti alla prima apertura: dove si clicca. Spariscono al primo gesto. */
function showHints() {
  if (hintsDone || !W || webglFailed || !showLabels) return
  hintsDone = true
  const make = (text, parent, y) => { const el = document.createElement('div'); el.className = 'hint'; el.textContent = text; const o = label(el, parent, 0, y, 0); o.center.set(0.5, 1); hints.push(o) }
  const zone = W.zones.find((z) => z.id === 'ricerca' && z.people.length) || W.zones.find((z) => !z.top && z.people.length)
  const rec = W.persons.find((r) => r.agent.status === 'running' && r.zone !== zone) || W.persons.find((r) => r.zone !== zone) || W.persons[0]
  if (zone) make('Clicca una zona per entrare', zone.tag.parent, zone.tag.position.y + 0.75)
  if (rec) make('Clicca una persona: ti dice cosa fa', rec.person, 3.25)
  make('Qui arriva ciò che devi decidere', W.kiosk.g, 3.6)
  setTimeout(clearHints, 18000); dirty = true
}
function clearHints() { if (!hints.length) return; for (const h of hints) { h.parent?.remove(h); h.element.remove() } hints = []; dirty = true }

/* ---------- plastico delle città ---------- */
function openCity(slug) {
  if (!W?.cityCard) return
  cityOpen = slug
  const cities = snapshot?.production?.available ? snapshot.production.cities : []
  const k = cities.findIndex((c) => c.slug === slug), city = cities[k], card = W.cityCard.element
  if (slug && !city) cityOpen = null
  card.hidden = !city
  if (city) {
    W.cityCard.position.copy(W.cityTable.models[k].m.position).add(new THREE.Vector3(0, 1.25, 0))
    card.innerHTML = `<button type="button" data-close aria-label="Chiudi">×</button><strong>${esc(city.name)}</strong><small>${city.protected ? 'Protetta · sola lettura' : city.live ? 'Online' : 'In produzione'} · ${city.done}/8 fasi</small>`
      + `<div class="dots">${PHASES.map((name, i) => `<i title="${name}" style="background:${PHASE_COLOR[city.phases[i]] || PHASE_COLOR.t}"></i>`).join('')}</div>`
      + `<p>${esc(city.protected ? 'Non si tocca da qui.' : city.next ? `Manca: ${city.next}` : 'Allineata, niente da fare.')}</p><button type="button" class="go" data-slug="${esc(city.slug)}">Apri la riga della città →</button>`
  }
  dirty = true
}

/* ---------- la giornata, rivista in un minuto ---------- */
function stopReplay() {
  clearTimeout(replayTimer); replay = null
  $('replay-ico').textContent = '▶'; $('replay').setAttribute('aria-label', 'Rivedi oggi'); $('replay').querySelector('.tx').textContent = ' Rivedi oggi'; $('replay-line').hidden = true
  if (W) { updateTags(); updateFocus() }
}
function startReplay() {
  if (replay) { stopReplay(); return }
  const events = snapshot?.day || []
  $('replay-line').hidden = false
  if (!events.length) { $('replay-text').textContent = 'Oggi nessun agente ha ancora lavorato.'; $('replay-bar').style.width = '0%'; replayTimer = setTimeout(stopReplay, 3500); replay = { events, i: 0, current: null }; return }
  replay = { events, i: -1, current: null }
  $('replay-ico').textContent = '■'; $('replay').setAttribute('aria-label', 'Ferma'); $('replay').querySelector('.tx').textContent = ' Ferma'
  const next = () => {
    if (!replay) return
    replay.i++
    if (replay.i >= replay.events.length) { $('replay-text').textContent = `Fine: ${plural(replay.events.length, 'corsa', 'corse')} oggi.`; replay.current = null; updateTags(); updateFocus(); replayTimer = setTimeout(stopReplay, 3000); return }
    const e = replay.current = replay.events[replay.i]
    const rec = W?.persons.find((r) => r.agent.id === e.agentId)
    $('replay-text').textContent = `${clock(e.at)} · ${rec?.agent.name || e.agentId}: ${short(e.summary || e.label, 90)} (${e.label})`
    $('replay-bar').style.width = `${(replay.i + 1) / replay.events.length * 100}%`
    if (W) { updateTags(); updateFocus() }
    if (e.items > 0 && !reduceMotion && !webglFailed) spawnPacket(e.agentId, 'kiosk')
    replayTimer = setTimeout(next, 2600)
  }
  next()
}
$('replay').addEventListener('click', startReplay)

/* ---------- pacchetti: arancione un ordine che parte, verde un risultato che arriva ---------- */
function spawnPacket(fromId, toId, points) {
  if (!W?.kiosk || packets.length > 24) return
  const source = W.persons.find((rec) => rec.agent.id === fromId), destination = W.persons.find((rec) => rec.agent.id === toId)
  if (!points && (!source || (toId !== 'kiosk' && !destination))) return
  const head = (rec) => rec.person.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.5, 0))
  const from = points ? points[0] : head(source), to = points ? points[1] : destination ? head(destination) : W.kiosk.top.clone()
  const mid = from.clone().lerp(to, 0.5); mid.y = Math.max(from.y, to.y) + 3.2 + Math.random()
  const order = points || fromId === 'director'
  const m = mesh(geo('packet', () => new THREE.SphereGeometry(0.1, 12, 8)), glow(order ? '#ff8a4d' : '#7af0b0', 2.6), scene, from.x, from.y, from.z, false)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleTex(), color: order ? '#ff8a4d' : '#7af0b0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(0.7); m.add(halo)
  packets.push({ m, halo, curve: new THREE.QuadraticBezierCurve3(from, mid, to), t: 0, dur: 2.2 + Math.random() * 0.8 })
}

/* ---------- camera ---------- */
function focusDepartment(id, agentId = null) {
  focused = id; selected = agentId
  clearHints(); updateFocus(); renderHud(); moveCamera()
  // Il pannello della pagina mostra la squadra della zona scelta qui.
  send({ type: 'office:focus', department: id, agentId })
}
// Inquadra i punti nella parte di schermo libera dai comandi (pad in pixel) e li centra lì: vale per ogni formato di finestra.
function frameView(target, dir, points, pad) {
  const cam = camera.clone(), v = new THREE.Vector3(), tgt = target.clone()
  const rw = Math.max(0.3, 2 - 2 * (pad.l + pad.r) / stageWidth), rh = Math.max(0.3, 2 - 2 * (pad.t + pad.b) / stageHeight)
  const cx = (pad.l - pad.r) / stageWidth, cy = (pad.b - pad.t) / stageHeight, tanV = Math.tan(camera.fov * Math.PI / 360)
  const measure = (dist) => {
    cam.position.copy(tgt).addScaledVector(dir, dist); cam.lookAt(tgt); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ok = true
    for (const p of points) { v.copy(p).project(cam); if (v.z >= 1) ok = false; x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y) }
    return { x0, x1, y0, y1, ok }
  }
  let dist = 40
  for (let pass = 0; pass < 4; pass++) {
    let lo = 2, hi = 400
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2, m = measure(mid); if (m.ok && m.x1 - m.x0 <= rw && m.y1 - m.y0 <= rh) hi = mid; else lo = mid }
    dist = hi
    const m = measure(dist), dx = (m.x0 + m.x1) / 2 - cx, dy = (m.y0 + m.y1) / 2 - cy
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
    const forward = new THREE.Vector3(up.x, 0, up.z), sinE = forward.length() || 1
    tgt.addScaledVector(right, dx * dist * tanV * camera.aspect).addScaledVector(forward.normalize(), dy * dist * tanV / sinE)
  }
  return { target: tgt, position: tgt.clone().addScaledVector(dir, dist) }
}
const corners = (b) => [b.x0, b.x1].flatMap((x) => [b.z0, b.z1].flatMap((z) => [b.y0, b.y1].map((y) => new THREE.Vector3(x, y, z))))
function moveCamera(instant = false) {
  if (!camera || !W) return
  const zone = W.zones.find((z) => z.id === focused), rec = selected && W.persons.find((r) => r.agent.id === selected)
  // I comandi sopra la scena (in alto e in basso) non devono coprire quello che si guarda.
  const small = stageWidth < 700, pad = { l: 16, r: 16, t: small ? 54 : 64, b: small ? 104 : 72 }
  let target, dir, points
  if (zone && rec) {
    const p = rec.station.seat
    target = new THREE.Vector3(p.x, p.y + 1.0, p.z)
    dir = new THREE.Vector3(0.36, zone.top ? 0.44 : 0.54, 1).normalize()
    points = corners({ x0: p.x - 2.1, x1: p.x + 2.1, z0: p.z - 2.2, z1: p.z + 1.2, y0: p.y, y1: p.y + 3.1 })
  } else if (zone) {
    const b = zone.box
    target = new THREE.Vector3((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2)
    dir = new THREE.Vector3(zone.top ? 0.16 : 0.3, zone.top ? 0.46 : 0.6, 1).normalize()
    points = corners({ ...b, y1: b.y1 + 1.2 })
  } else {
    target = new THREE.Vector3(0, 0, 0)
    dir = new THREE.Vector3(0.46, 0.84, 1).normalize()
    points = corners({ x0: ROOM.x0, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z1, y0: 0, y1: 0 }).concat(corners({ x0: ROOM.x0, x1: ROOM.x1, z0: ROOM.z0, z1: ROOM.z0, y0: ROOM.wallH + 0.3, y1: ROOM.wallH + 0.3 }))
      .concat(corners({ x0: -SIGN.w / 2, x1: SIGN.w / 2, z0: ROOM.z0, z1: ROOM.z0, y0: SIGN.y + SIGN.h + 0.2, y1: SIGN.y + SIGN.h + 0.2 }))
    // Da lontano il riquadro «Adesso» sta nell'angolo in alto a sinistra: su schermi larghi la stanza gli fa posto.
    if (!small && stageWidth > 980) pad.l = 120
  }
  const view = frameView(target, dir, points, pad)
  // Un albero fra la camera e la zona che si guarda si fa da parte: si torna a vederlo nella vista completa.
  const cam = camera.clone(); cam.position.copy(view.position); cam.lookAt(view.target); cam.updateMatrixWorld()
  const box = new THREE.Box2(), v = new THREE.Vector3(), depth = zone ? Math.max(...points.map((p) => v.copy(p).applyMatrix4(cam.matrixWorldInverse).z)) : 0
  if (zone) { for (const p of points) { v.copy(p).project(cam); box.expandByPoint(new THREE.Vector2(v.x, v.y)) } box.expandByScalar(0.16) }
  for (const tree of W.tall) {
    const at = tree.g.getWorldPosition(new THREE.Vector3())
    // La lampada ad arco della lounge sta in primo piano da quasi ogni zona: dentro una zona non si disegna.
    let hide = Boolean(zone && tree.front)
    if (zone && !tree.front) for (const y of [0.6, tree.top * 0.6, tree.top]) { v.set(at.x, at.y + y, at.z); const z = v.clone().applyMatrix4(cam.matrixWorldInverse).z; v.project(cam); if (z > depth + 0.5 && box.containsPoint(new THREE.Vector2(v.x, v.y))) hide = true }
    tree.g.visible = !hide
  }
  if (instant || reduceMotion) { camera.position.copy(view.position); controls.target.copy(view.target); tween = null; controls.update() }
  else tween = { start: performance.now(), from: camera.position.clone(), to: view.position, fromT: controls.target.clone(), toT: view.target, dur: 1100 }
  lastInteraction = performance.now(); dirty = true
}
function resize() {
  if (!renderer) return
  stageWidth = Math.max(1, $('stage').clientWidth); stageHeight = Math.max(1, $('stage').clientHeight)
  renderer.setSize(stageWidth, stageHeight); labels.setSize(stageWidth, stageHeight); syncNow()
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(stageWidth, stageHeight) }
  camera.aspect = stageWidth / stageHeight; camera.updateProjectionMatrix()
  moveCamera(true); dirty = true
}

/* ---------- clic e passaggio del mouse ---------- */
const ray = new THREE.Raycaster()
function rayHit(event) {
  if (!W) return null
  const rect = renderer.domElement.getBoundingClientRect()
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
  const hits = ray.intersectObjects(W.pick, false)
  // Una persona vince sul tappeto e sul divisorio che le stanno davanti o dietro a pochi centimetri.
  const first = hits[0]; if (!first) return null
  const person = hits.find((hit) => hit.object.userData.pick.agentId && hit.distance < first.distance + 0.9)
  return (person || first).object.userData.pick
}
const targetOf = (hit) => !hit ? null : hit.city !== undefined ? { type: 'city', k: hit.city, key: `city${hit.city}` } : hit.cities ? { type: 'cities', key: 'cities' } : hit.kiosk ? { type: 'kiosk', key: 'kiosk' }
  : hit.agentId ? { type: 'agent', id: hit.agentId, dept: hit.deptId, key: `a:${hit.agentId}` } : hit.info ? { type: 'info', name: hit.info, dept: hit.deptId, key: `i:${hit.info}` } : hit.deptId ? { type: 'dept', id: hit.deptId, key: `d:${hit.deptId}` } : null
function pick(event) {
  if (!down || Math.hypot(down.x - event.clientX, down.y - event.clientY) > 6) { down = null; return }
  down = null; clearHints()
  const target = targetOf(rayHit(event)); if (!target) return
  if (target.type === 'city') { const c = snapshot?.production?.available && snapshot.production.cities[target.k]; openCity(c && cityOpen !== c.slug ? c.slug : null) }
  else if (target.type === 'cities') { if (focused !== 'mappe') focusDepartment('mappe') }
  else if (target.type === 'kiosk') send({ type: 'office:navigate' })
  else if (target.type === 'agent') focusDepartment(target.dept, target.id)
  else if (target.type === 'info') { if (target.dept && focused !== target.dept) focusDepartment(target.dept) }
  else if (target.type === 'dept') focusDepartment(target.id)
}
let hoverAt = 0
function hover(event) {
  if (event.buttons) { $('tip').hidden = true; return }
  if (performance.now() - hoverAt > 50) { hoverAt = performance.now(); setHover(targetOf(rayHit(event))) }
  showTip(event)
}
function setHover(target) {
  if (hovered?.key === target?.key) return
  hovered = target
  renderer.domElement.style.cursor = target && target.type !== 'info' ? 'pointer' : target ? 'help' : ''
  if (!target) $('tip').hidden = true
  dirty = true
}

/* ---------- animazione ---------- */
function frame(time) {
  if (document.hidden || webglFailed) return
  const animate = !reduceMotion, gap = time - (lastRaf || time); lastRaf = time
  // Qualità adattiva: se il computer fatica, prima via il bagliore, poi risoluzione e ombre più leggere.
  if (animate && !qualityLocked && W && gap > 0 && gap < 500) { slow = gap > 48 ? slow + 1 : Math.max(0, slow - 2); if (slow > 45 && quality > 0) { slow = 0; setQuality(quality - 1) } }
  const lively = tween || time - lastInteraction < 2500
  if (animate ? (!lively && time - lastFrame < 30) : (!dirty && !tween)) return
  const dt = Math.min(0.1, (time - (lastFrame || time)) / 1000); lastFrame = time
  const t = (time - clockStart) / 1000
  if (tween) {
    const k0 = Math.min(1, (time - tween.start) / tween.dur), k = k0 < 0.5 ? 4 * k0 ** 3 : 1 - (-2 * k0 + 2) ** 3 / 2
    camera.position.lerpVectors(tween.from, tween.to, k); controls.target.lerpVectors(tween.fromT, tween.toT, k)
    if (k0 === 1) tween = null
  } else if (animate && !focused && time - lastInteraction > 12000) {
    // Vista d'insieme: la camera ondeggia piano, come uno sguardo che gira sull'ufficio.
    const az = controls.getAzimuthalAngle(), wanted = 0.42 + Math.sin(t * 0.06) * 0.16
    const offset = camera.position.clone().sub(controls.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (wanted - az) * 0.008)
    camera.position.copy(controls.target).add(offset)
  }
  controls.update()
  if (W) {
    if (animate) step(t, dt)
    for (const zone of W.zones) {
      const on = focused === zone.id, hov = hovered && (hovered.id === zone.id || hovered.dept === zone.id) && hovered.type !== 'agent'
      zone.ring.material.opacity += ((on ? 0.5 + Math.sin(t * 3) * 0.22 * (animate ? 1 : 0) : hov ? 0.6 : 0) - zone.ring.material.opacity) * 0.25
      zone.ring.visible = zone.ring.material.opacity > 0.01
    }
    marker(hoverRing, hovered?.type === 'agent' ? hovered.id : null, t, 0.9)
    marker(selectRing, selected, t, 1)
    W.kiosk.g.scale.setScalar(hovered?.type === 'kiosk' ? 1.05 : 1)
  }
  if (composer && quality === 2) composer.render(); else renderer.render(scene, camera)
  labels.render(scene, camera)
  // Se le etichette si sono mosse da poco, un altro fotogramma le rimette in ordine (anche con «riduci movimento»).
  dirty = !declutter(time)
}
function marker(ring, agentId, t, scale) {
  const rec = agentId && W.persons.find((r) => r.agent.id === agentId)
  ring.visible = Boolean(rec)
  if (!rec) return
  ring.position.set(rec.person.position.x, rec.person.position.y + 0.03, rec.person.position.z)
  ring.material.color.set(STATE_COLOR[rec.agent.status]).multiplyScalar(1.6); ring.material.opacity = 0.75 + Math.sin(t * 5) * 0.2
  ring.scale.setScalar(scale * (1.15 + Math.sin(t * 5) * 0.06))
}
function step(t, dt) {
  for (const rec of W.persons) stepPerson(rec, t, dt)
  for (const fn of W.tick) fn(t, dt)
  for (const s of W.sway) { s.g.rotation.z = Math.sin(t * 0.9 + s.phase) * s.amp; s.g.rotation.x = Math.cos(t * 0.7 + s.phase) * s.amp * 0.6 }
  if (t - lastScreens > 0.3) { lastScreens = t; animateStations(W, t) }
  // Il comando di StudioMap lavora sulla sua città: dalla console parte un pacchetto verso il plastico.
  if (W.studio?.on && W.cityTable) {
    const k = W.cityTable.models.findIndex((m) => m.running)
    if (k >= 0 && t - W.studio.sent > 2.4) { W.studio.sent = t; spawnPacket(null, null, [W.studio.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.7, 0)), W.cityTable.models[k].m.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0))]) }
  }
  packets = packets.filter((p) => {
    p.t += dt / p.dur
    if (p.t >= 1) { scene.remove(p.m); p.halo.material.dispose(); return false }
    p.m.position.copy(p.curve.getPoint(p.t))
    return true
  })
}

/* ---------- messaggi con la pagina ---------- */
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'office:embed') { $('app').classList.toggle('embedded', event.data.panel === false); if (typeof event.data.labels === 'boolean') setLabels(event.data.labels, false) }
  else if (event.data?.type === 'office:focus') {
    const id = typeof event.data.department === 'string' ? event.data.department : null
    const agentId = typeof event.data.agentId === 'string' ? event.data.agentId : null
    if (id === focused && agentId === selected) return
    if (!id || snapshot?.departments.some((d) => d.id === id)) { focused = id; selected = agentId; clearHints(); updateFocus(); renderHud(); moveCamera() }
  } else if (event.data?.type === 'office:snapshot') {
    const first = !snapshot
    const events = officeSceneEvents(snapshot, event.data.snapshot)
    snapshot = event.data.snapshot; dataError = ''
    if (focused && !snapshot.departments.some((d) => d.id === focused)) { focused = null; selected = null }
    if (replay) stopReplay()
    const built = Boolean(W)
    buildOffice(); renderHud()
    for (const e of events) if (!deliveredEvents.has(e.key)) {
      deliveredEvents.add(e.key)
      if (!reduceMotion && !webglFailed) spawnPacket(e.from, e.to)
    }
    while (deliveredEvents.size > 5000) deliveredEvents.delete(deliveredEvents.values().next().value)
    if (W && (first || !built)) moveCamera(true)
  } else if (event.data?.type === 'office:error') {
    dataError = String(event.data.message)
    if (snapshot) renderHud(); else $('now-list').innerHTML = `<li class="now-error" role="alert">${esc(dataError)}</li>`
  }
})
init3D()
loadFonts().then(() => { fontsReady = true; if (snapshot && !W) { buildOffice(); if (W) moveCamera(true) } })
send({ type: 'office:ready' })
window.addEventListener('pagehide', () => { renderer?.setAnimationLoop(null); controls?.dispose(); resizeObserver?.disconnect(); disposeWorld(); renderer?.dispose() }, { once: true })
