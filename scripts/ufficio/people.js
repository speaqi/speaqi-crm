import * as THREE from 'three'
import { BRAND, STATE_COLOR, U, std, geo, mesh, rbox, cyl, sph, capsule, planeGeo, logoMat, canvasTex, badgeTex, roundRect, hashId, lum, FONT } from './kit.js'

// Le persone dell'ufficio: una figura articolata (gomiti e ginocchia), sempre la stessa per lo stesso agente.
// Lo stato si legge dal corpo: chi lavora scrive, chi è disponibile si rilassa o va in lounge,
// chi ha un problema è in piedi con la mano alzata, chi è spento dorme sulla scrivania.

const SHIRTS = ['#1f2e45', '#ffffff', '#4f6ef7', '#ff5a1f', '#e9dfc9', '#8f9f7b', '#2e3a55', '#f0c4a8', '#f4efe4', '#3d6b66']
const SKIN = ['#f2cba9', '#e4b48c', '#cf9770', '#ad7650', '#80563a', '#f6d8bd']
const HAIR = ['#2b1d16', '#4a3020', '#1c1c1f', '#8a5a2b', '#caa25c', '#6b6f78', '#a4502c']
const PANTS = ['#262a3a', '#3a4152', '#8c7b66', '#1b1f2b', '#55607a']
const HIP = 0.86, SIT = -0.36

export function makePerson(seed, opts = {}) {
  const h = hashId(seed)
  const shirt = opts.shirt || SHIRTS[h % SHIRTS.length]
  const tone = lum(shirt) > 0.5 ? 'navy' : 'white'
  const skin = std(SKIN[(h >>> 4) % SKIN.length], { roughness: 0.65 })
  const hair = std(opts.hair || HAIR[(h >>> 8) % HAIR.length], { roughness: 0.9 })
  const pants = std(opts.pants || PANTS[(h >>> 11) % PANTS.length], { roughness: 0.9 })
  const cloth = std(shirt, { roughness: 0.92 })
  const sleeves = opts.jacket || (h >>> 17) % 3 !== 0 ? cloth : skin
  const group = new THREE.Group(), rig = new THREE.Group(), upper = new THREE.Group()
  group.add(rig); rig.add(upper); upper.position.y = HIP
  const torso = capsule(upper, 0.185, 0.3, 0, 0.3, 0, cloth); torso.scale.set(1.04, 1, 0.8)
  // Maglia Speaqi: logo intero sulla schiena, icona sul petto.
  const back = mesh(planeGeo(0.28, 0.066), logoMat('full', opts.jacket ? 'white' : tone), upper, 0, 0.43, -0.153, false); back.rotation.y = Math.PI
  mesh(planeGeo(0.085, 0.078), logoMat('icon', opts.jacket ? 'white' : tone), upper, 0.075, 0.46, 0.152, false)
  if (opts.jacket) mesh(planeGeo(0.09, 0.3), std('#ffffff'), upper, -0.03, 0.36, 0.1515, false)
  cyl(upper, 0.06, 0.07, 0.08, 0, 0.64, 0, skin, 10)
  const head = new THREE.Group(); head.position.set(0, 0.83, 0); upper.add(head)
  sph(head, 0.165, 0, 0, 0, skin, 22, 16)
  const eye = std('#1b1d24', { roughness: 0.4 })
  for (const sx of [-1, 1]) sph(head, 0.021, sx * 0.062, 0.012, 0.151, eye, 8, 6, false)
  // Capelli: sei tagli, scelti dall'identità dell'agente.
  const style = opts.style ?? (h >>> 14) % 6
  const capGeo = geo('hair-cap', () => new THREE.SphereGeometry(0.174, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5))
  const bobGeo = geo('hair-bob', () => new THREE.SphereGeometry(0.181, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.68))
  if (style === 1) mesh(bobGeo, hair, head).rotation.x = -0.5
  else if (style === 5) { const m = mesh(geo('hair-buzz', () => new THREE.SphereGeometry(0.169, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.46)), hair, head); m.rotation.x = -0.25 }
  else if (style === 4) { mesh(capGeo, hair, head).rotation.x = -0.3; for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; sph(head, 0.07, Math.cos(a) * 0.1, 0.13 + (k % 2) * 0.02, Math.sin(a) * 0.1 - 0.03, hair, 10, 8) } }
  else {
    mesh(capGeo, hair, head).rotation.x = -0.32
    if (style === 2) sph(head, 0.075, 0, 0.17, -0.07, hair, 12, 10)
    if (style === 3) { const tail = capsule(head, 0.045, 0.16, 0, -0.03, -0.185, hair); tail.rotation.x = 0.3 }
  }
  if (opts.cap) {
    const cap = std(opts.cap, { roughness: 0.85 })
    mesh(geo('cap-crown', () => new THREE.SphereGeometry(0.18, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2)), cap, head, 0, 0.012, 0)
    mesh(geo('cap-brim', () => new THREE.CylinderGeometry(0.21, 0.21, 0.02, 22, 1, false, -Math.PI / 2, Math.PI)), cap, head, 0, 0.02, 0.06)
  }
  if (opts.headphones) {
    const band = mesh(geo('hp-band', () => new THREE.TorusGeometry(0.182, 0.018, 8, 24, Math.PI)), std('#20232f', { roughness: 0.5 }), head, 0, 0.01, 0)
    band.rotation.y = 0
    for (const sx of [-1, 1]) { const cup = cyl(head, 0.062, 0.062, 0.05, sx * 0.178, -0.005, 0, std(BRAND.orange, { roughness: 0.5 }), 16); cup.rotation.z = Math.PI / 2 }
  }
  if (opts.glasses) for (const sx of [-1, 1]) mesh(geo('glass-ring', () => new THREE.TorusGeometry(0.036, 0.007, 6, 18)), std('#20232f'), head, sx * 0.062, 0.012, 0.158, false)
  const limb = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.25, 0.52, 0); upper.add(sh)
    capsule(sh, 0.056, 0.17, 0, -0.14, 0, cloth)
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el)
    capsule(el, 0.048, 0.16, 0, -0.12, 0, sleeves)
    sph(el, 0.054, 0, -0.26, 0, skin, 10, 8)
    return { sh, el }
  }
  const leg = (side) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, HIP, 0); rig.add(hip)
    capsule(hip, 0.08, 0.25, 0, -0.2, 0, pants)
    const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee)
    capsule(knee, 0.066, 0.27, 0, -0.2, 0, pants)
    rbox(knee, 0.11, 0.075, 0.25, 0.03, 0, -0.415, 0.05, std((h >>> 20) % 2 ? '#f4f1ea' : '#20232f', { roughness: 0.7 }))
    return { hip, knee }
  }
  const L = limb(-1), R = limb(1), legL = leg(-1), legR = leg(1)
  // La tazza: compare in pausa e quando si beve alla scrivania.
  const cup = new THREE.Group(); cup.position.set(0, -0.3, 0.07); R.el.add(cup); cup.visible = false
  cyl(cup, 0.036, 0.03, 0.085, 0, 0, 0, std('#ffffff', { roughness: 0.4 }), 14)
  cyl(cup, 0.03, 0.03, 0.005, 0, 0.041, 0, std('#5a3a22'), 14, false)
  group.scale.setScalar(0.96 * U)
  const parts = { rig, upper, torso, head, shL: L.sh, elL: L.el, shR: R.sh, elR: R.el, hipL: legL.hip, kneeL: legL.knee, hipR: legR.hip, kneeR: legR.knee, cup }
  return { group, parts }
}

