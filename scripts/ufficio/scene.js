import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import LOGO_WHITE from '../../public/deck/logo-on-color.png'
import LOGO_NAVY from '../../public/deck/logo.png'

// Campus Speaqi: sette padiglioni sempre visibili, le persone sono gli agenti veri del CRM.
// Il clic avvicina la camera, non nasconde niente. Nessun dato inventato: un reparto vuoto ha scrivanie vuote.

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n / 100)
const date = (value) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const STATE = { running: 'In corso', ready: 'Disponibile', attention: 'Da verificare', off: 'Spento' }
const STATE_COLOR = { running: '#5fe39a', ready: '#8fc1ff', attention: '#ffb547', off: '#71828e' }
const send = (message) => window.parent.postMessage(message, '*')
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const romeHour = () => Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
const hashId = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

const BRAND = { navy: '#16192e', blue: '#4f6ef7', orange: '#ff5a1f', cream: '#f4efe4' }
const H = 2.9, TERRACE = 1.5, GAP = 2.6, PLAZA = 5.4, FRONT_Z = 3.4, BACK_Z = -6.4, WALL_Z = -2.6
// La Direzione non è un padiglione: è l'ultimo piano della sede (buildHQ).
const BACK_LEFT = ['mappe', 'sviluppo'], BACK_RIGHT = ['ricerca']
const FRONT_LEFT = ['commerciale', 'finanza'], FRONT_RIGHT = ['marketing', 'operazioni']
const SHIRTS = ['#16192e', '#ffffff', '#4f6ef7', '#ff5a1f', '#1f2a4d', '#eef1f8']
const SKIN = ['#f1c7a5', '#e0ac85', '#c98e66', '#a8714d', '#7c5236', '#f5d4b8']
const HAIR = ['#2b1d16', '#4a3020', '#1c1c1f', '#8a5a2b', '#c9a15a', '#6b6f78']

let snapshot = null, focused = null, selected = null, light = romeHour() >= 7 && romeHour() < 19 ? 'day' : 'night', dataError = ''
let renderer, labels, scene, camera, controls, root, sun, hemi, resizeObserver, signature = ''
let tween = null, stageWidth = 1, stageHeight = 1, lastFrame = 0, lastInteraction = 0, clockStart = performance.now()
let webglFailed = false, down = null, dirty = true, hovered = null
let ceoTag = null, pickables = [], pavilions = [], persons = [], spinners = [], trees = [], flags = [], lamps = [], screens = [], roomLights = [], hqWindows = [], hq = null
let packets = [], kiosk = null, fountain = null, clouds = [], gulls = [], stars = null, bounds = { center: new THREE.Vector3(), radius: 30 }
const tex = {}
$('brand-logo').src = LOGO_WHITE

$('manage').onclick = () => send({ type: 'office:navigate' })
$('reset').onclick = () => focusDepartment(null)
document.querySelectorAll('[data-light]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.light === light))
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

/* ---------- texture: logo, insegne, fumetti ---------- */
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}
function loadLogos() {
  for (const [tone, src] of [['white', LOGO_WHITE], ['navy', LOGO_NAVY]]) {
    const full = new THREE.Texture(), icon = new THREE.Texture()
    full.colorSpace = icon.colorSpace = THREE.SRGBColorSpace; full.anisotropy = icon.anisotropy = 4
    tex[`full-${tone}`] = full; tex[`icon-${tone}`] = icon
    const img = new Image()
    img.onload = () => {
      full.image = img; full.needsUpdate = true
      // L'icona è la parte sinistra del logo (0-511 px su 2000 x 470).
      const c = document.createElement('canvas'); c.width = 256; c.height = 236
      c.getContext('2d').drawImage(img, 0, 0, 511, 470, 0, 0, 256, 236)
      icon.image = c; icon.needsUpdate = true; dirty = true
    }
    img.src = src
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
function signTexture(sector, index) {
  return canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = BRAND.navy; roundRect(ctx, 0, 0, w, h, 26); ctx.fill()
    ctx.fillStyle = sector.color; roundRect(ctx, 26, 34, 92, 92, 20); ctx.fill()
    ctx.fillStyle = BRAND.navy; ctx.font = '700 52px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(index + 1).padStart(2, '0'), 72, 82)
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.font = '650 64px Inter, system-ui, sans-serif'
    ctx.fillText(sector.name.toUpperCase().split('').join(' '), 150, 84)
  })
}
function bubbleTexture(kind) {
  return canvasTexture(128, 128, (ctx) => {
    if (kind === 'alert') {
      ctx.fillStyle = '#ffb547'; ctx.beginPath(); ctx.arc(64, 60, 48, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.moveTo(52, 100); ctx.lineTo(64, 124); ctx.lineTo(76, 100); ctx.fill()
      ctx.fillStyle = BRAND.navy; ctx.font = '800 72px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 64, 64)
    } else if (kind === 'zzz') {
      ctx.fillStyle = '#dfe9ff'; ctx.font = '800 76px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.strokeStyle = BRAND.navy; ctx.lineWidth = 8; ctx.strokeText('z', 64, 66); ctx.fillText('z', 64, 66)
    } else if (kind === 'mail') {
      ctx.fillStyle = BRAND.orange; roundRect(ctx, 10, 28, 108, 72, 12); ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(64, 72); ctx.lineTo(108, 40); ctx.stroke()
    } else if (kind === 'talk') {
      ctx.fillStyle = '#ffffff'; roundRect(ctx, 8, 14, 112, 76, 22); ctx.fill()
      ctx.beginPath(); ctx.moveTo(30, 88); ctx.lineTo(22, 118); ctx.lineTo(52, 88); ctx.fill()
      ctx.fillStyle = BRAND.navy; for (const x of [38, 64, 90]) { ctx.beginPath(); ctx.arc(x, 52, 9, 0, Math.PI * 2); ctx.fill() }
    } else if (kind === 'glow') {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
    }
  })
}

/* ---------- materiali e geometrie condivise ---------- */
const matCache = new Map()
const std = (hex, extra = {}) => {
  const key = (typeof hex === 'string' ? hex : '#' + hex.getHexString()) + JSON.stringify(extra)
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.78, ...extra }))
  return matCache.get(key)
}
const G = {
  torso: new THREE.CapsuleGeometry(0.19, 0.34, 6, 14),
  head: new THREE.SphereGeometry(0.15, 20, 14),
  hair: new THREE.SphereGeometry(0.157, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.56),
  leg: new THREE.CapsuleGeometry(0.075, 0.42, 4, 8),
  arm: new THREE.CapsuleGeometry(0.055, 0.34, 4, 8),
  brim: new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI),
  crown: new THREE.SphereGeometry(0.165, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  backLogo: new THREE.PlaneGeometry(0.3, 0.3 * 470 / 2000),
  chestLogo: new THREE.PlaneGeometry(0.09, 0.083),
  capLogo: new THREE.PlaneGeometry(0.09, 0.083),
  deskTop: new THREE.BoxGeometry(1.15, 0.06, 0.62),
  deskLeg: new THREE.BoxGeometry(0.05, 0.72, 0.05),
  monitor: new THREE.BoxGeometry(0.66, 0.42, 0.04),
  screen: new THREE.PlaneGeometry(0.6, 0.36),
  seat: new THREE.BoxGeometry(0.46, 0.06, 0.44),
  chairBack: new THREE.BoxGeometry(0.46, 0.5, 0.05),
  chairPole: new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8),
  orb: new THREE.OctahedronGeometry(0.11, 0),
  packet: new THREE.SphereGeometry(0.09, 12, 8),
}
const logoMats = new Map()
function logoMat(kind, tone) {
  const key = kind + tone
  if (!logoMats.has(key)) logoMats.set(key, new THREE.MeshBasicMaterial({ map: tex[`${kind}-${tone}`], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
  return logoMats.get(key)
}
function mesh(geometry, material, parent, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z)
  if (shadow) { m.castShadow = true; m.receiveShadow = true }
  parent.add(m); return m
}
const boxGeoCache = new Map()
function box(parent, w, h, d, x, y, z, material) {
  const key = `${w}|${h}|${d}`
  if (!boxGeoCache.has(key)) boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d))
  return mesh(boxGeoCache.get(key), typeof material === 'string' ? std(material) : material, parent, x, y, z)
}
function cyl(parent, rt, rb, h, x, y, z, material, seg = 16) {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof material === 'string' ? std(material) : material, parent, x, y, z)
}

/* ---------- persone ---------- */
function makePerson(agent, index) {
  const h = hashId(agent.id)
  const shirt = SHIRTS[(h + index) % SHIRTS.length]
  const tone = lum(shirt) > 0.55 ? 'navy' : 'white'
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body)
  const torso = mesh(G.torso, std(shirt), body)
  const head = mesh(G.head, std(SKIN[h % SKIN.length]), body)
  const hair = mesh(G.hair, std(HAIR[(h >>> 3) % HAIR.length]), head); hair.rotation.x = -0.35
  // Maglia Speaqi: logo intero sulla schiena, icona sul petto.
  const back = mesh(G.backLogo, logoMat('full', tone), torso, 0, 0.1, -0.197, false); back.rotation.y = Math.PI
  mesh(G.chestLogo, logoMat('icon', tone), torso, 0.075, 0.14, 0.193, false)
  if ((h >>> 5) % 3 === 0) {
    const cap = [BRAND.navy, BRAND.orange, '#ffffff', BRAND.blue][(h >>> 7) % 4]
    const capTone = lum(cap) > 0.55 ? 'navy' : 'white'
    mesh(G.crown, std(cap), head, 0, 0.02, 0)
    mesh(G.brim, std(cap), head, 0, 0.02, 0.06)
    const cl = mesh(G.capLogo, logoMat('icon', capTone), head, 0, 0.1, 0.152, false); cl.rotation.x = -0.4
  }
  const pants = std('#262a3a')
  const legL = mesh(G.leg, pants, group), legR = mesh(G.leg, pants, group)
  const shL = new THREE.Group(), shR = new THREE.Group(); body.add(shL, shR)
  mesh(G.arm, std(shirt), shL, 0, -0.2, 0); mesh(G.arm, std(shirt), shR, 0, -0.2, 0)
  return { group, parts: { body, torso, head, legL, legR, shL, shR } }
}
function poseSeated(P) {
  P.body.rotation.set(0, 0, 0); P.torso.rotation.set(0, 0, 0); P.head.rotation.set(0, 0, 0)
  P.torso.position.set(0, 0.84, 0); P.head.position.set(0, 1.36, 0.02)
  P.shL.position.set(-0.24, 1.08, 0); P.shR.position.set(0.24, 1.08, 0)
  P.shL.rotation.set(-1.15, 0, 0.12); P.shR.rotation.set(-1.15, 0, -0.12)
  P.legL.position.set(-0.1, 0.5, 0.22); P.legR.position.set(0.1, 0.5, 0.22)
  P.legL.rotation.set(Math.PI / 2, 0, 0); P.legR.rotation.set(Math.PI / 2, 0, 0)
}
function poseStanding(P) {
  P.body.rotation.set(0, 0, 0); P.torso.rotation.set(0, 0, 0); P.head.rotation.set(0, 0, 0)
  P.torso.position.set(0, 1.08, 0); P.head.position.set(0, 1.6, 0.01)
  P.shL.position.set(-0.25, 1.32, 0); P.shR.position.set(0.25, 1.32, 0)
  P.shL.rotation.set(0.05, 0, 0.1); P.shR.rotation.set(0.05, 0, -0.1)
  P.legL.position.set(-0.1, 0.36, 0); P.legR.position.set(0.1, 0.36, 0)
  P.legL.rotation.set(0, 0, 0); P.legR.rotation.set(0, 0, 0)
}
function poseAsleep(P) {
  poseSeated(P)
  P.torso.rotation.x = 0.32; P.torso.position.z = 0.08
  P.head.position.set(0, 1.24, 0.24); P.head.rotation.x = 0.55
  P.shL.rotation.set(-1.45, 0, 0.25); P.shR.rotation.set(-1.45, 0, -0.25)
}

