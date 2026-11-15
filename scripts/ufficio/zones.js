import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { PAL, BRAND, STATE_COLOR, FONT, U, std, glow, track, box, rbox, cyl, sph, mesh, geo, planeGeo, rrShape, canvasTex, plaqueTex, badgeTex, drawIcon, roundRect, softTex, blob, lightPool, ledStrip, logoMat, tex, mix, hashId, short, esc } from './kit.js'
import { ROOM, DECK, LAB, LOUNGE, POOL, potPlant, planter, olive } from './room.js'
import { makePerson, poseStand, applyState, bubble } from './people.js'
import { zoneOf, roleOf } from './catalog.js'

// Le zone dei reparti e gli oggetti "vivi" dell'ufficio. Ogni zona è una fila di postazioni con la sua insegna;
// ogni postazione dice lo stato dell'agente (luce sul monitor, alone a terra, schermo) e ogni oggetto mostra un dato vero.

const PHASES = ['Luoghi', 'Testi', 'Temi', 'Presentazione', 'Itinerari', 'Controlli', 'Su Speaqi', 'Online']
const PHASE_COLOR = { d: '#43d18a', p: '#ffb547', t: '#3a4656' }
const euro = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n / 100)
const when = (value) => new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const V = (x, y, z) => new THREE.Vector3(x, y, z)

/** Dove sta ogni reparto. `cols` è il massimo di postazioni per fila; le file crescono verso chi guarda. */
const SLOTS = {
  direzione: { kind: 'deck' },
  mappe: { kind: 'wall', x: -10.2, z: -8.5, cols: 4 },
  sviluppo: { kind: 'lab', x: 11.45, z: -8.7, cols: 3 },
  marketing: { kind: 'pod', x: -10.6, z: -2.6, cols: 3 },
  ricerca: { kind: 'pod', x: 1.8, z: -4.4, cols: 3 },
  commerciale: { kind: 'pod', x: 11, z: -3.6, cols: 2 },
  operazioni: { kind: 'pod', x: -10.6, z: 3.0, cols: 3 },
  finanza: { kind: 'pod', x: 10.6, z: 2.2, cols: 3 },
}
const PITCH = 2.15, ROW = 2.6, SEAT = 0.68 * U
const HALL = V(LOUNGE.x, 0, LOUNGE.z + 2.7)

export function label(el, parent, x, y, z) { const o = new CSS2DObject(el); o.position.set(x, y, z); parent.add(o); return o }
const pickable = (W, object, data) => object.traverse((o) => { if (o.isMesh && !o.userData.pick) { o.userData.pick = data; W.pick.push(o) } })

/* ---------- schermi delle postazioni ---------- */
function drawScreen(st, t = 0) {
  const ctx = st.screen.ctx, w = 256, h = 152, agent = st.agent, status = agent ? agent.status : 'empty', role = st.role
  if (status === 'off' || status === 'empty') { ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 0, w, h) }
  else if (status === 'attention') {
    ctx.fillStyle = '#3b2606'; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#ffb547'; ctx.fillRect(0, 0, w, 10)
    drawIcon(ctx, agent.blocked ? 'hand' : 'alert', w / 2, h / 2 + 6, 92, '#ffc566', 2)
  } else if (status === 'ready') {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1c2c4c'); g.addColorStop(1, '#274a7e')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    drawIcon(ctx, role.icon, w / 2, h / 2, 78, 'rgba(190,220,255,.92)', 1.9)
  } else {
    ctx.fillStyle = '#081a14'; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#0f2b20'; ctx.fillRect(0, 0, w, 26)
    drawIcon(ctx, role.icon, 18, 13, 18, '#7af0b0', 2.2)
    ctx.fillStyle = '#43d18a'; ctx.fillRect(w - 16 - 60 * (0.5 + 0.5 * Math.sin(t * 2)), 9, 60 * (0.5 + 0.5 * Math.sin(t * 2)), 8)
    if (role.screen === 'map') {
      ctx.strokeStyle = 'rgba(120,240,176,.22)'; ctx.lineWidth = 2
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * 43, 30); ctx.lineTo(i * 43 - 14, h); ctx.stroke() }
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, 30 + i * 30); ctx.lineTo(w, 22 + i * 30); ctx.stroke() }
      ctx.strokeStyle = '#ff8a4d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(26, 126); ctx.bezierCurveTo(70, 60, 120, 140, 170, 76); ctx.lineTo(228, 56); ctx.stroke()
      const pins = [[26, 126], [84, 92], [132, 108], [170, 76], [228, 56]], n = 1 + Math.floor(t * 0.8) % 5
      pins.slice(0, n).forEach(([x, y], i) => drawIcon(ctx, 'pin', x, y - 12, i === n - 1 ? 34 : 26, i === n - 1 ? '#ffffff' : '#7af0b0', 2.4))
    } else if (role.screen === 'wave') {
      for (let i = 0; i < 30; i++) {
        const a = 10 + (0.5 + 0.5 * Math.sin(t * 5 + i * 0.8)) * (26 + 22 * Math.sin(i * 0.5 + t * 1.3) ** 2)
        ctx.fillStyle = i % 3 ? '#43d18a' : '#7af0b0'; ctx.fillRect(12 + i * 8, 90 - a, 5, a * 2)
      }
    } else if (role.screen === 'bars') {
      for (let i = 0; i < 8; i++) { const a = 24 + (0.5 + 0.5 * Math.sin(t * 1.4 + i * 1.1)) * 76; ctx.fillStyle = i % 2 ? '#7af0b0' : '#43d18a'; ctx.fillRect(18 + i * 28, h - 14 - a, 18, a) }
    } else if (role.screen === 'slides') {
      ctx.fillStyle = '#12382a'; roundRect(ctx, 14, 36, 150, 100, 8); ctx.fill()
      ctx.fillStyle = '#7af0b0'; ctx.fillRect(26, 50, 84 + 30 * Math.sin(t), 10)
      ctx.fillStyle = '#2f8f62'; for (let i = 0; i < 3; i++) ctx.fillRect(26, 72 + i * 16, 110 - i * 22, 7)
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i === Math.floor(t * 0.7) % 3 ? '#43d18a' : '#12382a'; roundRect(ctx, 176, 36 + i * 35, 66, 29, 5); ctx.fill() }
    } else {
      const rows = 6, typed = (t * 2.2) % (rows + 1)
      for (let i = 0; i < rows; i++) {
        const full = 70 + ((i * 53) % 130), len = i < Math.floor(typed) ? full : i === Math.floor(typed) ? full * (typed % 1) : 0
        ctx.fillStyle = i % 4 === 0 ? '#7af0b0' : '#2f8f62'; ctx.fillRect(16, 40 + i * 17, len, 8)
        if (i === Math.floor(typed) && Math.sin(t * 9) > 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(18 + len, 38 + i * 17, 5, 12) }
      }
    }
  }
  st.screen.texture.needsUpdate = true
}

