/**
 * E2E test: Geo import from GeoJSON.
 *
 * Flow:
 *   1. Load test-sierra-leone-districts.geojson
 *   2. Fetch matching level org units (districts) from play
 *   3. Run matchGeoJsonToOrgUnits
 *   4. Build metadata payload and POST with importMode=VALIDATE (no actual changes)
 */
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import { parseGeoJsonFile, matchGeoJsonToOrgUnits } from '../src/lib/metadataExporter.js'

const result = { flow: 'geo-import', steps: [] }
const steps = result.steps
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

try {
    section('Geo import — Sierra Leone districts')

    const geojsonPath = path.resolve('test-sierra-leone-districts.geojson')
    const raw = fs.readFileSync(geojsonPath)
    // parseGeoJsonFile supports ArrayBuffer/string input
    const parsed = parseGeoJsonFile(raw.toString('utf8'))
    step('parseGeoJsonFile', 'OK',
        `features=${parsed.features.length} propertyKeys=${parsed.propertyKeys?.join(', ')}`)

    // Fetch org units at district level (level 2 in Sierra Leone demo)
    const ous = await api.get('/api/organisationUnits?filter=level:eq:2&fields=id,name,level&paging=false')
    const orgUnits = ous.organisationUnits ?? []
    step('fetch org units (level 2)', 'OK', `count=${orgUnits.length}`)

    // Try matching by the 'name' property (which the SL districts GeoJSON uses)
    const matchProp = parsed.propertyKeys?.find(k => /name/i.test(k)) ?? parsed.propertyKeys?.[0] ?? 'name'
    const matchResult = matchGeoJsonToOrgUnits(parsed.features, matchProp, orgUnits, 'name')
    const matched = matchResult.matched ?? []
    const unmatched = matchResult.unmatched ?? []
    step('matchGeoJsonToOrgUnits',
        matched.length > 0 ? 'OK' : 'FAIL',
        `matched=${matched.length} unmatched=${unmatched.length} duplicates=${matchResult.duplicates?.length ?? 0} property="${matchProp}"`)
    if (matched.length > 0) {
        const byLevel = {}
        for (const m of matched) byLevel[m.matchLevel] = (byLevel[m.matchLevel] ?? 0) + 1
        info(`    match levels: ${JSON.stringify(byLevel)}`)
    }

    // Build a minimal metadata payload for dry-run import
    const payload = matchResult.payload ?? {
        organisationUnits: matched
            .filter(m => m.feature?.geometry)
            .map(m => ({
                id: m.orgUnit.id,
                geometry: m.feature.geometry,
            })),
    }
    step('build geo payload', 'OK', `orgUnits with geometry=${payload.organisationUnits.length}`)

    if (payload.organisationUnits.length > 0) {
        const dry = await api.post(
            '/api/metadata?importMode=VALIDATE&importStrategy=UPDATE',
            payload
        )
        const r = dry.body
        step('POST /api/metadata geometry (VALIDATE)',
            dry.ok ? (r?.status === 'OK' ? 'OK' : 'WARN') : 'FAIL',
            `http=${dry.status} status=${r?.status} stats=${JSON.stringify(r?.stats ?? {})}`)
        const errs = (r?.typeReports ?? [])
            .flatMap(tr => (tr.objectReports ?? []).flatMap(o => o.errorReports ?? []))
        if (errs.length) {
            for (const e of errs.slice(0, 3)) info(`    ${e.errorCode}: ${(e.message ?? '').slice(0, 160)}`)
        }
    } else {
        step('POST /api/metadata', 'WARN', 'no matched org units with geometry — skipping')
    }
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-geo-import.json'), JSON.stringify(result, null, 2))