/* ---------- arredi ---------- */
function desk(parent, x, z, agent) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g)
  mesh(G.deskTop, std('#e3cfae'), g, 0, 0.74, 0)
  for (const [lx, lz] of [[-0.52, -0.26], [0.52, -0.26], [-0.52, 0.26], [0.52, 0.26]]) mesh(G.deskLeg, std('#3a3f52'), g, lx, 0.36, lz)
  mesh(G.monitor, std('#20232f'), g, 0, 1.03, -0.16)
  const screenMat = new THREE.MeshBasicMaterial({ color: '#1d2433', toneMapped: false })
  const screen = mesh(G.screen, screenMat, g, 0, 1.03, -0.138, false)
  const chair = new THREE.Group(); chair.position.set(x, 0, z + 0.72); parent.add(chair)
  mesh(G.seat, std('#2c3142'), chair, 0, 0.45, 0)
  mesh(G.chairBack, std('#2c3142'), chair, 0, 0.72, 0.22)
  mesh(G.chairPole, std('#5a6170'), chair, 0, 0.22, 0)
  const s = { mat: screenMat, status: agent?.status || 'empty', phase: Math.random() * 10 }
  screens.push(s)
  return { g, chair, screen: s }
}
function plant(parent, x, y, z, scale = 1, pot = '#c88366') {
  const p = new THREE.Group(); p.position.set(x, y, z); p.scale.setScalar(scale); parent.add(p)
  cyl(p, 0.24, 0.18, 0.42, 0, 0.21, 0, pot)
  for (let i = 0; i < 7; i++) {
    const leaf = mesh(new THREE.SphereGeometry(0.26, 8, 6), std(i % 2 ? '#6fa877' : '#3b7553', { flatShading: true }), p)
    const a = i * 2.4
    leaf.position.set(Math.cos(a) * 0.2, 0.62 + (i % 3) * 0.17, Math.sin(a) * 0.2)
    leaf.scale.set(0.7, 1.3, 0.38); leaf.rotation.set(0, -a, -0.45 + (i % 2) * 0.9)
  }
  trees.push({ g: p, phase: Math.random() * 6, amp: 0.025 })
  return p
}
function roundedRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  return s
}
function slab(parent, w, d, thickness, r, x, topY, z, topMat, sideMat) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, d, r), { depth: thickness, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2, curveSegments: 10 })
  const m = new THREE.Mesh(geo, [std(topMat), std(sideMat)])
  m.rotation.x = -Math.PI / 2; m.position.set(x, topY - thickness - 0.12, z)
  m.receiveShadow = true; m.castShadow = true; parent.add(m); return m
}
function outline(w, d, color) {
  const shape = roundedRect(w + 0.9, d + 0.9, 0.6)
  shape.holes.push(roundedRect(w + 0.5, d + 0.5, 0.45))
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 2
  return m
}

/* ---------- padiglione di un reparto ---------- */
function pavilionSize(sector) {
  const n = Math.min(sector.agents.length, 12), cols = Math.max(1, Math.min(n, 4)), rows = Math.max(1, Math.ceil(n / 4))
  let w = Math.max(5.8, cols * 1.75 + 2.8)
  if (sector.id === 'direzione') w = Math.max(w, 7.8)
  return { w, d: 3.2 + rows * 1.9, cols, rows }
}
function buildPavilion(sector, index, place) {
  const { w, d, cols } = place.size
  const g = new THREE.Group(); g.position.set(place.x, place.y, place.z); g.rotation.y = place.yaw; root.add(g)
  const tint = (amount, base = BRAND.cream) => new THREE.Color(sector.color).lerp(new THREE.Color(base), amount)
  // Pavimento in terrazzo chiaro, tappeto del colore del reparto sotto le scrivanie.
  box(g, w, 0.2, d, 0, -0.1, 0, std(tint(0.82)))
  box(g, w - 0.9, 0.02, Math.min(d - 1.4, 1.9 * place.size.rows + 0.3), 0, 0.011, -d / 2 + 0.25 + Math.min(d - 1.4, 1.9 * place.size.rows + 0.3) / 2, std(tint(0.45, '#ffffff'), { roughness: 0.95 }))
  // Parete di fondo nel colore del reparto, con il logo Speaqi.
  box(g, w, H, 0.18, 0, H / 2, -d / 2 + 0.09, std(tint(0.55)))
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.4, w * 0.46), Math.min(3.4, w * 0.46) * 470 / 2000), logoMat('full', 'navy'))
  wall.position.set(0, 2.2, -d / 2 + 0.185); g.add(wall)
  // Pareti laterali in vetro con montanti scuri.
  const glass = std('#cfe9f5', { transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0.1, depthWrite: false })
  for (const sx of [-1, 1]) {
    const pane = box(g, 0.04, H, d, sx * (w / 2 - 0.02), H / 2, 0, glass); pane.castShadow = false
    for (let k = 0; k <= Math.round(d / 1.25); k++) box(g, 0.07, H, 0.07, sx * (w / 2 - 0.02), H / 2, -d / 2 + k * d / Math.round(d / 1.25), '#2b3446')
    box(g, 0.08, 0.08, d, sx * (w / 2 - 0.02), 0.9, 0, '#2b3446')
  }
  for (const sx of [-1, 1]) cyl(g, 0.07, 0.07, H, sx * (w / 2 - 0.05), H / 2, d / 2 - 0.05, '#f2f2ee', 12)
  // Tetto a lamelle: la luce entra a strisce, l'interno resta visibile dall'alto.
  const frame = std(tint(0.15, BRAND.navy))
  box(g, w + 0.24, 0.22, 0.16, 0, H + 0.05, d / 2, frame)
  box(g, w + 0.24, 0.3, 0.16, 0, H + 0.05, -d / 2, frame)
  for (const sx of [-1, 1]) box(g, 0.16, 0.3, d, sx * (w / 2 + 0.04), H + 0.05, 0, frame)
  const slats = Math.round(d / 0.62)
  for (let k = 1; k < slats; k++) box(g, w, 0.07, 0.15, 0, H + 0.12, -d / 2 + k * d / slats, '#e4c9a0')
  // Insegna sopra il tetto, sul filo della facciata: l'apertura davanti resta libera.
  const signW = Math.min(w * 0.62, 4.2), signH = signW * 160 / 1024
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), new THREE.MeshBasicMaterial({ map: signTexture(sector, index), toneMapped: false }))
  sign.position.set(-w / 2 + signW / 2 + 0.3, H + 0.2 + signH / 2, d / 2 + 0.01); g.add(sign)
  box(g, signW, signH, 0.06, sign.position.x, sign.position.y, d / 2 - 0.035, BRAND.navy)
  // Angolo caffè e verde.
  box(g, 0.55, 0.92, 1.3, w / 2 - 0.42, 0.46, d / 2 - 1.1, '#f1ede4')
  box(g, 0.26, 0.34, 0.26, w / 2 - 0.42, 1.09, d / 2 - 1.35, BRAND.navy)
  cyl(g, 0.045, 0.04, 0.1, w / 2 - 0.42, 0.97, d / 2 - 0.85, '#ffffff', 10)
  plant(g, -w / 2 + 0.55, 0, d / 2 - 0.6, 1.25)
  plant(g, -w / 2 + 0.5, 0, -d / 2 + 0.5, 0.9, '#e7e1d4')
  // Lampade a sospensione: accese di sera.
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd79a', emissiveIntensity: 0 })
  lamps.push(lampMat)
  // Di sera l'interno si accende: una luce calda per padiglione, senza ombre.
  const room = new THREE.PointLight('#ffd9a6', 0, Math.max(w, d) * 1.4, 1.4); room.position.set(0, H - 0.6, 0.2); g.add(room); roomLights.push(room)
  const deskZ = (row) => -d / 2 + 0.62 + row * 1.9
  for (let c = 0; c < cols; c++) {
    const lx = (c - (cols - 1) / 2) * 1.75
    cyl(g, 0.006, 0.006, 0.7, lx, H - 0.35, deskZ(0) + 0.2, '#30343f', 6).castShadow = false
    cyl(g, 0.06, 0.22, 0.16, lx, H - 0.74, deskZ(0) + 0.2, lampMat, 18).castShadow = false
  }
  const people = []
  const roster = sector.agents.slice(0, 12)
  if (!roster.length) desk(g, 0, deskZ(0), null)
  roster.forEach((agent, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    people.push(placeAgent(g, sector, agent, i, (col - (cols - 1) / 2) * 1.75, deskZ(row), new THREE.Vector3(w / 2 - 1.05, 0, d / 2 - 0.7 - (i % 3) * 0.5)))
  })
  // Oggetti di reparto sul tetto: si muovono sempre, sono il segno del mestiere.
  roofProp(sector.id, g, w, d)
  const ring = outline(w, d, sector.color); g.add(ring)
  g.traverse((o) => { if (o.isMesh && !o.userData.deptId && o !== ring) { o.userData.deptId = sector.id; pickables.push(o) } })
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag'
  el.style.setProperty('--c', sector.color)
  el.setAttribute('aria-label', `Apri reparto ${sector.name}`)
  const working = sector.agents.filter((a) => a.status === 'running').length
  el.innerHTML = `<i></i>${esc(sector.name)}<b>${working ? `● ${working} al lavoro` : `${sector.agents.length} ${sector.agents.length === 1 ? 'agente' : 'agenti'}`}</b>`
  el.onclick = () => focusDepartment(focused === sector.id ? null : sector.id)
  const tag = new CSS2DObject(el); tag.position.set(0, H + 1.6, d / 2); g.add(tag)
  pavilions.push({ id: sector.id, sector, group: g, ring, tag, w, d, center: new THREE.Vector3(), yaw: place.yaw, people })
}
// Un agente alla sua scrivania: persona, stato, comportamento, cartellino.
function placeAgent(parent, sector, agent, i, px, pz, coffee) {
  const station = desk(parent, px, pz, agent)
  const { group: person, parts } = makePerson(agent, i)
  parent.add(person)
  // Il pallino sopra la testa c'è sempre: dalla vista d'insieme si contano le persone e il loro stato.
  const orb = mesh(G.orb, new THREE.MeshBasicMaterial({ color: STATE_COLOR[agent.status], toneMapped: false }), person, 0, 2.0, 0, false)
  const rec = { agent, person, parts, station, orb, sector, pavilion: parent, phase: (hashId(agent.id) % 1000) / 160,
    seat: new THREE.Vector3(px, 0, pz + 0.62), coffee, mode: 'seated', until: 0, path: [], bubble: null, zs: [] }
  setupPerson(rec)
  const el = document.createElement('div'); el.className = 'person-tag'
  el.innerHTML = `<i style="--c:${STATE_COLOR[agent.status]}"></i>${esc(agent.name)}`
  rec.tag = new CSS2DObject(el); rec.tag.position.set(0, 2.62, 0); rec.tag.visible = false; person.add(rec.tag)
  person.traverse((o) => { if (o.isMesh) { o.userData.agentId = agent.id; o.userData.deptId = sector.id; pickables.push(o) } })
  persons.push(rec)
  return rec
}
// Una bandiera Speaqi che sventola (Commerciale e ingresso della sede).
function flagPole(parent, x, y, z, color, tone, height = 2.2) {
  cyl(parent, 0.04, 0.04, height, x, y + height / 2, z, '#d5d9e0', 8)
  const flagGeo = new THREE.PlaneGeometry(1.3, 0.8, 16, 6)
  flagGeo.translate(0.65, 0, 0)
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.7 }))
  flag.position.set(x + 0.04, y + height - 0.4, z); flag.castShadow = true; parent.add(flag)
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.39), new THREE.MeshBasicMaterial({ map: tex[`icon-${tone}`], transparent: true, depthWrite: false, side: THREE.DoubleSide }))
  icon.position.set(0.6, 0, 0.01); flag.add(icon)
  flags.push({ mesh: flag, base: flagGeo.attributes.position.array.slice(), icon })
}
function roofProp(id, g, w, d) {
  const top = H + 0.2
  if (id === 'sviluppo') {
    // Un cubo che gira con il segno del codice.
    const codeTex = canvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = BRAND.navy; ctx.fillRect(0, 0, 256, 256)
      ctx.fillStyle = '#c8e05a'; ctx.font = '800 112px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('</>', 128, 132)
    })
    const cube = mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ map: codeTex, emissive: '#ffffff', emissiveMap: codeTex, emissiveIntensity: 0.35, roughness: 0.4 }), g, w / 2 - 1.2, top + 1.2, -d / 2 + 1.2)
    cyl(g, 0.05, 0.22, 0.45, w / 2 - 1.2, top + 0.22, -d / 2 + 1.2, '#8b97a8', 12)
    spinners.push({ o: cube, kind: 'spinY', speed: 0.6, bob: 0.06 })
  } else if (id === 'direzione') {
    // Terrazza della Direzione: ombrellone arancione e due sdraio. L'insegna Speaqi sta sulla sede, dietro.
    cyl(g, 0.04, 0.04, 1.8, w / 2 - 1.6, top + 0.9, -0.2, '#f2f2ee', 8)
    const shade = mesh(new THREE.ConeGeometry(1.15, 0.42, 18), std(BRAND.orange, { roughness: 0.6 }), g, w / 2 - 1.6, top + 1.8, -0.2)
    spinners.push({ o: shade, kind: 'spinY', speed: 0.08 })
    for (const dx of [-0.75, 0.75]) { const c = box(g, 0.5, 0.12, 1.1, w / 2 - 1.6 + dx, top + 0.35, 0.5, '#f4f6fb'); c.rotation.x = -0.25 }
    box(g, 3.6, 0.05, 2.6, w / 2 - 1.8, top + 0.12, 0, '#d9c3a0')
  } else if (id === 'mappe') {
    const globe = new THREE.Group(); globe.position.set(w / 2 - 1.3, top + 1.15, -d / 2 + 1.3); g.add(globe)
    cyl(g, 0.05, 0.25, 0.5, w / 2 - 1.3, top + 0.25, -d / 2 + 1.3, '#8b97a8', 12)
    mesh(new THREE.SphereGeometry(0.62, 28, 18), std('#4f8fd9', { roughness: 0.4 }), globe)
    const land = mesh(new THREE.IcosahedronGeometry(0.635, 1), std('#7cc47f', { flatShading: true, roughness: 0.6 }), globe)
    land.scale.set(1, 1, 1); land.material = land.material.clone(); land.material.transparent = true; land.material.opacity = 0.9; land.material.alphaTest = 0.5
    const meridian = mesh(new THREE.TorusGeometry(0.72, 0.025, 8, 48), std('#ffd27a', { metalness: 0.6, roughness: 0.3 }), globe, 0, 0, 0, false)
    meridian.rotation.y = Math.PI / 2
    const pin = new THREE.Group(); globe.add(pin); pin.position.set(0, 0.62, 0)
    mesh(new THREE.ConeGeometry(0.08, 0.22, 12), std(BRAND.orange), pin, 0, 0.1, 0).rotation.x = Math.PI
    mesh(new THREE.SphereGeometry(0.1, 12, 8), std(BRAND.orange), pin, 0, 0.24, 0)
    spinners.push({ o: globe, kind: 'spinY', speed: 0.35 })
  } else if (id === 'ricerca') {
    const mount = new THREE.Group(); mount.position.set(w / 2 - 1.2, top, -d / 2 + 1.2); g.add(mount)
    cyl(mount, 0.08, 0.12, 0.7, 0, 0.35, 0, '#8b97a8', 10)
    const head = new THREE.Group(); head.position.y = 0.75; mount.add(head)
    const dish = mesh(new THREE.SphereGeometry(0.7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 3.2), std('#f2f4f7', { side: THREE.DoubleSide, roughness: 0.4 }), head)
    dish.rotation.x = -Math.PI / 2 - 0.6; dish.position.z = 0.25
    cyl(head, 0.02, 0.02, 0.7, 0, 0.3, 0.55, '#8b97a8', 6).rotation.x = 0.9
    mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#8fe3ff', toneMapped: false }), head, 0, 0.55, 0.85, false)
    spinners.push({ o: mount, kind: 'sweep', speed: 0.4 })
  } else if (id === 'commerciale') {
    flagPole(g, -w / 2 + 0.8, top, -d / 2 + 0.8, '#ffffff', 'navy')
  } else if (id === 'finanza') {
    const coin = new THREE.Group(); coin.position.set(w / 2 - 1.1, top + 1.0, -d / 2 + 1.1); g.add(coin)
    const face = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 32), std('#f2c14e', { metalness: 0.75, roughness: 0.25 }), coin)
    face.rotation.x = Math.PI / 2
    const euroSign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#7a5200'; ctx.font = '800 96px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('€', 64, 70)
    }), transparent: true, side: THREE.DoubleSide, depthWrite: false }))
    euroSign.position.z = 0.056; coin.add(euroSign)
    const back = euroSign.clone(); back.position.z = -0.056; back.rotation.y = Math.PI; coin.add(back)
    cyl(g, 0.05, 0.22, 0.4, w / 2 - 1.1, top + 0.2, -d / 2 + 1.1, '#8b97a8', 12)
    spinners.push({ o: coin, kind: 'spinY', speed: 1.1, bob: 0.08 })
  } else if (id === 'marketing') {
    const horn = new THREE.Group(); horn.position.set(w / 2 - 1.1, top + 0.85, -d / 2 + 1.1); g.add(horn)
    const cone = mesh(new THREE.CylinderGeometry(0.42, 0.12, 0.9, 24, 1, true), std(BRAND.orange, { side: THREE.DoubleSide, roughness: 0.5 }), horn)
    cone.rotation.x = Math.PI / 2 - 0.3; cone.position.z = 0.2
    cyl(horn, 0.14, 0.14, 0.3, 0, -0.05, -0.28, '#f4f6fb', 14).rotation.x = Math.PI / 2
    cyl(g, 0.05, 0.05, 0.75, w / 2 - 1.1, top + 0.38, -d / 2 + 1.1, '#8b97a8', 8)
    spinners.push({ o: horn, kind: 'sweep', speed: 0.7, range: 0.6 })
    // Cuori che salgono: i "mi piace" del reparto.
    const heartTex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#ff5a8a'; ctx.beginPath(); ctx.moveTo(64, 112)
      ctx.bezierCurveTo(4, 72, 18, 14, 64, 40); ctx.bezierCurveTo(110, 14, 124, 72, 64, 112); ctx.fill()
    })
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }))
      s.scale.setScalar(0.32); s.position.set(w / 2 - 1.1, top + 1.3, -d / 2 + 1.5); g.add(s)
      spinners.push({ o: s, kind: 'rise', phase: k / 3, base: s.position.clone() })
    }
  } else if (id === 'operazioni') {
    const gear = (r, teeth, x, z, speed, color) => {
      const gr = new THREE.Group(); gr.position.set(x, top + r + 0.35, z); g.add(gr)
      mesh(new THREE.CylinderGeometry(r, r, 0.16, 28), std(color, { metalness: 0.5, roughness: 0.4 }), gr).rotation.x = Math.PI / 2
      for (let t = 0; t < teeth; t++) {
        const a = t / teeth * Math.PI * 2
        const tooth = box(gr, 0.16, 0.2, 0.16, Math.cos(a) * (r + 0.08), Math.sin(a) * (r + 0.08), 0, std(color, { metalness: 0.5, roughness: 0.4 }))
        tooth.rotation.z = a
      }
      cyl(gr, 0.1, 0.1, 0.2, 0, 0, 0, '#2b3446', 12).rotation.x = Math.PI / 2
      spinners.push({ o: gr, kind: 'spinZ', speed })
    }
    gear(0.5, 10, w / 2 - 1.5, -d / 2 + 0.8, 0.7, '#9fb0c3')
    gear(0.32, 7, w / 2 - 0.68, -d / 2 + 0.8, -0.7 * 0.5 / 0.32 * 1.05, BRAND.blue)
    box(g, 2.1, 0.35, 0.3, w / 2 - 1.1, top + 0.18, -d / 2 + 0.8, '#5a6170')
  }
}