/* ---------- postazione ---------- */
function chair(parent, x, z, yaw, color = '#59606e') {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = yaw; parent.add(c)
  const fabric = std(color, { roughness: 0.95 }), metal = std('#c9cdd4', { roughness: 0.35, metalness: 0.7 })
  rbox(c, 0.5, 0.09, 0.48, 0.04, 0, 0.45, 0, fabric)
  const back = rbox(c, 0.46, 0.5, 0.08, 0.04, 0, 0.8, 0.24, fabric); back.rotation.x = -0.1
  cyl(c, 0.03, 0.03, 0.34, 0, 0.26, 0, metal, 8)
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, leg = box(c, 0.05, 0.035, 0.3, Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15, metal); leg.rotation.y = a }
  return c
}
/** f = +1: la persona siede verso chi guarda e lavora rivolta al fondo (lo schermo si vede). f = -1: guarda la sala (Direttore). */
function station(W, g, sector, agent, x, z, f, { exec = false } = {}) {
  const d = new THREE.Group(); d.position.set(x, 0, z); d.scale.setScalar(U); g.add(d)
  const role = agent ? roleOf(agent, sector) : { icon: 'users', screen: 'lines' }
  const w = exec ? 2.2 : 1.52, dp = exec ? 0.86 : 0.72
  rbox(d, w, 0.05, dp, 0.02, 0, 0.735, 0, std(exec ? PAL.walnut : PAL.oak, { roughness: 0.5 }))
  if (exec) { box(d, w - 0.1, 0.62, 0.04, 0, 0.4, 0.34, std(PAL.walnut, { roughness: 0.6 })); for (const sx of [-1, 1]) box(d, 0.05, 0.71, dp - 0.08, sx * (w / 2 - 0.05), 0.355, 0, std(PAL.walnut, { roughness: 0.6 })) }
  else for (const sx of [-1, 1]) { box(d, 0.05, 0.71, 0.05, sx * (w / 2 - 0.08), 0.355, -0.28, PAL.white); box(d, 0.05, 0.71, 0.05, sx * (w / 2 - 0.08), 0.355, 0.28, PAL.white); box(d, 0.04, 0.04, 0.56, sx * (w / 2 - 0.08), 0.69, 0, PAL.white) }
  blob(d, w + 0.7, dp + 1.7, 0, f * 0.4, 0.26)
  // Schermo: racconta cosa fa l'agente. Il bordo luminoso in alto è il suo stato, leggibile da lontano.
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 152
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
  const screenMat = new THREE.MeshBasicMaterial({ map: texture }); screenMat.color.setScalar(1.15)
  const ledMat = new THREE.MeshBasicMaterial({ color: '#333a48' })
  const mz = -f * 0.22, dark = std('#1c1f29', { roughness: 0.45, metalness: 0.3 })
  if (exec) {
    // Portatile: lo schermo guarda il Direttore, dalla sala si vede il coperchio con il logo.
    rbox(d, 0.4, 0.02, 0.27, 0.01, 0, 0.77, -0.04, std('#c9cdd4', { roughness: 0.35, metalness: 0.7 }))
    const lid = rbox(d, 0.4, 0.27, 0.015, 0.006, 0, 0.9, 0.11, std('#c9cdd4', { roughness: 0.35, metalness: 0.7 })); lid.rotation.x = 0.28
    const scr = mesh(planeGeo(0.36, 0.23), screenMat, d, 0, 0.9, 0.1, false); scr.rotation.set(0.28, Math.PI, 0)
    const ic = mesh(planeGeo(0.1, 0.092), logoMat('icon', 'navy'), d, 0, 0.9, 0.121, false); ic.rotation.x = 0.28
    box(d, w - 0.3, 0.035, 0.03, 0, 0.72, dp / 2 + 0.012, ledMat, false)
    cyl(d, 0.045, 0.04, 0.09, -0.7, 0.805, 0.1, std('#ffffff', { roughness: 0.4 }), 12)
    box(d, 0.34, 0.012, 0.24, 0.62, 0.767, 0.02, std('#f4efe4'))
  } else {
    rbox(d, 0.26, 0.02, 0.18, 0.008, 0, 0.77, mz, dark); cyl(d, 0.022, 0.022, 0.2, 0, 0.87, mz, dark, 8)
    rbox(d, 0.78, 0.48, 0.035, 0.012, 0, 1.13, mz, dark)
    const scr = mesh(planeGeo(0.72, 0.42), screenMat, d, 0, 1.13, mz + f * 0.019, false); if (f < 0) scr.rotation.y = Math.PI
    box(d, 0.78, 0.035, 0.05, 0, 1.39, mz, ledMat, false)
    rbox(d, 0.42, 0.018, 0.14, 0.006, -0.03, 0.769, f * 0.15, std('#e9e6df', { roughness: 0.6 }))
    rbox(d, 0.06, 0.02, 0.1, 0.008, 0.32, 0.77, f * 0.16, std('#e9e6df', { roughness: 0.6 }))
    const seed = agent ? hashId(agent.id) : 7
    if (seed % 2) cyl(d, 0.04, 0.035, 0.09, -0.56, 0.805, f * 0.06, std(seed % 4 === 1 ? BRAND.orange : '#ffffff', { roughness: 0.4 }), 12)
    else { cyl(d, 0.06, 0.05, 0.09, -0.58, 0.805, -f * 0.12, PAL.stone, 10); for (let k = 0; k < 4; k++) { const leaf = sph(d, 0.07, -0.58 + Math.cos(k * 1.6) * 0.04, 0.9 + k * 0.03, -f * 0.12 + Math.sin(k * 1.6) * 0.04, std(PAL.leaf, { flatShading: true }), 7, 5); leaf.scale.set(0.7, 1.2, 0.5); leaf.rotation.y = k } }
    // Il cartellino con l'icona del ruolo, sulla scrivania.
    if (agent) { const card = mesh(planeGeo(0.2, 0.2), new THREE.MeshBasicMaterial({ map: badgeTex(role.icon, sector.color), transparent: true, depthWrite: false }), d, 0.6, 0.875, f * 0.2, false); card.renderOrder = 3 }
  }
  const sx = x, sz = z + f * SEAT
  const seat = chair(g, sx, sz, f > 0 ? 0 : Math.PI, exec ? '#2b3140' : '#5b6270'); seat.scale.setScalar(U)
  // Alone a terra del colore dello stato: verde chi lavora, ambra chi aspetta te.
  const haloMat = new THREE.MeshBasicMaterial({ map: softTex(), color: '#000000', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const halo = mesh(planeGeo(1, 1), haloMat, g, sx, 0.02, sz, false); halo.rotation.x = -Math.PI / 2; halo.scale.set(2.5 * U, 2.5 * U, 1); halo.renderOrder = 2
  const st = { group: d, agent, role, screen: { canvas, ctx: canvas.getContext('2d'), texture, mat: screenMat }, ledMat, haloMat, chair: seat, chairYaw: seat.rotation.y,
    seat: V(g.position.x + sx, g.position.y, g.position.z + sz), yaw: f > 0 ? Math.PI : 0, f, phase: Math.random() * 6 }
  drawScreen(st)
  W.stations.push(st)
  return st
}
function seatAgent(W, zone, g, sector, agent, i, x, z, f, opts) {
  const st = station(W, g, sector, agent, x, z, f, opts)
  const role = st.role
  const { group: person, parts } = makePerson(agent.id, { headphones: role.headphones, glasses: role.glasses, cap: hashId(agent.id) % 5 === 0 ? [BRAND.navy, BRAND.orange, '#ffffff'][hashId(agent.id) % 3] : null })
  W.root.add(person)
  const shadow = blob(person, 0.8, 0.8, 0, 0, 0.26, 0.015)
  const rec = { agent, sector, zone, person, parts, station: st, role, phase: (hashId(agent.id) % 1000) / 160, mode: 'idle', until: 0, path: [], extras: [], zs: [], badge: null, trip: null, shadow, index: i }
  applyState(rec)
  const el = document.createElement('button'); el.type = 'button'; el.className = 'person-tag'
  el.setAttribute('aria-label', `Apri scheda di ${agent.name}`)
  rec.tag = label(el, person, 0, 2.42, 0)
  pickable(W, person, { agentId: agent.id, deptId: sector.id })
  pickable(W, st.group, { agentId: agent.id, deptId: sector.id }); pickable(W, st.chair, { agentId: agent.id, deptId: sector.id })
  W.persons.push(rec); zone.people.push(rec)
  return rec
}

/* ---------- pezzi comuni delle zone ---------- */
function plaque(parent, sector, x, y, z, width = 2.7) {
  const zone = zoneOf(sector), h = width * 288 / 1024
  rbox(parent, width + 0.08, h + 0.08, 0.07, 0.03, x, y, z - 0.04, std(PAL.bronze, { roughness: 0.6 }))
  const face = mesh(planeGeo(width, h), new THREE.MeshBasicMaterial({ map: plaqueTex(zone.title, sector.name, zone.icon, sector.color) }), parent, x, y, z + 0.002, false)
  face.material.color.setScalar(1.05)
  ledStrip(parent, width - 0.3, x, y - h / 2 - 0.06, z - 0.02, { power: 2.6 })
  return face
}
function zoneRing(parent, w, d, x, z, color, y = 0.024) {
  const shape = rrShape(w + 0.5, d + 0.5, 0.5); shape.holes.push(rrShape(w + 0.14, d + 0.14, 0.36))
  const m = mesh(new THREE.ShapeGeometry(shape, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }), parent, x, y, z, false)
  m.material.color.multiplyScalar(1.6); m.rotation.x = -Math.PI / 2; m.renderOrder = 3
  return m
}
function rug(W, parent, w, d, x, z, color, deptId, y = 0.014) {
  const m = mesh(new THREE.ShapeGeometry(rrShape(w, d, 0.32), 6), std(mix(color, '#efe6d6', 0.52), { roughness: 1 }), parent, x, y, z, false)
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true
  m.userData.pick = { deptId }; W.pick.push(m)
  return m
}
function woodPlanter(W, parent, x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g)
  rbox(g, 0.62 * s, 0.74, 0.62 * s, 0.03, 0, 0.37, 0, std(PAL.oakDark, { roughness: 0.75 }))
  for (let k = 0; k < 5; k++) box(g, 0.64 * s, 0.02, 0.64 * s, 0, 0.12 + k * 0.13, 0, std('#8f6a44', { roughness: 0.8 }), false)
  for (let k = 0; k < 6; k++) {
    const a = k * 1.9, leaf = sph(g, 0.24, Math.cos(a) * 0.1, 0.95 + (k % 3) * 0.16, Math.sin(a) * 0.1, std(k % 2 ? '#6f9a62' : '#4f7d4f', { flatShading: true, roughness: 0.9 }), 8, 6)
    leaf.scale.set(0.6, 1.5, 0.34); leaf.rotation.set(0, -a, -0.5 + (k % 2))
  }
  W.sway.push({ g, phase: x + z, amp: 0.012 })
  blob(parent, 1.1 * s, 1.1 * s, x, z, 0.3)
}
function zoneTag(zone, parent, x, y, z) {
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag'
  el.style.setProperty('--c', zone.sector.color)
  el.setAttribute('aria-label', `Apri reparto ${zone.sector.name}`)
  zone.tag = label(el, parent, x, y, z)
}

