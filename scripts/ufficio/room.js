import * as THREE from 'three'
import { PAL, BRAND, U, std, glow, track, box, rbox, cyl, sph, mesh, geo, blobGeo, planeGeo, rrShape, arcBand, canvasTex, blob, lightPool, ledStrip, logoMat, rng } from './kit.js'

// L'involucro dell'ufficio: un open space mediterraneo visto "a spaccato", come un plastico.
// Pavimento in pietra chiara, due pareti (fondo e sinistra, con le finestre), The Deck rialzato,
// lounge al centro, vasca d'acqua a destra, ulivi e lavanda. Niente dati qui: solo il posto.

// Una stanza raccolta (30 x 22 metri): le persone si vedono grandi, come nel disegno del titolare.
export const ROOM = { x0: -15.2, x1: 15.2, z0: -11, z1: 11.6, wallH: 3.7, wallT: 0.45, RL: 5, RR: 3, slab: 0.7 }
export const DECK = { x0: -4, x1: 4, z0: -11, z1: -6.5, h: 0.55, stairX: -2 }
export const LAB = { x0: 7.7, x1: 15.2, z0: -11, z1: -6.2, h: 2.9 }
export const LOUNGE = { x: -1.2, z: 4.3 }
export const POOL = { x0: 12.5, x1: 14.6, z0: 4.9, z1: 9.4 }
export const SIGN = { w: 10.4, h: 2.9, y: 4.25 }
const rad = (deg) => deg * Math.PI / 180