/* ---------- la sede Speaqi ---------- */
const HQ = { w: 13, d: 7.5, floors: 6, floorH: 2.6 }
// Facciata a vetri: di giorno il riflesso del cielo, di sera alcune finestre accese.
function facadeTextures(cols, floors, seed) {
  const r = rng(seed), cw = 64, fh = 96
  const draw = (lit) => canvasTexture(cols * cw, floors * fh, (ctx) => {
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = c * cw, y = f * fh
      if (lit) {
        ctx.fillStyle = '#000'; ctx.fillRect(x, y, cw, fh)
        if (r() < 0.55) { ctx.fillStyle = r() < 0.8 ? '#ffd9a0' : '#bfe0ff'; ctx.fillRect(x + 4, y + 8, cw - 8, fh - 18) }
      } else {
        const g = ctx.createLinearGradient(x, y, x + cw, y + fh)
        g.addColorStop(0, '#cfe6f3'); g.addColorStop(0.55, '#7fa9c4'); g.addColorStop(1, '#5b84a3')
        ctx.fillStyle = '#2b3446'; ctx.fillRect(x, y, cw, fh)
        ctx.fillStyle = g; ctx.fillRect(x + 4, y + 8, cw - 8, fh - 18)
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x + 8, y + 12, 6, fh - 30)
      }
    }
  })
  return { map: draw(false), emissive: draw(true) }
}
function buildHQ(x, y, z, direzione) {
  const g = new THREE.Group(); g.position.set(x, y, z); root.add(g)
  const { w, d, floors, floorH } = HQ, bodyH = floors * floorH
  // Piazzale in pietra con le bandiere.
  box(g, w + 6, 0.05, 4.2, 0, 0.03, d / 2 + 2.1, '#ebe4d3').castShadow = false
  for (const fx of [-3.2, -1.6, 1.6, 3.2]) flagPole(g, fx, 0, d / 2 + 3.4, fx < 0 ? '#ffffff' : BRAND.navy, fx < 0 ? 'navy' : 'white', 3.2)
  // Atrio vetrato e pensilina.
  box(g, w - 1.2, floorH, d - 1.2, 0, floorH / 2, 0, std('#a9cfe3', { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.3 }))
  box(g, 4.2, 0.18, 2.2, 0, floorH - 0.25, d / 2 + 0.6, BRAND.navy)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.16, 0.16, floorH, sx * (w / 2 - 0.4), floorH / 2, sz * (d / 2 - 0.4), '#f2f2ee', 12)
  // Il corpo: vetro su quattro lati, solai bianchi a ogni piano.
  const cols = Math.round(w / 1.1), side = Math.round(d / 1.1)
  const front = facadeTextures(cols, floors - 2, 3), flank = facadeTextures(side, floors - 2, 9)
  const glass = (t) => new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.22, metalness: 0.35 })
  const fm = glass(front), sm = glass(flank)
  hqWindows.push(fm, sm)
  const roofMat = std('#dfe3e8')
  const officeH = bodyH - 2 * floorH
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, officeH, d), [sm, sm, roofMat, roofMat, fm, fm])
  body.position.y = floorH + officeH / 2; body.castShadow = true; body.receiveShadow = true; g.add(body)
  for (let f = 1; f <= floors; f++) box(g, w + 0.5, 0.18, d + 0.5, 0, f * floorH, 0, '#f4f4f0')
  // Lame verticali sulla facciata: il ritmo dell'edificio.
  for (let k = 0; k <= 6; k++) box(g, 0.14, officeH, 0.3, -w / 2 + k * w / 6, floorH + officeH / 2, d / 2 + 0.12, '#f4f4f0')
  buildDirectionFloor(g, x, y + bodyH - floorH, z, direzione)
  // Ascensore di vetro sul fianco, che sale e scende.
  const shaftX = w / 2 + 0.75
  box(g, 1.2, bodyH + 0.6, 1.4, shaftX, (bodyH + 0.6) / 2, 0.8, std('#cfe9f5', { transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false })).castShadow = false
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.7, 0.7]) box(g, 0.06, bodyH + 0.6, 0.06, shaftX + sx, (bodyH + 0.6) / 2, 0.8 + sz, '#2b3446')
  const cabin = new THREE.Group(); cabin.position.set(shaftX, 0.2, 0.8); g.add(cabin)
  box(cabin, 1.0, 1.9, 1.2, 0, 0.95, 0, std('#f7f2e6', { emissive: '#ffd79a', emissiveIntensity: 0.25 }))
  box(cabin, 0.9, 0.06, 1.1, 0, 1.92, 0, BRAND.orange)
  spinners.push({ o: cabin, kind: 'lift', low: 0.2, high: bodyH - 1.9 })
  // Coronamento: piano arretrato, insegna Speaqi grande e luce di segnalazione.
  const topY = bodyH + 0.1
  box(g, w - 3, 1.6, d - 2.4, 0, topY + 0.8, -0.3, '#2b3446')
  const signW = w * 0.82, signH = signW * 470 / 2000 + 0.9
  for (const sx of [-1, 1]) box(g, 0.2, 1.8, 0.2, sx * (signW / 2 - 0.8), topY + 0.9, d / 2 - 0.6, '#5a6170')
  box(g, signW, signH, 0.3, 0, topY + 1.7 + signH / 2, d / 2 - 0.6, BRAND.navy)
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(signW - 0.9, (signW - 0.9) * 470 / 2000), new THREE.MeshBasicMaterial({ map: tex['full-white'], transparent: true, toneMapped: false, depthWrite: false }))
  logo.position.set(0, topY + 1.7 + signH / 2, d / 2 - 0.44); g.add(logo)
  // Retro dell'insegna: si legge anche girando intorno al campus.
  const back = logo.clone(); back.position.z = d / 2 - 0.76; back.rotation.y = Math.PI; g.add(back)
  const beacon = mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: BRAND.orange, toneMapped: false }), g, signW / 2 - 0.3, topY + 2.0 + signH, d / 2 - 0.6, false)
  spinners.push({ o: beacon, kind: 'blink' })
  // Luce dell'insegna di sera.
  const glow = new THREE.PointLight('#9fb7ff', 0, 14, 1.5); glow.position.set(0, topY + 1.7 + signH / 2, d / 2 + 1.5); g.add(glow); roomLights.push(glow)
  const tag = document.createElement('div'); tag.className = 'hq-tag'; tag.textContent = 'Sede Speaqi'
  const label = new CSS2DObject(tag); label.position.set(0, topY + 2.6 + signH, d / 2 - 0.6); g.add(label)
  hq = { group: g, top: topY + 2.2 + signH, x, z }
  return hq
}
// Ultimo piano della sede: open space vetrato della Direzione, con il CEO e il Direttore.
function buildDirectionFloor(hqGroup, wx, wy, wz, entry) {
  const { w, d, floorH } = HQ
  const sector = entry?.sector || { id: 'direzione', name: 'Direzione', color: '#9b83d9', agents: [] }
  const g = new THREE.Group(); g.position.set(wx, wy + 0.09, wz); root.add(g)
  const tint = (amount, base = BRAND.cream) => new THREE.Color(sector.color).lerp(new THREE.Color(base), amount)
  const h = floorH - 0.09
  box(g, w - 0.2, 0.04, d - 0.2, 0, 0.02, 0, std('#efe7da', { roughness: 0.6 }))
  box(g, w - 2.4, 0.02, d - 2.6, 0, 0.05, -0.2, std(tint(0.55, '#ffffff'), { roughness: 0.95 }))
  // Parete di fondo con il logo, vetrate su tre lati quasi invisibili: da fuori si vede dentro.
  box(g, w - 0.2, h, 0.16, 0, h / 2, -d / 2 + 0.1, std(tint(0.62)))
  const wallLogo = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6 * 470 / 2000), logoMat('full', 'navy'))
  wallLogo.position.set(0, 1.75, -d / 2 + 0.19); g.add(wallLogo)
  const glass = std('#d9eef8', { transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false })
  const front = box(g, w - 0.2, h, 0.04, 0, h / 2, d / 2 - 0.1, glass); front.castShadow = false
  for (const sx of [-1, 1]) { const p = box(g, 0.04, h, d - 0.2, sx * (w / 2 - 0.1), h / 2, 0, glass); p.castShadow = false }
  for (let k = 0; k <= 6; k++) box(g, 0.08, h, 0.08, -w / 2 + 0.1 + k * (w - 0.2) / 6, h / 2, d / 2 - 0.1, '#2b3446')
  // La scrivania del CEO, verso la vetrata: il Direttore siede davanti per gli ordini.
  const ceoDesk = new THREE.Group(); ceoDesk.position.set(-1.6, 0, -0.9); g.add(ceoDesk)
  box(ceoDesk, 2.4, 0.08, 1.0, 0, 0.76, 0, '#6e4a33'); box(ceoDesk, 2.3, 0.7, 0.08, 0, 0.38, -0.42, '#5a3b28')
  for (const sx of [-1.1, 1.1]) box(ceoDesk, 0.08, 0.72, 0.9, sx, 0.36, 0, '#5a3b28')
  box(ceoDesk, 0.7, 0.03, 0.46, 0.3, 0.81, 0.05, '#1d2433')
  const laptop = box(ceoDesk, 0.66, 0.42, 0.03, 0.3, 1.02, -0.17, '#1d2433'); laptop.rotation.x = -0.25
  const lscreen = mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ color: '#7fb0ff', toneMapped: false }), ceoDesk, 0.3, 1.02, -0.15, false); lscreen.rotation.set(-0.25, Math.PI, 0)
  cyl(ceoDesk, 0.05, 0.04, 0.1, -0.6, 0.85, 0.15, '#ffffff', 10)
  // La sedia del CEO è dietro la scrivania, il CEO guarda verso la vetrata.
  const ceoChair = new THREE.Group(); ceoChair.position.set(-1.6, 0, -1.8); g.add(ceoChair)
  box(ceoChair, 0.62, 0.08, 0.58, 0, 0.47, 0, '#1b1f2e'); box(ceoChair, 0.62, 0.8, 0.08, 0, 0.9, -0.3, '#1b1f2e'); cyl(ceoChair, 0.03, 0.03, 0.42, 0, 0.22, 0, '#5a6170', 8)
  const ceo = makeCeo(); ceo.group.position.set(-1.6, 0, -1.75); g.add(ceo.group)
  // Il Direttore: l'agente vero, alla sua postazione davanti al CEO.
  const people = []
  sector.agents.slice(0, 3).forEach((agent, i) => {
    const sub = new THREE.Group(); sub.position.set(-1.6 + (i - (Math.min(sector.agents.length, 3) - 1) / 2) * 1.5, 0, 0.35); g.add(sub)
    people.push(placeAgent(sub, sector, agent, i, 0, 0, new THREE.Vector3(-2.4 - i * 0.5, 0, 0.9)))
  })
  // Tavolo riunioni, divano e verde.
  cyl(g, 0.85, 0.85, 0.06, 3.4, 0.74, -0.6, '#f2ede3', 28); cyl(g, 0.12, 0.3, 0.72, 3.4, 0.36, -0.6, '#5a6170', 12)
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; const c = box(g, 0.42, 0.06, 0.42, 3.4 + Math.cos(a) * 1.15, 0.45, -0.6 + Math.sin(a) * 1.15, '#2c3142'); c.rotation.y = -a }
  box(g, 2.2, 0.42, 0.8, 3.5, 0.21, 2.0, '#c9b49a'); box(g, 2.2, 0.5, 0.18, 3.5, 0.6, 2.32, '#c9b49a')
  plant(g, -w / 2 + 0.7, 0, d / 2 - 0.8, 1.4); plant(g, w / 2 - 0.7, 0, -d / 2 + 0.8, 1.3, '#e7e1d4'); plant(g, 1.3, 0, -d / 2 + 0.7, 1.1)
  // Lo schermo grande con l'andamento: barre che si muovono.
  const board = new THREE.Group(); board.position.set(3.4, 1.65, -d / 2 + 0.22); g.add(board)
  box(board, 2.2, 1.2, 0.06, 0, 0, 0, '#1d2433')
  for (let k = 0; k < 6; k++) {
    const bar = box(board, 0.22, 0.8, 0.02, -0.8 + k * 0.32, -0.45, 0.04, new THREE.MeshBasicMaterial({ color: k % 2 ? '#8fc1ff' : '#5fe39a', toneMapped: false }))
    bar.castShadow = false; bar.geometry = new THREE.BoxGeometry(0.22, 0.8, 0.02); bar.geometry.translate(0, 0.4, 0)
    spinners.push({ o: bar, kind: 'bar', phase: k * 0.9 })
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd79a', emissiveIntensity: 0 }); lamps.push(lampMat)
  for (const lx of [-3, -0.6, 2.4]) cyl(g, 0.3, 0.3, 0.04, lx, h - 0.06, 0, lampMat, 20).castShadow = false
  const room = new THREE.PointLight('#ffd9a6', 0, 14, 1.4); room.position.set(0, h - 0.5, 0.5); g.add(room); roomLights.push(room)
  const ring = outline(w - 0.4, d - 0.4, sector.color); ring.position.y = 0.07; g.add(ring)
  g.traverse((o) => { if (o.isMesh && !o.userData.deptId && o !== ring) { o.userData.deptId = sector.id; pickables.push(o) } })
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag'
  el.style.setProperty('--c', sector.color)
  el.setAttribute('aria-label', `Apri reparto ${sector.name}`)
  el.innerHTML = `<i></i>${esc(sector.name)}<b>CEO e ${sector.agents.length === 1 ? 'Direttore' : `${sector.agents.length} agenti`}</b>`
  el.onclick = () => focusDepartment(focused === sector.id ? null : sector.id)
  const tag = new CSS2DObject(el); tag.position.set(-w / 2 + 2.2, h + 0.3, d / 2 + 0.3); g.add(tag)
  pavilions.push({ id: sector.id, sector, group: g, ring, tag, w, d, center: new THREE.Vector3(), yaw: 0, people, top: true })
}
// Il CEO: il titolare, l'unica persona che non è un agente. Giacca scura sulla maglia Speaqi.
function makeCeo() {
  const fake = { id: 'ceo' }
  const { group, parts } = makePerson(fake, 0)
  group.traverse((o) => {
    if (!o.isMesh) return
    if (o.geometry === G.torso || o.geometry === G.arm) o.material = std('#2a2f45')
    if (o.geometry === G.backLogo) o.material = logoMat('full', 'white')
    if (o.geometry === G.chestLogo) o.material = logoMat('icon', 'white')
  })
  mesh(new THREE.PlaneGeometry(0.1, 0.3), std('#ffffff'), parts.torso, -0.05, 0.08, 0.196, false)
  poseSeated(parts)
  group.rotation.y = 0
  const el = document.createElement('div'); el.className = 'person-tag ceo'; el.innerHTML = '<i style="--c:#ffd27a"></i>Tu · CEO'
  const tag = new CSS2DObject(el); tag.position.set(0, 2.0, 0); tag.visible = false; group.add(tag); ceoTag = tag
  const talk = bubble('talk'); talk.scale.setScalar(0.4); talk.position.set(0.35, 1.85, 0.1); group.add(talk)
  spinners.push({ o: group, kind: 'ceo', parts, talk })
  group.traverse((o) => { if (o.isMesh) { o.userData.deptId = 'direzione'; pickables.push(o) } })
  return { group, parts }
}