/* ---------- le zone ---------- */
function layoutRows(n, cols) { const rows = Math.max(1, Math.ceil(n / cols)); return { rows, perRow: (r) => Math.min(cols, n - r * cols) } }
function buildPod(W, sector, slot, kind) {
  const roster = sector.agents.slice(0, 12), n = roster.length, cols = Math.max(1, Math.min(n || (kind === 'lab' ? 2 : 1), slot.cols))
  const { rows } = layoutRows(n || cols, slot.cols)
  const w = cols * PITCH + (kind === 'pod' ? 1.5 : 0.7), d = (rows - 1) * ROW + 2.65
  const g = new THREE.Group(); g.position.set(slot.x, 0, slot.z); W.root.add(g)
  const zone = { id: sector.id, sector, group: g, people: [], kind, slot }
  const deskZ = (row) => (kind === 'pod' ? 0.7 : 0) + row * ROW
  if (kind === 'pod') {
    // Divisorio bianco con il filo di luce alla base, fioriere di legno ai lati e l'insegna in cima.
    rbox(g, w - 1.3, 1.5, 0.16, 0.04, 0, 0.75, 0, std(PAL.white, { roughness: 0.9 }))
    box(g, w - 1.26, 0.04, 0.2, 0, 1.52, 0, std(PAL.oak, { roughness: 0.6 }))
    ledStrip(g, w - 1.4, 0, 0.035, 0.09, { pool: 0.3, poolDepth: 1.2, poolZ: 0.45 }); ledStrip(g, w - 1.4, 0, 0.035, -0.09, { pool: 0.32, poolDepth: 1.5, poolZ: -0.6 })
    for (const sx of [-1, 1]) woodPlanter(W, g, sx * (w / 2 - 0.32), 0)
    // L'insegna poggia sul divisorio: bassa quanto basta per non coprire la zona che le sta dietro.
    const pw = Math.min(2.3, w - 1.2)
    plaque(g, sector, 0, 1.6 + pw * 288 / 1024 / 2, -0.02, pw)
    blob(g, w, 1.1, 0, 0, 0.3)
  }
  const z0 = kind === 'pod' ? 0.25 : -0.62
  rug(W, g, w - 0.25, d + (kind === 'pod' ? 0 : 0.5), 0, z0 + (d + (kind === 'pod' ? 0 : 0.5)) / 2, sector.color, sector.id)
  zone.ring = zoneRing(g, w, d + 0.6, 0, (kind === 'pod' ? -0.2 : -0.75) + (d + 0.6) / 2, sector.color)
  zone.box = { x0: slot.x - w / 2, x1: slot.x + w / 2, z0: slot.z + (kind === 'pod' ? -0.3 : -0.9), z1: slot.z + d + 0.3, y0: 0, y1: 2.4 }
  const seatsX = (row) => { const count = n ? Math.min(slot.cols, n - row * slot.cols) : cols; return (col) => (col - (count - 1) / 2) * PITCH }
  if (!n) for (let c = 0; c < cols; c++) station(W, g, sector, null, seatsX(0)(c), deskZ(0), 1)
  roster.forEach((agent, i) => { const row = Math.floor(i / slot.cols), col = i % slot.cols; seatAgent(W, zone, g, sector, agent, i, seatsX(row)(col), deskZ(row), 1) })
  // Da dove si esce per andare in lounge: a sinistra il corridoio accanto al Deck, a destra quello fra Insight Hub e Deal Room.
  const left = slot.x < LOUNGE.x - 3, gate = V(LOUNGE.x + 4.4, 0, HALL.z)
  zone.routeOut = (rec) => {
    const aisle = rec.station.seat.z + 0.78 * U, start = V(rec.station.seat.x, 0, aisle)
    if (left) return [start, V(-5.55, 0, aisle), ...(aisle < 4.5 ? [V(-5.55, 0, HALL.z)] : []), HALL]
    if (kind === 'lab') return [start, V(LAB.x0 + 1.8, 0, aisle), V(LAB.x0 + 1.8, 0, LAB.z1 + 0.7), V(6.6, 0, LAB.z1 + 0.9), V(6.6, 0, 0.5), gate, HALL]
    const exitX = sector.id === 'ricerca' ? zone.box.x1 + 0.6 : Math.min(zone.box.x0 - 0.6, 6.9)
    return [start, V(exitX, 0, aisle), ...(aisle < 1 ? [V(exitX, 0, 0.5)] : []), gate, HALL]
  }
  zoneTag(zone, g, 0, kind === 'pod' ? 3.2 : 3.2, kind === 'pod' ? 0 : 0.4)
  W.zones.push(zone)
  return zone
}

