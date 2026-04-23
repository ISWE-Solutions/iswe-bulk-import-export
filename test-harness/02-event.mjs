/**
 * E2E test: Event program import (Inpatient morbidity, eBAyeGv0exc).
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import { generateEventTemplate } from '../src/lib/templateGenerator.js'
import { parseUploadedFile } from '../src/lib/fileParser.js'
import { validateEventData } from '../src/lib/validator.js'
import { buildEventPayload } from '../src/lib/payloadBuilder.js'

const PROGRAM_ID = 'eBAyeGv0exc'
const PROGRAM_FIELDS =
    'id,displayName,programType,' +
    'programStages[id,displayName,repeatable,sortOrder,programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'organisationUnits[id,displayName,path]'

const result = { flow: 'event-import', program: PROGRAM_ID, steps: [] }
const steps = result.steps
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

try {
    section('Event import — Inpatient morbidity')
    const program = await api.get(`/api/programs/${PROGRAM_ID}?fields=${encodeURIComponent(PROGRAM_FIELDS)}`)
    step('fetch metadata', 'OK',
        `${program.displayName}, ${program.programStages.length} stage(s), ${program.organisationUnits.length} org units`)

    const metadata = { ...program, assignedAttributes: [], assignedDataElements: [] }
    const wb = generateEventTemplate(program, metadata)
    step('generateEventTemplate', 'OK', `sheets: ${wb.SheetNames.join(' | ')}`)

    const orgUnit = program.organisationUnits[0].id
    const today = new Date().toISOString().slice(0, 10)
    const N = 5

    for (const stage of program.programStages) {
        const stageSheetName = wb.SheetNames.find(s =>
            s !== 'Instructions' && s !== 'Validation' &&
            (s === stage.displayName.slice(0, 31) || s.toLowerCase().includes(stage.displayName.toLowerCase().slice(0, 15)))
        )
        if (!stageSheetName) { warn('no sheet for stage ' + stage.displayName); continue }
        const stageSheet = wb.Sheets[stageSheetName]
        const stageHeaders = XLSX.utils.sheet_to_json(stageSheet, { header: 1 })[0]
        const rows = []
        for (let i = 0; i < N; i++) {
            const row = {}
            for (const h of stageHeaders) row[h] = ''
            row['ORG_UNIT_ID'] = orgUnit
            // Event template uses "EVENT_DATE *" header
            const dateCol = stageHeaders.find(h => h.startsWith('EVENT_DATE'))
            if (dateCol) row[dateCol] = today
            for (const psde of stage.programStageDataElements) {
                const de = psde.dataElement
                const col = stageHeaders.find(h => h.includes(`[${de.id}]`))
                if (!col) continue
                row[col] = synthValue(de, i)
            }
            rows.push(row)
        }
        wb.Sheets[stageSheetName] = XLSX.utils.json_to_sheet(rows, { header: stageHeaders })
    }

    const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, 'event-filled.xlsx'), buf)

    const file = new File([buf], 'event-filled.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const parsed = await parseUploadedFile(file, metadata)
    const counts = Object.fromEntries(Object.entries(parsed.events).map(([k, v]) => [k, v.length]))
    step('parse events', 'OK', JSON.stringify(counts))

    const { errors, warnings } = validateEventData(parsed, metadata)
    step('validate', errors.length ? 'FAIL' : 'OK',
        `errors=${errors.length} warnings=${warnings.length}${errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''}`)

    const { payload } = buildEventPayload(parsed, metadata)
    step('buildEventPayload', 'OK', `events=${payload.events.length}`)
    fs.writeFileSync(path.join(outDir, 'event-payload.json'), JSON.stringify(payload, null, 2))

    const submission = await api.post(
        '/api/tracker?async=false&importStrategy=CREATE_AND_UPDATE&atomicMode=OBJECT',
        payload
    )
    const report = submission.body
    const status = report?.status
    const stats = report?.stats ?? {}
    const errs = collectErrors(report)
    const ignored = stats.ignored ?? 0
    step('POST /api/tracker (events)',
        errs.length === 0 && ignored === 0 ? 'OK' : 'FAIL',
        `http=${submission.status} status=${status} stats=${JSON.stringify(stats)} errors=${errs.length}`)
    if (errs.length) for (const e of errs.slice(0, 5)) info(`    ${e.errorCode}:${(e.message ?? '').slice(0, 160)}`)

    // Verify + cleanup
    const createdEvents = payload.events.map(e => e.event)
    if (createdEvents.length > 0) {
        const got = await api.get(`/api/tracker/events/${createdEvents[0]}?fields=event,programStage,occurredAt,orgUnit`)
        step('verify event', got.event === createdEvents[0] ? 'OK' : 'FAIL', JSON.stringify(got))
    }

    const del = await api.post(
        '/api/tracker?async=false&importStrategy=DELETE',
        { events: createdEvents.map(event => ({ event })) }
    )
    step('cleanup DELETE', del.ok ? 'OK' : 'WARN', `http=${del.status} status=${del.body?.status}`)
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-event-import.json'), JSON.stringify(result, null, 2))

function synthValue(de, idx = 0) {
    const vt = de.valueType
    const os = de.optionSet
    if (vt === 'FILE_RESOURCE' || vt === 'IMAGE' || vt === 'COORDINATE'
        || vt === 'ORGANISATION_UNIT' || vt === 'REFERENCE' || vt === 'USERNAME' || vt === 'URL') return ''
    if (os?.options?.length) return os.options[0].displayName
    switch (vt) {
        case 'TEXT': case 'LONG_TEXT': return `Text${idx}`
        case 'NUMBER': case 'INTEGER': case 'INTEGER_POSITIVE':
        case 'INTEGER_ZERO_OR_POSITIVE': return 1 + idx
        case 'INTEGER_NEGATIVE': return -1 - idx
        case 'PERCENTAGE': return 50
        case 'DATE': return '2026-01-15'
        case 'DATETIME': return '2026-01-15T10:00:00.000'
        case 'TRUE_ONLY': case 'BOOLEAN': return 'true'
        case 'PHONE_NUMBER': return '+23276000000'
        case 'EMAIL': return 'test@example.com'
        default: return 'X'
    }
}

function collectErrors(report) {
    if (!report) return []
    const errs = []
    if (report.validationReport?.errorReports) errs.push(...report.validationReport.errorReports)
    if (report.bundleReport?.typeReportMap) {
        for (const tr of Object.values(report.bundleReport.typeReportMap)) {
            for (const obj of tr.objectReports ?? []) errs.push(...(obj.errorReports ?? []))
        }
    }
    return errs
}