/* ---------- comportamento ---------- */
const bubbleMats = {}
function bubble(kind) {
  if (!bubbleMats[kind]) bubbleMats[kind] = new THREE.SpriteMaterial({ map: bubbleTexture(kind), transparent: true, depthWrite: false })
  return new THREE.Sprite(bubbleMats[kind])
}
function setupPerson(rec) {
  const { agent, person, parts, station } = rec
  station.chair.rotation.y = 0
  if (agent.status === 'attention') {
    poseStanding(parts); person.position.set(rec.seat.x + 0.55, 0, rec.seat.z + 0.35); person.rotation.y = 0.2
    rec.mode = 'alert'; station.chair.rotation.y = 0.5
    rec.bubble = bubble('alert'); rec.bubble.scale.setScalar(0.42); rec.bubble.position.set(0, 2.2, 0); person.add(rec.bubble)
  } else if (agent.status === 'off') {
    poseAsleep(parts); person.position.copy(rec.seat); person.rotation.y = Math.PI; rec.mode = 'asleep'
    for (let k = 0; k < 3; k++) { const z = bubble('zzz'); z.scale.setScalar(0.22); person.add(z); rec.zs.push(z) }
  } else {
    poseSeated(parts); person.position.copy(rec.seat); person.rotation.y = Math.PI
    rec.mode = agent.status === 'running' ? 'typing' : 'seated'
    rec.until = 4 + (rec.phase * 7) % 8
  }
}
function walkTo(rec, points, next) {
  poseStanding(rec.parts); rec.mode = 'walk'; rec.path = points.map((p) => p.clone()); rec.next = next
}
function stepPerson(rec, t, dt) {
  const { parts: P, person } = rec, ph = rec.phase
  rec.orb.position.y = 2.0 + Math.sin(t * 2 + ph) * 0.05; rec.orb.rotation.y = t * 1.5
  if (rec.mode === 'typing') {
    P.shL.rotation.x = -1.15 + Math.sin(t * 14 + ph) * 0.07; P.shR.rotation.x = -1.15 + Math.sin(t * 14 + ph + 1.7) * 0.07
    P.head.rotation.x = Math.sin(t * 1.3 + ph) * 0.06; P.head.rotation.y = Math.sin(t * 0.7 + ph) * 0.12
  } else if (rec.mode === 'seated') {
    P.head.rotation.y = Math.sin(t * 0.5 + ph) * 0.3; P.torso.rotation.x = -0.08
    P.shR.rotation.x = -1.1 + Math.sin(t * 3 + ph) * 0.12 * (Math.sin(t * 0.4 + ph) > 0.4 ? 1 : 0)
    rec.until -= dt
    if (rec.until <= 0) {
      const stand = rec.seat.clone().add(new THREE.Vector3(0, 0, 0.6))
      const turn = new THREE.Vector3(stand.x, 0, rec.coffee.z)
      walkTo(rec, [stand, turn, rec.coffee], 'coffee')
      rec.station.chair.rotation.y = 0.6
    }
  } else if (rec.mode === 'walk') {
    const target = rec.path[0]
    const delta = target.clone().sub(person.position); delta.y = 0
    const dist = delta.length(), speed = 1.05
    if (dist < 0.03) {
      rec.path.shift()
      if (!rec.path.length) {
        if (rec.next === 'coffee') { rec.mode = 'coffee'; rec.until = 4 + (ph * 3) % 3; person.rotation.y = Math.PI / 2; poseStanding(P) }
        else { rec.mode = 'seated'; rec.until = 9 + (ph * 11) % 9; poseSeated(P); person.position.copy(rec.seat); person.rotation.y = Math.PI; rec.station.chair.rotation.y = 0 }
      }
    } else {
      person.position.addScaledVector(delta.normalize(), Math.min(dist, speed * dt))
      const want = Math.atan2(delta.x, delta.z)
      let diff = want - person.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      person.rotation.y += diff * Math.min(1, dt * 10)
      const s = Math.sin(t * 9 + ph)
      P.legL.rotation.x = s * 0.55; P.legR.rotation.x = -s * 0.55
      P.shL.rotation.x = -s * 0.45; P.shR.rotation.x = s * 0.45
      P.body.position.y = Math.abs(Math.cos(t * 9 + ph)) * 0.04
    }
  } else if (rec.mode === 'coffee') {
    P.shR.rotation.set(-1.9 + Math.sin(t * 1.5 + ph) * 0.15, 0, -0.35); P.head.rotation.x = -0.1 + Math.sin(t * 1.5 + ph) * 0.05
    rec.until -= dt
    if (rec.until <= 0) {
      const stand = rec.seat.clone().add(new THREE.Vector3(0, 0, 0.6))
      walkTo(rec, [new THREE.Vector3(stand.x, 0, rec.coffee.z), stand, rec.seat], 'seat')
    }
  } else if (rec.mode === 'alert') {
    P.shR.rotation.set(-2.7 + Math.sin(t * 2 + ph) * 0.12, 0, -0.5); P.head.rotation.y = Math.sin(t * 0.9 + ph) * 0.35
    P.body.rotation.z = Math.sin(t * 1.2 + ph) * 0.03
    rec.bubble.position.y = 2.2 + Math.abs(Math.sin(t * 3 + ph)) * 0.12
  } else if (rec.mode === 'asleep') {
    P.torso.scale.setScalar(1 + Math.sin(t * 1.6 + ph) * 0.02)
    rec.zs.forEach((z, k) => {
      const f = ((t * 0.35 + k / 3 + ph) % 1)
      z.position.set(0.15 + f * 0.25, 1.55 + f * 0.9, 0.1 - f * 0.2)
      z.material.opacity = f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85
      z.scale.setScalar(0.14 + f * 0.16)
    })
  }
}
const packetMat = new THREE.MeshBasicMaterial({ color: '#9ff7c4', toneMapped: false })
function spawnPacket(rec) {
  if (!kiosk || packets.length > 24) return
  const from = new THREE.Vector3(); rec.pavilion.localToWorld(from.set(rec.seat.x, H + 0.4, rec.seat.z - 0.3))
  const to = kiosk.top.clone()
  const mid = from.clone().lerp(to, 0.5); mid.y = Math.max(from.y, to.y) + 3.5 + Math.random()
  const m = mesh(G.packet, packetMat, scene, from.x, from.y, from.z, false)
  const glow = new THREE.Sprite(glowMat); glow.scale.setScalar(0.4); m.add(glow)
  packets.push({ m, curve: new THREE.QuadraticBezierCurve3(from, mid, to), t: 0, dur: 2.2 + Math.random() * 0.8 })
}
let glowMat