function wallScreen(parent, w, h, x, y, z, cw, ch) {
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8
  rbox(parent, w + 0.14, h + 0.14, 0.08, 0.03, x, y, z, std('#11141d', { roughness: 0.4, metalness: 0.4 }))
  const m = mesh(planeGeo(w, h), new THREE.MeshBasicMaterial({ map: texture }), parent, x, y, z + 0.045, false); m.material.color.setScalar(1.12)
  return { canvas, ctx: canvas.getContext('2d'), texture, key: '', mesh: m }
}
function buildMapLab(W, sector) {
  const zone = buildPod(W, sector, SLOTS.mappe, 'wall'), root = W.root, wz = ROOM.z0 + 0.05
  plaque(root, sector, -13.65, 2.75, wz, 2.5)
  // Lo schermo grande: le città e le otto fasi, com'è nella sala «Città».
  W.prod = wallScreen(root, 4.3, 1.81, -9.95, 2.0, wz, 1280, 538)
  // La carta del golfo: decorativa.
  const map = wallScreen(root, 2.2, 1.81, -6.42, 2.0, wz, 512, 420)
  const ctx = map.ctx
  ctx.fillStyle = '#bfe6ee'; ctx.fillRect(0, 0, 512, 420)
  ctx.fillStyle = '#e9e2cf'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(512, 0); ctx.lineTo(512, 120); ctx.bezierCurveTo(430, 150, 400, 220, 330, 210); ctx.bezierCurveTo(250, 200, 250, 120, 170, 150); ctx.bezierCurveTo(100, 180, 60, 260, 0, 250); ctx.fill()
  ctx.fillStyle = '#cfe0b8'; ctx.beginPath(); ctx.ellipse(380, 80, 70, 44, 0, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#e9e2cf'; ctx.beginPath(); ctx.ellipse(150, 340, 46, 22, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(420, 350, 60, 20, 0.2, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = BRAND.orange; ctx.lineWidth = 5; ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.moveTo(150, 330); ctx.quadraticCurveTo(230, 250, 250, 170); ctx.stroke(); ctx.setLineDash([])
  for (const [x, y] of [[250, 150], [380, 70], [150, 328], [420, 340], [90, 190], [470, 110]]) drawIcon(ctx, 'pin', x, y - 20, 46, BRAND.navy, 2.6)
  map.texture.needsUpdate = true
  ledStrip(root, 6.9, -8.75, 0.95, wz + 0.03, { power: 2.4 })
  lightPool(root, 8, 2.2, -9.4, ROOM.z0 + 1.0, '#bfe0ff', 0.2)
  W.lights.push({ light: (() => { const l = new THREE.PointLight('#cfe4ff', 0, 11, 1.6); l.position.set(-9.6, 2.4, ROOM.z0 + 2.2); root.add(l); return l })(), night: 22, day: 0 })
  // Il mappamondo che gira, nell'angolo.
  const stand = new THREE.Group(); stand.position.set(-14.35, 0, -9.7); root.add(stand)
  cyl(stand, 0.2, 0.26, 0.05, 0, 0.025, 0, PAL.oakDark, 20); cyl(stand, 0.03, 0.03, 0.9, 0, 0.47, 0, PAL.metal, 8)
  const globe = new THREE.Group(); globe.position.y = 1.32; globe.rotation.z = 0.35; stand.add(globe)
  sph(globe, 0.4, 0, 0, 0, std('#5aa0d8', { roughness: 0.35 }), 28, 18)
  for (let k = 0; k < 7; k++) { const land = sph(globe, 0.16, 0, 0, 0, std('#8cc48a', { flatShading: true, roughness: 0.7 }), 7, 5); land.position.setFromSphericalCoords(0.33, 0.6 + (k % 4) * 0.55, k * 1.1); land.scale.set(1, 0.8, 0.9) }
  const arc = mesh(geo('globe-arc', () => new THREE.TorusGeometry(0.46, 0.014, 6, 40)), std('#d8b56a', { metalness: 0.7, roughness: 0.3 }), stand, 0, 1.32, 0); arc.rotation.y = Math.PI / 2
  blob(root, 1.1, 1.1, -14.35, -9.7, 0.3)
  W.tick.push((t) => { globe.rotation.y = t * 0.3 })
  pickable(W, stand, { deptId: sector.id })
  buildCityTable(W, V(-8.3, 0, -5.1)); buildStudio(W, V(-14.6, 0, -6.95))
  zone.box.z0 = ROOM.z0; zone.box.x0 = Math.min(zone.box.x0, -15); zone.box.x1 = Math.max(zone.box.x1, -5.5); zone.box.y1 = 3.4; zone.box.z1 = Math.max(zone.box.z1, -4.4)
  return zone
}

function buildCodeLab(W, sector) {
  const zone = buildPod(W, sector, SLOTS.sviluppo, 'lab'), root = W.root, wz = ROOM.z0 + 0.05, cx = (LAB.x0 + LAB.x1) / 2
  plaque(root, sector, cx - 1.6, 2.6, wz, 2.5)
  // Il neon del codice e la lavagna.
  const neon = canvasTex(256, 128, (ctx) => { ctx.clearRect(0, 0, 256, 128); ctx.shadowColor = '#c8f060'; ctx.shadowBlur = 18; drawIcon(ctx, 'code', 128, 64, 104, '#e4ff9a', 2.2) })
  const sign = mesh(planeGeo(1.5, 0.75), new THREE.MeshBasicMaterial({ map: neon, transparent: true, depthWrite: false }), root, cx + 1.3, 2.6, wz + 0.01, false); sign.material.color.setScalar(1.9)
  rbox(root, 2.2, 1.2, 0.04, 0.02, cx + 2.3, 1.55, wz, std('#ffffff', { roughness: 0.3 }))
  const scribble = canvasTex(256, 140, (ctx) => { ctx.strokeStyle = '#4f6ef7'; ctx.lineWidth = 3; ctx.strokeRect(20, 20, 60, 36); ctx.strokeRect(160, 80, 70, 36); ctx.beginPath(); ctx.moveTo(80, 38); ctx.bezierCurveTo(120, 38, 120, 98, 160, 98); ctx.stroke(); ctx.strokeStyle = '#ff5a1f'; ctx.beginPath(); ctx.arc(128, 40, 16, 0, 7); ctx.stroke() })
  mesh(planeGeo(2.0, 1.1), new THREE.MeshBasicMaterial({ map: scribble, transparent: true }), root, cx + 2.3, 1.55, wz + 0.024, false)
  if (!sector.agents.length) {
    // Nessun agente di sviluppo ancora: scrivanie vuote e il cartello, niente persone inventate.
    const t = canvasTex(512, 300, (ctx) => {
      ctx.fillStyle = '#fbf8f1'; roundRect(ctx, 0, 0, 512, 300, 28); ctx.fill()
      ctx.fillStyle = BRAND.navy; ctx.textAlign = 'center'; ctx.font = `400 62px ${FONT.display}`; ctx.fillText('In arrivo', 256, 128)
      ctx.fillStyle = '#6b7684'; ctx.font = `500 30px ${FONT.ui}`; ctx.fillText('Qui lavoreranno gli agenti', 256, 190); ctx.fillText('di sviluppo', 256, 230)
    })
    const easel = new THREE.Group(); easel.position.set(LAB.x0 + 2.1, 0, LAB.z1 - 1.5); easel.rotation.y = 0.25; root.add(easel)
    for (const sx of [-0.32, 0.32]) { const leg = box(easel, 0.04, 1.5, 0.04, sx, 0.74, 0.06, PAL.oakDark); leg.rotation.x = 0.1 } const backLeg = box(easel, 0.04, 1.5, 0.04, 0, 0.72, -0.26, PAL.oakDark); backLeg.rotation.x = -0.3
    mesh(planeGeo(0.95, 0.56), new THREE.MeshBasicMaterial({ map: t }), easel, 0, 1.12, 0.1, false).rotation.x = -0.1
    pickable(W, easel, { deptId: sector.id })
  }
  potPlant(W, root, LAB.x1 - 0.95, 0, LAB.z1 - 0.8, 1.1, '#e7e1d4')
  zone.box = { x0: LAB.x0, x1: LAB.x1, z0: LAB.z0, z1: LAB.z1, y0: 0, y1: 3.0 }
  zone.group.remove(zone.ring); zone.ring.geometry.dispose(); zone.ring.material.dispose()
  zone.ring = zoneRing(root, LAB.x1 - LAB.x0 - 0.9, LAB.z1 - LAB.z0 - 0.8, cx - 0.05, (LAB.z0 + LAB.z1) / 2, sector.color)
  return zone
}

function buildDeckZone(W, sector) {
  const root = W.root, h = DECK.h, g = new THREE.Group(); g.position.set(0, h + 0.03, 0); root.add(g)
  const zone = { id: sector.id, sector, group: g, people: [], kind: 'deck', top: true }
  const mz = (DECK.z0 + DECK.z1) / 2
  const deskZ = -8.7
  rug(W, g, 6.2, 3.0, 0.75, deskZ - 0.2, sector.color, sector.id, 0.006)
  const roster = sector.agents.slice(0, 3)
  roster.forEach((agent, i) => {
    const x = roster.length === 1 ? 0.9 : 0.75 + (i - (roster.length - 1) / 2) * 2.5
    seatAgent(W, zone, g, sector, agent, i, x, deskZ, -1, { exec: i === Math.floor((roster.length - 1) / 2) })
  })
  if (!roster.length) station(W, g, sector, null, 0.9, deskZ, -1, { exec: true })
  // Una poltroncina per gli ospiti e il verde.
  const guest = mesh(geo('pouf', () => new THREE.SphereGeometry(0.46, 20, 14)), std(PAL.linen, { roughness: 1 }), g, 3.25, 0.26, -8.3); guest.scale.set(0.95, 0.58, 0.95)
  potPlant(W, g, -3.4, 0, -10.3, 1.2, '#e7e1d4'); potPlant(W, g, 3.45, 0, -10.3, 1.1)
  plaque(root, sector, -2.25, h + 2.55, DECK.z0 + 0.19, 2.6)
  // Lo schermo dell'ufficio: quanti agenti sono accesi, quanti lavorano, cosa aspetta te.
  W.kpi = wallScreen(root, 3.3, 1.5, 1.95, h + 1.9, DECK.z0 + 0.2, 880, 400)
  zone.ring = zoneRing(root, DECK.x1 - DECK.x0 - 0.3, DECK.z1 - DECK.z0 - 0.2, 0, mz, sector.color, h + 0.05)
  zone.box = { x0: DECK.x0, x1: DECK.x1, z0: DECK.z0, z1: DECK.z1 + 1, y0: 0, y1: 3.5 }
  // Sul Deck la pausa è alla ringhiera, a guardare la sala.
  zone.routeOut = null
  zone.rail = [V(1.3, h + 0.03, DECK.z1 - 0.55), V(0.2, h + 0.03, DECK.z1 - 0.55)]
  zoneTag(zone, root, 0, h + 3.55, DECK.z0 + 0.6)
  pickable(W, g, { deptId: sector.id })
  buildCeo(W, V(3.0, h + 0.03, DECK.z1 - 0.6), zone)
  W.zones.push(zone)
  return zone
}
// Il CEO: il titolare, l'unica persona che non è un agente. Sta alla ringhiera del Deck e guarda la squadra.
function buildCeo(W, at, zone) {
  const { group, parts } = makePerson('ceo', { shirt: '#2a2f45', jacket: true, style: 0, hair: '#3a2a1e', pants: '#1b1f2b' })
  poseStand(parts); group.position.copy(at); group.rotation.y = -0.25; W.root.add(group)
  blob(group, 0.8, 0.8, 0, 0, 0.26, 0.015)
  const el = document.createElement('div'); el.className = 'person-tag ceo'; el.innerHTML = '<i style="--c:#ffd27a"></i><b>Tu · CEO</b>'
  const tag = label(el, group, 0, 2.3, 0)
  const talk = bubble('talk'); talk.scale.setScalar(0.36); talk.position.set(0.32, 2.02, 0.1); group.add(talk)
  parts.cup.visible = true
  W.tick.push((t) => {
    const talking = Math.sin(t * 0.4) > 0.55
    talk.visible = talking; talk.position.y = 2.02 + Math.sin(t * 2) * 0.03
    group.rotation.y = talking ? -0.25 - (Math.PI * 0.6 - 0.25) * Math.min(1, (Math.sin(t * 0.4) - 0.55) * 8) : -0.25 + Math.sin(t * 0.25) * 0.35
    parts.shR.rotation.x = -0.6; parts.elR.rotation.x = Math.sin(t * 0.7) > 0.8 ? -2.0 : -1.4
    parts.shL.rotation.x = talking ? -0.9 + Math.sin(t * 3) * 0.2 : 0.05; parts.elL.rotation.x = talking ? -0.9 : -0.18
    parts.head.rotation.y = Math.sin(t * 0.5) * 0.3
  })
  pickable(W, group, { deptId: zone.id })
  W.ceo = { group, tag }
}

/* ---------- oggetti vivi ---------- */
function buildCityTable(W, at) {
  const g = new THREE.Group(); g.position.copy(at); W.root.add(g)
  rbox(g, 3.7, 0.08, 1.6, 0.03, 0, 0.8, 0, std(PAL.oak, { roughness: 0.55 }))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.045, 0.045, 0.76, sx * 1.65, 0.38, sz * 0.62, PAL.white, 8)
  box(g, 3.4, 0.02, 1.32, 0, 0.85, 0, std('#8ec6dd', { roughness: 0.4 }), false)
  blob(g, 4.4, 2.3, 0, 0, 0.3); ledStrip(g, 3.3, 0, 0.76, 0.79, { power: 2 })
  const models = []
  for (let k = 0; k < 12; k++) {
    const m = new THREE.Group(); m.position.set(-1.4 + (k % 6) * 0.56, 0.86, k < 6 ? -0.33 : 0.33); g.add(m)
    const body = mesh(geo('unit', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.6 }), m, 0, 0.2, 0)
    const pole = cyl(m, 0.012, 0.012, 0.34, 0.12, 0.6, 0.12, '#f2f2ee', 6)
    const flag = box(m, 0.16, 0.1, 0.01, 0.21, 0.72, 0.12, glow(BRAND.orange, 1.5), false)
    const warn = sph(m, 0.06, -0.14, 0.5, 0, glow('#ff4d3d', 2.2), 10, 8, false)
    m.traverse((o) => { if (o.isMesh) { o.userData.pick = { city: k }; W.pick.push(o) } })
    models.push({ m, body, pole, flag, warn })
  }
  pickable(W, g, { cities: true })
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag cities'; el.style.setProperty('--c', '#62a9da')
  const tag = label(el, g, 0, 1.75, 0)
  const card = document.createElement('div'); card.className = 'city-card'; card.hidden = true
  W.cityCard = label(card, g, 0, 2.0, 0)
  W.cityTable = { g, models, el, tag }
  W.tick.push((t) => { for (const model of models) if (model.m.visible) model.m.position.y = 0.86 + (model.running ? Math.abs(Math.sin(t * 5)) * 0.12 : 0) })
}
function buildStudio(W, at) {
  // La console di StudioMap: i comandi lanciati dalla riga di una città girano qui.
  const c = new THREE.Group(); c.position.copy(at); c.rotation.y = Math.PI / 2; W.root.add(c)
  rbox(c, 0.8, 1.6, 0.56, 0.05, 0, 0.8, 0, std('#1b2233', { roughness: 0.5, metalness: 0.3 }))
  const leds = []
  for (let k = 0; k < 4; k++) leds.push(box(c, 0.56, 0.06, 0.02, 0, 0.5 + k * 0.28, 0.29, new THREE.MeshBasicMaterial({ color: '#2b3446' }), false))
  mesh(planeGeo(0.3, 0.276), logoMat('icon', 'white'), c, 0, 1.42, 0.286, false)
  const ring = mesh(geo('studio-ring', () => new THREE.TorusGeometry(0.28, 0.035, 8, 28)), glow(BRAND.orange, 2.4), c, 0, 2.0, 0, false); ring.visible = false
  blob(W.root, 1.3, 1.5, at.x, at.z, 0.3)
  const el = document.createElement('div'); el.className = 'task-tag studio'
  const tag = label(el, c, 0, 2.45, 0)
  pickable(W, c, { info: 'studio' })
  W.studio = { group: c, leds, ring, el, tag, on: false, sent: 0 }
  W.tick.push((t) => {
    if (!W.studio.on) return
    ring.rotation.y = t * 2.4; ring.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.5
    leds.forEach((led, k) => led.material.color.setHSL(0.06, 0.95, 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 7 - k * 1.4))))
  })
}
function buildInbox(W) {
  // «Aspetta te»: il banco all'ingresso dove arriva tutto quello che devi decidere.
  const at = V(-4.6, 0, 8.5), g = new THREE.Group(); g.position.copy(at); g.rotation.y = 0.12; W.root.add(g)
  rbox(g, 2.3, 0.08, 0.8, 0.03, 0, 0.92, 0, std(PAL.oak, { roughness: 0.5 }))
  rbox(g, 2.2, 0.86, 0.7, 0.05, 0, 0.45, 0, std(PAL.white, { roughness: 0.9 }))
  box(g, 2.22, 0.14, 0.72, 0, 0.08, 0, std(BRAND.orange, { roughness: 0.6 }))
  ledStrip(g, 2.1, 0, 0.03, 0.37, { color: '#ffb080', power: 2.6, pool: 0.4, poolDepth: 1.4, poolZ: 0.55 })
  mesh(planeGeo(0.5, 0.46), logoMat('icon', 'navy'), g, -0.72, 0.5, 0.352, false)
  const signCanvas = document.createElement('canvas'); signCanvas.width = 640; signCanvas.height = 200
  const sign = new THREE.CanvasTexture(signCanvas); sign.colorSpace = THREE.SRGBColorSpace; sign.anisotropy = 8
  const drawSign = (n) => {
    const ctx = signCanvas.getContext('2d')
    ctx.clearRect(0, 0, 640, 200); ctx.fillStyle = BRAND.orange; roundRect(ctx, 0, 0, 640, 200, 40); ctx.fill()
    drawIcon(ctx, 'inbox', 84, 100, 96, '#ffffff', 2)
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `400 74px ${FONT.display}`; ctx.fillText('Aspetta te', 156, 106)
    ctx.fillStyle = '#ffffff'; roundRect(ctx, 506, 44, 112, 112, 56); ctx.fill()
    ctx.fillStyle = '#c23c0a'; ctx.textAlign = 'center'; ctx.font = `700 ${n > 99 ? 54 : 68}px ${FONT.ui}`; ctx.fillText(String(n), 562, 104)
    sign.needsUpdate = true
  }
  drawSign(0)
  for (const sx of [-0.7, 0.7]) box(g, 0.05, 0.5, 0.05, sx, 1.2, -0.25, PAL.metal)
  rbox(g, 1.96, 0.64, 0.06, 0.03, 0, 1.72, -0.27, std('#b23c10', { roughness: 0.6 }))
  mesh(planeGeo(1.88, 0.5875), new THREE.MeshBasicMaterial({ map: sign }), g, 0, 1.72, -0.236, false).material.color.setScalar(1.1)
  // La vaschetta: i fogli crescono con le proposte in attesa.
  rbox(g, 0.62, 0.05, 0.46, 0.02, 0.45, 0.985, 0.02, std(PAL.metal, { roughness: 0.4, metalness: 0.5 }))
  const sheets = []
  for (let k = 0; k < 12; k++) { const s = box(g, 0.5, 0.012, 0.36, 0.45 + Math.sin(k * 2.3) * 0.02, 1.02 + k * 0.014, 0.02 + Math.cos(k * 1.7) * 0.015, std(k % 3 ? '#ffffff' : '#fff1d6', { roughness: 0.8 })); s.rotation.y = Math.sin(k * 1.3) * 0.12; s.visible = false; sheets.push(s) }
  const envelopes = []
  for (let k = 0; k < 8; k++) { const e = bubble('mail'); e.scale.setScalar(0.42); e.visible = false; g.add(e); envelopes.push(e) }
  blob(W.root, 3.2, 1.8, at.x, at.z, 0.32)
  const el = document.createElement('button'); el.type = 'button'; el.className = 'tag kiosk'
  const tag = label(el, g, 0, 2.55, -0.2)
  pickable(W, g, { kiosk: true })
  W.kiosk = { g, sheets, envelopes, el, tag, drawSign, count: -1, top: at.clone().add(V(0.45, 1.25, 0)) }
  W.tick.push((t) => envelopes.forEach((e, k) => { const a = t * 0.7 + k / envelopes.length * Math.PI * 2; e.position.set(0.45 + Math.cos(a) * 0.62, 1.62 + Math.sin(t * 1.6 + k) * 0.1, 0.02 + Math.sin(a) * 0.42) }))
}
function buildSystem(W, zone) {
  // Gli armadi del sistema: pianificatore e ultimo backup. Le spie sono verdi se va tutto bene.
  const root = W.root, x = ROOM.x0 + 0.42, g = new THREE.Group(); g.position.set(x, 0, 5.15); g.rotation.y = Math.PI / 2; root.add(g)
  const leds = []
  for (let k = 0; k < 2; k++) {
    rbox(g, 0.78, 2.0, 0.6, 0.03, (k - 0.5) * 0.84, 1.0, 0, std('#1c212d', { roughness: 0.45, metalness: 0.4 }))
    for (let r = 0; r < 7; r++) { box(g, 0.64, 0.16, 0.02, (k - 0.5) * 0.84, 0.3 + r * 0.24, 0.305, std('#2a3142', { roughness: 0.5 }), false); const led = box(g, 0.06, 0.04, 0.02, (k - 0.5) * 0.84 - 0.24, 0.3 + r * 0.24, 0.318, new THREE.MeshBasicMaterial({ color: '#43d18a' }), false); leds.push(led) }
  }
  blob(root, 1.4, 2.4, x + 0.1, 5.15, 0.32)
  const screen = wallScreen(g, 1.5, 0.78, 0, 2.52, 0.0, 600, 312)
  for (const sx of [-0.6, 0.6]) box(g, 0.05, 0.3, 0.05, sx, 2.1, -0.02, PAL.metal)
  const el = document.createElement('div'); el.className = 'task-tag sys'
  const tag = label(el, g, 0, 3.2, 0)
  pickable(W, g, { info: 'system', deptId: zone.id })
  W.sys = { leds, screen, el, tag, bad: false }
  W.tick.push((t) => leds.forEach((led, k) => { const on = Math.sin(t * (2 + (k % 5)) + k * 1.7) > -0.3; led.material.color.set(W.sys.bad ? (on ? '#ff4d3d' : '#4a1612') : (on ? '#43d18a' : '#123a26')).multiplyScalar(on ? 2 : 1) }))
}
function buildMoney(W, zone) {
  // Il tabellone dei soldi: credito di StudioMap e spesa degli agenti.
  const g = new THREE.Group(); g.position.set(zone.box.x0 - 1.1, 0, zone.slot.z + 0.75); g.rotation.y = 0.45; W.root.add(g)
  for (const sx of [-0.62, 0.62]) box(g, 0.05, 1.2, 0.05, sx, 0.6, 0, PAL.metal)
  box(g, 1.5, 0.04, 0.4, 0, 0.02, 0, PAL.metal)
  const screen = wallScreen(g, 1.7, 0.96, 0, 1.55, 0, 680, 384)
  blob(W.root, 2.2, 1.2, g.position.x, g.position.z, 0.3)
  // La moneta che gira: è il segno del reparto.
  const coin = new THREE.Group(); coin.position.set(0, 2.45, 0); g.add(coin)
  const face = cyl(coin, 0.28, 0.28, 0.06, 0, 0, 0, std('#f2c14e', { metalness: 0.8, roughness: 0.25 }), 32); face.rotation.x = Math.PI / 2
  const euroTex = canvasTex(128, 128, (ctx) => drawIcon(ctx, 'euro', 64, 64, 96, '#7a5200', 2.6))
  for (const s of [1, -1]) { const p = mesh(planeGeo(0.4, 0.4), new THREE.MeshBasicMaterial({ map: euroTex, transparent: true, depthWrite: false }), coin, 0, 0, s * 0.034, false); if (s < 0) p.rotation.y = Math.PI }
  W.tick.push((t) => { coin.rotation.y = t * 1.1; coin.position.y = 2.45 + Math.sin(t * 2) * 0.04 })
  const el = document.createElement('div'); el.className = 'task-tag money'
  const tag = label(el, g, 0, 3.0, 0)
  pickable(W, g, { info: 'money', deptId: zone.id })
  W.money = { screen, el, tag }
}
function zoneProps(W, zone) {
  const g = zone.group, id = zone.id, w = zone.box.x1 - zone.box.x0, root = W.root
  if (id === 'ricerca') {
    // Il cannocchiale: la Ricerca guarda fuori e porta dentro quello che trova.
    const t = new THREE.Group(); t.position.set(-w / 2 - 0.55, 0, 1.3); g.add(t)
    for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2, leg = cyl(t, 0.018, 0.018, 1.25, Math.cos(a) * 0.24, 0.6, Math.sin(a) * 0.24, PAL.oakDark, 6); leg.rotation.set(Math.sin(a) * 0.38, 0, -Math.cos(a) * 0.38) }
    const head = new THREE.Group(); head.position.y = 1.25; t.add(head)
    const tube = cyl(head, 0.05, 0.075, 0.95, 0, 0.1, 0, std('#d8b56a', { metalness: 0.75, roughness: 0.3 }), 14); tube.rotation.z = 1.15
    blob(g, 1.1, 1.1, t.position.x, t.position.z, 0.3)
    W.tick.push((tt) => { head.rotation.y = 0.6 + Math.sin(tt * 0.3) * 0.7 })
    pickable(W, t, { deptId: id })
  } else if (id === 'commerciale') {
    // Il roll-up da fiera con il logo: il Commerciale porta Speaqi fuori.
    const b = new THREE.Group(); b.position.set(w / 2 + 0.2, 0, 1.4); b.rotation.y = -0.5; g.add(b)
    box(b, 0.9, 0.06, 0.3, 0, 0.03, 0, PAL.metal); box(b, 0.86, 1.95, 0.02, 0, 1.03, 0, std(BRAND.navy, { roughness: 0.7 }))
    mesh(planeGeo(0.74, 0.74 * 470 / 2000), logoMat('full', 'white'), b, 0, 1.6, 0.012, false)
    mesh(planeGeo(0.5, 0.46), logoMat('icon', 'white'), b, 0, 0.95, 0.012, false)
    blob(g, 1.3, 0.8, b.position.x, b.position.z, 0.3)
    pickable(W, b, { deptId: id })
  } else if (id === 'marketing') {
    // Il megafono e i cuori: salgono solo quando qualcuno del reparto sta lavorando.
    const s = new THREE.Group(); s.position.set(-w / 2 - 0.5, 0, 1.2); g.add(s)
    cyl(s, 0.16, 0.2, 0.05, 0, 0.025, 0, PAL.metal, 16); cyl(s, 0.025, 0.025, 1.25, 0, 0.65, 0, PAL.metal, 8)
    const horn = new THREE.Group(); horn.position.y = 1.4; s.add(horn)
    const cone = mesh(geo('horn', () => new THREE.CylinderGeometry(0.34, 0.09, 0.7, 24, 1, true)), std(BRAND.orange, { side: THREE.DoubleSide, roughness: 0.5 }), horn); cone.rotation.x = Math.PI / 2 - 0.25; cone.position.z = 0.2
    cyl(horn, 0.11, 0.11, 0.24, 0, -0.06, -0.2, '#f4f6fb', 14).rotation.x = Math.PI / 2
    blob(g, 0.9, 0.9, s.position.x, s.position.z, 0.3)
    const heartTex = canvasTex(128, 128, (ctx) => drawIcon(ctx, 'heart', 64, 64, 104, '#ff5a8a', 2, true))
    const hearts = []
    for (let k = 0; k < 3; k++) { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false })); h.scale.setScalar(0.28); s.add(h); hearts.push(h) }
    W.tick.push((t) => {
      horn.rotation.y = 0.5 + Math.sin(t * 0.7) * 0.6
      const busy = zone.people.some((rec) => rec.agent.status === 'running')
      hearts.forEach((h, k) => { const f = (t * 0.28 + k / 3) % 1; h.visible = busy; h.position.set(Math.sin(f * 9 + k * 2) * 0.22, 1.7 + f * 1.8, 0.4); h.material.opacity = f < 0.15 ? f / 0.15 : 1 - f; h.scale.setScalar(0.2 + f * 0.2) })
    })
    pickable(W, s, { deptId: id })
  } else if (id === 'operazioni') {
    buildSystem(W, zone)
    // Il robottino delle pulizie: gira quando «Pulizia database» lavora, altrimenti è alla base.
    const bot = new THREE.Group(); root.add(bot)
    cyl(bot, 0.22, 0.22, 0.08, 0, 0.06, 0, std('#f4f1ea', { roughness: 0.4 }), 24); cyl(bot, 0.1, 0.1, 0.02, 0, 0.11, 0, std(BRAND.navy), 16)
    const eye = sph(bot, 0.025, 0, 0.1, 0.19, glow('#43d18a', 2.5), 8, 6, false)
    const home = V(zone.box.x1 + 0.7, 0, zone.slot.z + 0.2); bot.position.copy(home)
    const dock = box(root, 0.5, 0.04, 0.3, home.x, 0.02, home.z - 0.25, PAL.metal)
    W.tick.push((t) => {
      const busy = zone.people.some((rec) => rec.agent.status === 'running')
      eye.material = glow(busy ? '#43d18a' : '#7fb4ff', 2.5)
      if (!busy) { bot.position.lerp(home, 0.04); return }
      const a = t * 0.5, cx = zone.box.x1 + 1.6, cz = zone.slot.z + 2.4
      bot.position.set(cx + Math.cos(a) * 1.1 + Math.cos(a * 3.1) * 0.25, 0, cz + Math.sin(a) * 1.5); bot.rotation.y = -a
    })
    void dock
  } else if (id === 'finanza') buildMoney(W, zone)
}

