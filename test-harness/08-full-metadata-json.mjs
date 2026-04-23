/**
 * Full-metadata-export smoke test: parse a real DHIS2 /api/metadata.json export
 * and validate (dry run) a subset against the server.
 *
 * Run:
 *   node test-harness/bundle-run.mjs test-harness/08-full-metadata-json.mjs
 *
 * Requires /tmp/full-all.json (fetch separately, e.g. curl a full metadata export).
 */
import fs from 'node:fs'
import { parseNativeJsonPayload } from '../src/lib/fileParser.js'
import { api, section, ok, fail, info } from './api.mjs'

let failures = 0
const expect = (label, cond) => { if (cond) ok(label); else { fail(label); failures++ } }

const path = process.env.FULL_META ?? '/tmp/full-all.json'
if (!fs.existsSync(path)) {
    info(`no file at ${path}, skipping`)
    process.exit(0)
}

section('Parse full metadata export')
const text = fs.readFileSync(path, 'utf8')
const r = parseNativeJsonPayload(text, 'metadata')
const buckets = Object.keys(r.summary).length
const total = Object.values(r.summary).reduce((a, b) => a + b, 0)
info(`file size: ${(text.length / 1024 / 1024).toFixed(1)} MB`)
info(`buckets: ${buckets}`)
info(`objects: ${total}`)
expect('parsed >= 1 bucket', buckets >= 1)
expect('parsed >= 1 object', total >= 1)
info(`top 6 buckets: ${Object.entries(r.summary).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', ')}`)

section('DHIS2 dry-run on a small subset')
try {
    await api.get('/api/me?fields=id')

    // Pick 2 buckets and take up to 10 objects from each to keep validate fast
    const entries = Object.entries(r.payload).filter(([, v]) => Array.isArray(v) && v.length > 0).slice(0, 2)
    const subset = {}
    for (const [k, v] of entries) subset[k] = v.slice(0, 10)

    const resp = await api.post(
        '/api/metadata?importStrategy=CREATE_AND_UPDATE&atomicMode=NONE&importMode=VALIDATE',
        subset,
    )
    info(`HTTP ${resp.status} status=${resp.body?.status}`)
    expect('server accepted payload (200)', resp.status === 200)
    expect('server status = OK or WARNING', ['OK', 'WARNING'].includes(resp.body?.status))
    if (resp.body?.typeReports) {
        for (const tr of resp.body.typeReports) {
            info(`  ${tr.klass}: ${JSON.stringify(tr.stats)}`)
        }
    }
} catch (e) {
    info(`skipped (no live DHIS2): ${e.message.slice(0, 120)}`)
}

console.log('\n' + (failures === 0 ? '[OK] FULL METADATA JSON IMPORT OK' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
