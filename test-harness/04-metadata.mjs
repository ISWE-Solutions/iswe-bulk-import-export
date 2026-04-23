/**
 * E2E test: Metadata export + re-import round trip.
 *
 * For two representative types:
 *   - optionSets (special-case: two-sheet format)
 *   - dataElements (generic format)
 *
 * Flow:
 *   1. GET real metadata from play
 *   2. buildMetadataWorkbook → .xlsx buffer
 *   3. parseMetadataFile(buffer, type) → payload
 *   4. Validate structural fidelity (ids preserved, counts match)
 *   5. Try a no-op dry-run import to /api/metadata to ensure payload is API-shaped
 *
 * Does NOT create new metadata (play instance is shared).
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import { buildMetadataWorkbook, parseMetadataFile } from '../src/lib/metadataExporter.js'

// Minimal type defs mirroring MetadataTypeSelector.jsx (without React/icons).
const TYPE_OPTION_SETS = {
    key: 'optionSets',
    label: 'Option Sets',
    resource: 'optionSets',
    fields: 'id,name,code,valueType,options[id,name,code,sortOrder]',
    columns: [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name *', required: true },
        { key: 'code', label: 'Code' },
        { key: 'valueType', label: 'Value Type *', required: true },
    ],
    optionColumns: [
        { key: 'optionSet.id', label: 'Option Set ID *', required: true },
        { key: 'optionSet.name', label: 'Option Set Name', readOnly: true },
        { key: 'id', label: 'Option ID' },
        { key: 'name', label: 'Option Name *', required: true },
        { key: 'code', label: 'Option Code *', required: true },
        { key: 'sortOrder', label: 'Sort Order' },
    ],
}

const TYPE_DATA_ELEMENTS = {
    key: 'dataElements',
    label: 'Data Elements',
    resource: 'dataElements',
    fields: 'id,name,shortName,code,description,valueType,domainType,aggregationType,categoryCombo[id,name],zeroIsSignificant',
    columns: [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name *', required: true },
        { key: 'shortName', label: 'Short Name *', required: true },
        { key: 'code', label: 'Code' },
        { key: 'description', label: 'Description' },
        { key: 'valueType', label: 'Value Type *', required: true },
        { key: 'domainType', label: 'Domain Type *', required: true },
        { key: 'aggregationType', label: 'Aggregation Type *', required: true },
        { key: 'categoryCombo.id', label: 'Category Combo ID' },
        { key: 'categoryCombo.name', label: 'Category Combo Name', readOnly: true },
        { key: 'zeroIsSignificant', label: 'Zero Is Significant' },
    ],
}

const result = { flow: 'metadata-roundtrip', steps: [] }
const steps = result.steps
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

async function roundTrip(type) {
    section(`Metadata round-trip — ${type.label}`)

    const q = `/api/${type.resource}?fields=${encodeURIComponent(type.fields)}&pageSize=10`
    const apiRes = await api.get(q)
    const items = apiRes[type.resource] ?? []
    step(`fetch ${type.resource}`, 'OK', `items=${items.length}`)

    const { wb, filename } = buildMetadataWorkbook(type, items)
    step('buildMetadataWorkbook', 'OK', `sheets: ${wb.SheetNames.join(' | ')} filename=${filename}`)

    const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, filename), buf)

    // parseMetadataFile accepts either a workbook or an ArrayBuffer
    const wb2 = XLSX.read(buf, { type: 'buffer' })
    const { payload, summary } = parseMetadataFile(wb2, type)
    step('parseMetadataFile', 'OK', `summary=${JSON.stringify(summary)}`)

    const resourceKey = type.resource
    const parsedItems = payload[resourceKey] ?? []
    // Fidelity check: every original id should be present in the parsed payload
    const origIds = new Set(items.map(i => i.id).filter(Boolean))
    const parsedIds = new Set(parsedItems.map(i => i.id).filter(Boolean))
    const missing = [...origIds].filter(id => !parsedIds.has(id))
    step('id fidelity', missing.length === 0 ? 'OK' : 'FAIL',
        `orig=${origIds.size} parsed=${parsedIds.size} missing=${missing.length}`)

    // DRY RUN import to verify DHIS2 accepts the payload shape
    const dry = await api.post(
        '/api/metadata?importMode=VALIDATE&importStrategy=UPDATE',
        payload
    )
    const r = dry.body
    const okStatus = r?.status === 'OK' || r?.status === 'SUCCESS'
    const typeStats = r?.stats ?? {}
    step('POST /api/metadata?importMode=VALIDATE',
        dry.ok && okStatus ? 'OK' : (r?.status === 'WARNING' ? 'WARN' : 'FAIL'),
        `http=${dry.status} status=${r?.status} stats=${JSON.stringify(typeStats)}`)
    if (r?.typeReports?.length) {
        for (const tr of r.typeReports) {
            const errs = (tr.objectReports ?? []).flatMap(o => o.errorReports ?? [])
            const trStats = tr.stats ?? {}
            info(`    ${tr.klass}: stats=${JSON.stringify(trStats)} errors=${errs.length}`)
            for (const e of errs.slice(0, 3)) {
                info(`      ${e.errorCode}: ${(e.message ?? '').slice(0, 180)}`)
            }
        }
    }
}

try {
    await roundTrip(TYPE_OPTION_SETS)
    await roundTrip(TYPE_DATA_ELEMENTS)
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-metadata-roundtrip.json'), JSON.stringify(result, null, 2))