/* ---------- costruzione e aggiornamento ---------- */
export function buildZones(W, snapshot) {
  let spare = 0
  for (const sector of snapshot.departments) {
    const slot = SLOTS[sector.id]
    let zone
    if (!slot) zone = buildPod(W, sector, { kind: 'pod', x: 4.6 + spare++ * 5.2, z: 6.4, cols: 1 }, 'pod')
    else if (slot.kind === 'deck') zone = buildDeckZone(W, sector)
    else if (slot.kind === 'wall') zone = buildMapLab(W, sector)
    else if (slot.kind === 'lab') zone = buildCodeLab(W, sector)
    else zone = buildPod(W, sector, slot, 'pod')
    if (zone.kind === 'pod') zoneProps(W, zone)
  }
  buildInbox(W)
  // Le pause: chi è disponibile ogni tanto va in lounge (al massimo quattro insieme); sul Deck, alla ringhiera.
  for (const rec of W.persons) {
    const zone = rec.zone
    rec.planBreak = () => {
      if (zone.rail) {
        const spot = zone.rail[rec.index % zone.rail.length], key = `rail${rec.index % zone.rail.length}`
        if (W.lounge.taken.has(key)) return null
        W.lounge.taken.add(key)
        const stand = rec.station.seat.clone().add(V(-1.55, 0, 0))
        return { out: [stand, V(stand.x, stand.y, spot.z), spot], back: [V(stand.x, stand.y, spot.z), stand, rec.station.seat], spot: { pos: spot, yaw: 0, sit: false }, release: () => W.lounge.taken.delete(key) }
      }
      if (!zone.routeOut || W.lounge.taken.size >= 4) return null
      const free = W.lounge.spots.map((s, i) => i).filter((i) => !W.lounge.taken.has(i))
      if (!free.length) return null
      const index = free[(hashId(rec.agent.id) + Math.floor(performance.now() / 1000)) % free.length], spot = W.lounge.spots[index]
      W.lounge.taken.add(index)
      // Si entra dal davanti del tappeto; chi va sul divano passa di lato al tavolino.
      const c = W.lounge.center, near = []
      if (spot.sit && spot.pos.z < c.z) { const side = spot.pos.x >= c.x ? 1 : -1; near.push(V(c.x + side * 1.08 * U, 0, c.z + 0.45 * U)); near.push(V(c.x + (spot.pos.x - c.x) * 0.6, 0, c.z + (spot.pos.z - c.z) * 0.6)) }
      const out = [...zone.routeOut(rec), ...near, spot.pos]
      return { out, back: [...out.slice(0, -1).reverse(), rec.station.seat], spot, release: () => W.lounge.taken.delete(index) }
    }
  }
}