/* ---------- texture del posto ---------- */
function tileTex() {
  const t = canvasTex(512, 512, (ctx, w) => {
    const r = rng(21), half = w / 2
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const k = 226 + Math.round((r() - 0.5) * 8)
      ctx.fillStyle = `rgb(${k},${k - 14},${k - 32})`; ctx.fillRect(i * half, j * half, half, half)
    }
    for (let n = 0; n < 2600; n++) { ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.07)' : 'rgba(120,96,70,.06)'; ctx.fillRect(r() * w, r() * w, 1 + r() * 3, 1 + r() * 2) }
    ctx.strokeStyle = 'rgba(176,156,128,.5)'; ctx.lineWidth = 3
    for (const p of [0, half]) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, w); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke() }
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 2.6, 1 / 2.6)
  return t
}
function plankTex(base, line) {
  const t = canvasTex(256, 256, (ctx, w) => {
    const r = rng(5)
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Color(base).offsetHSL(0, 0, (r() - 0.5) * 0.05)
      ctx.fillStyle = '#' + c.getHexString(); ctx.fillRect(0, i * 32, w, 32)
      ctx.fillStyle = line; ctx.fillRect(0, i * 32, w, 1.5)
      const cut = r() * w; ctx.fillRect(cut, i * 32, 1.5, 32)
    }
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
function rugTex(color) {
  return canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, w)
    for (let i = 0; i < w; i += 4) { ctx.fillStyle = i % 8 ? 'rgba(255,255,255,.05)' : 'rgba(60,40,20,.05)'; ctx.fillRect(0, i, w, 2); ctx.fillRect(i, 0, 1, w) }
  })
}
function waterTex() {
  const t = canvasTex(256, 256, (ctx, w) => {
    ctx.fillStyle = '#35a9b8'; ctx.fillRect(0, 0, w, w)
    const r = rng(9)
    ctx.lineCap = 'round'
    for (let n = 0; n < 46; n++) {
      const x = r() * w, y = r() * w, a = r() * Math.PI * 2, len = 22 + r() * 46
      ctx.strokeStyle = `rgba(215,252,255,${0.16 + r() * 0.3})`; ctx.lineWidth = 2 + r() * 4
      for (const ox of [-w, 0, w]) for (const oy of [-w, 0, w]) {
        ctx.beginPath(); ctx.moveTo(x + ox, y + oy)
        ctx.quadraticCurveTo(x + ox + Math.cos(a + 0.9) * len * 0.6, y + oy + Math.sin(a + 0.9) * len * 0.6, x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); ctx.stroke()
      }
    }
  })
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/* ---------- verde ---------- */
const UP = new THREE.Vector3(0, 1, 0)
const LEAVES = ['#8c9a6e', '#7d8c62', '#9aa97c', '#869468']
/** Ulivo: tronco contorto e chioma grigio-verde, quello del disegno. */
export function olive(W, parent, x, y, z, s = 1, seed = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); parent.add(g)
  const r = rng(seed * 97 + 3), bark = std('#7b644b', { roughness: 1 })
  let p = new THREE.Vector3(), dir = new THREE.Vector3((r() - 0.5) * 0.35, 1, (r() - 0.5) * 0.35).normalize()
  for (let k = 0; k < 3; k++) {
    const len = 0.62 - k * 0.1, top = 0.085 - k * 0.02, bottom = 0.13 - k * 0.03
    const seg = mesh(geo(`trunk${k}`, () => new THREE.CylinderGeometry(top, bottom, len, 7)), bark, g)
    seg.position.copy(p).addScaledVector(dir, len / 2); seg.quaternion.setFromUnitVectors(UP, dir)
    p = p.clone().addScaledVector(dir, len * 0.94)
    dir = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.7, 0.15, (r() - 0.5) * 0.7)).normalize()
  }
  const crown = new THREE.Group(); crown.position.copy(p); g.add(crown)
  for (let k = 0; k < 11; k++) {
    const a = r() * Math.PI * 2, d = r() * 0.72, rr = 0.34 + r() * 0.26
    const b = mesh(blobGeo(1, 1), std(LEAVES[k % LEAVES.length], { roughness: 0.95, flatShading: true }), crown, Math.cos(a) * d, 0.18 + r() * 0.62, Math.sin(a) * d)
    b.scale.set(rr, rr * (0.72 + r() * 0.2), rr); b.rotation.set(r() * 3, r() * 3, 0)
  }
  W.sway.push({ g: crown, phase: r() * 6, amp: 0.022 })
  W.tall.push({ g, top: (1.7 + 1.0) * s })
  return g
}
export function cypress(W, parent, x, y, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g)
  cyl(g, 0.06, 0.09, 0.4, 0, 0.2, 0, '#6b4d36', 6)
  const c = mesh(geo('cypress', () => new THREE.ConeGeometry(0.42, 3.2, 9)), std('#3f6a48', { flatShading: true, roughness: 0.95 }), g, 0, 0.35 + 1.6 * s, 0); c.scale.set(s, s, s)
  W.sway.push({ g, phase: x, amp: 0.012 })
}
/** Pianta in vaso a foglie larghe. */
export function potPlant(W, parent, x, y, z, s = 1, pot = PAL.stone) {
  const p = new THREE.Group(); p.position.set(x, y, z); p.scale.setScalar(s); parent.add(p)
  cyl(p, 0.24, 0.18, 0.42, 0, 0.21, 0, std(pot, { roughness: 0.9 }), 18)
  const leafGeo = geo('leaf', () => new THREE.SphereGeometry(0.26, 9, 6))
  for (let i = 0; i < 8; i++) {
    const leaf = mesh(leafGeo, std(i % 2 ? '#6f9a62' : '#4f7d4f', { flatShading: true, roughness: 0.9 }), p), a = i * 2.4
    leaf.position.set(Math.cos(a) * 0.2, 0.62 + (i % 3) * 0.18, Math.sin(a) * 0.2)
    leaf.scale.set(0.7, 1.35, 0.36); leaf.rotation.set(0, -a, -0.45 + (i % 2) * 0.9)
  }
  blob(parent, 0.9 * s, 0.9 * s, x, z, 0.28, y + 0.012)
  W.sway.push({ g: p, phase: x * 3 + z, amp: 0.02 })
  return p
}
/** Fioriera in pietra con ciuffi verdi e, volendo, lavanda. */
export function planter(W, parent, w, d, h, x, y, z, { lavender = false, led = true, rot = 0, seed = 1 } = {}) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; parent.add(g)
  rbox(g, w, h, d, 0.06, 0, h / 2, 0, std(PAL.stone, { roughness: 0.95 }))
  box(g, w - 0.14, 0.04, d - 0.14, 0, h - 0.005, 0, std('#5b4a3a', { roughness: 1 }), false)
  const r = rng(seed * 31 + 7), n = Math.max(2, Math.round(w * d * 5))
  for (let i = 0; i < n; i++) {
    const px = (r() - 0.5) * (w - 0.3), pz = (r() - 0.5) * (d - 0.26), s = 0.16 + r() * 0.13
    const b = mesh(blobGeo(1, 1), std(r() < 0.5 ? PAL.leaf : PAL.leafDark, { flatShading: true, roughness: 0.95 }), g, px, h + s * 0.55, pz)
    b.scale.set(s, s * (0.9 + r() * 0.7), s)
    if (lavender && r() < 0.8) for (let k = 0; k < 3; k++) {
      const stem = mesh(geo('lav', () => new THREE.ConeGeometry(0.035, 0.26, 5)), std(k % 2 ? PAL.lavender : '#8672c4', { roughness: 0.9 }), g, px + (r() - 0.5) * 0.2, h + s + 0.12 + r() * 0.08, pz + (r() - 0.5) * 0.16, false)
      stem.rotation.set((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4)
    }
  }
  if (led) ledStrip(g, w - 0.1, 0, 0.035, d / 2 + 0.012, { pool: 0.22, poolDepth: 0.9, poolZ: 0.35 })
  return g
}

