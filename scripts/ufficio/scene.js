import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import SPEAQI_LOGO from '../../public/deck/logo-on-color.png'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n / 100)
const date = (value) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const STATE = { running: 'In corso', ready: 'Disponibile', attention: 'Da verificare', off: 'Spento' }
const STATE_COLOR = { running: '#9fe8be', ready: '#bfd5ed', attention: '#f6cf88', off: '#71828e' }
const send = (message) => window.parent.postMessage(message, '*')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const FLOOR_HEIGHT = 5.6
let snapshot = null, focused = null, selected = null, layout = 'tower', light = 'day', dataError = ''
let renderer, labels, scene, camera, controls, root, sunlight, ambient, resizeObserver
let tween = null, slots = [], pickables = [], people = [], stageWidth = 1, stageHeight = 1
let currentBounds = { center: new THREE.Vector3(0, 8, 0), radius: 19 }
let webglFailed = false, down = null, dirty = true, lastFrame = 0
let logoTexture
$('brand-logo').src = SPEAQI_LOGO

// Le azioni sensibili restano nella pagina CRM autenticata.
$('manage').onclick = () => send({ type: 'office:navigate' })
$('reset').onclick = () => focusDepartment(null)
document.querySelectorAll('[data-layout]').forEach((button) => {
  button.onclick = () => {
    layout = button.dataset.layout
    document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    $('scene-kicker').textContent = layout === 'tower' ? '01 / Architettura verticale' : '02 / Architettura orizzontale'
    $('scene-title').textContent = layout === 'tower' ? 'Una squadra, più livelli.' : 'Spazio alle connessioni.'
    $('scene-description').innerHTML = layout === 'tower' ? 'Quattro piani aperti. Sette reparti.<br>Una vista d’insieme sul lavoro.' : 'Sette aree, un unico studio.<br>Ogni reparto ha il suo spazio.'
    buildOffice(); renderPanel(); moveCamera()
  }
})
document.querySelectorAll('[data-light]').forEach((button) => {
  button.onclick = () => {
    light = button.dataset.light
    document.querySelectorAll('[data-light]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    applyLight()
  }
})
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') focusDepartment(null) })

function fail3D() {
  webglFailed = true
  $('fallback').hidden = false
  send({ type: 'office:failed' })
}

function init3D() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.18
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); fail3D() })
    $('stage').appendChild(renderer.domElement)
    labels = new CSS2DRenderer()
    labels.domElement.className = 'labels'
    $('stage').appendChild(labels.domElement)
    scene = new THREE.Scene()
    logoTexture = new THREE.TextureLoader().load(SPEAQI_LOGO, () => { dirty = true })
    logoTexture.colorSpace = THREE.SRGBColorSpace
    camera = new THREE.PerspectiveCamera(36, 1, 0.2, 500)
    camera.position.set(36, 29, 46)
    ambient = new THREE.HemisphereLight('#f1f6fa', '#829399', 2.6)
    scene.add(ambient)
    sunlight = new THREE.DirectionalLight('#fff2dd', 3.2)
    sunlight.position.set(-18, 45, 30); sunlight.castShadow = true
    sunlight.shadow.mapSize.set(2048, 2048)
    Object.assign(sunlight.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 140 })
    sunlight.shadow.bias = -0.0003
    sunlight.shadow.normalBias = 0.025
    scene.add(sunlight)
    const fill = new THREE.DirectionalLight('#a9c9e3', 1.4); fill.position.set(20, 20, -25); scene.add(fill)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.dampingFactor = 0.09
    controls.minDistance = 5; controls.maxDistance = 190
    controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.4
    controls.enablePan = false
    controls.addEventListener('start', () => { tween = null })
    controls.addEventListener('change', () => { dirty = true })
    renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY } })
    renderer.domElement.addEventListener('pointercancel', () => { down = null })
    renderer.domElement.addEventListener('pointerup', pick)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe($('stage'))
    applyLight(); resize()
    renderer.setAnimationLoop(frame)
  } catch { fail3D() }
}

