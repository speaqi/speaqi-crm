import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import LOGO_WHITE from '../../public/deck/logo-on-color.png'
import LOGO_NAVY from '../../public/deck/logo.png'
import FONT_DISPLAY from '../../public/deck/heuvel-grotesk-regular.woff2'
import FONT_500 from '../../public/deck/inter-latin-500-normal.woff2'
import FONT_700 from '../../public/deck/inter-latin-700-normal.woff2'

// Il kit dell'ufficio: materiali, geometrie, icone e texture condivise da stanza, zone e persone.
// Tutto ciò che nasce qui è condiviso fra una ricostruzione e l'altra e non si libera (userData.shared).

export const BRAND = { navy: '#1f2e45', ink: '#16192e', blue: '#4f6ef7', orange: '#ff5a1f', cream: '#f4efe4' }
export const PAL = {
  floor: '#e9dfd0', wall: '#f3ece1', stone: '#ddd0bb', stoneDark: '#bfae94', oak: '#d9bb8e', oakDark: '#b98f5e', walnut: '#70503a',
  bronze: '#3a2e26', metal: '#2a303c', white: '#f8f5ef', linen: '#efe6d8', sage: '#8f9f7b', leaf: '#6f8f5a', leafDark: '#4f7048',
  olive: '#8c9a6e', lavender: '#9d8ad0', teal: '#3fb4c2', led: '#ffd49a', warm: '#ffc27a',
}
/** Scala delle persone e delle loro postazioni: più grandi del vero, come le figure di un plastico, perché si leggano da lontano. */
export const U = 1.2
export const STATE_COLOR = { running: '#43d18a', ready: '#7fb4ff', attention: '#ffb547', off: '#8492a0' }
export const FONT = { ui: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', display: '"Heuvel Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif' }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const short = (text, max) => { const v = String(text ?? '').replace(/\s+/g, ' ').trim(); return v.length > max ? `${v.slice(0, max - 1)}…` : v }
export const hashId = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
export const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
export const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }
export const mix = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k)

/* ---------- font incorporati: le insegne non dipendono dal computer di chi guarda ---------- */
export function loadFonts() {
  if (typeof FontFace === 'undefined' || !document.fonts) return Promise.resolve()
  const faces = [new FontFace('Heuvel Grotesk', `url(${FONT_DISPLAY})`, { weight: '400' }),
    new FontFace('Inter', `url(${FONT_500})`, { weight: '500' }), new FontFace('Inter', `url(${FONT_700})`, { weight: '700' })]
  const all = Promise.all(faces.map((face) => face.load().then((loaded) => { document.fonts.add(loaded) }).catch(() => null)))
  return Promise.race([all, new Promise((done) => setTimeout(done, 2500))])
}

/* ---------- materiali ---------- */
const mats = new Map(), glows = new Map(), pools = []
let envLevel = 1, glowLevel = 1
export function std(color, o = {}) {
  const key = (typeof color === 'string' ? color : '#' + color.getHexString()) + JSON.stringify(o)
  let m = mats.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...o })
    m.userData.shared = true; m.userData.env = o.envMapIntensity ?? 1; m.envMapIntensity = m.userData.env * envLevel
    mats.set(key, m)
  }
  return m
}
/** Un materiale non condiviso che segue comunque giorno e sera (riflessi dell'ambiente). */
export function track(material) { material.userData.env = material.envMapIntensity ?? 1; material.envMapIntensity = material.userData.env * envLevel; mats.set(Symbol('m'), material); return material }
export function untrack(material) { for (const [key, m] of mats) if (m === material) mats.delete(key) }
/** Luce propria (LED, schermi, neon): con la sera si accende di più e il bloom la fa brillare. */
export function glow(color, power = 1, o = {}) {
  const key = color + '|' + power + JSON.stringify(o)
  let m = glows.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, ...o })
    m.userData = { shared: true, glow: { color: new THREE.Color(color), power, fixed: !!o.fixed } }
    m.color.multiplyScalar(power * (m.userData.glow.fixed ? 1 : glowLevel))
    glows.set(key, m)
  }
  return m
}
export function setLevels({ env, glow: g, pool }) {
  envLevel = env; glowLevel = g
  for (const m of mats.values()) m.envMapIntensity = (m.userData.env ?? 1) * env
  for (const m of glows.values()) m.color.copy(m.userData.glow.color).multiplyScalar(m.userData.glow.power * (m.userData.glow.fixed ? 1 : g))
  for (const p of pools) p.material.opacity = Math.min(1, p.power * pool)
}

