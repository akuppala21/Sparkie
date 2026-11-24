import assert from 'node:assert/strict'
import test from 'node:test'
import { openFleetHomeOnColdEntry } from '../../webapp_plugin/cold-landing.js'

function fixture(path = '/', { base = '', type = 'navigate', state = null, saved = {}, original = path } = {}) {
  const origin = 'https://sparkie.example.test'
  const location = new URL(path, origin)
  const writes = []
  const keys = Object.keys(saved)
  const browser = {
    __HERMES_UI_SURFACE__: 'webapp',
    __HERMES_BASE_PATH__: base,
    location,
    history: { state, replaceState(state, title, href) {
      writes.push({ state, title })
      location.href = new URL(href, location.href).href
    } },
    performance: { getEntriesByType: () => [{ type, name: new URL(original, origin).href }] },
    localStorage: { length: keys.length, key: index => keys[index], getItem: key => saved[key] ?? null }
  }
  return { browser, writes }
}

test('a fresh visit opens the fleet in the same history entry at the same mount path', () => {
  for (const [path, base] of [['/', ''], ['/#/', ''], ['/fleet/', '/fleet'], ['/fleet#/', '/fleet/']]) {
    const { browser, writes } = fixture(path, { base })
    const before = browser.location.pathname
    assert.equal(openFleetHomeOnColdEntry(browser), true)
    assert.equal(browser.location.pathname, before)
    assert.equal(browser.location.hash, '#/sparks')
    assert.deepEqual(writes, [{ state: null, title: '' }])
    assert.equal(openFleetHomeOnColdEntry(browser), false)
    assert.equal(writes.length, 1)
  }
})

test('explicit destinations, native windows, sign-in and other UI surfaces keep their entry', () => {
  for (const path of ['/#/capabilities', '/#/settings?tab=appearance', '/#/session-id', '/#/sparks',
    '/?profile=work#/', '/?win=quick#/', '/?hello=window-id#/', '/auth/login', '/login',
    '/#hermes-session=example', '/webapp/window', '/fleet-other/']) {
    const { browser, writes } = fixture(path)
    assert.equal(openFleetHomeOnColdEntry(browser), false, path)
    assert.deepEqual(writes, [])
  }
  const { browser, writes } = fixture('/#/', { original: '/?hello=already-consumed#/' })
  assert.equal(openFleetHomeOnColdEntry(browser), false)
  for (const surface of ['dashboard', undefined]) {
    browser.__HERMES_UI_SURFACE__ = surface
    assert.equal(openFleetHomeOnColdEntry(browser), false)
  }
  assert.deepEqual(writes, [])
})

test('an open New session, a restored history entry and a native remembered destination win', () => {
  for (const options of [
    { state: { idx: 0 } }, { state: { idx: 3, key: 'draft', usr: null } },
    { type: 'reload' }, { type: 'back_forward' },
    { saved: { 'hermes.desktop.lastRoute.profile.default': '/settings' } },
    { saved: { 'hermes.desktop.lastSessionId.profile.work': 'old-session' } }
  ]) {
    const { browser, writes } = fixture('/#/', options)
    assert.equal(openFleetHomeOnColdEntry(browser), false)
    assert.equal(browser.location.hash, '#/')
    assert.deepEqual(writes, [])
  }
  const { browser } = fixture('/#/', { saved: { 'hermes.desktop.lastRoute.profile.default': '/' } })
  assert.equal(openFleetHomeOnColdEntry(browser), true)
})

test('a browser without navigation timing or storage can still open Hermes', () => {
  const { browser, writes } = fixture()
  const performance = browser.performance
  browser.performance = undefined
  assert.equal(openFleetHomeOnColdEntry(browser), false)
  browser.performance = performance
  Object.defineProperty(browser, 'localStorage', { get() { throw new Error('Storage disabled') } })
  assert.equal(openFleetHomeOnColdEntry(browser), false)
  assert.deepEqual(writes, [])
})