/* ---------- campus ---------- */
function layoutCampus() {
  const byId = Object.fromEntries(snapshot.departments.map((s, i) => [s.id, { sector: s, index: i, size: pavilionSize(s) }]))
  const places = {}
  // In alto ai lati della sede; davanti ai lati della piazza.
  let left = -HQ.w / 2 - 1.6, right = HQ.w / 2 + 1.6
  BACK_LEFT.filter((id) => byId[id]).forEach((id, k) => { const s = byId[id].size; places[id] = { x: left - s.w / 2, y: TERRACE, z: BACK_Z + 0.4 + k * 0.6, yaw: 0.14 + k * 0.06 }; left -= s.w + GAP })
  BACK_RIGHT.filter((id) => byId[id]).forEach((id, k) => { const s = byId[id].size; places[id] = { x: right + s.w / 2, y: TERRACE, z: BACK_Z + 0.4 + k * 0.6, yaw: -0.14 - k * 0.06 }; right += s.w + GAP })
  let fl = -PLAZA, fr = PLAZA
  FRONT_LEFT.filter((id) => byId[id]).forEach((id, k) => { const s = byId[id].size; places[id] = { x: fl - s.w / 2, y: 0, z: FRONT_Z - k * 1.1, yaw: 0.16 + k * 0.06 }; fl -= s.w + GAP })
  FRONT_RIGHT.filter((id) => byId[id]).forEach((id, k) => { const s = byId[id].size; places[id] = { x: fr + s.w / 2, y: 0, z: FRONT_Z - k * 1.1, yaw: -0.16 - k * 0.06 }; fr += s.w + GAP })
  // Reparti futuri non previsti: in fila in alto a destra, senza sparire.
  for (const s of snapshot.departments) if (!places[s.id] && s.id !== 'direzione') { const size = byId[s.id].size; places[s.id] = { x: right + size.w / 2, y: TERRACE, z: BACK_Z, yaw: 0 }; right += size.w + GAP }
  for (const id of Object.keys(places)) Object.assign(places[id], { size: byId[id].size })
  const xs = Object.values(places).flatMap((p) => [p.x - p.size.w / 2, p.x + p.size.w / 2])
  return { places, byId, minX: Math.min(-PLAZA - 2, -HQ.w / 2 - 3, ...xs) - 3.2, maxX: Math.max(PLAZA + 2, HQ.w / 2 + 3, ...xs) + 3.2 }
}
function tree(parent, x, y, z, kind, r) {
  const t = new THREE.Group(); t.position.set(x, y, z); parent.add(t)
  const s = 0.8 + r() * 0.5
  if (kind === 'cypress') {
    cyl(t, 0.07, 0.1, 0.5, 0, 0.25, 0, '#6b4d36', 6)
    const c = mesh(new THREE.ConeGeometry(0.42 * s, 3.2 * s, 8), std('#2f5d3e', { flatShading: true }), t, 0, 0.4 + 1.6 * s, 0)
    c.scale.set(1, 1, 1)
  } else if (kind === 'pine') {
    cyl(t, 0.08, 0.13, 2.2 * s, 0, 1.1 * s, 0, '#7a5a3f', 6).rotation.z = (r() - 0.5) * 0.2
    const top = mesh(new THREE.SphereGeometry(1.25 * s, 9, 6), std('#4f7a45', { flatShading: true }), t, 0, 2.35 * s, 0)
    top.scale.set(1, 0.42, 1)
  } else {
    cyl(t, 0.07, 0.11, 0.9 * s, 0, 0.45 * s, 0, '#7a5a3f', 6)
    const colors = ['#6fae5f', '#86bf6a', '#5c9a55']
    for (let k = 0; k < 3; k++) mesh(new THREE.IcosahedronGeometry((0.55 + r() * 0.25) * s, 0), std(colors[k], { flatShading: true }), t,
      (r() - 0.5) * 0.5 * s, (1.15 + k * 0.32) * s, (r() - 0.5) * 0.5 * s)
  }
  t.rotation.y = r() * Math.PI
  trees.push({ g: t, phase: r() * 6, amp: kind === 'cypress' ? 0.015 : 0.03 })
}
function lamp(parent, x, y, z) {
  cyl(parent, 0.05, 0.07, 2.4, x, y + 1.2, z, '#2b3446', 8)
  const mat = new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd27a', emissiveIntensity: 0 })
  lamps.push(mat)
  mesh(new THREE.SphereGeometry(0.17, 12, 10), mat, parent, x, y + 2.5, z, false)
}
function bench(parent, x, z, rot) {
  const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rot; parent.add(b)
  box(b, 1.5, 0.08, 0.45, 0, 0.45, 0, '#c99b6d'); box(b, 1.5, 0.35, 0.06, 0, 0.7, -0.2, '#c99b6d')
  for (const sx of [-0.62, 0.62]) box(b, 0.08, 0.45, 0.4, sx, 0.22, 0, '#2b3446')
}
function path(parent, from, to, y, width = 1.1) {
  const d = to.clone().sub(from); const len = Math.hypot(d.x, d.z)
  const p = box(parent, width, 0.04, len, (from.x + to.x) / 2, y + 0.02, (from.z + to.z) / 2, '#ebe4d3')
  p.rotation.y = Math.atan2(d.x, d.z); p.castShadow = false
}
function buildCampus() {
  const L = layoutCampus()
  const W = L.maxX - L.minX, cx = (L.minX + L.maxX) / 2
  // La sede sta in cima alla scalinata, dietro il suo piazzale.
  const hqZ = WALL_Z - 1.6 - 4.6 - HQ.d / 2
  const zFront = 13.5, zBack = hqZ - HQ.d / 2 - 4.2, D = zFront - zBack
  // Isola: prato, bordo in pietra, fianchi di terra.
  slab(root, W, D, 2.4, 3.2, cx, 0, (zFront + zBack) / 2, '#a3c98f', '#7b6650')
  // Terrazza della Direzione con muro in pietra e scalinata.
  slab(root, W - 1.2, WALL_Z - zBack - 0.6, TERRACE, 2.6, cx, TERRACE, (WALL_Z + zBack + 0.6) / 2, '#a8cf93', '#e3dac8')
  const steps = 8
  for (let k = 0; k < steps; k++) box(root, 4.4, TERRACE / steps * (k + 1), 0.42, 0, TERRACE / steps * (k + 1) / 2, WALL_Z + 0.12 + (steps - 1 - k) * 0.42 + 0.21, '#efe8da')
  for (const sx of [-1, 1]) box(root, 0.35, TERRACE + 0.5, steps * 0.42 + 0.1, sx * 2.38, (TERRACE + 0.5) / 2, WALL_Z + 0.12 + steps * 0.21, '#d6cdb9')
  box(root, W - 2, 0.04, 1.3, cx, TERRACE + 0.02, WALL_Z - 1.0, '#ebe4d3').castShadow = false
  box(root, 1.3, 0.04, 2.6, 0, TERRACE + 0.02, WALL_Z - 2.5, '#ebe4d3').castShadow = false
  // Siepe sul bordo della terrazza, interrotta dalla scalinata.
  for (let x = L.minX + 1.8; x < L.maxX - 1.8; x += 0.75) if (Math.abs(x) > 2.8) {
    const hedge = mesh(new THREE.IcosahedronGeometry(0.42, 0), std(x % 1.5 > 0.7 ? '#4f8a52' : '#5f9a5c', { flatShading: true }), root, x, TERRACE + 0.3, WALL_Z - 0.35)
    hedge.scale.set(1.1, 0.75, 0.9)
  }
  // La sede Speaqi dietro la Direzione, con i viali che la collegano alla terrazza.
  buildHQ(0, TERRACE, hqZ, L.byId.direzione)
  for (const sx of [-1, 1]) lamp(root, sx * (HQ.w / 2 + 2.6), TERRACE, hqZ + HQ.d / 2 + 2.2)
  // Piazza con fontana e "Aspetta te".
  const plazaZ = 6.6
  mesh(new THREE.CylinderGeometry(PLAZA - 0.2, PLAZA - 0.2, 0.06, 56), std('#efe8d9'), root, 0, 0.03, plazaZ).castShadow = false
  const inlay = mesh(new THREE.TorusGeometry(3.3, 0.07, 6, 64), std('#cfc4ae'), root, 0, 0.065, plazaZ, false); inlay.rotation.x = Math.PI / 2
  path(root, new THREE.Vector3(0, 0, WALL_Z + steps * 0.42 + 0.1), new THREE.Vector3(0, 0, plazaZ - 3), 0, 2.2)
  path(root, new THREE.Vector3(0, 0, plazaZ + PLAZA - 0.6), new THREE.Vector3(0, 0, zFront + 0.4), 0, 2.2)
  buildFountain(new THREE.Vector3(0, 0, plazaZ))
  buildKiosk(new THREE.Vector3(0, 0, plazaZ + 3.9))
  for (const sx of [-1, 1]) { bench(root, sx * 3.6, plazaZ + 2.4, -sx * 0.9); lamp(root, sx * 4.4, 0, plazaZ - 2.8); lamp(root, sx * 4.4, 0, plazaZ + 3.3); lamp(root, sx * 2.9, TERRACE, WALL_Z - 0.5) }
  for (const [id, p] of Object.entries(L.places)) {
    buildPavilion(L.byId[id].sector, L.byId[id].index, p)
    if (p.y === 0) {
      const front = new THREE.Vector3(Math.sin(p.yaw) * (p.size.d / 2 + 0.2), 0, Math.cos(p.yaw) * (p.size.d / 2 + 0.2)).add(new THREE.Vector3(p.x, 0, p.z))
      path(root, front, new THREE.Vector3(Math.sign(p.x) * (PLAZA - 1), 0, plazaZ), 0, 1.1)
    }
  }
  // Verde: cipressi in fondo, pini ai lati, alberi sparsi fuori da padiglioni, piazza e percorsi.
  const r = rng(7)
  const blocked = (x, z, y) => {
    if (Math.abs(x) < 3 && z > WALL_Z - 3 && z < zFront + 1) return true
    if (Math.hypot(x, z - plazaZ) < PLAZA + 0.8) return true
    if (z > WALL_Z - 1.8 && z < WALL_Z + 0.8) return true
    if (y > 0 && z > WALL_Z - 2.2) return true
    if (Math.abs(x) < HQ.w / 2 + 3.2 && z > hqZ - HQ.d / 2 - 1.5 && z < WALL_Z) return true
    for (const p of Object.values(L.places)) {
      const dx = x - p.x, dz = z - p.z, c = Math.cos(-p.yaw), s = Math.sin(-p.yaw)
      const lx = dx * c - dz * s, lz = dx * s + dz * c
      if (Math.abs(lx) < p.size.w / 2 + 1.1 && Math.abs(lz) < p.size.d / 2 + 1.4 && Math.abs((p.y || 0) - y) < 0.1) return true
      // Davanti a ogni padiglione niente alberi: la camera ci guarda dentro.
      if (Math.abs(lx) < p.size.w / 2 + 2.5 && lz > 0 && lz < p.size.d / 2 + 9) return true
    }
    return false
  }
  for (let x = L.minX + 1.4; x <= L.maxX - 1.4; x += 1.25) if (Math.abs(x) > HQ.w / 2 + 2.6) tree(root, x + (r() - 0.5) * 0.3, TERRACE, zBack + 0.9 + r() * 0.4, 'cypress', r)
  let placed = 0
  for (let i = 0; i < 400 && placed < 34; i++) {
    const x = L.minX + 1.2 + r() * (W - 2.4), z = zBack + 2.2 + r() * (D - 3.6)
    const y = z < WALL_Z - 0.5 ? TERRACE : 0
    if (blocked(x, z, y)) continue
    if (Math.abs(x - L.minX) < 1.6 || Math.abs(x - L.maxX) < 1.6) continue
    const edge = Math.abs(x) > W / 2 - 6
    tree(root, x, y, z, edge && r() < 0.5 ? 'pine' : 'round', r); placed++
  }
  bounds = { center: new THREE.Vector3(cx, 3, (zFront + zBack) / 2 - 1), W, D, plazaZ }
}
function buildFountain(at) {
  const g = new THREE.Group(); g.position.copy(at); root.add(g)
  const rim = mesh(new THREE.TorusGeometry(1.55, 0.16, 10, 40), std('#e6dccb'), g, 0, 0.3, 0); rim.rotation.x = Math.PI / 2
  cyl(g, 1.55, 1.6, 0.3, 0, 0.15, 0, '#d8cdb8', 40)
  const water = mesh(new THREE.CircleGeometry(1.45, 40), new THREE.MeshStandardMaterial({ color: '#5fb6d6', roughness: 0.15, metalness: 0.2, emissive: '#1d6f8f', emissiveIntensity: 0.25 }), g, 0, 0.32, 0, false)
  water.rotation.x = -Math.PI / 2
  cyl(g, 0.22, 0.3, 0.9, 0, 0.6, 0, '#efe8da', 16)
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.57), new THREE.MeshBasicMaterial({ map: tex['icon-white'], transparent: true, depthWrite: false, toneMapped: false }))
  icon.position.set(0, 1.45, 0); g.add(icon)
  const count = 70, positions = new Float32Array(count * 3), seeds = new Float32Array(count)
  for (let i = 0; i < count; i++) seeds[i] = Math.random()
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const drops = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#d9f4ff', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }))
  g.add(drops)
  const ripples = []
  for (let k = 0; k < 3; k++) {
    const rr = mesh(new THREE.RingGeometry(0.3, 0.36, 40), new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.5, depthWrite: false }), g, 0, 0.335, 0, false)
    rr.rotation.x = -Math.PI / 2; ripples.push(rr)
  }
  fountain = { drops, seeds, icon, water, ripples }
}
function buildKiosk(at) {
  const g = new THREE.Group(); g.position.copy(at); root.add(g)
  box(g, 1.1, 1.6, 0.6, 0, 0.8, 0, BRAND.navy)
  box(g, 1.16, 0.1, 0.66, 0, 1.65, 0, BRAND.orange)
  const slot = box(g, 0.6, 0.05, 0.02, 0, 1.25, 0.31, '#0b0d18'); slot.castShadow = false
  const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.46), new THREE.MeshBasicMaterial({ map: tex['icon-white'], transparent: true, depthWrite: false }))
  icon.position.set(0, 0.75, 0.305); g.add(icon)
  const envelopes = []
  for (let k = 0; k < 6; k++) { const e = bubble('mail'); e.scale.setScalar(0.5); e.visible = false; g.add(e); envelopes.push(e) }
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag kiosk'
  el.onclick = () => send({ type: 'office:navigate' })
  const tag = new CSS2DObject(el); tag.position.set(0, 3.0, 0); g.add(tag)
  g.traverse((o) => { if (o.isMesh) { o.userData.kiosk = true; pickables.push(o) } })
  kiosk = { g, envelopes, el, top: at.clone().add(new THREE.Vector3(0, 1.7, 0)) }
  updateKiosk()
}
function updateKiosk() {
  if (!kiosk || !snapshot) return
  const n = snapshot.pendingCount
  kiosk.el.innerHTML = `<i></i>Aspetta te<b>${n}</b>`
  kiosk.el.style.setProperty('--c', n ? BRAND.orange : '#71828e')
  kiosk.el.setAttribute('aria-label', `Aspetta te: ${n} ${n === 1 ? 'proposta' : 'proposte'} da decidere`)
  kiosk.envelopes.forEach((e, k) => { e.visible = k < Math.min(n, 6) })
  dirty = true
}
function buildSky() {
  // Nuvole che fanno ombra sul campus: invisibili a schermo, si vede solo l'ombra che passa.
  const r = rng(11)
  for (let k = 0; k < 5; k++) {
    const c = new THREE.Group()
    for (let j = 0; j < 5; j++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.4 + r() * 1.4, 10, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
      m.position.set((r() - 0.5) * 5, (r() - 0.5) * 0.8, (r() - 0.5) * 3); m.castShadow = true; c.add(m)
    }
    c.position.set(-40 + k * 18, 22, -10 + r() * 20); scene.add(c)
    clouds.push({ g: c, speed: 0.8 + r() * 0.6 })
  }
  // Gabbiani.
  const wingMat = new THREE.MeshStandardMaterial({ color: '#f7f8fa', side: THREE.DoubleSide, roughness: 0.6 })
  for (let k = 0; k < 3; k++) {
    const b = new THREE.Group(); scene.add(b)
    const wingGeo = new THREE.BufferGeometry(); wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.1, 0, 0, -0.12, 0.7, 0.05, -0.02], 3)); wingGeo.computeVertexNormals()
    const l = new THREE.Mesh(wingGeo, wingMat), rr = new THREE.Mesh(wingGeo, wingMat); rr.scale.x = -1
    b.add(l, rr); mesh(new THREE.CapsuleGeometry(0.06, 0.25, 4, 8), std('#ffffff'), b, 0, 0, 0, false).rotation.x = Math.PI / 2
    gulls.push({ g: b, l, r: rr, radius: 14 + k * 5, h: 9 + k * 1.5, speed: 0.18 + k * 0.05, phase: k * 2.1 })
  }
  // Stelle, solo di sera.
  const sp = new Float32Array(500 * 3), rs = rng(5)
  for (let i = 0; i < 500; i++) { const a = rs() * Math.PI * 2, e = 0.15 + rs() * 1.2, d = 160; sp.set([Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d - 10, Math.sin(a) * Math.cos(e) * d], i * 3) }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 0.9, sizeAttenuation: false, transparent: true, opacity: 0.8 }))
  scene.add(stars)
}