/* ---------- geometrie in cache ---------- */
const geos = new Map()
const gk = (...n) => n.map((v) => typeof v === 'number' ? Math.round(v * 1000) : v).join('|')
export function geo(key, make) { let g = geos.get(key); if (!g) { g = make(); g.userData.shared = true; geos.set(key, g) } return g }
export function mesh(geometry, material, parent, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, typeof material === 'string' ? std(material) : material); m.position.set(x, y, z)
  if (shadow) { m.castShadow = true; m.receiveShadow = true }
  if (parent) parent.add(m)
  return m
}
export const box = (parent, w, h, d, x, y, z, material, shadow = true) => mesh(geo('b' + gk(w, h, d), () => new THREE.BoxGeometry(w, h, d)), material, parent, x, y, z, shadow)
export const rbox = (parent, w, h, d, r, x, y, z, material, shadow = true) =>
  mesh(geo('r' + gk(w, h, d, r), () => new RoundedBoxGeometry(w, h, d, 3, Math.max(0.005, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)))), material, parent, x, y, z, shadow)
export const cyl = (parent, rt, rb, h, x, y, z, material, seg = 20, shadow = true) => mesh(geo('c' + gk(rt, rb, h, seg), () => new THREE.CylinderGeometry(rt, rb, h, seg)), material, parent, x, y, z, shadow)
export const sph = (parent, r, x, y, z, material, ws = 18, hs = 12, shadow = true) => mesh(geo('s' + gk(r, ws, hs), () => new THREE.SphereGeometry(r, ws, hs)), material, parent, x, y, z, shadow)
export const capsule = (parent, r, len, x, y, z, material, shadow = true) => mesh(geo('k' + gk(r, len), () => new THREE.CapsuleGeometry(r, len, 5, 12)), material, parent, x, y, z, shadow)
export const blobGeo = (r, detail = 1) => geo('i' + gk(r, detail), () => new THREE.IcosahedronGeometry(r, detail))
export const planeGeo = (w, h) => geo('p' + gk(w, h), () => new THREE.PlaneGeometry(w, h))

export function rrShape(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  return s
}
/** Una fascia curva vista dall'alto (divani, parapetti, fioriere): raggio interno ed esterno, angoli in radianti. */
export function arcBand(parent, r0, r1, a0, a1, height, x, y, z, material, seg = 28) {
  const s = new THREE.Shape()
  for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * i / seg; s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r1, Math.sin(a) * r1) }
  for (let i = seg; i >= 0; i--) { const a = a0 + (a1 - a0) * i / seg; s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0) }
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 })
  const m = mesh(g, material, parent, x, y, z); m.rotation.x = -Math.PI / 2
  return m
}

