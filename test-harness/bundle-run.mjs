/**
 * Bundle a single test harness file with esbuild and execute it.
 * Externalizes xlsx and fflate so node_modules versions are used.
 *
 * Usage: node test-harness/bundle-run.mjs test-harness/01-tracker.mjs
 */
import * as esbuild from 'esbuild'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const entry = process.argv[2]
if (!entry) {
    console.error('usage: bundle-run.mjs <entry>')
    process.exit(2)
}

const absEntry = path.resolve(entry)
const outDir = path.resolve('test-harness/.tmp')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, path.basename(entry).replace(/\.mjs$/, '.bundle.mjs'))

await esbuild.build({
    entryPoints: [absEntry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    external: ['xlsx', 'fflate'],
    target: 'node20',
    logLevel: 'error',
    banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
})

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
process.exit(r.status ?? 1)
