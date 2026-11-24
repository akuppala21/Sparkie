// Called by the bundled plugin after registering /sparks, before HashRouter mounts.
export function openFleetHomeOnColdEntry(browser = globalThis.window) {
  if (browser?.__HERMES_UI_SURFACE__ !== 'webapp') return false
  const { location, history } = browser
  const base = (browser.__HERMES_BASE_PATH__ || '').replace(/\/$/, '')
  if (location.pathname !== (base || '/') && location.pathname !== base + '/') return false
  if (location.search || (location.hash && location.hash !== '#/') || history.state !== null) return false

  const entry = browser.performance?.getEntriesByType?.('navigation')[0]
  if (entry?.type !== 'navigate') return false
  // The native browser bridge consumes ?hello before bundled plugins register.
  if (new URL(entry.name).searchParams.has('hello')) return false

  try {
    // Hermes selects the connection and profile after mount. Yield to its own
    // restore if this browser remembers a destination for any profile.
    const storage = browser.localStorage
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index) || ''
      if (key.startsWith('hermes.desktop.lastSessionId.profile.')) return false
      if (key.startsWith('hermes.desktop.lastRoute.profile.') && storage.getItem(key) !== '/') return false
    }
    history.replaceState(history.state, '', '#/sparks')
    return true
  } catch {
    // A browser that restricts storage or history keeps its native entry route.
    return false
  }
}