function drawProduction(W, snapshot) {
  const screen = W.prod; if (!screen) return
  const P = snapshot.production, C = snapshot.command
  const key = JSON.stringify([P, C && [C.slug, C.phase, C.done, C.error]])
  if (key === screen.key) return
  screen.key = key
  const ctx = screen.ctx, w = 1280, h = 538
  ctx.fillStyle = '#0d1522'; ctx.fillRect(0, 0, w, h)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  ctx.fillStyle = '#f4efe4'; ctx.font = `400 46px ${FONT.display}`; ctx.fillText('Produzione città', 36, 46)
  ctx.font = `500 24px ${FONT.ui}`; ctx.fillStyle = '#9fb0c3'
  if (!P) ctx.fillText('Leggo le città da StudioMap…', 36, 120)
  else if (!P.available) { ctx.fillStyle = '#ffb547'; ctx.fillText(short(`StudioMap non disponibile: ${P.reason}`, 90), 36, 120) }
  else {
    ctx.textAlign = 'right'; ctx.fillText(`${P.totals.live} online · ${P.totals.in_progress} in produzione · ${P.totals.live_behind} con arretrati`, w - 36, 48)
    ctx.textAlign = 'center'; ctx.font = `500 17px ${FONT.ui}`
    PHASES.forEach((name, k) => ctx.fillText(name, 470 + k * 62, 96))
    P.cities.slice(0, 7).forEach((city, i) => {
      const y = 138 + i * 56, running = C && !C.done && C.slug === city.slug
      if (running) { ctx.fillStyle = '#ff5a1f2e'; ctx.fillRect(20, y - 25, w - 40, 50) }
      ctx.textAlign = 'left'; ctx.font = `700 28px ${FONT.ui}`; ctx.fillStyle = city.protected ? '#8b97a8' : '#f4efe4'
      ctx.fillText(short(city.name, 22), 36, y)
      for (let k = 0; k < 8; k++) { ctx.fillStyle = PHASE_COLOR[city.phases[k]] || PHASE_COLOR.t; ctx.beginPath(); ctx.arc(470 + k * 62, y, 13, 0, Math.PI * 2); ctx.fill() }
      ctx.font = `500 21px ${FONT.ui}`
      ctx.fillStyle = running ? '#ffb38f' : city.error ? '#ff8a7a' : '#9fb0c3'
      ctx.fillText(short(running ? `● ${C.label}${C.phase ? ` · ${C.phase}` : ''}` : city.protected ? 'protetta' : city.next || 'allineata', 34), 950, y)
    })
  }
  screen.texture.needsUpdate = true
}
function panel(ctx, w, h, title, icon) {
  ctx.fillStyle = '#0d1522'; ctx.fillRect(0, 0, w, h)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  drawIcon(ctx, icon, 52, 50, 44, '#ffb38f', 2.2)
  ctx.fillStyle = '#f4efe4'; ctx.font = `400 42px ${FONT.display}`; ctx.fillText(title, 90, 52)
}
function drawKpi(W, snapshot) {
  const screen = W.kpi; if (!screen) return
  const agents = snapshot.departments.flatMap((d) => d.agents), on = agents.filter((a) => a.enabled).length
  const working = agents.filter((a) => a.status === 'running').length, stuck = agents.filter((a) => a.status === 'attention').length
  const key = [agents.length, on, working, stuck, snapshot.pendingCount, snapshot.totals.day_actual, snapshot.totals.month_actual].join()
  if (key === screen.key) return
  screen.key = key
  const ctx = screen.ctx
  panel(ctx, 880, 400, 'L’ufficio adesso', 'users')
  const cells = [[`${on}/${agents.length}`, 'agenti accesi', '#7fb4ff'], [String(working), 'al lavoro', '#43d18a'], [String(stuck), 'da verificare', stuck ? '#ffb547' : '#5b6a7d'], [String(snapshot.pendingCount), 'aspettano te', snapshot.pendingCount ? '#ff8a4d' : '#5b6a7d']]
  cells.forEach(([value, name, color], i) => {
    const x = 36 + i * 208
    ctx.fillStyle = '#162235'; roundRect(ctx, x, 104, 190, 176, 18); ctx.fill()
    ctx.fillStyle = color; ctx.font = `700 78px ${FONT.ui}`; ctx.textAlign = 'center'; ctx.fillText(value, x + 95, 176)
    ctx.fillStyle = '#b9c6d6'; ctx.font = `500 25px ${FONT.ui}`; ctx.fillText(name, x + 95, 246)
  })
  ctx.textAlign = 'left'; ctx.fillStyle = '#9fb0c3'; ctx.font = `500 28px ${FONT.ui}`
  ctx.fillText(`Spesa degli agenti: oggi ${euro(snapshot.totals.day_actual)} · mese ${euro(snapshot.totals.month_actual)}`, 36, 340)
  screen.texture.needsUpdate = true
}
function updateSystem(W, snapshot) {
  const S = snapshot.system
  if (W.sys) {
    const age = S?.lastBackupAt ? (Date.now() - new Date(S.lastBackupAt).getTime()) / 36e5 : Infinity
    const bad = !S ? false : !S.schedulerOn || age > 36 || S.backupOk === false
    W.sys.bad = bad
    W.sys.el.dataset.state = !S ? 'idle' : bad ? 'attention' : 'done'
    const line1 = !S ? 'Sistema' : `Pianificatore ${S.schedulerOn ? `acceso${S.schedulerJobs ? ` · solo ${short(S.schedulerJobs, 28)}` : ''}` : 'SPENTO'}`
    const line2 = !S ? 'stato non letto' : `Ultimo backup: ${S.lastBackupAt ? `${when(S.lastBackupAt)}${age > 36 ? ` · ${Math.floor(age / 24)} giorni fa` : ''}` : 'nessuno registrato'}`
    W.sys.el.innerHTML = `<b>${esc(line1)}</b><span>${esc(line2)}</span>`
    W.sys.info = { title: 'Sistema', lines: [line1, line2], bad }
    const ctx = W.sys.screen.ctx
    panel(ctx, 600, 312, 'Sistema', 'server')
    ;[[!S ? 'Pianificatore: non letto' : `Pianificatore ${S.schedulerOn ? 'acceso' : 'SPENTO'}`, !S ? '#5b6a7d' : S.schedulerOn ? '#43d18a' : '#ff4d3d'],
      [!S ? 'Backup: non letto' : S.lastBackupAt ? `Backup ${when(S.lastBackupAt)}` : 'Nessun backup', !S ? '#5b6a7d' : age > 36 || S.backupOk === false ? '#ff4d3d' : '#43d18a']].forEach(([text, color], i) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(58, 142 + i * 82, 17, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#e6edf5'; ctx.font = `500 34px ${FONT.ui}`; ctx.fillText(short(text, 30), 96, 144 + i * 82)
    })
    W.sys.screen.texture.needsUpdate = true
  }
  if (W.money) {
    const credit = snapshot.production?.available ? snapshot.production.creditUsd : null, low = credit != null && credit < 5
    const line1 = `Credito StudioMap: ${credit == null ? 'non letto' : `${credit.toFixed(2).replace('.', ',')} $`}${low ? ' · sotto 5 $' : ''}`
    const line2 = `Agenti oggi ${euro(snapshot.totals.day_actual)} · mese ${euro(snapshot.totals.month_actual)}`
    W.money.el.dataset.state = low ? 'attention' : 'idle'
    W.money.el.innerHTML = `<b>${esc(line1)}</b><span>${esc(line2)}</span>`
    W.money.info = { title: 'Soldi', lines: [line1, line2], bad: low }
    const ctx = W.money.screen.ctx
    panel(ctx, 680, 384, 'Soldi', 'euro')
    ctx.fillStyle = '#9fb0c3'; ctx.font = `500 28px ${FONT.ui}`; ctx.fillText('Credito StudioMap', 36, 128)
    ctx.fillStyle = low ? '#ff8a7a' : '#f4efe4'; ctx.font = `700 76px ${FONT.ui}`; ctx.fillText(credit == null ? '—' : `${credit.toFixed(2).replace('.', ',')} $`, 36, 196)
    ctx.fillStyle = '#9fb0c3'; ctx.font = `500 28px ${FONT.ui}`; ctx.fillText('Spesa degli agenti', 36, 276)
    ctx.fillStyle = '#f4efe4'; ctx.font = `700 40px ${FONT.ui}`; ctx.fillText(`oggi ${euro(snapshot.totals.day_actual)} · mese ${euro(snapshot.totals.month_actual)}`, 36, 330)
    W.money.screen.texture.needsUpdate = true
  }
}
function updateStudio(W, snapshot) {
  const studio = W.studio; if (!studio) return
  const C = snapshot.command, on = !!C && !C.done
  studio.ring.visible = on; studio.on = on
  studio.el.dataset.state = on ? 'running' : C?.error ? 'attention' : C ? 'done' : 'idle'
  const line = !C ? 'nessun comando in corso' : short(C.error ? `Non riuscito: ${C.error}` : C.done ? 'Fatto' : C.phase || C.last || 'Avviato', 70)
  studio.el.innerHTML = !C ? '<b>StudioMap</b><span>nessun comando in corso</span>' : `<b>StudioMap · ${esc(C.label)} · ${esc(C.name)}</b><span>${esc(line)}</span>`
  studio.info = { title: C ? `StudioMap · ${C.label} · ${C.name}` : 'StudioMap', lines: [line], bad: !!C?.error }
  if (!on) studio.leds.forEach((led) => led.material.color.set(C?.error ? '#ff4d3d' : C ? '#43d18a' : '#2b3446'))
}
function updateCities(W, snapshot) {
  const table = W.cityTable; if (!table) return
  const P = snapshot.production, cities = P?.available ? P.cities : []
  table.models.forEach((model, k) => {
    const city = cities[k]
    model.m.visible = !!city
    if (!city) return
    const h = 0.14 + city.done / 8 * 0.62
    model.body.scale.set(0.34, h, 0.34); model.body.position.y = h / 2
    // Grigio = in lavorazione, azzurro = su Speaqi, verde con la bandierina = online.
    model.body.material.color.set(city.protected ? '#c9b98a' : city.live ? '#48bba6' : city.phases[6] === 'd' ? '#62a9da' : '#9aa3ad')
    model.pole.visible = model.flag.visible = city.live
    model.pole.position.y = h + 0.17; model.flag.position.y = h + 0.29
    model.warn.visible = city.error; model.warn.position.y = h + 0.1
    model.running = !!snapshot.command && !snapshot.command.done && snapshot.command.slug === city.slug
  })
  table.el.innerHTML = !P ? '<i></i>Città<b>leggo…</b>' : !P.available ? '<i></i>Città<b>StudioMap non disponibile</b>' : `<i></i>Città<b>${P.totals.in_progress} in produzione · ${P.totals.live} online</b>`
  table.el.setAttribute('aria-label', 'Apri la sala delle città')
}
function updateKiosk(W, snapshot) {
  const kiosk = W.kiosk; if (!kiosk) return
  const n = snapshot.pendingCount
  const titles = snapshot.outputs.slice(0, 2).map((o) => `<span>${esc(short(o.title, 44))}</span>`).join('')
  kiosk.el.innerHTML = `<i></i>Aspetta te<b>${n}</b>${n && titles ? `<em>${titles}${n > 2 ? `<span>e altre ${n - 2}</span>` : ''}</em>` : ''}`
  kiosk.el.classList.toggle('empty', !n)
  kiosk.el.setAttribute('aria-label', `Aspetta te: ${n} ${n === 1 ? 'proposta' : 'proposte'} da decidere`)
  if (kiosk.count !== n) { kiosk.count = n; kiosk.drawSign(n) }
  kiosk.sheets.forEach((s, k) => { s.visible = k < Math.min(n, 12) })
  kiosk.envelopes.forEach((e, k) => { e.visible = k < Math.min(Math.ceil(n / 3), 8) })
}
/** Lo stato sulle postazioni: luce del monitor, alone a terra, schermo. */
export function refreshStation(st) {
  const status = st.agent ? st.agent.status : 'empty'
  st.ledMat.color.set(status === 'empty' || status === 'off' ? '#333a48' : STATE_COLOR[status]).multiplyScalar(status === 'empty' || status === 'off' ? 1 : 2.2)
  st.haloMat.color.set(status === 'running' ? STATE_COLOR.running : status === 'attention' ? STATE_COLOR.attention : '#000000')
  st.haloMat.opacity = status === 'running' || status === 'attention' ? 0.5 : 0
  st.screen.mat.color.setScalar(status === 'off' || status === 'empty' ? 1 : 1.2)
  drawScreen(st, 0)
}
export function updateLive(W, snapshot) { drawProduction(W, snapshot); drawKpi(W, snapshot); updateSystem(W, snapshot); updateStudio(W, snapshot); updateCities(W, snapshot); updateKiosk(W, snapshot) }
/** Ogni mezzo secondo si ridisegnano solo gli schermi di chi sta lavorando. */
export function animateStations(W, t) {
  for (const st of W.stations) {
    const status = st.agent?.status
    if (status === 'running') { drawScreen(st, t + st.phase); st.haloMat.opacity = 0.38 + 0.2 * Math.sin(t * 3 + st.phase) }
    else if (status === 'attention') st.haloMat.opacity = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 5 + st.phase))
  }
}
export { PHASES, PHASE_COLOR, POOL }