/* ---------- motore ---------- */
function init3D() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
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
    loadLogos()
    glowMat = new THREE.SpriteMaterial({ map: bubbleTexture('glow'), color: '#9ff7c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    camera = new THREE.PerspectiveCamera(34, 1, 0.3, 600)
    camera.position.set(30, 30, 52)
    hemi = new THREE.HemisphereLight('#eaf3ff', '#8a7f6a', 2.2); scene.add(hemi)
    sun = new THREE.DirectionalLight('#fff1d8', 3.4)
    sun.position.set(-26, 42, 30); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 5, far: 160 })
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03
    scene.add(sun); scene.add(sun.target)
    const fill = new THREE.DirectionalLight('#a9c9e3', 0.9); fill.position.set(25, 18, -20); scene.add(fill)
    buildSky()
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.dampingFactor = 0.08
    controls.minDistance = 4; controls.maxDistance = 160
    controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.5
    controls.minAzimuthAngle = -1.25; controls.maxAzimuthAngle = 1.25
    controls.screenSpacePanning = true
    controls.addEventListener('start', () => { tween = null; lastInteraction = performance.now() })
    controls.addEventListener('change', () => { dirty = true })
    renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; lastInteraction = performance.now() })
    renderer.domElement.addEventListener('pointercancel', () => { down = null })
    renderer.domElement.addEventListener('pointerup', pick)
    renderer.domElement.addEventListener('pointermove', hover)
    renderer.domElement.addEventListener('pointerleave', () => setHover(null))
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe($('stage'))
    applyLight(); resize()
    renderer.setAnimationLoop(frame)
  } catch { fail3D() }
}
function applyLight() {
  if (!renderer || !hemi) return
  const night = light === 'night'
  hemi.intensity = night ? 0.55 : 2.2
  hemi.color.set(night ? '#7d95c9' : '#eaf3ff'); hemi.groundColor.set(night ? '#1d2133' : '#8a7f6a')
  sun.intensity = night ? 0.7 : 3.4
  sun.color.set(night ? '#9db8ff' : '#fff1d8')
  renderer.toneMappingExposure = night ? 1.05 : 1.0
  for (const m of lamps) m.emissiveIntensity = night ? 2.6 : 0
  for (const l of roomLights) l.intensity = night ? 14 : 0
  for (const m of hqWindows) m.emissiveIntensity = night ? 1.3 : 0
  if (stars) stars.visible = night
  document.querySelector('.viewport').dataset.light = light
  dirty = true
}
function disposeRoot() {
  if (!root) return
  // Geometrie, materiali e texture condivisi restano; si liberano solo quelli di questo campus.
  const geos = new Set(Object.values(G)); for (const g of boxGeoCache.values()) geos.add(g)
  const shared = new Set([...matCache.values(), ...logoMats.values(), ...Object.values(bubbleMats), packetMat, glowMat])
  const sharedTex = new Set(Object.values(tex))
  root.traverse((o) => {
    if ((o.isMesh || o.isPoints) && !geos.has(o.geometry)) o.geometry.dispose()
    for (const m of [o.material].flat()) if (m && !shared.has(m)) { if (m.map && !sharedTex.has(m.map)) m.map.dispose(); m.dispose() }
    if (o.isCSS2DObject) o.element.remove()
  })
  scene.remove(root)
  for (const p of packets) scene.remove(p.m)
  packets = []
}
function structureKey() {
  return JSON.stringify(snapshot.departments.map((d) => [d.id, d.name, d.agents.map((a) => [a.id, a.name, a.status])]))
}
function buildOffice() {
  if (!scene || webglFailed || !snapshot) return
  const key = structureKey()
  if (key === signature && root) { updateKiosk(); updateFocus(); return }
  signature = key
  disposeRoot(); ceoTag = null; pickables = []; pavilions = []; persons = []; spinners = []; trees = []; flags = []; screens = []; roomLights = []; hqWindows = []; hq = null
  lamps = []
  root = new THREE.Group(); scene.add(root)
  buildCampus()
  root.updateMatrixWorld(true)
  for (const p of pavilions) p.center = p.group.localToWorld(new THREE.Vector3(0, 1.2, 0.2))
  sun.target.position.copy(bounds.center)
  sun.position.copy(bounds.center).add(new THREE.Vector3(-26, 42, 30))
  applyLight(); updateFocus()
  dirty = true
}
function updateFocus() {
  for (const p of pavilions) {
    p.tag.element.setAttribute('aria-pressed', String(focused === p.id))
    p.tag.element.classList.toggle('dim', Boolean(focused) && focused !== p.id)
    for (const rec of p.people) rec.tag.visible = focused === p.id
  }
  if (ceoTag) ceoTag.visible = focused === 'direzione'
  for (const rec of persons) rec.tag.element.classList.toggle('sel', rec.agent.id === selected)
  dirty = true
}
function focusDepartment(id, agentId = null) {
  focused = id; selected = agentId
  updateFocus(); renderPanel(); moveCamera()
}
// Distanza minima perché tutti i punti stiano nell'inquadratura, con un margine: vale per ogni formato di finestra.
function fitDistance(target, dir, points, margin = 0.86) {
  const cam = camera.clone(), v = new THREE.Vector3()
  const fits = (dist) => {
    cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    return points.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) < margin && Math.abs(v.y) < margin && v.z < 1 })
  }
  let lo = 2, hi = 400
  for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid }
  return hi
}
function corners(cx, cz, w, d, y0, y1, yaw = 0) {
  const out = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [y0, y1]) {
    const lx = sx * w / 2, lz = sz * d / 2
    out.push(new THREE.Vector3(cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, cz - lx * Math.sin(yaw) + lz * Math.cos(yaw)))
  }
  return out
}
function moveCamera(instant = false) {
  if (!camera || !snapshot) return
  const pav = pavilions.find((p) => p.id === focused)
  const rec = selected && persons.find((r) => r.agent.id === selected)
  let target, dir, points, scale = 1
  if (pav) {
    const base = pav.group.position
    target = pav.top ? base.clone().add(new THREE.Vector3(-0.4, 1.1, 0)) : pav.center.clone()
    // I padiglioni in alto si guardano passando sopra la piazza, non attraverso quelli davanti.
    const side = Math.abs(base.x) < 1 ? 0.2 : -Math.sign(base.x) * (base.y > 0 ? 0.75 : 0.28)
    // L'ultimo piano si guarda quasi in piano, attraverso la vetrata: dall'alto il soffitto coprirebbe tutto.
    dir = new THREE.Vector3(Math.sin(pav.yaw) + side, pav.top ? 0.07 : base.y > 0 ? 0.42 : 0.34, Math.cos(pav.yaw)).normalize()
    points = pav.top ? corners(base.x - 0.4, base.z + pav.d / 2, pav.w * 0.62, 0.2, base.y + 0.3, base.y + HQ.floorH - 0.5)
      : corners(base.x, base.z, pav.w, pav.d, base.y, base.y + H + 0.6, pav.yaw)
    // Con un agente scelto la camera si avvicina a lui restando fuori dal padiglione, dalla stessa parte.
    if (rec) { target.lerp(rec.person.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)), 0.7); scale = 0.7 }
  } else {
    target = bounds.center.clone()
    dir = new THREE.Vector3(0.3, 0.56, 1).normalize()
    points = pavilions.flatMap((p) => corners(p.group.position.x, p.group.position.z, p.w, p.d, p.group.position.y, p.group.position.y + H + 0.8, p.yaw))
      .concat(corners(0, bounds.plazaZ, PLAZA * 2, PLAZA * 2, 0, 2))
      .concat(hq ? corners(hq.x, hq.z, HQ.w, HQ.d, TERRACE, TERRACE + hq.top) : [])
  }
  const pos = target.clone().addScaledVector(dir, fitDistance(target, dir, points, pav ? 0.82 : 0.94) * scale)
  if (instant || reduceMotion) { camera.position.copy(pos); controls.target.copy(target); tween = null; controls.update() }
  else tween = { start: performance.now(), from: camera.position.clone(), to: pos, fromT: controls.target.clone(), toT: target, dur: 1100 }
  lastInteraction = performance.now()
  dirty = true
}
function resize() {
  if (!renderer) return
  stageWidth = Math.max(1, $('stage').clientWidth); stageHeight = Math.max(1, $('stage').clientHeight)
  renderer.setSize(stageWidth, stageHeight); labels.setSize(stageWidth, stageHeight)
  camera.aspect = stageWidth / stageHeight; camera.updateProjectionMatrix()
  moveCamera(true); dirty = true
}
function rayHit(event) {
  const rect = renderer.domElement.getBoundingClientRect()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera)
  return ray.intersectObjects(pickables, false)[0]?.object.userData
}
function pick(event) {
  if (!down || Math.hypot(down.x - event.clientX, down.y - event.clientY) > 6) { down = null; return }
  down = null
  const hit = rayHit(event)
  if (hit?.kiosk) send({ type: 'office:navigate' })
  else if (hit?.agentId) focusDepartment(hit.deptId, hit.agentId)
  else if (hit?.deptId) focusDepartment(hit.deptId)
}
let hoverAt = 0
function hover(event) {
  if (event.buttons || performance.now() - hoverAt < 60) return
  hoverAt = performance.now()
  const hit = rayHit(event)
  setHover(hit?.kiosk ? 'kiosk' : hit?.deptId || null)
}
function setHover(id) {
  if (hovered === id) return
  hovered = id
  renderer.domElement.style.cursor = id ? 'pointer' : ''
  dirty = true
}
function frame(time) {
  if (document.hidden || webglFailed) return
  const animate = !reduceMotion
  if (animate ? time - lastFrame < 30 : !dirty && !tween) return
  const dt = Math.min(0.1, (time - (lastFrame || time)) / 1000); lastFrame = time
  const t = (time - clockStart) / 1000
  if (tween) {
    const k0 = Math.min(1, (time - tween.start) / tween.dur), k = k0 < 0.5 ? 4 * k0 ** 3 : 1 - (-2 * k0 + 2) ** 3 / 2
    camera.position.lerpVectors(tween.from, tween.to, k); controls.target.lerpVectors(tween.fromT, tween.toT, k)
    if (k0 === 1) tween = null
  } else if (animate && !focused && time - lastInteraction > 9000) {
    // Vista d'insieme: la camera ondeggia piano, come uno sguardo che gira sul campus.
    const az = controls.getAzimuthalAngle(), wanted = 0.27 + Math.sin(t * 0.07) * 0.32
    const offset = camera.position.clone().sub(controls.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (wanted - az) * 0.01)
    camera.position.copy(controls.target).add(offset)
  }
  controls.update()
  if (animate) step(t, dt)
  for (const p of pavilions) {
    const on = focused === p.id, hov = hovered === p.id
    p.ring.material.opacity = on ? 0.55 + Math.sin(t * 3) * 0.25 * (animate ? 1 : 0) : hov ? 0.4 : 0
  }
  if (kiosk) kiosk.g.scale.setScalar(hovered === 'kiosk' ? 1.05 : 1)
  renderer.render(scene, camera); labels.render(scene, camera); dirty = false
}
function step(t, dt) {
  for (const rec of persons) stepPerson(rec, t, dt)
  for (const s of screens) {
    if (s.status === 'running') s.mat.color.setHSL(0.38, 0.6, 0.42 + Math.sin(t * 6 + s.phase) * 0.06 + (Math.sin(t * 23 + s.phase) > 0.92 ? 0.12 : 0))
    else if (s.status === 'ready') s.mat.color.set('#4d7fd1')
    else if (s.status === 'attention') s.mat.color.setHSL(0.09, 0.85, 0.5 + Math.sin(t * 4 + s.phase) * 0.08)
    else s.mat.color.set('#141a26')
  }
  for (const s of spinners) {
    if (s.kind === 'spinY') { s.o.rotation.y = t * s.speed; if (s.bob) s.o.position.y += Math.sin(t * 2) * s.bob * 0.02 }
    else if (s.kind === 'spinZ') s.o.rotation.z = t * s.speed
    else if (s.kind === 'sweep') s.o.rotation.y = Math.sin(t * s.speed) * (s.range || 1.1)
    else if (s.kind === 'blink') s.o.visible = Math.sin(t * 4) > -0.2
    else if (s.kind === 'bar') s.o.scale.y = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.8 + s.phase))
    else if (s.kind === 'ceo') {
      // Il CEO parla con il Direttore: ogni tanto indica e compare il fumetto.
      const talking = Math.sin(t * 0.45) > 0.35
      s.talk.visible = talking
      s.talk.position.y = 1.85 + Math.sin(t * 2) * 0.03
      s.parts.shR.rotation.set(talking ? -1.5 + Math.sin(t * 3) * 0.15 : -1.15, 0, talking ? 0.2 : -0.12)
      s.parts.head.rotation.y = Math.sin(t * 0.6) * 0.25
    }
    else if (s.kind === 'lift') { const f = (Math.sin(t * 0.35) + 1) / 2; s.o.position.y = s.low + (s.high - s.low) * (f * f * (3 - 2 * f)) }
    else if (s.kind === 'rise') {
      const f = (t * 0.28 + s.phase) % 1
      s.o.position.set(s.base.x + Math.sin(f * 9 + s.phase * 6) * 0.25, s.base.y + f * 2.2, s.base.z)
      s.o.material.opacity = f < 0.15 ? f / 0.15 : 1 - f
      s.o.scale.setScalar(0.22 + f * 0.22)
    }
  }
  for (const f of flags) {
    const pos = f.mesh.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = f.base[i * 3], y = f.base[i * 3 + 1]
      pos.setZ(i, Math.sin(x * 4 - t * 5) * 0.12 * (x / 1.3) + Math.sin(y * 3 + t * 3) * 0.02 * (x / 1.3))
    }
    pos.needsUpdate = true; f.mesh.geometry.computeVertexNormals()
    f.icon.position.z = Math.sin(0.6 * 4 - t * 5) * 0.12 * (0.6 / 1.3) + 0.012
  }
  for (const tr of trees) { tr.g.rotation.z = Math.sin(t * 0.9 + tr.phase) * tr.amp; tr.g.rotation.x = Math.cos(t * 0.7 + tr.phase) * tr.amp * 0.6 }
  if (fountain) {
    const pos = fountain.drops.geometry.attributes.position
    for (let i = 0; i < fountain.seeds.length; i++) {
      const s = fountain.seeds[i], f = (t * 0.55 + s) % 1, a = s * 47.1, rr = 0.15 + f * 1.0
      pos.setXYZ(i, Math.cos(a) * rr, 1.25 + f * 1.4 - f * f * 2.3, Math.sin(a) * rr)
    }
    pos.needsUpdate = true
    fountain.ripples.forEach((rr, k) => { const f = (t * 0.35 + k / 3) % 1; rr.scale.setScalar(1 + f * 3.4); rr.material.opacity = 0.55 * (1 - f) })
    fountain.icon.rotation.y = t * 0.6
  }
  if (kiosk) kiosk.envelopes.forEach((e, k) => {
    const a = t * 0.8 + k / 6 * Math.PI * 2
    e.position.set(Math.cos(a) * 0.85, 2.15 + Math.sin(t * 1.6 + k) * 0.12, Math.sin(a) * 0.85)
  })
  for (const c of clouds) { c.g.position.x += c.speed * dt; if (c.g.position.x > 55) c.g.position.x = -55 }
  for (const b of gulls) {
    const a = t * b.speed + b.phase
    b.g.position.set(bounds.center.x + Math.cos(a) * b.radius, b.h + Math.sin(t * 0.5 + b.phase) * 0.8, bounds.center.z - 4 + Math.sin(a) * b.radius * 0.6)
    b.g.rotation.y = -a + Math.PI
    const flap = Math.sin(t * 7 + b.phase) * 0.55
    b.l.rotation.z = flap; b.r.rotation.z = -flap
  }
  // Ogni agente in corso manda il lavoro verso "Aspetta te".
  for (const rec of persons) if (rec.agent.status === 'running') {
    rec.nextPacket = (rec.nextPacket ?? rec.phase % 2) - dt
    if (rec.nextPacket <= 0) { spawnPacket(rec); rec.nextPacket = 1.6 + Math.random() * 1.6 }
  }
  packets = packets.filter((p) => {
    p.t += dt / p.dur
    if (p.t >= 1) { scene.remove(p.m); return false }
    p.m.position.copy(p.curve.getPoint(p.t))
    return true
  })
}

