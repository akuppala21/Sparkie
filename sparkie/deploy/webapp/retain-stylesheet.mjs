import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sealed = gunzipSync(readFileSync(new URL('./original-main.css.gz', import.meta.url))).toString('utf8')
const marker = '/*$vite$:1*/'
if (digest(sealed) !== '475000f11448ccbba80ae1f747361e4bccab71be373db693cf0ce8a69ee78fad') {
  throw new Error('Unexpected original Webapp stylesheet')
}

const emitter = Symbol.for('sparkie.build.retainMainStylesheet')
globalThis[emitter] = compiled => {
  if (!compiled.endsWith(marker) ||
      digest(compiled) !== '3a0adb38fead24f08a2e156a171a549fe2f365cdc5affd6b0add08b299154ac0' ||
      digest(compiled.slice(0, -marker.length)) !== 'b57464509e01a1b37fa33bc3401cceb2319f23a5daa16fb759c490827cfe8c42') {
    throw new Error('The ordinary compiler produced a different stylesheet. Review the new inputs.')
  }
  return sealed + marker
}

// Modify only the value handed to Vite for main.css. Vite hashes this value,
// removes its own marker, produces the JavaScript modules and rewrites references.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.endsWith('/vite/dist/node/chunks/node.js')) return result
    const source = Buffer.from(result.source).toString()
    if (digest(source) !== 'dab5039168ce4526f98058d84e31bf79eeed8eba558a9a27db570df893326364') {
      throw new Error('Unexpected Vite compiler')
    }
    const site = /(const referenceId = this\.emitFile\(\{\s*type: "asset",\s*name: cssAssetName,\s*originalFileName,\s*source: )chunkCSS/g
    if ([...source.matchAll(site)].length !== 1) throw new Error('Unexpected Vite asset emitter')
    return { ...result, source: source.replace(site, '$1cssAssetName === "main.css" ? globalThis[Symbol.for("sparkie.build.retainMainStylesheet")](chunkCSS) : chunkCSS') }
  }
})
