/**
 * E2E test: Aggregate data entry import.
 * Uses a simple monthly data set on play instance.
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import { generateDataEntryTemplate } from '../src/lib/templateGenerator.js'
import { parseDataEntryTemplate } from '../src/lib/fileParser.js'
import { validateDataEntryData } from '../src/lib/validator.js'
import { buildDataEntryPayload } from '../src/lib/payloadBuilder.js'

const FIELDS =
    'id,displayName,periodType,' +
    'categoryCombo[id,displayName,categoryOptionCombos[id,displayName]],' +
    'dataSetElements[dataElement[id,displayName,valueType,categoryCombo[id,displayName,categoryOptionCombos[id,displayName]],optionSet[id,displayName,options[id,displayName,code]]]],' +
    'sections[id,displayName,sortOrder,dataElements[id]],' +
    'organisationUnits[id,displayName,path]'

const result = { flow: 'aggregate-import', dataSet: null, steps: [] }
const steps = result.steps
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

try {
    section('Aggregate data entry import')

    // Pick a monthly data set whose data elements all use the default category
    // combo — that guarantees admin has write access to the category option
    // combos on the play instance (non-default COCs are often sharing-restricted).
    const list = await api.get('/api/dataSets?fields=id,displayName,periodType&pageSize=60')
    const monthly = list.dataSets.filter(d => d.periodType === 'Monthly')
    let metadata = null
    for (const cand of monthly) {
        const meta = await api.get(`/api/dataSets/${cand.id}?fields=${encodeURIComponent(FIELDS)}`)
        const allDefault = meta.dataSetElements.every(dse =>
            dse.dataElement?.categoryCombo?.displayName === 'default'
            || (dse.dataElement?.categoryCombo?.categoryOptionCombos?.length === 1
                && dse.dataElement.categoryCombo.categoryOptionCombos[0].displayName === 'default'))
        const hasOus = meta.organisationUnits?.length > 0
        if (allDefault && hasOus && meta.dataSetElements.length > 0) {
            metadata = meta
            break
        }
    }
    if (!metadata) {
        metadata = await api.get(`/api/dataSets/${monthly[0].id}?fields=${encodeURIComponent(FIELDS)}`)
    }
    result.dataSet = metadata.id
    step('pick data set', 'OK',
        `${metadata.displayName} (${metadata.id}), ${metadata.periodType}, ${metadata.dataSetElements.length} DEs, ${metadata.organisationUnits.length} OUs`)

    if (metadata.organisationUnits.length === 0) {
        throw new Error('data set has no org units assigned — pick another')
    }
    const orgUnit = metadata.organisationUnits[0].id

    const wb = generateDataEntryTemplate(metadata)
    step('generateDataEntryTemplate', 'OK', `sheets: ${wb.SheetNames.join(' | ')}`)

    // Fill in a few rows
    const ds = wb.Sheets['Data Entry']
    const headers = XLSX.utils.sheet_to_json(ds, { header: 1 })[0]
    const valueCols = headers.filter(h => /\[[A-Za-z0-9]{11}(\.[A-Za-z0-9]{11})?\]\s*$/.test(h))
    if (valueCols.length === 0) throw new Error('no data value columns found in template')

    // Use just a small subset of columns to avoid overwhelming
    const useCols = valueCols.slice(0, Math.min(5, valueCols.length))
    const period = '202501'
    const rows = []
    for (let i = 0; i < 3; i++) {
        const row = {}
        for (const h of headers) row[h] = ''
        row['ORG_UNIT_ID *'] = orgUnit
        row['PERIOD *'] = period
        for (const c of useCols) {
            // Find the DE by parsing header
            const m = c.match(/\[([A-Za-z0-9]{11})(?:\.[A-Za-z0-9]{11})?\]/)
            const deId = m?.[1]
            const de = metadata.dataSetElements.find(dse => dse.dataElement.id === deId)?.dataElement
            row[c] = synthDv(de, i)
        }
        // Vary the org unit so the three rows don't clash as duplicates
        if (i > 0 && metadata.organisationUnits[i]) row['ORG_UNIT_ID *'] = metadata.organisationUnits[i].id
        rows.push(row)
    }
    wb.Sheets['Data Entry'] = XLSX.utils.json_to_sheet(rows, { header: headers })

    const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, 'aggregate-filled.xlsx'), buf)

    const wb2 = XLSX.read(buf, { type: 'buffer' })
    const parsed = parseDataEntryTemplate(wb2, metadata)
    step('parseDataEntryTemplate', 'OK', `dataValues=${parsed.dataValues.length}`)

    const { errors, warnings } = validateDataEntryData(parsed, metadata)
    step('validate', errors.length ? 'FAIL' : 'OK',
        `errors=${errors.length} warnings=${warnings.length}${errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''}`)

    const { payload } = buildDataEntryPayload(parsed)
    step('buildDataEntryPayload', 'OK', `dataValues=${payload.dataValues.length}`)
    fs.writeFileSync(path.join(outDir, 'aggregate-payload.json'), JSON.stringify(payload, null, 2))

    // POST to /api/dataValueSets
    const sub = await api.post('/api/dataValueSets?importStrategy=CREATE_AND_UPDATE&dryRun=false', payload)
    const r = sub.body
    const ic = r?.importCount ?? r?.response?.importCount ?? {}
    const imported = ic.imported ?? 0
    const updated = ic.updated ?? 0
    const ignored = ic.ignored ?? 0
    // WARNING is acceptable if at least one value was accepted; ERROR is not.
    const acceptedSomething = imported + updated > 0
    step('POST /api/dataValueSets',
        r?.status !== 'ERROR' && (sub.ok || acceptedSomething) ? 'OK' : 'FAIL',
        `http=${sub.status} status=${r?.status} imported=${imported} updated=${updated} ignored=${ignored} conflicts=${r?.conflicts?.length ?? 0}`)
    if (r?.description) info(`    description: ${String(r.description).slice(0, 200)}`)
    if (r?.conflicts?.length) {
        for (const c of r.conflicts.slice(0, 5)) info(`    ${JSON.stringify(c).slice(0, 200)}`)
    }
    if (ignored > 0 && !r?.conflicts?.length) {
        const inner = r?.response ?? {}
        if (inner.conflicts?.length) {
            for (const c of inner.conflicts.slice(0, 5)) info(`    ${JSON.stringify(c).slice(0, 300)}`)
        } else {
            info(`    raw: ${JSON.stringify(r).slice(0, 800)}`)
        }
    }

    // Verify via GET /api/dataValueSets
    const q = `/api/dataValueSets?dataSet=${metadata.id}&period=${period}&orgUnit=${orgUnit}`
    const check = await api.get(q)
    step('verify dataValues', (check.dataValues?.length ?? 0) > 0 ? 'OK' : 'WARN',
        `returned=${check.dataValues?.length ?? 0}`)

    // Cleanup
    const del = await api.post(`/api/dataValueSets?importStrategy=DELETE`, payload)
    step('cleanup DELETE',
        del.ok && del.body?.status !== 'ERROR' ? 'OK' : 'WARN',
        `http=${del.status} status=${del.body?.status} deleted=${del.body?.importCount?.deleted ?? '?'}`)

} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-aggregate-import.json'), JSON.stringify(result, null, 2))

function synthDv(de, i = 0) {
    const vt = de?.valueType
    const os = de?.optionSet
    if (os?.options?.length) return os.options[0].code ?? os.options[0].displayName
    switch (vt) {
        case 'NUMBER': case 'INTEGER': case 'INTEGER_POSITIVE':
        case 'INTEGER_ZERO_OR_POSITIVE': return 10 + i
        case 'INTEGER_NEGATIVE': return -(10 + i)
        case 'PERCENTAGE': return 50
        case 'UNIT_INTERVAL': return 0.5
        case 'BOOLEAN': return 'true'
        case 'TRUE_ONLY': return 'true'
        case 'DATE': return '2025-01-15'
        case 'TEXT': case 'LONG_TEXT': return `T${i}`
        default: return 1
    }
}
