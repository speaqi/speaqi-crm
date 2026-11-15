import * as THREE from 'three'
import { std, mesh, cyl, canvasTex } from './kit.js'

// Gli animali dell'ufficio: il cane e il gatto girano attorno alla lounge, l'unicorno passeggia vicino alla vasca.
// Un quadrupede di forme semplici, rivolto verso +z. Le zampe ruotano dall'anca.
function quadruped(parent, o) {
  const g = new THREE.Group(); parent.add(g)
  const body = new THREE.Group(); g.add(body)
  const hipY = o.legH
  const torso = mesh(new THREE.CapsuleGeometry(o.bodyH / 2, o.bodyLen, 4, 10), std(o.color, { roughness: 0.8 }), body, 0, hipY + o.bodyH * 0.35, 0)
  torso.rotation.x = Math.PI / 2; torso.scale.x = o.bodyW / o.bodyH
  if (o.belly) mesh(new THREE.CapsuleGeometry(o.bodyH * 0.36, o.bodyLen * 0.7, 3, 8), std(o.belly, { roughness: 0.85 }), body, 0, hipY + o.bodyH * 0.12, 0.02).rotation.x = Math.PI / 2
  const legs = []
  const lx = o.bodyW * 0.32, lz = o.bodyLen * 0.48
  for (const [sx, sz, ph] of [[-1, 1, 0], [1, 1, Math.PI], [-1, -1, Math.PI], [1, -1, 0]]) {
    const hip = new THREE.Group(); hip.position.set(sx * lx, hipY + o.bodyH * 0.2, sz * lz); body.add(hip)
    cyl(hip, o.legR, o.legR * 0.85, o.legH + o.bodyH * 0.2, 0, -(o.legH + o.bodyH * 0.2) / 2, 0, o.legColor || o.color, 8)
    if (o.hoof) cyl(hip, o.legR * 1.1, o.legR * 1.15, 0.05, 0, -(o.legH + o.bodyH * 0.2) + 0.02, 0, o.hoof, 8)
    legs.push({ hip, ph })
  }
  // Collo e testa: la testa sta davanti, un po' in alto.
  const head = new THREE.Group(); body.add(head)
  const neckBase = new THREE.Vector3(0, hipY + o.bodyH * 0.7, o.bodyLen / 2 + o.bodyH * 0.15)
  if (o.neck) {
    // Collo inclinato in avanti; la testa sta sulla sua cima.
    const neck = cyl(body, o.bodyH * 0.22, o.bodyH * 0.32, o.neck, neckBase.x, neckBase.y, neckBase.z, o.color, 10)
    neck.rotation.x = 0.5
    const top = neckBase.clone().add(new THREE.Vector3(0, Math.cos(0.5), Math.sin(0.5)).multiplyScalar(o.neck / 2))
    head.position.set(0, top.y + o.head * 0.3, top.z + o.head * 0.35)
    g.userData.mane = { base: neckBase, top }
  } else head.position.set(0, hipY + o.bodyH * 0.6, o.bodyLen / 2 + o.bodyH * 0.45)
  mesh(new THREE.SphereGeometry(o.head, 14, 10), std(o.color, { roughness: 0.8 }), head)
  const snout = mesh(new THREE.SphereGeometry(o.head * 0.62, 12, 8), std(o.snout || o.color, { roughness: 0.8 }), head, 0, -o.head * 0.25, o.head * 0.75)
  snout.scale.set(1, 0.8, o.longSnout ? 1.5 : 1.1)
  mesh(new THREE.SphereGeometry(o.head * 0.16, 8, 6), std('#1b1d24'), head, 0, -o.head * 0.08, o.head * (o.longSnout ? 1.6 : 1.38), false)
  for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(o.head * 0.12, 8, 6), std('#1b1d24'), head, sx * o.head * 0.42, o.head * 0.22, o.head * 0.78, false)
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(o.head * 0.32, o.head * (o.earH || 0.8), 4), std(o.ear || o.color), head, sx * o.head * 0.55, o.head * 0.85, -o.head * 0.05, false)
    ear.rotation.z = -sx * 0.25
  }
  // Coda: un'asta dal fondo del corpo, che si muove dalla base.
  const tail = new THREE.Group(); tail.position.set(0, hipY + o.bodyH * 0.5, -o.bodyLen / 2 - o.bodyH * 0.3); body.add(tail)
  const stick = cyl(tail, o.tailR, o.tailR * 0.6, o.tailLen, 0, o.tailLen / 2, 0, o.tailColor || o.color, 8)
  tail.rotation.x = -(o.tailUp ?? 0.6); stick.castShadow = false
  return { g, body, legs, head, tail, hipY }
}
export function buildPets(W, lounge, stroll) {
  const critters = []
  const dog = quadruped(W.root, { color: '#d98c3f', belly: '#fbf3e6', snout: '#fbf3e6', ear: '#c97b30', legColor: '#d98c3f', bodyLen: 0.42, bodyH: 0.24, bodyW: 0.26, legH: 0.12, legR: 0.04, head: 0.14, earH: 0.9, longSnout: true, tailR: 0.03, tailLen: 0.14, tailUp: 0.9 })
  const cat = quadruped(W.root, { color: '#7d8796', belly: '#e8ebf0', snout: '#e8ebf0', ear: '#6a7383', bodyLen: 0.34, bodyH: 0.18, bodyW: 0.18, legH: 0.16, legR: 0.03, head: 0.12, earH: 1, tailR: 0.025, tailLen: 0.36, tailUp: 0.25 })
  critters.push({ ...dog, path: lounge, speed: 0.2, phase: 0.4, step: 11, swing: 0.6, bob: 0.025, wag: 'dog' })
  critters.push({ ...cat, path: lounge, speed: 0.2, phase: 0.02, step: 9, swing: 0.45, bob: 0.012, wag: 'cat' })
  const uni = quadruped(W.root, { color: '#fbf8fd', snout: '#f4ecf7', ear: '#fbf8fd', legColor: '#fbf8fd', hoof: '#b7a3d9', bodyLen: 0.62, bodyH: 0.34, bodyW: 0.32, legH: 0.42, legR: 0.045, head: 0.15, neck: 0.42, earH: 0.7, longSnout: true, tailR: 0.01, tailLen: 0.05, tailUp: 0.2 })
  // Corno dorato, criniera e coda arcobaleno.
  const horn = mesh(new THREE.ConeGeometry(0.045, 0.32, 10), std('#f2c14e', { metalness: 0.6, roughness: 0.3, emissive: '#7a5600', emissiveIntensity: 0.25 }), uni.head, 0, 0.26, 0.08, false)
  horn.rotation.x = 0.45
  const rainbow = ['#ff6b8b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#9775fa']
  const { base, top } = uni.g.userData.mane
  rainbow.forEach((c, k) => {
    const at = top.clone().lerp(base, k / (rainbow.length - 1)).add(new THREE.Vector3(0, 0.05, -0.07))
    mesh(new THREE.SphereGeometry(0.065, 8, 6), std(c, { roughness: 0.7 }), uni.body, 0, at.y, at.z, false)
    mesh(new THREE.SphereGeometry(0.06 - k * 0.004, 8, 6), std(c, { roughness: 0.7 }), uni.tail, 0, 0.04 + k * 0.07, -k * 0.02, false)
  })
  uni.tail.rotation.x = -0.2
  const sparkTex = canvasTex(64, 64, (ctx) => {
    const gr = ctx.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, '#fffbe6'); gr.addColorStop(1, 'rgba(255,240,180,0)')
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64)
  })
  const sparks = []
  for (let k = 0; k < 3; k++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthWrite: false }))
    sp.scale.setScalar(0.12); uni.head.add(sp); sparks.push(sp)
  }
  critters.push({ ...uni, path: stroll, speed: 0.2, phase: 1.3, step: 6.5, swing: 0.5, bob: 0.03, wag: 'unicorn', sparks })
  for (const c of critters) moveCritter(c, 0)
  W.tick.push((t) => { for (const c of critters) moveCritter(c, t) })
}
function moveCritter(c, t) {
  const a = t * c.speed + c.phase, p = c.path
  c.g.position.set(p.cx + Math.cos(a) * p.rx, 0, p.cz + Math.sin(a) * p.rz)
  // Guarda nel verso di marcia: la tangente all'ellisse.
  c.g.rotation.y = Math.atan2(-Math.sin(a) * p.rx, Math.cos(a) * p.rz)
  const f = t * c.step
  for (const leg of c.legs) leg.hip.rotation.x = Math.sin(f + leg.ph) * c.swing
  c.body.position.y = Math.abs(Math.sin(f)) * c.bob
  c.head.rotation.x = Math.sin(f * 0.5) * 0.06
  if (c.wag === 'dog') c.tail.rotation.z = Math.sin(t * 14) * 0.6
  else if (c.wag === 'cat') { c.tail.rotation.z = Math.sin(t * 1.6) * 0.35; c.tail.rotation.x = -0.25 - Math.sin(t * 1.1) * 0.15 }
  else c.tail.rotation.z = Math.sin(t * 3) * 0.25
  if (c.sparks) c.sparks.forEach((sp, k) => {
    const s = (t * 0.6 + k / 3) % 1
    sp.position.set(Math.sin(k * 2.1 + t) * 0.12, 0.42 + s * 0.3, 0.14 + Math.cos(k * 2.1 + t) * 0.08)
    sp.material.opacity = Math.sin(s * Math.PI)
  })
}
