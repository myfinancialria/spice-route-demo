/**
 * The server shares the browser's domain code rather than reimplementing it.
 * The core is written as TypeScript modules with extensionless imports and a
 * JSON import, neither of which Node resolves natively, so bundle it once.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('server/lib', { recursive: true })

await build({
  entryPoints: ['server/core-entry.ts'],
  outfile: 'server/lib/core.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  loader: { '.json': 'json' },
  logLevel: 'error',
})

console.log('server/lib/core.mjs built')