/* ---------- pannello ---------- */
function departmentRows() {
  return snapshot.departments.map((sector, i) => {
    const working = sector.agents.filter((a) => a.status === 'running').length
    const enabled = sector.agents.filter((a) => a.enabled).length
    return `<li><button type="button" class="sector" data-dept="${esc(sector.id)}" aria-pressed="${focused === sector.id}"><span class="sector-top"><i class="swatch" style="--c:${sector.color}"></i><strong>${esc(sector.name)}</strong><em>${String(i + 1).padStart(2, '0')}</em></span><small>${sector.agents.length ? `${enabled}/${sector.agents.length} accesi${working ? ` · ${working} in corso` : ''}` : 'Nessun agente installato'}</small></button></li>`
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
  let html = sector ? `<button type="button" class="back" data-back>← Tutto il campus</button><p class="eyebrow">${sector.id === 'direzione' ? 'Sede Speaqi · ultimo piano' : `Padiglione ${String(snapshot.departments.indexOf(sector) + 1).padStart(2, '0')}`}</p><h2>${esc(sector.name)}</h2><p>${roster.length} ${roster.length === 1 ? 'agente installato' : 'agenti installati'} · ${roster.filter((a) => a.enabled).length} ${roster.filter((a) => a.enabled).length === 1 ? 'acceso' : 'accesi'}</p>`
    : `<p class="eyebrow">Il tuo workspace</p><h2>Il lavoro, a colpo d’occhio.</h2><p>Tocca un padiglione per avvicinarti: il resto del campus resta lì.</p><div class="metrics"><div class="metric"><span>Agenti accesi</span><strong>${agents.filter((a) => a.enabled).length}<small>su ${agents.length} installati</small></strong></div><div class="metric"><span>Da decidere</span><strong>${snapshot.pendingCount}</strong><small>proposte in attesa</small></div></div>`
  if (dataError) html += `<div class="notice" role="alert">${esc(dataError)}<br>I dati mostrati sono dell’ultimo aggiornamento riuscito.</div>`
  html += budgetHTML(roster)
  if (!sector) html += `<section class="section"><h3>Reparti / ${String(snapshot.departments.length).padStart(2, '0')}</h3><ul class="list">${departmentRows()}</ul></section>`
  else html += `<section class="section"><h3>La squadra</h3><ul class="list">${roster.length ? roster.map((agent) => `<li><div class="agent" data-agent-card="${esc(agent.id)}"><button type="button" class="sector" data-agent="${esc(agent.id)}" aria-expanded="${selected === agent.id}"><span class="agent-top"><i class="swatch" style="--c:${STATE_COLOR[agent.status]}"></i><strong>${esc(agent.name)}</strong><span class="status ${agent.status}">${STATE[agent.status]}</span></span><small>${esc(agent.lastRun?.summary || 'Nessuna corsa registrata.')}</small></button>${selected === agent.id ? `<div class="agent-detail"><p>${esc(agent.description)}</p><p>${esc(agent.model)}<br>${agent.lastRun ? `${esc(agent.lastRun.label)} · ${date(agent.lastRun.startedAt)}` : 'Nessuna corsa registrata.'}</p><p>${euro(agent.spend.month_actual)} spesi · ${euro(agent.spend.month_reserved)} prenotati</p><button type="button" class="ghost" data-open-agent="${esc(agent.id)}">Apri impostazioni e storico ↗</button></div>` : ''}</div></li>`).join('') : '<li class="empty">Questo padiglione è pronto ad accogliere nuovi agenti.</li>'}</ul></section>`
  html += `<section class="section"><h3>Aspetta te${sector ? '' : ` / ${snapshot.pendingCount}`}</h3><ul class="list">${queue.length ? queue.slice(0, 5).map((o) => `<li><button type="button" class="output" data-output="${esc(o.id)}"><strong>${esc(o.title)}</strong><small>${esc(agents.find((a) => a.id === o.agentId)?.name || o.agentId)} · Apri e valuta ↗</small></button></li>`).join('') : '<li class="empty">Nessuna proposta in questa vista.</li>'}</ul>${!sector && snapshot.pendingCount > 5 ? '<button type="button" class="ghost full" data-manage>Vedi tutte le proposte ↗</button>' : ''}${sector ? '<p class="fine">Proposte della prima pagina della coda. Apri agenti e bozze per consultarle tutte.</p>' : ''}</section>`
  if (!sector) html += `<section class="section"><h3>Attività recenti</h3>${snapshot.runs.length ? snapshot.runs.slice(0, 3).map((r) => `<div class="run"><strong>${esc(agents.find((a) => a.id === r.agentId)?.name || r.agentId)}</strong>${esc(r.summary || r.label)}<br><time>${date(r.startedAt)} · ${esc(r.label)}</time></div>`).join('') : '<p>Nessuna corsa registrata.</p>'}</section>`
  html += `<p class="fine section">Dati CRM · ${date(snapshot.updatedAt)} (Roma). Aggiornamento ogni 30 secondi. “Acceso” indica che l’agente è abilitato; “In corso” indica una corsa registrata. Nel campus chi lavora scrive al computer, chi è disponibile va a prendere un caffè, chi è spento dorme alla scrivania.</p><button type="button" class="ghost full" data-refresh>Aggiorna dati</button>`
  const scroll = $('panel').scrollTop
  $('panel').innerHTML = html
  $('panel').scrollTop = scroll
}
$('panel').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return
  if (button.hasAttribute('data-dept')) { $('panel').scrollTop = 0; focusDepartment(button.dataset.dept) }
  else if (button.hasAttribute('data-back')) { $('panel').scrollTop = 0; focusDepartment(null) }
  else if (button.hasAttribute('data-agent')) {
    selected = selected === button.dataset.agent ? null : button.dataset.agent
    updateFocus(); renderPanel(); moveCamera()
    $('panel').querySelector(`[data-agent="${CSS.escape(button.dataset.agent)}"]`)?.focus({ preventScroll: true })
  }
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
    if (focused && !snapshot.departments.some((d) => d.id === focused)) { focused = null; selected = null }
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
window.addEventListener('pagehide', () => { renderer?.setAnimationLoop(null); controls?.dispose(); resizeObserver?.disconnect(); disposeRoot(); renderer?.dispose() }, { once: true })
