import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_AREA_KEYS,
  areaForPath,
  canAccessPath,
  isAreaKey,
  resolveAllowedAreas,
} from '../src/lib/areas.ts'

test('super admin gets every area', () => {
  assert.deepEqual(resolveAllowedAreas(['pipeline'], true), ALL_AREA_KEYS)
  assert.deepEqual(resolveAllowedAreas(null, true), ALL_AREA_KEYS)
})

test('null means defaults plus oggi', () => {
  assert.deepEqual(resolveAllowedAreas(null, false), ['oggi', 'pipeline', 'contatti', 'followup'])
  assert.deepEqual(resolveAllowedAreas(undefined, false), ['oggi', 'pipeline', 'contatti', 'followup'])
})

test('empty array means only oggi', () => {
  assert.deepEqual(resolveAllowedAreas([], false), ['oggi'])
})

test('unknown and non-string keys are ignored, order follows AREAS', () => {
  assert.deepEqual(resolveAllowedAreas(['finanza', 'boh', 42, null, 'pipeline', 'finanza'], false), [
    'oggi',
    'pipeline',
    'finanza',
  ])
  assert.deepEqual(resolveAllowedAreas('finanza', false), ['oggi', 'pipeline', 'contatti', 'followup'])
})

test('isAreaKey', () => {
  assert.equal(isAreaKey('finanza'), true)
  assert.equal(isAreaKey('campagne'), false)
  assert.equal(isAreaKey(3), false)
})

test('areaForPath resolves nested paths on segment boundaries', () => {
  assert.equal(areaForPath('/contacts/123'), 'contatti')
  assert.equal(areaForPath('/impostazioni'), 'impostazioni')
  assert.equal(areaForPath('/impostazioni/email-ai'), 'impostazioni')
  assert.equal(areaForPath('/progetti'), 'progetti')
  assert.equal(areaForPath('/import'), 'import')
  assert.equal(areaForPath('/importazioni'), null)
  assert.equal(areaForPath('/contacts?scope=holding'), 'contatti')
  assert.equal(areaForPath('/qualcosa-di-nuovo'), null)
})

test('canAccessPath', () => {
  const base = resolveAllowedAreas(null, false)
  assert.equal(canAccessPath('/kanban', base, false), true)
  assert.equal(canAccessPath('/finanza', base, false), false)
  assert.equal(canAccessPath('/finanza', resolveAllowedAreas(['finanza'], false), false), true)
  // dashboard always reachable, even with nothing granted
  assert.equal(canAccessPath('/dashboard', resolveAllowedAreas([], false), false), true)
  // unmapped paths are allowed
  assert.equal(canAccessPath('/qualcosa-di-nuovo', base, false), true)
  // unknown areas (team call failed) → no client-side blocking
  assert.equal(canAccessPath('/finanza', null, false), true)
})

test('super admin paths ignore granted areas', () => {
  const everything = resolveAllowedAreas([...ALL_AREA_KEYS], false)
  for (const path of ['/acumbamail', '/hospitality', '/impostazioni/wine-project', '/impostazioni/team']) {
    assert.equal(canAccessPath(path, everything, false), false, path)
    assert.equal(canAccessPath(path, ALL_AREA_KEYS, true), true, path)
  }
  // even when areas are unknown, non-admins never pass super admin paths
  assert.equal(canAccessPath('/acumbamail', null, false), false)
})

test('pages added on main are mapped', () => {
  assert.equal(areaForPath('/todo'), 'todo')
  assert.equal(areaForPath('/navigazione'), 'navigazione')
  const base = resolveAllowedAreas(null, false)
  assert.equal(canAccessPath('/todo', base, false), false)
  assert.equal(canAccessPath('/navigazione', base, false), false)
  assert.equal(canAccessPath('/navigazione', resolveAllowedAreas(['navigazione'], false), false), true)
})

test('commerciale, incassi and whatsapp settings are super admin only', () => {
  const everything = resolveAllowedAreas([...ALL_AREA_KEYS], false)
  for (const path of ['/commerciale', '/commerciale/abc', '/incassi', '/impostazioni/whatsapp']) {
    assert.equal(canAccessPath(path, everything, false), false, path)
    assert.equal(canAccessPath(path, ALL_AREA_KEYS, true), true, path)
  }
})