/* ---------- pose ---------- */
function reset(P) {
  P.rig.rotation.set(0, 0, 0); P.rig.position.set(0, 0, 0); P.upper.rotation.set(0, 0, 0); P.head.rotation.set(0, 0, 0); P.torso.scale.set(1.04, 1, 0.8)
  P.shL.rotation.set(0.05, 0, -0.08); P.shR.rotation.set(0.05, 0, 0.08); P.elL.rotation.set(-0.18, 0, 0); P.elR.rotation.set(-0.18, 0, 0)
  P.hipL.rotation.set(0, 0, 0); P.hipR.rotation.set(0, 0, 0); P.kneeL.rotation.set(0, 0, 0); P.kneeR.rotation.set(0, 0, 0)
  P.cup.visible = false
}
export function poseStand(P) { reset(P) }
export function poseSit(P) {
  reset(P); P.rig.position.y = SIT
  P.hipL.rotation.x = P.hipR.rotation.x = -1.5; P.kneeL.rotation.x = P.kneeR.rotation.x = 1.42
  P.shL.rotation.set(-0.45, 0, -0.06); P.shR.rotation.set(-0.45, 0, 0.06); P.elL.rotation.x = P.elR.rotation.x = -1.25
}
export function poseRelax(P) {
  poseSit(P); P.upper.rotation.x = -0.12
  P.shL.rotation.set(-0.2, 0, -0.1); P.shR.rotation.set(-0.2, 0, 0.1); P.elL.rotation.x = P.elR.rotation.x = -1.0
}
export function poseSleep(P) {
  poseSit(P); P.upper.rotation.x = 0.82; P.head.rotation.set(0.2, 0, 0.55)
  P.shL.rotation.set(-1.75, 0, 0.35); P.shR.rotation.set(-1.75, 0, -0.35); P.elL.rotation.x = P.elR.rotation.x = -0.75
}