/* ---------- texture ---------- */
export function canvasTex(w, h, draw, shared = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  if (shared) t.userData.shared = true
  return t
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}
export const tex = {}
let logoListener = () => {}
export const onLogos = (fn) => { logoListener = fn }
export function loadLogos() {
  for (const [tone, src] of [['white', LOGO_WHITE], ['navy', LOGO_NAVY]]) {
    const full = new THREE.Texture(), icon = new THREE.Texture()
    full.colorSpace = icon.colorSpace = THREE.SRGBColorSpace; full.anisotropy = icon.anisotropy = 8
    full.userData.shared = icon.userData.shared = true
    tex[`full-${tone}`] = full; tex[`icon-${tone}`] = icon
    const img = new Image()
    img.onload = () => {
      full.image = img; full.needsUpdate = true
      // L'icona è la parte sinistra del logo (0-511 px su 2000 x 470).
      const c = document.createElement('canvas'); c.width = 256; c.height = 236
      c.getContext('2d').drawImage(img, 0, 0, 511, 470, 0, 0, 256, 236)
      icon.image = c; icon.needsUpdate = true; logoListener()
    }
    img.src = src
  }
}
export const LOGO_SRC = { white: LOGO_WHITE, navy: LOGO_NAVY }
const logoMats = new Map()
export function logoMat(kind, tone) {
  const key = kind + tone
  if (!logoMats.has(key)) {
    const m = new THREE.MeshBasicMaterial({ map: tex[`${kind}-${tone}`], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    m.userData.shared = true; logoMats.set(key, m)
  }
  return logoMats.get(key)
}

/* ---------- icone: gli stessi tracciati nel 3D (canvas) e nell'interfaccia (SVG) ---------- */
export const ICONS = {
  crown: 'M3 7l4 5 5-7 5 7 4-5-2 12H5z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6zM9 12l2 2 4-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
  building: 'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2',
  cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  news: 'M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2zM17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h5',
  slides: 'M3 4h18M5 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4M12 15v3M8 21l4-3 4 3M9 11l2-2 2 1.5 2-3',
  mail: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 7l10 7 10-7',
  euro: 'M18 6.5A7 7 0 0 0 6.5 12 7 7 0 0 0 18 17.5M3.5 10.5h9M3.5 13.5h9',
  heart: 'M12 20.5S3.5 15 3.5 9A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20.5 9c0 6-8.5 11.5-8.5 11.5z',
  sparkles: 'M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M2 13h20',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  server: 'M4 4h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 13h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zM7 7.5h.01M7 16.5h.01',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14',
  inbox: 'M3 13l3-8h12l3 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 13h5l1.5 3h5L16 13h5',
  coffee: 'M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3',
  moon: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z',
  alert: 'M12 4l9.5 16h-19zM12 10v4.5M12 17.5h.01',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  city: 'M3 21h18M5 21V9l5-3v15M10 21V4l8 4v13M13 10h2M13 14h2M13 18h2M7 12h.01M7 16h.01',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.5 14a1.6 1.6 0 0 1 2.6-1.8L8 14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
}
export function drawIcon(ctx, name, cx, cy, size, color, lineWidth = 2, fill = false) {
  const d = ICONS[name]; if (!d) return
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24)
  ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color
  const p = new Path2D(d)
  if (fill) { ctx.fillStyle = color; ctx.fill(p) }
  ctx.stroke(p); ctx.restore()
}
export const iconSvg = (name, size = 14) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`

function fitFont(ctx, text, weight, size, family, max) {
  let s = size
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 2 } while (ctx.measureText(text).width > max && s > 20)
}
/** Insegna di una zona, come nel disegno: tassello con l'icona, nome grande, sottotitolo. */
export function plaqueTex(title, subtitle, icon, color) {
  return canvasTex(1024, 288, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#473829'); g.addColorStop(1, '#30251d')
    ctx.fillStyle = g; roundRect(ctx, 0, 0, w, h, 46); ctx.fill()
    ctx.strokeStyle = 'rgba(255,226,180,.28)'; ctx.lineWidth = 4; roundRect(ctx, 5, 5, w - 10, h - 10, 42); ctx.stroke()
    ctx.fillStyle = color; roundRect(ctx, 40, 44, 200, 200, 44); ctx.fill()
    drawIcon(ctx, icon, 140, 144, 124, '#ffffff', 2)
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    try { ctx.letterSpacing = '5px' } catch { /* non ovunque */ }
    ctx.fillStyle = '#f8eedd'; fitFont(ctx, title, 400, 112, FONT.display, 700); ctx.fillText(title, 280, 116)
    try { ctx.letterSpacing = '1px' } catch { /* non ovunque */ }
    ctx.fillStyle = '#dcc49c'; fitFont(ctx, subtitle, 500, 52, FONT.ui, 700); ctx.fillText(subtitle, 284, 208)
  })
}
/** Distintivo tondo con un'icona (stato sopra la testa, oggetti cliccabili). */
export function badgeTex(icon, color, ink = '#ffffff') {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = 'rgba(12,18,30,.28)'; ctx.beginPath(); ctx.arc(64, 68, 54, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(64, 62, 52, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(64, 62, 49, 0, Math.PI * 2); ctx.stroke()
    drawIcon(ctx, icon, 64, 62, 62, ink, 2.6)
  }, true)
}
const radial = (stops) => canvasTex(128, 128, (ctx) => {
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, color] of stops) g.addColorStop(at, color)
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
}, true)
let blobTex, poolTex, sparkTex
export const softTex = () => blobTex || (blobTex = radial([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]))
export const sparkleTex = () => sparkTex || (sparkTex = radial([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]))
const blobMats = new Map()
/** Ombra di contatto: una macchia morbida sotto mobili e persone, che ancora le cose al pavimento. */
export function blob(parent, w, d, x, z, alpha = 0.3, y = 0.012) {
  const key = String(alpha)
  if (!blobMats.has(key)) { const m = new THREE.MeshBasicMaterial({ map: softTex(), color: '#3a2412', transparent: true, opacity: alpha, depthWrite: false }); m.userData.shared = true; blobMats.set(key, m) }
  const p = mesh(planeGeo(1, 1), blobMats.get(key), parent, x, y, z, false)
  p.rotation.x = -Math.PI / 2; p.scale.set(w, d, 1); p.renderOrder = 1
  return p
}
/** Luce che cade sul pavimento sotto una striscia LED: di sera è lei a fare l'atmosfera. */
export function lightPool(parent, w, d, x, z, color = PAL.warm, power = 0.4, y = 0.016) {
  if (!poolTex) poolTex = radial([[0, 'rgba(255,255,255,.95)'], [0.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']])
  const material = new THREE.MeshBasicMaterial({ map: poolTex, color, transparent: true, opacity: power, depthWrite: false, blending: THREE.AdditiveBlending })
  const p = mesh(planeGeo(1, 1), material, parent, x, y, z, false)
  p.rotation.x = -Math.PI / 2; p.scale.set(w, d, 1); p.renderOrder = 2
  const entry = { material, power }; pools.push(entry); p.userData.pool = entry
  return p
}
export function dropPool(entry) { const i = pools.indexOf(entry); if (i >= 0) pools.splice(i, 1) }
/** Striscia LED calda: una barretta luminosa più la sua luce sul pavimento. */
export function ledStrip(parent, w, x, y, z, { color = PAL.led, power = 2.2, depth = 0.03, pool = 0, poolDepth = 1.3, poolZ = 0.5, vertical = false } = {}) {
  const m = vertical ? box(parent, 0.03, w, depth, x, y, z, glow(color, power), false) : box(parent, w, 0.03, depth, x, y, z, glow(color, power), false)
  if (pool) lightPool(parent, w * 1.05, poolDepth, x, z + poolZ, color, pool)
  return m
}