function applyLight() {
  if (!renderer || !ambient) return
  const night = light === 'night'
  ambient.intensity = night ? 1.5 : 2.6
  sunlight.intensity = night ? 1.1 : 3.2
  sunlight.color.set(night ? '#b2ceff' : '#fff2dd')
  renderer.toneMappingExposure = night ? 0.95 : 1.18
  document.querySelector('.viewport').style.background = night
    ? 'radial-gradient(ellipse at 50% 60%,#182c3b,#0a1421 75%)' : ''
  dirty = true
}

function material(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra }) }
function box(group, w, h, d, x, y, z, color, extra = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color, extra))
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh)
  return mesh
}
function cylinder(group, top, bottom, h, x, y, z, color, count = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, count), material(color))
  mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh
}
function plant(group, x, y, z, scale = 1, potColor = '#d6d0c1') {
  const p = new THREE.Group(); p.position.set(x, y, z); p.scale.setScalar(scale); group.add(p)
  cylinder(p, 0.28, 0.21, 0.5, 0, 0.25, 0, potColor)
  cylinder(p, 0.035, 0.035, 0.85, 0, 0.85, 0, '#5e7260')
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), material(i % 2 ? '#73a77c' : '#386e51'))
    const angle = i * 2.4
    leaf.position.set(Math.cos(angle) * 0.27, 1.03 + (i % 3) * 0.18, Math.sin(angle) * 0.27)
    leaf.scale.set(0.72, 1.35, 0.36)
    leaf.rotation.set(0, -angle, -0.48 + (i % 2) * 0.9); p.add(leaf)
  }
}
function chair(group, x, z, rotation = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotation; group.add(g)
  box(g, 0.65, 0.11, 0.65, 0, 0.5, 0, '#53636b')
  box(g, 0.64, 0.62, 0.1, 0, 0.85, 0.28, '#53636b')
  cylinder(g, 0.05, 0.05, 0.4, 0, 0.25, 0, '#34434e')
  box(g, 0.6, 0.04, 0.1, 0, 0.06, 0, '#34434e')
}
function desk(group, x, z, color, agent) {
  const g = new THREE.Group(); g.position.set(x, 0.035, z); group.add(g)
  box(g, 1.95, 0.12, 0.88, 0, 0.94, -0.28, '#d6c9af')
  for (const dx of [-0.82, 0.82]) box(g, 0.08, 0.89, 0.65, dx, 0.45, -0.28, '#73838a')
  box(g, 0.12, 0.28, 0.12, 0, 1.12, -0.48, '#3b4c56')
  box(g, 0.87, 0.55, 0.08, 0, 1.42, -0.48, '#30404b')
  const screen = box(g, 0.76, 0.44, 0.015, 0, 1.42, -0.43, agent ? STATE_COLOR[agent.status] : '#566e7b', { emissive: agent ? STATE_COLOR[agent.status] : '#263b48', emissiveIntensity: 0.18 })
  // La tastiera è un solido sopra il piano, con distanza reale dalle altre superfici.
  box(g, 0.61, 0.035, 0.22, 0, 1.025, -0.08, '#71828a')
  cylinder(g, 0.09, 0.09, 0.18, 0.68, 1.09, -0.15, '#ece9dc')
  chair(g, 0, 0.65)
  if (agent) {
    const avatar = new THREE.Group(); avatar.position.set(0, 0, 0.58); g.add(avatar)
    const shirt = agent.status === 'off' ? '#798d97' : color
    const torso = box(avatar, 0.46, 0.57, 0.3, 0, 0.95, 0, shirt)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), material('#d3b69c'))
    head.position.set(0, 1.48, -0.025); avatar.add(head)
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), material('#39444b'))
    hair.position.copy(head.position); avatar.add(hair)
    for (const dx of [-0.28, 0.28]) box(avatar, 0.12, 0.13, 0.49, dx, 1.03, -0.21, shirt)
    for (const dx of [-0.13, 0.13]) box(avatar, 0.16, 0.17, 0.52, dx, 0.6, -0.16, '#42535d')
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), material(STATE_COLOR[agent.status], { emissive: STATE_COLOR[agent.status], emissiveIntensity: 0.3 }))
    dot.position.set(0.68, 1.42, -0.42); g.add(dot)
    avatar.traverse((o) => { if (o.isMesh) { o.userData.agentId = agent.id; pickables.push(o) } })
    people.push({ torso, screen, agent })
  }
}
function meeting(group, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); group.add(g)
  cylinder(g, 1.4, 1.4, 0.13, 0, 0.9, 0, '#d8c9ad', 32)
  cylinder(g, 0.24, 0.42, 0.85, 0, 0.43, 0, '#71818b')
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2
    chair(g, Math.sin(a) * 1.85, Math.cos(a) * 1.85, a)
  }
  plant(g, 0, 0.98, 0, 0.5)
}
function caption(group, sector, x, y, z, index) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag'
  el.style.setProperty('--c', sector.color)
  el.setAttribute('aria-label', `Apri reparto ${sector.name}`)
  el.setAttribute('aria-pressed', String(focused === sector.id))
  el.innerHTML = `<i></i>${esc(sector.name)}<b>${layout === 'tower' ? `P${3 - Math.floor(index / 2)}` : `0${index + 1}`}</b>`
  el.onclick = () => focusDepartment(focused === sector.id ? null : sector.id)
  const tag = new CSS2DObject(el); tag.position.set(x, y, z); group.add(tag)
  return tag
}
function disposeRoot() {
  if (!root) return
  root.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => m.dispose()) }
    if (o.isCSS2DObject) o.element.remove()
  })
  scene.remove(root)
}
function buildOffice() {
  if (!scene || webglFailed || !snapshot) return
  disposeRoot(); pickables = []; people = []; slots = []
  root = new THREE.Group(); scene.add(root)
  const tower = layout === 'tower'
  const platformW = tower ? 29 : 49, platformD = tower ? 14 : 38
  box(root, platformW, 0.6, platformD, 0, -0.9, 0, '#20333f')
  box(root, platformW - 0.8, 0.16, platformD - 0.8, 0, -0.51, 0, '#4a606b')
  if (tower) {
    // Un solo solaio per piano. Nessuna superficie coplanare o piano trasparente.
    for (let floor = 0; floor < 4; floor++) {
      const y = floor * FLOOR_HEIGHT
      const slab = box(root, 25.6, 0.32, 10.8, 0, y - 0.16, 0, '#b1bdb9')
      Object.assign(slab.userData, { floorLevel: floor, slabWidth: 25.6, slabDepth: 10.8 })
      box(root, 25.65, 0.08, 0.12, 0, y - 0.14, 5.48, '#d8e9ad', { emissive: '#d8e9ad', emissiveIntensity: 0.15 })
      box(root, 25.6, 2.9, 0.16, 0, y + 1.45, -5.1, '#8d9fa4')
      // Le finestre sono pannelli opachi incassati; niente ordinamento di vetri sovrapposti.
      for (let x = -11; x <= 11; x += 2.1) box(root, 1.9, 1.9, 0.04, x, y + 1.7, -4.98, '#a4bdc9', { metalness: 0.2, roughness: 0.3 })
      for (const x of [-12.5, 0, 12.5]) box(root, 0.22, 3.1, 0.22, x, y + 1.55, -4.7, '#e0e1d6')
    }
    const coreTop = 3 * FLOOR_HEIGHT + 3.1
    box(root, 2.2, coreTop + 0.2, 1.3, 0, (coreTop - 0.2) / 2, -3.75, '#3c5260')
    for (let i = 0; i < 4; i++) box(root, 0.7, 1.85, 0.06, 0, i * FLOOR_HEIGHT + 0.95, -3.06, '#9badb4', { metalness: 0.25 })
    // La copertura resta solo sul nucleo per lasciare visibili gli uffici.
    box(root, 3.0, 0.3, 2.1, 0, coreTop + 0.1, -3.75, '#d9e1d8')
    // Insegna sul coronamento, con il logo originale incluso nella build.
    const sign = new THREE.Group(); sign.userData.roofSign = true; root.add(sign)
    for (const x of [-3.7, 3.7]) box(sign, 0.12, 1.6, 0.12, x, coreTop + 0.65, -3.75, '#738991')
    box(sign, 10.4, 2.7, 0.24, 0, coreTop + 2.0, -3.75, '#172a37', { metalness: 0.15 })
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 8.8 * 476 / 2000),
      new THREE.MeshBasicMaterial({ map: logoTexture, transparent: true, depthWrite: false, toneMapped: false }))
    logo.position.set(0, coreTop + 2.0, -3.61); sign.add(logo)
    meeting(root, 6.3, 1)
    plant(root, 10.6, 0.02, -3.7, 1.7)
  } else {
    const slab = box(root, 46, 0.32, 34, 0, -0.16, 0, '#aab8b5')
    Object.assign(slab.userData, { floorLevel: 0, slabWidth: 46, slabDepth: 34 })
    box(root, 46, 2.6, 0.2, 0, 1.3, -16.7, '#9aadb0')
    for (let x = -21; x < 22; x += 3.3) box(root, 2.95, 1.8, 0.05, x, 1.5, -16.55, '#acc6d0')
    meeting(root, 0, 11.5)
    box(root, 4, 0.6, 1.0, 16, 0.3, 11.5, '#667c86')
    box(root, 4, 0.8, 0.22, 16, 0.8, 12, '#788f96')
    plant(root, 20, 0, 12, 1.7); plant(root, -21, 0, 13, 1.7)
  }
  snapshot.departments.forEach((sector, index) => {
    const level = 3 - Math.floor(index / 2)
    const x = tower ? (index % 2 ? 6.3 : -6.3) : (index % 3 - 1) * 14.4
    const y = tower ? level * FLOOR_HEIGHT : 0
    const z = tower ? 0 : Math.floor(index / 3) * 10.8 - 11
    const g = new THREE.Group(); g.position.set(x, y, z); root.add(g)
    // Rivestimento rialzato di 3 cm sopra il solaio: profondità distinte.
    const tint = new THREE.Color(sector.color).lerp(new THREE.Color('#e4dfd1'), 0.24)
    const partitionTint = new THREE.Color(sector.color).lerp(new THREE.Color('#ede8dc'), 0.42)
    box(g, 10.8, 0.05, 7.5, 0, 0.055, 0, tint, { roughness: 0.94 })
    box(g, 0.12, 1.1, 7.5, -5.35, 0.63, 0, partitionTint)
    // Parete acustica e divisorio riprendono il colore del reparto.
    box(g, 10.1, 0.95, 0.14, 0, 1.8, -3.6, partitionTint)
    for (let slat = 0; slat < 9; slat++) box(g, 0.045, 0.78, 0.05, -4.55 + slat * 0.2, 1.8, -3.5, '#dcc5a0')
    box(g, 10.8, 0.12, 0.15, 0, 0.13, 3.7, sector.color)
    box(g, 2.5, 0.9, 0.55, 3.7, 0.52, -3.15, '#bdac90')
    plant(g, 4.35, 0.98, -3.15, 0.55, '#c88366')
    plant(g, 3.15, 0.98, -3.15, 0.45)
    // Verde all'interno: piante alte laterali e fioriera dietro alle scrivanie.
    plant(g, -4.75, 0.085, 2.55, 1.35, '#c88366')
    plant(g, 4.8, 0.085, 1.15, 1.15)
    box(g, 2.8, 0.48, 0.64, -2.9, 0.325, -3.05, '#bda887')
    for (const px of [-3.8, -2.9, -2.0]) plant(g, px, 0.565, -3.05, 0.6, '#bda887')
    const roster = sector.agents.slice(0, 12)
    if (!roster.length) {
      desk(g, -1.3, 0, sector.color, null)
      plant(g, 1.6, 0.1, 0.8, 1.1)
    } else {
      const columns = Math.min(roster.length, 4)
      roster.forEach((agent, i) => {
        const px = (i % columns - (columns - 1) / 2) * 2.4
        const pz = -1.8 + Math.floor(i / columns) * 2.05
        desk(g, px, pz, sector.color, agent)
      })
    }
    const tag = caption(g, sector, 0, 1.5, 4.2, index)
    g.traverse((o) => { if (o.isMesh) { o.userData.deptId = sector.id; if (!pickables.includes(o)) pickables.push(o) } })
    slots.push({ id: sector.id, group: g, tag, center: new THREE.Vector3(x, y + 0.9, z), level })
  })
  currentBounds = tower ? { center: new THREE.Vector3(0, 10.2, 0), radius: 21.5 }
    : { center: new THREE.Vector3(0, 0.8, -1), radius: 29 }
  updateVisibility(); dirty = true
}
function updateVisibility() {
  // En sezione il piano selezionato resta aperto; gli altri non ostruiscono l'interno.
  for (const slot of slots) {
    slot.tag.element.setAttribute('aria-pressed', String(focused === slot.id))
    slot.tag.visible = !focused || focused === slot.id
    slot.group.visible = !focused || slot.id === focused
  }
  // Nell'ispezione resta il solo basamento del reparto: niente nucleo o piani che invadono la vista.
  const selectedSlot = slots.find((slot) => slot.id === focused)
  if (root) for (const child of root.children) {
    if (child.userData.roofSign) child.visible = !focused
    if (!child.isMesh) continue
    if (child.userData.floorLevel !== undefined) {
      child.visible = !selectedSlot || child.userData.floorLevel === (layout === 'tower' ? selectedSlot.level : 0)
      child.scale.set(selectedSlot ? 10.95 / child.userData.slabWidth : 1, 1, selectedSlot ? 7.7 / child.userData.slabDepth : 1)
      child.position.x = selectedSlot?.center.x ?? 0
      child.position.z = selectedSlot?.center.z ?? 0
    } else child.visible = !focused
  }
  dirty = true
}
function focusDepartment(id, agentId = null) {
  focused = id; selected = agentId
  updateVisibility(); renderPanel(); moveCamera()
}
function moveCamera(instant = false) {
  if (!camera || !snapshot) return
  const slot = slots.find((s) => s.id === focused)
  const target = slot ? slot.center.clone() : currentBounds.center.clone()
  const radius = slot ? 7.4 : currentBounds.radius
  // Adatta il campo visivo allo spazio 3D effettivo, senza pannelli sovrapposti.
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect) * 1.08
  const direction = slot ? new THREE.Vector3(0.27, 0.6, 1).normalize()
    : layout === 'tower' ? new THREE.Vector3(0.55, 0.36, 1).normalize() : new THREE.Vector3(0.62, 0.95, 1).normalize()
  const pos = target.clone().addScaledVector(direction, distance)
  if (instant || reduceMotion) { camera.position.copy(pos); controls.target.copy(target); tween = null; controls.update() }
  else tween = { start: performance.now(), from: camera.position.clone(), to: pos, fromT: controls.target.clone(), toT: target }
  dirty = true
}
function resize() {
  if (!renderer) return
  stageWidth = Math.max(1, $('stage').clientWidth); stageHeight = Math.max(1, $('stage').clientHeight)
  renderer.setSize(stageWidth, stageHeight); labels.setSize(stageWidth, stageHeight)
  camera.aspect = stageWidth / stageHeight; camera.updateProjectionMatrix()
  moveCamera(true); dirty = true
}
function pick(event) {
  if (!down || Math.hypot(down.x - event.clientX, down.y - event.clientY) > 6) { down = null; return }
  down = null
  const rect = renderer.domElement.getBoundingClientRect()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
  // Raycaster non ignora gli antenati nascosti: filtra la gerarchia prima del pick.
  const visible = pickables.filter((o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true })
  const hit = ray.intersectObjects(visible, false)[0]?.object.userData
  if (hit?.deptId) focusDepartment(hit.deptId, hit.agentId || null)
}
function frame(time) {
  if (document.hidden || webglFailed || time - lastFrame < 32) return
  lastFrame = time
  if (tween) {
    const t = Math.min(1, (time - tween.start) / 700), k = 1 - (1 - t) ** 3
    camera.position.lerpVectors(tween.from, tween.to, k); controls.target.lerpVectors(tween.fromT, tween.toT, k)
    if (t === 1) tween = null
    dirty = true
  }
  controls.update()
  if (dirty) { renderer.render(scene, camera); labels.render(scene, camera); dirty = false }
}