/* ---------- fumetti ---------- */
const bubbleMats = {}
function bubbleTex(kind) {
  if (kind === 'alert') return badgeTex('alert', STATE_COLOR.attention, '#3a2500')
  if (kind === 'work') return badgeTex('bolt', STATE_COLOR.running, '#06301b')
  if (kind === 'hand') return badgeTex('hand', BRAND.orange)
  return canvasTex(128, 128, (ctx) => {
    if (kind === 'mail') {
      ctx.fillStyle = BRAND.orange; roundRect(ctx, 10, 28, 108, 72, 12); ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(20, 40); ctx.lineTo(64, 72); ctx.lineTo(108, 40); ctx.stroke()
    } else if (kind === 'zzz') {
      ctx.font = `700 84px ${FONT.ui}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(22,25,46,.85)'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.strokeText('z', 64, 66)
      ctx.fillStyle = '#e6edff'; ctx.fillText('z', 64, 66)
    } else {
      ctx.fillStyle = '#ffffff'; roundRect(ctx, 8, 14, 112, 76, 24); ctx.fill()
      ctx.beginPath(); ctx.moveTo(30, 86); ctx.lineTo(22, 118); ctx.lineTo(54, 88); ctx.fill()
      ctx.fillStyle = BRAND.ink; for (const x of [38, 64, 90]) { ctx.beginPath(); ctx.arc(x, 52, 9, 0, Math.PI * 2); ctx.fill() }
    }
  }, true)
}
export function bubble(kind) {
  if (!bubbleMats[kind]) { bubbleMats[kind] = new THREE.SpriteMaterial({ map: bubbleTex(kind), transparent: true, depthWrite: false }); bubbleMats[kind].userData.shared = true }
  const s = new THREE.Sprite(bubbleMats[kind]); s.renderOrder = 5
  return s
}

/* ---------- comportamento ---------- */
/** Rimette la persona nello stato dell'agente: si chiama alla nascita e a ogni cambio di stato, senza ricostruire la stanza. */
export function applyState(rec) {
  const { agent, person, parts: P, station } = rec
  if (rec.trip) { rec.trip.release(); rec.trip = null }
  rec.path = []; rec.blocked = !!agent.blocked
  for (const b of rec.extras) person.remove(b)
  rec.extras = []; rec.zs = []; rec.badge = null
  station.chair.rotation.y = station.chairYaw
  person.position.copy(station.seat); person.rotation.y = station.yaw
  const add = (kind, scale, y) => { const b = bubble(kind); b.scale.setScalar(scale); b.position.set(0, y, 0); person.add(b); rec.extras.push(b); return b }
  if (agent.status === 'attention') {
    // In piedi accanto alla sedia, con la mano alzata: aspetta qualcuno.
    poseStand(P); rec.mode = 'alert'
    const side = new THREE.Vector3(0.62 * U, 0, -0.42 * U).applyAxisAngle(new THREE.Vector3(0, 1, 0), station.yaw)
    person.position.add(side); person.rotation.y = station.yaw + Math.PI * 0.82
    station.chair.rotation.y = station.chairYaw + 0.6
    rec.badge = add(agent.blocked ? 'hand' : 'alert', 0.44, 2.2)
  } else if (agent.status === 'off') {
    poseSleep(P); rec.mode = 'asleep'
    for (let k = 0; k < 3; k++) rec.zs.push(add('zzz', 0.2, 1.6))
  } else if (agent.status === 'running') {
    poseSit(P); rec.mode = 'typing'
    rec.badge = add('work', 0.36, 1.92)
  } else {
    poseRelax(P); rec.mode = 'idle'
    rec.until = 6 + (rec.phase * 9.7) % 22
  }
}
function walk(rec, points, next) {
  poseStand(rec.parts); rec.mode = 'walk'; rec.path = points.map((p) => p.clone()); rec.next = next
  if (next === 'break') rec.parts.cup.visible = false
}
export function stepPerson(rec, t, dt) {
  const { parts: P, person, station } = rec, ph = rec.phase
  if (rec.badge) { rec.badge.position.y = (rec.mode === 'alert' ? 2.2 : 1.92) + Math.abs(Math.sin(t * (rec.mode === 'alert' ? 3.2 : 2) + ph)) * (rec.mode === 'alert' ? 0.12 : 0.04) }
  if (rec.mode === 'typing') {
    P.elL.rotation.x = -1.25 + Math.sin(t * 15 + ph) * 0.07; P.elR.rotation.x = -1.25 + Math.sin(t * 15 + ph + 1.9) * 0.07
    P.head.rotation.x = 0.06 + Math.sin(t * 1.3 + ph) * 0.04; P.head.rotation.y = Math.sin(t * 0.6 + ph) * 0.14
    P.upper.rotation.x = 0.06 + Math.sin(t * 0.9 + ph) * 0.015
    if (rec.badge) rec.badge.material.rotation = 0
  } else if (rec.mode === 'idle') {
    // Rilassato alla scrivania: si guarda intorno, ogni tanto beve; poi una pausa in lounge.
    const sip = Math.sin(t * 0.35 + ph * 1.7) > 0.86
    P.cup.visible = sip
    P.shR.rotation.x = sip ? -0.9 : -0.2; P.elR.rotation.x = sip ? -1.95 + Math.sin(t * 2) * 0.05 : -1.0
    P.head.rotation.y = Math.sin(t * 0.42 + ph) * 0.45; P.head.rotation.x = sip ? -0.12 : Math.sin(t * 0.3 + ph) * 0.05
    P.upper.rotation.x = -0.12 + Math.sin(t * 0.5 + ph) * 0.02
    rec.until -= dt
    if (rec.until <= 0) {
      const trip = rec.planBreak ? rec.planBreak() : null
      if (trip) { rec.trip = trip; station.chair.rotation.y = station.chairYaw + 0.7; walk(rec, trip.out, 'break') }
      else rec.until = 14 + (ph * 5) % 9
    }
  } else if (rec.mode === 'walk') {
    const target = rec.path[0]
    const delta = target.clone().sub(person.position), flat = Math.hypot(delta.x, delta.z)
    if (flat < 0.04) {
      rec.path.shift()
      if (!rec.path.length) {
        if (rec.next === 'break') {
          const spot = rec.trip.spot
          rec.mode = 'break'; rec.until = 8 + (ph * 3.1) % 6; person.position.copy(spot.pos); person.rotation.y = spot.yaw
          if (spot.sit) { poseRelax(P); P.rig.position.y = SIT + (spot.seatY || 0) } else poseStand(P)
          P.cup.visible = true
        } else {
          if (rec.trip) { rec.trip.release(); rec.trip = null }
          rec.mode = 'idle'; rec.until = 18 + (ph * 11) % 26; poseRelax(P)
          person.position.copy(station.seat); person.rotation.y = station.yaw; station.chair.rotation.y = station.chairYaw
        }
      }
    } else {
      const step = Math.min(flat, 1.15 * dt)
      person.position.x += delta.x / flat * step; person.position.z += delta.z / flat * step
      person.position.y += delta.y * Math.min(1, step / flat)
      let diff = Math.atan2(delta.x, delta.z) - person.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      person.rotation.y += diff * Math.min(1, dt * 9)
      const s = Math.sin(t * 8.5 + ph), c = Math.cos(t * 8.5 + ph)
      P.hipL.rotation.x = s * 0.6; P.hipR.rotation.x = -s * 0.6
      P.kneeL.rotation.x = Math.max(0, c) * 0.85; P.kneeR.rotation.x = Math.max(0, -c) * 0.85
      P.shL.rotation.x = -s * 0.45; P.shR.rotation.x = s * 0.45; P.elL.rotation.x = P.elR.rotation.x = -0.4
      P.rig.position.y = Math.abs(c) * 0.035; P.upper.rotation.x = 0.05
    }
  } else if (rec.mode === 'break') {
    const sip = Math.sin(t * 0.9 + ph) > 0.55
    P.shR.rotation.x = sip ? -1.0 : -0.55; P.elR.rotation.x = sip ? -1.9 : -1.45
    P.head.rotation.y = Math.sin(t * 0.7 + ph) * 0.4; P.head.rotation.x = sip ? -0.1 : 0
    if (!rec.trip.spot.sit) { P.upper.rotation.z = Math.sin(t * 0.8 + ph) * 0.02; P.shL.rotation.x = Math.sin(t * 1.4 + ph) > 0.7 ? -0.6 : 0.05 }
    rec.until -= dt
    if (rec.until <= 0) walk(rec, rec.trip.back, 'seat')
  } else if (rec.mode === 'alert') {
    P.shR.rotation.set(-2.75 + Math.sin(t * 5 + ph) * 0.16, 0, 0.32); P.elR.rotation.x = -0.25
    P.head.rotation.y = Math.sin(t * 0.9 + ph) * 0.3; P.upper.rotation.z = Math.sin(t * 1.2 + ph) * 0.025
  } else if (rec.mode === 'asleep') {
    P.torso.scale.set(1.04 + Math.sin(t * 1.5 + ph) * 0.02, 1, 0.8 + Math.sin(t * 1.5 + ph) * 0.02)
    rec.zs.forEach((z, k) => {
      const f = ((t * 0.3 + k / 3 + ph) % 1)
      z.position.set(0.12 + f * 0.3, 1.25 + f * 0.95, 0.5 - f * 0.25)
      z.material.opacity = 1; z.scale.setScalar((0.12 + f * 0.16) * (f < 0.12 ? f / 0.12 : f > 0.75 ? (1 - f) / 0.25 : 1))
    })
  }
}