/* ---------- la stanza ---------- */
function floorShape() {
  const { x0, x1, z0, z1, RL, RR } = ROOM, s = new THREE.Shape()
  // Coordinate della forma: (x, -z). Angoli davanti arrotondati, come nel disegno.
  s.moveTo(x0, -z0); s.lineTo(x1, -z0); s.lineTo(x1, -(z1 - RR))
  s.absarc(x1 - RR, -(z1 - RR), RR, 0, -Math.PI / 2, true)
  s.lineTo(x0 + RL, -z1)
  s.absarc(x0 + RL, -(z1 - RL), RL, -Math.PI / 2, -Math.PI, true)
  s.lineTo(x0, -z0)
  return s
}
function slab(parent, shape, thickness, topMat, sideMat, y = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 20 })
  const m = new THREE.Mesh(g, [topMat, sideMat]); m.rotation.x = -Math.PI / 2; m.position.y = y - thickness - 0.05
  m.receiveShadow = true; m.castShadow = true; parent.add(m)
  return m
}
function windowWall(W, root) {
  const { x0, z0, wallH: H, wallT: T } = ROOM, wall = std(PAL.wall, { roughness: 0.96 }), x = x0 - T / 2, zEnd = 6.2
  const span = zEnd - z0, mid = (z0 + zEnd) / 2
  box(root, T, 0.5, span, x, 0.25, mid, wall); box(root, T, 0.5, span, x, H - 0.25, mid, wall)
  const centers = [-8.9, -5.0, -1.1, 2.8], half = 1.45
  const edges = [z0, ...centers.flatMap((c) => [c - half, c + half]), zEnd]
  for (let i = 0; i < edges.length; i += 2) { const a = edges[i], b = edges[i + 1]; box(root, T, H - 1, b - a, x, H / 2, (a + b) / 2, wall) }
  const glass = std('#bfe3f2', { transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0.15, depthWrite: false, envMapIntensity: 1.8 })
  const frame = std(PAL.metal, { roughness: 0.5, metalness: 0.4 })
  for (const c of centers) {
    box(root, 0.03, H - 1, half * 2, x, H / 2, c, glass, false)
    for (const dz of [-half + 0.03, 0, half - 0.03]) box(root, 0.07, H - 1, 0.06, x, H / 2, c + dz, frame)
    for (const y of [0.53, 2.3, H - 0.53]) box(root, 0.07, 0.06, half * 2, x, y, c, frame)
    // Davanzale interno in pietra.
    box(root, 0.22, 0.05, half * 2 + 0.1, x0 + 0.1, 0.525, c, std(PAL.stone))
  }
  box(root, T + 0.06, 0.05, span, x, H + 0.025, mid, std(PAL.stone, { roughness: 0.9 }))
}
function buildShell(W, root) {
  const { x0, x1, z0, z1, wallH: H, wallT: T, RL, RR } = ROOM
  // Il plastico poggia su un piano neutro: una grande ombra morbida lo tiene a terra.
  const ground = mesh(geo('ground', () => new THREE.CircleGeometry(170, 48)), W.groundMat, root, 0, -ROOM.slab - 0.06, 0, false)
  ground.rotation.x = -Math.PI / 2
  const catcher = mesh(geo('ground-shadow', () => new THREE.CircleGeometry(90, 32)), W.shadowMat, root, 0, -ROOM.slab - 0.05, 0, false)
  catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true
  blob(root, 52, 40, 0.5, 1, 0.3, -ROOM.slab - 0.04)
  const tiles = track(new THREE.MeshStandardMaterial({ map: tileTex(), roughness: 0.62, metalness: 0, envMapIntensity: 0.9 }))
  slab(root, floorShape(), ROOM.slab, tiles, std(PAL.stoneDark, { roughness: 0.95 }))
  // Parete di fondo e parete delle finestre.
  const wall = std(PAL.wall, { roughness: 0.96 })
  box(root, x1 - x0 + T, H, T, (x0 + x1 - T) / 2, H / 2, z0 - T / 2, wall)
  box(root, x1 - x0 + T + 0.06, 0.05, T + 0.06, (x0 + x1 - T) / 2, H + 0.025, z0 - T / 2, std(PAL.stone, { roughness: 0.9 }))
  box(root, x1 - x0, 0.12, 0.03, (x0 + x1) / 2, 0.06, z0 + 0.015, std(PAL.stone))
  windowWall(W, root)
  // Terrazza fuori dalle finestre: doghe di legno, cipressi e ulivi.
  const deckTex = plankTex('#c9a77c', 'rgba(90,60,30,.35)'); deckTex.repeat.set(0.5, 0.5)
  const terrace = rrShape(3.4, 17.2, 0.8)
  const tm = slab(root, terrace, ROOM.slab, track(new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.8 })), std(PAL.stoneDark, { roughness: 0.95 }))
  tm.position.x = x0 - T - 1.7; tm.position.z = -2.4
  const tx = x0 - T - 1.7
  ;[[-9.8, 1], [-6.2, 0], [-2.4, 1], [1.3, 0], [4.9, 1]].forEach(([z, kind], i) => {
    if (kind) { planter(W, root, 1.1, 1.1, 0.5, tx - 0.3, 0, z, { led: false, seed: i }); olive(W, root, tx - 0.3, 0.45, z, 1.15, i + 40) }
    else { cypress(W, root, tx - 0.7, 0, z, 1.1); cypress(W, root, tx + 0.5, 0, z + 0.9, 0.85) }
  })
  // Angolo curvo davanti a sinistra: fioriera bassa con il verde, luce alla base.
  const cx = x0 + RL, cz = z1 - RL, stone = std(PAL.stone, { roughness: 0.95 })
  arcBand(root, RL - 0.75, RL - 0.12, rad(-180), rad(-97), 0.55, cx, 0, cz, stone, 36)
  const r = rng(77)
  for (let i = 0; i < 46; i++) {
    const a = rad(180 - i * 1.78 - r()), d = RL - 0.44 + (r() - 0.5) * 0.28, s = 0.2 + r() * 0.16
    const b = mesh(blobGeo(1, 1), std(r() < 0.5 ? PAL.leaf : PAL.leafDark, { flatShading: true, roughness: 0.95 }), root, cx + Math.cos(a) * d, 0.58 + s * 0.6, cz + Math.sin(a) * d)
    b.scale.set(s, s * (1 + r() * 0.8), s)
    if (i % 3 === 0) { const stem = mesh(geo('lav', () => new THREE.ConeGeometry(0.035, 0.26, 5)), std(PAL.lavender), root, b.position.x, 0.58 + s * 1.4 + 0.1, b.position.z, false); stem.rotation.z = (r() - 0.5) * 0.5 }
  }
  for (let i = 0; i < 7; i++) {
    const a = rad(176 - i * 12.5), px = cx + Math.cos(a) * (RL - 0.95), pz = cz + Math.sin(a) * (RL - 0.95)
    sph(root, 0.05, px, 0.07, pz, glow(PAL.led, 2.6), 8, 6, false); lightPool(root, 1.5, 1.5, px, pz, PAL.warm, 0.2)
  }
  // Bordo destro: un muretto basso, per non coprire la vista.
  rbox(root, 0.4, 0.42, z1 - RR - LAB.z1 - 0.2, 0.05, x1 - 0.22, 0.21, (LAB.z1 + z1 - RR) / 2 + 0.1, stone)
  arcBand(root, RR - 0.42, RR - 0.02, rad(-90), rad(0), 0.42, x1 - RR, 0, z1 - RR, stone, 20)
}
function buildDeck(W, root) {
  const { x0, x1, z0, z1, h } = DECK, w = x1 - x0, d = z1 - z0, mz = (z0 + z1) / 2, H = ROOM.wallH
  const oakTex = plankTex(PAL.oak, 'rgba(110,74,40,.3)'); oakTex.repeat.set(4, 2.4)
  rbox(root, w, h, d, 0.05, 0, h / 2, mz, std(PAL.stone, { roughness: 0.9 }))
  box(root, w - 0.12, 0.03, d - 0.1, 0, h + 0.012, mz + 0.02, track(new THREE.MeshStandardMaterial({ map: oakTex, roughness: 0.7 })))
  ledStrip(root, w - 0.3, 0, 0.05, z1 + 0.012, { pool: 0.42, poolDepth: 1.7, poolZ: 0.7 })
  // Tre gradini sul lato sinistro, con il filo di luce sotto ogni pedata: scendono verso la lounge.
  const sx0 = DECK.stairX
  for (let i = 1; i <= 2; i++) {
    const sh = h - i * (h / 3), sz = z1 + (i - 0.5) * 0.42
    rbox(root, 3.0, sh, 0.42, 0.03, sx0, sh / 2, sz, std(PAL.stone, { roughness: 0.9 }))
    box(root, 2.9, 0.025, 0.4, sx0, sh + 0.008, sz, track(new THREE.MeshStandardMaterial({ map: oakTex, roughness: 0.7 })))
    ledStrip(root, 2.8, sx0, sh - 0.03, sz + 0.215, { power: 2.4 })
  }
  // Parapetto in vetro: davanti a destra della scala, e sui due fianchi.
  const glass = std('#cfeaf5', { transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0.1, depthWrite: false, envMapIntensity: 1.8 }), rail = std(PAL.metal, { metalness: 0.5, roughness: 0.4 })
  const fa = sx0 + 1.55, fb = x1 - 0.06
  box(root, fb - fa, 0.95, 0.03, (fa + fb) / 2, h + 0.5, z1 - 0.08, glass, false); box(root, fb - fa, 0.04, 0.06, (fa + fb) / 2, h + 0.99, z1 - 0.08, rail)
  for (const px of [fa, fb]) box(root, 0.05, 1.0, 0.05, px, h + 0.5, z1 - 0.08, rail)
  for (const sx of [-1, 1]) { box(root, 0.03, 0.95, d - 0.5, sx * (x1 - 0.06), h + 0.5, mz + 0.18, glass, false); box(root, 0.06, 0.04, d - 0.5, sx * (x1 - 0.06), h + 0.99, mz + 0.18, rail) }
  // Parete a doghe di rovere con la luce dietro: è il fondale della Direzione.
  box(root, w, H - h - 0.05, 0.05, 0, h + (H - h) / 2, z0 + 0.03, std('#5a4433', { roughness: 0.9 }))
  const n = Math.floor((w - 0.1) / 0.17), slats = new THREE.InstancedMesh(geo('slat', () => new THREE.BoxGeometry(0.085, H - h - 0.28, 0.07)), std(PAL.oak, { roughness: 0.75 }), n), m4 = new THREE.Matrix4()
  for (let i = 0; i < n; i++) { m4.setPosition(x0 + 0.13 + i * 0.17, h + (H - h) / 2 - 0.02, z0 + 0.1); slats.setMatrixAt(i, m4) }
  slats.castShadow = true; slats.receiveShadow = true; root.add(slats)
  ledStrip(root, w - 0.2, 0, h + 0.07, z0 + 0.09, { power: 3 }); ledStrip(root, w - 0.2, 0, H - 0.1, z0 + 0.09, { power: 3 })
  lightPool(root, w, 2.2, 0, z0 + 1.0, PAL.warm, 0.34, h + 0.034)
  W.lights.push(pointLight(root, 0, h + 2.3, z0 + 2.6, '#ffd2a0', 26, 12))
}
function pointLight(root, x, y, z, color, night, distance, day = 0) {
  const light = new THREE.PointLight(color, 0, distance, 1.6); light.position.set(x, y, z); root.add(light)
  return { light, night, day }
}
function buildLab(W, root) {
  const { x0, x1, z0, z1, h } = LAB, w = x1 - x0, d = z1 - z0
  // Sala di vetro: moquette scura, vetrate su tre lati, la porta aperta verso la sala.
  const carpet = mesh(new THREE.ShapeGeometry(rrShape(w - 0.5, d - 0.4, 0.3), 6), track(new THREE.MeshStandardMaterial({ map: rugTex('#3b4a5e'), roughness: 1 })), root, (x0 + x1) / 2 - 0.05, 0.012, (z0 + z1) / 2 + 0.02, false)
  carpet.rotation.x = -Math.PI / 2; carpet.receiveShadow = true
  const glass = std('#cfeaf5', { transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false, envMapIntensity: 2 }), frame = std(PAL.metal, { metalness: 0.5, roughness: 0.4 })
  const pane = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), along = Math.abs(bx - ax) > Math.abs(bz - az)
    const m = box(root, along ? len : 0.03, h, along ? 0.03 : len, (ax + bx) / 2, h / 2, (az + bz) / 2, glass, false)
    box(root, along ? len : 0.07, 0.07, along ? 0.07 : len, (ax + bx) / 2, h, (az + bz) / 2, frame)
    box(root, along ? len : 0.07, 0.05, along ? 0.07 : len, (ax + bx) / 2, 0.025, (az + bz) / 2, frame)
    const posts = Math.max(1, Math.round(len / 1.5))
    for (let i = 0; i <= posts; i++) box(root, 0.06, h, 0.06, ax + (bx - ax) * i / posts, h / 2, az + (bz - az) * i / posts, frame)
    return m
  }
  pane(x0, z0, x0, z1); pane(x0, z1, x0 + 1.0, z1); pane(x0 + 2.6, z1, x1 - 0.25, z1); pane(x1 - 0.25, z1, x1 - 0.25, z0)
  box(root, 1.6, 0.07, 0.07, x0 + 1.8, h, z1, frame)
  W.lights.push(pointLight(root, (x0 + x1) / 2, 2.5, (z0 + z1) / 2, '#cfe0ff', 16, 10))
}
function buildLounge(W, parent) {
  // La lounge sta in un gruppo con la stessa scala delle persone: divano, pouf e tavolino sono della loro misura.
  const root = new THREE.Group(); root.position.set(LOUNGE.x, 0, LOUNGE.z); root.scale.setScalar(U); parent.add(root)
  const x = 0, z = 0
  const rug = mesh(geo('lounge-rug', () => new THREE.CircleGeometry(3.05, 48)), track(new THREE.MeshStandardMaterial({ map: rugTex('#d6c3a4'), roughness: 1 })), root, x, 0.013, z, false)
  rug.rotation.x = -Math.PI / 2; rug.receiveShadow = true
  const ring = mesh(geo('lounge-ring', () => new THREE.RingGeometry(2.55, 2.68, 48)), std('#b99f7a', { roughness: 1 }), root, x, 0.016, z, false); ring.rotation.x = -Math.PI / 2
  // Divano curvo color lino, rivolto verso chi guarda.
  const linen = std(PAL.linen, { roughness: 1 })
  arcBand(root, 1.5, 2.42, rad(28), rad(152), 0.4, x, 0.03, z, linen)
  arcBand(root, 2.24, 2.52, rad(24), rad(156), 0.82, x, 0.03, z, std('#e5d9c6', { roughness: 1 }))
  for (const a of [58, 90, 122]) { const c = rbox(root, 0.5, 0.34, 0.16, 0.07, x + Math.cos(rad(a)) * 2.12, 0.62, z - Math.sin(rad(a)) * 2.12, std(a === 90 ? '#c9a58a' : '#8fa6b8', { roughness: 1 })); c.rotation.y = rad(a) - Math.PI / 2 }
  blob(root, 5.6, 2.6, x, z - 1.75, 0.3)
  // Tavolino tondo, due pouf, la lampada ad arco.
  cyl(root, 0.62, 0.62, 0.05, x, 0.4, z + 0.05, std(PAL.oak, { roughness: 0.6 }), 32)
  for (const a of [0, 2.1, 4.2]) cyl(root, 0.025, 0.025, 0.38, x + Math.cos(a) * 0.4, 0.19, z + 0.05 + Math.sin(a) * 0.4, PAL.metal, 6)
  blob(root, 1.6, 1.6, x, z + 0.05, 0.3)
  cyl(root, 0.09, 0.07, 0.12, x + 0.18, 0.485, z - 0.05, std('#ffffff', { roughness: 0.4 }), 12); box(root, 0.3, 0.02, 0.22, x - 0.2, 0.435, z + 0.15, BRAND.navy)
  const poufGeo = geo('pouf', () => new THREE.SphereGeometry(0.46, 20, 14))
  for (const [a, color] of [[58, '#7f9bb5'], [128, '#7f9bb5']]) {
    const p = mesh(poufGeo, std(color, { roughness: 1 }), root, x + Math.cos(rad(a)) * 1.78, 0.24, z + Math.sin(rad(a)) * 1.78); p.scale.set(1, 0.56, 1)
    blob(root, 1.2, 1.2, p.position.x, p.position.z, 0.3)
  }
  const lampX = x + 2.75, lampZ = z - 1.25, black = std('#22252e', { roughness: 0.4, metalness: 0.6 })
  cyl(root, 0.26, 0.28, 0.06, lampX, 0.03, lampZ, std('#e8e2d6', { roughness: 0.4 }), 24)
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(lampX, 0.05, lampZ), new THREE.Vector3(lampX, 3.3, lampZ), new THREE.Vector3(x + 0.8, 2.45, z - 0.2))
  // Arco e paralume stanno in un gruppo a parte: entrando in una zona la lampada si fa da parte, come gli alberi.
  const lamp = new THREE.Group(); root.add(lamp)
  mesh(new THREE.TubeGeometry(curve, 26, 0.028, 8), black, lamp)
  const shade = mesh(geo('lamp-shade', () => new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), std('#22252e', { roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }), lamp, x + 0.8, 2.32, z - 0.2)
  shade.scale.y = 0.8
  sph(lamp, 0.1, x + 0.8, 2.34, z - 0.2, glow('#ffe2b5', 3.2), 12, 8, false)
  W.tall.push({ g: lamp, front: true })
  lightPool(root, 4.6, 4.6, x + 0.4, z, PAL.warm, 0.26)
  W.lights.push(pointLight(root, x + 0.8, 2.2, z - 0.2, '#ffd2a0', 30, 12))
  // Un ulivo giovane nella sua vasca di pietra, dietro il divano: basso, per non coprire chi lavora.
  cyl(root, 0.5, 0.42, 0.55, x - 2.7, 0.275, z - 1.65, std(PAL.stone, { roughness: 0.95 }), 8)
  olive(W, root, x - 2.7, 0.5, z - 1.65, 0.8, 3); blob(root, 1.8, 1.8, x - 2.7, z - 1.65, 0.3)
  sph(root, 0.05, x - 2.7, 0.07, z - 1.1, glow(PAL.led, 2.6), 8, 6, false); lightPool(root, 1.8, 1.8, x - 2.7, z - 1.3, PAL.warm, 0.24)
  // Posti dove fare una pausa: tre sul divano, due sui pouf, due in piedi. In coordinate della stanza.
  const center = new THREE.Vector3(LOUNGE.x, 0, LOUNGE.z), spots = []
  const world = (px, pz) => new THREE.Vector3(LOUNGE.x + px * U, 0, LOUNGE.z + pz * U)
  const face = (p) => Math.atan2(center.x - p.x, center.z - p.z)
  for (const a of [62, 90, 118]) { const p = world(Math.cos(rad(a)) * 1.95, -Math.sin(rad(a)) * 1.95); spots.push({ pos: p, yaw: face(p), sit: true, seatY: -0.02 }) }
  for (const a of [58, 128]) { const p = world(Math.cos(rad(a)) * 1.78, Math.sin(rad(a)) * 1.78); spots.push({ pos: p, yaw: face(p), sit: true, seatY: 0.0 }) }
  for (const a of [10, 172]) { const p = world(Math.cos(rad(a)) * 2.05, Math.sin(rad(a)) * 2.05 + 0.5); spots.push({ pos: p, yaw: face(p), sit: false }) }
  W.lounge = { spots, taken: new Set(), center }
}
function buildPool(W, root) {
  const { x0, x1, z0, z1 } = POOL, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, stone = std(PAL.stone, { roughness: 0.9 })
  rbox(root, w + 0.5, 0.24, 0.3, 0.04, cx, 0.12, z0 - 0.1, stone); rbox(root, w + 0.5, 0.24, 0.3, 0.04, cx, 0.12, z1 + 0.1, stone)
  rbox(root, 0.3, 0.24, d + 0.1, 0.04, x0 - 0.1, 0.12, cz, stone); rbox(root, 0.3, 0.24, d + 0.1, 0.04, x1 + 0.1, 0.12, cz, stone)
  box(root, w, 0.02, d, cx, 0.02, cz, std('#1f7f8e', { roughness: 0.6 }), false)
  const map = waterTex(); map.repeat.set(w / 2.4, d / 2.4)
  const water = track(new THREE.MeshStandardMaterial({ color: '#7fe3ee', map, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.88, emissive: '#2aa7b6', emissiveMap: map, emissiveIntensity: 0.35, envMapIntensity: 1.6 }))
  const surface = mesh(planeGeo(1, 1), water, root, cx, 0.17, cz, false); surface.rotation.x = -Math.PI / 2; surface.scale.set(w, d, 1); surface.receiveShadow = true
  const map2 = waterTex(); map2.repeat.set(w / 3.4, d / 3.4)
  const shimmer = new THREE.MeshBasicMaterial({ map: map2, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  const top = mesh(planeGeo(1, 1), shimmer, root, cx, 0.178, cz, false); top.rotation.x = -Math.PI / 2; top.scale.set(w, d, 1)
  W.tick.push((t) => { map.offset.set(t * 0.018, t * 0.011); map2.offset.set(-t * 0.014, t * 0.02) })
  W.water = { water, shimmer }
  for (let i = 0; i < 6; i++) { const lz = z0 + 0.7 + i * (d - 1.4) / 5; sph(root, 0.07, x0 + 0.22, 0.1, lz, glow('#d8fbff', 2.6), 8, 6, false) }
  W.lights.push(pointLight(root, cx, 1.1, cz, '#7fe9f5', 22, 9))
  // Bordo vasca: due poltroncine, lanterne e lavanda, come nel disegno.
  const chairGeo = geo('pouf', () => new THREE.SphereGeometry(0.46, 20, 14))
  for (const [px, pz] of [[x0 - 1.5, z1 - 0.6], [x0 - 2.3, z1 + 0.5]]) { const c = mesh(chairGeo, std(PAL.linen, { roughness: 1 }), root, px, 0.27, pz); c.scale.set(1.05, 0.6, 1.05); blob(root, 1.3, 1.3, px, pz, 0.3) }
  cyl(root, 0.3, 0.3, 0.04, x0 - 1.45, 0.42, z1 + 0.75, std(PAL.oak), 20); cyl(root, 0.03, 0.05, 0.4, x0 - 1.45, 0.2, z1 + 0.75, PAL.metal, 8)
  for (const [px, pz] of [[x0 - 0.75, z1 + 0.5], [x0 - 0.55, z0 - 0.75]]) {
    box(root, 0.2, 0.34, 0.2, px, 0.17, pz, std('#22252e', { roughness: 0.5, metalness: 0.5 }))
    box(root, 0.13, 0.22, 0.13, px, 0.17, pz, glow('#ffd9a0', 2.8), false); lightPool(root, 1.7, 1.7, px, pz, PAL.warm, 0.3)
  }
  planter(W, root, 0.6, 2.6, 0.4, x0 - 0.62, 0, cz + 0.4, { lavender: true, led: false, seed: 5 })
}
function buildWelcome(W, root) {
  // La grande fioriera all'ingresso con il logo Speaqi, come nel disegno.
  const x = 4.3, z = 10.35
  const g = planter(W, root, 5.2, 1.5, 0.82, x, 0, z, { lavender: true, seed: 11 })
  const logo = mesh(planeGeo(2.5, 2.5 * 470 / 2000), logoMat('full', 'navy'), g, 0, 0.43, 0.756, false); logo.renderOrder = 3
  olive(W, root, x + 1.2, 0.75, z - 0.1, 1.15, 8)
  blob(root, 6.4, 2.6, x, z, 0.3)
  // Fra The Deck e il Code Lab: il punto caffè, con il logo sulla parete.
  const wx = (DECK.x1 + LAB.x0) / 2, wz = ROOM.z0
  const small = mesh(planeGeo(2.6, 2.6 * 470 / 2000), logoMat('full', 'navy'), root, wx, 2.55, wz + 0.012, false); small.renderOrder = 3
  ledStrip(root, 3.0, wx, 0.05, wz + 0.05, { pool: 0.3, poolDepth: 1.5, poolZ: 0.6 })
  rbox(root, 2.9, 0.9, 0.6, 0.04, wx, 0.45, wz + 0.42, std(PAL.white, { roughness: 0.85 })); rbox(root, 3.0, 0.06, 0.66, 0.02, wx, 0.93, wz + 0.42, std(PAL.oak, { roughness: 0.5 }))
  rbox(root, 0.5, 0.48, 0.42, 0.05, wx - 0.75, 1.2, wz + 0.36, std('#22252e', { roughness: 0.35, metalness: 0.6 })); box(root, 0.3, 0.05, 0.2, wx - 0.75, 1.02, wz + 0.5, std('#c9cdd4', { metalness: 0.7, roughness: 0.3 }))
  for (let k = 0; k < 4; k++) cyl(root, 0.045, 0.038, 0.09, wx - 0.1 + k * 0.16, 1.005, wz + 0.5, std(k % 2 ? '#ffffff' : BRAND.orange, { roughness: 0.4 }), 12)
  potPlant(W, root, wx + 1.05, 0.96, wz + 0.4, 0.62, PAL.stone)
  blob(root, 3.6, 1.3, wx, wz + 0.5, 0.3)
  buildBigSign(W, root)
}
/** La scritta grande Speaqi: in cima alla parete di fondo, si legge da ogni punto e di sera si accende. */
function buildBigSign(W, root) {
  const { w, h, y } = SIGN, z = ROOM.z0 - 0.2, metal = std(PAL.metal, { roughness: 0.5, metalness: 0.5 })
  for (const sx of [-0.36, -0.12, 0.12, 0.36]) box(root, 0.16, y - ROOM.wallH + 0.3, 0.16, sx * w, (y + ROOM.wallH) / 2 - 0.1, z - 0.1, metal)
  rbox(root, w, h, 0.26, 0.08, 0, y + h / 2, z, std(BRAND.ink, { roughness: 0.55 }))
  const lw = w - 1.3
  const face = mesh(planeGeo(lw, lw * 470 / 2000), new THREE.MeshBasicMaterial({ map: logoMat('full', 'white').map, transparent: true, depthWrite: false }), root, 0, y + h / 2, z + 0.135, false)
  face.material.color.setScalar(1.25); face.renderOrder = 3
  const back = mesh(planeGeo(lw, lw * 470 / 2000), logoMat('full', 'white'), root, 0, y + h / 2, z - 0.135, false); back.rotation.y = Math.PI
  ledStrip(root, w - 0.4, 0, y - 0.06, z + 0.1, { power: 2.8 })
  W.lights.push(pointLight(root, 0, y + h / 2, z + 3.2, '#a9bcff', 30, 16))
  W.sign = face
}
function buildGreen(W, root) {
  const tree = (x, z, s, seed) => { cyl(root, 0.52 * s, 0.44 * s, 0.55, x, 0.275, z, std(PAL.stone, { roughness: 0.95 }), 8); olive(W, root, x, 0.52, z, 1.2 * s, seed); blob(root, 2 * s, 2 * s, x, z, 0.3); sph(root, 0.045, x, 0.06, z + 0.55 * s, glow(PAL.led, 2.6), 8, 6, false); lightPool(root, 1.8, 1.8, x, z + 0.4, PAL.warm, 0.2) }
  tree(-13.7, 0.4, 0.9, 23); tree(14.15, 3.3, 0.82, 22); tree(-9.7, 9.5, 0.85, 24)
  potPlant(W, root, -4.85, 0, -10.35, 1.05, '#e7e1d4'); potPlant(W, root, 14.4, 0, -5.5, 1.05); potPlant(W, root, -14.35, 0, -3.6, 1.0, '#e7e1d4'); potPlant(W, root, 6.55, 0, 1.3, 0.95)
}

export function buildRoom(W) {
  const root = W.root
  buildShell(W, root); buildDeck(W, root); buildLab(W, root); buildLounge(W, root); buildPool(W, root); buildWelcome(W, root); buildGreen(W, root)
}