function departmentRows() {
  return snapshot.departments.map((sector, i) => {
    const working = sector.agents.filter((a) => a.status === 'running').length
    const enabled = sector.agents.filter((a) => a.enabled).length
    return `<li><button type="button" class="sector" data-dept="${esc(sector.id)}" aria-pressed="${focused === sector.id}"><span class="sector-top"><i class="swatch" style="--c:${sector.color}"></i><strong>${esc(sector.name)}</strong><em>${layout === 'tower' ? `P${3 - Math.floor(i / 2)}` : `0${i + 1}`}</em></span><small>${sector.agents.length ? `${enabled}/${sector.agents.length} accesi${working ? ` · ${working} in corso` : ''}` : 'Nessun agente installato'}</small></button></li>`
  }).join('')
}
function budgetHTML(agents) {
  const spent = agents.reduce((n, a) => n + a.spend.month_actual, 0)
  const reserved = agents.reduce((n, a) => n + a.spend.month_reserved, 0)
  const budget = agents.reduce((n, a) => n + a.monthlyBudget, 0)
  const pct = budget ? Math.min(100, (spent + reserved) / budget * 100) : 0
  return `<div class="section"><h3>Budget del mese</h3><div class="budget-line"><b>${euro(spent)}</b><span>su ${euro(budget)}</span></div><div class="bar"><span style="width:${pct}%"></span></div><p class="fine">${euro(reserved)} prenotati · Somma dei tetti per agente, anche spenti.</p></div>`
}
function renderPanel() {
  if (!snapshot) return
  const agents = snapshot.departments.flatMap((d) => d.agents)
  const sector = snapshot.departments.find((d) => d.id === focused)
  const roster = sector ? sector.agents : agents
  const queue = snapshot.outputs.filter((o) => !sector || roster.some((a) => a.id === o.agentId))
  let html = sector ? `<button type="button" class="back" data-back>← Tutti i reparti</button><p class="eyebrow">${layout === 'tower' ? 'Piano aperto' : 'Area di lavoro'}</p><h2>${esc(sector.name)}</h2><p>${roster.length} agenti installati · ${roster.filter((a) => a.enabled).length} accesi</p>`
    : `<p class="eyebrow">Il tuo workspace</p><h2>Il lavoro, a colpo d’occhio.</h2><p>Seleziona un reparto per entrare nel suo spazio.</p><div class="metrics"><div class="metric"><span>Agenti accesi</span><strong>${agents.filter((a) => a.enabled).length}<small>su ${agents.length} installati</small></strong></div><div class="metric"><span>Da decidere</span><strong>${snapshot.pendingCount}</strong><small>proposte in attesa</small></div></div>`
  if (dataError) html += `<div class="notice" role="alert">${esc(dataError)}<br>I dati mostrati sono dell’ultimo aggiornamento riuscito.</div>`
  html += budgetHTML(roster)
  if (!sector) html += `<section class="section"><h3>Reparti / 07</h3><ul class="list">${departmentRows()}</ul></section>`
  else html += `<section class="section"><h3>La squadra</h3><ul class="list">${roster.length ? roster.map((agent) => `<li><div class="agent" data-agent-card="${esc(agent.id)}"><button type="button" class="sector" data-agent="${esc(agent.id)}" aria-expanded="${selected === agent.id}"><span class="agent-top"><i class="swatch" style="--c:${STATE_COLOR[agent.status]}"></i><strong>${esc(agent.name)}</strong><span class="status ${agent.status}">${STATE[agent.status]}</span></span><small>${esc(agent.lastRun?.summary || 'Nessuna corsa registrata.')}</small></button>${selected === agent.id ? `<div class="agent-detail"><p>${esc(agent.description)}</p><p>${esc(agent.model)}<br>${agent.lastRun ? `${esc(agent.lastRun.label)} · ${date(agent.lastRun.startedAt)}` : 'Nessuna corsa registrata.'}</p><p>${euro(agent.spend.month_actual)} spesi · ${euro(agent.spend.month_reserved)} prenotati</p><button type="button" class="ghost" data-open-agent="${esc(agent.id)}">Apri impostazioni e storico ↗</button></div>` : ''}</div></li>`).join('') : '<li class="empty">Questo reparto è pronto ad accogliere nuovi agenti.</li>'}</ul></section>`
  html += `<section class="section"><h3>Aspetta te${sector ? '' : ` / ${snapshot.pendingCount}`}</h3><ul class="list">${queue.length ? queue.slice(0, 5).map((o) => `<li><button type="button" class="output" data-output="${esc(o.id)}"><strong>${esc(o.title)}</strong><small>${esc(agents.find((a) => a.id === o.agentId)?.name || o.agentId)} · Apri e valuta ↗</small></button></li>`).join('') : '<li class="empty">Nessuna proposta in questa vista.</li>'}</ul>${!sector && snapshot.pendingCount > 5 ? '<button type="button" class="ghost full" data-manage>Vedi tutte le proposte ↗</button>' : ''}${sector ? '<p class="fine">Proposte della prima pagina della coda. Apri agenti e bozze per consultarle tutte.</p>' : ''}</section>`
  if (!sector) html += `<section class="section"><h3>Attività recenti</h3>${snapshot.runs.length ? snapshot.runs.slice(0, 3).map((r) => `<div class="run"><strong>${esc(agents.find((a) => a.id === r.agentId)?.name || r.agentId)}</strong>${esc(r.summary || r.label)}<br><time>${date(r.startedAt)} · ${esc(r.label)}</time></div>`).join('') : '<p>Nessuna corsa registrata.</p>'}</section>`
  html += `<p class="fine section">Dati CRM · ${date(snapshot.updatedAt)} (Roma). Aggiornamento ogni 30 secondi. “Acceso” indica che l’agente è abilitato; “In corso” indica una corsa registrata.</p><button type="button" class="ghost full" data-refresh>Aggiorna dati</button>`
  // Mantiene lo scroll durante il polling; cambia solo quando si entra in un reparto.
  const scroll = $('panel').scrollTop
  $('panel').innerHTML = html
  $('panel').scrollTop = scroll
}
$('panel').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return
  if (button.hasAttribute('data-dept')) { $('panel').scrollTop = 0; focusDepartment(button.dataset.dept) }
  else if (button.hasAttribute('data-back')) { $('panel').scrollTop = 0; focusDepartment(null) }
  else if (button.hasAttribute('data-agent')) { selected = selected === button.dataset.agent ? null : button.dataset.agent; renderPanel(); $('panel').querySelector(`[data-agent="${CSS.escape(button.dataset.agent)}"]`)?.focus({ preventScroll: true }) }
  else if (button.hasAttribute('data-output')) send({ type: 'office:navigate', outputId: button.dataset.output })
  else if (button.hasAttribute('data-open-agent')) send({ type: 'office:navigate', agentId: button.dataset.openAgent })
  else if (button.hasAttribute('data-manage')) send({ type: 'office:navigate' })
  else if (button.hasAttribute('data-refresh')) send({ type: 'office:refresh' })
})

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'office:snapshot') {
    const first = !snapshot
    snapshot = event.data.snapshot; dataError = ''
    if (focused && !snapshot.departments.some((d) => d.id === focused)) focused = null
    $('sync').innerHTML = `<i class="live"></i><span>CRM · Aggiornato alle ${new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date(snapshot.updatedAt))}</span>`
    buildOffice(); renderPanel()
    if (first) moveCamera(true)
  } else if (event.data?.type === 'office:error') {
    dataError = String(event.data.message)
    $('sync').textContent = 'Aggiornamento non riuscito'
    if (snapshot) renderPanel()
    else $('panel').innerHTML = `<h2>Dati non disponibili</h2><div class="notice" role="alert">${esc(dataError)}</div><button type="button" class="ghost full" data-refresh>Riprova</button><button type="button" class="primary full" data-manage>Apri agenti e bozze ↗</button>`
  }
})
init3D()
send({ type: 'office:ready' })
window.addEventListener('pagehide', () => { renderer?.setAnimationLoop(null); controls?.dispose(); resizeObserver?.disconnect(); disposeRoot(); logoTexture?.dispose(); renderer?.dispose() }, { once: true })
