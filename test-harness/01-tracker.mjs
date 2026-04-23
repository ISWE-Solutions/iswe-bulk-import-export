/**
 * E2E test: Tracker program import (Child Programme, IpHINAT79UW).
 *
 * Flow:
 *  1. Fetch program metadata from play instance (same query the app uses)
 *  2. Generate template via src/lib/templateGenerator
 *  3. Write template to disk as .xlsx for inspection
 *  4. Parse it back via src/lib/fileParser (after injecting synthetic rows)
 *  5. Validate via src/lib/validator
 *  6. Build payload via src/lib/payloadBuilder
 *  7. POST /api/tracker to play instance
 *  8. Verify created TE via GET
 *  9. Clean up — DELETE the TE
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import { generateTemplate } from '../src/lib/templateGenerator.js'
import { parseUploadedFile } from '../src/lib/fileParser.js'
import { validateParsedData } from '../src/lib/validator.js'
import { buildTrackerPayload } from '../src/lib/payloadBuilder.js'

const PROGRAM_ID = 'IpHINAT79UW' // Child Programme
const PROGRAM_FIELDS =
    'id,displayName,programType,' +
    'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'programStages[id,displayName,repeatable,sortOrder,programStageSections[id,displayName,dataElements[id]],programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'organisationUnits[id,displayName,path]'

const result = { flow: 'tracker-import', program: PROGRAM_ID, steps: [], errors: [] }

function step(name, status, detail) {
    result.steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

try {
    section('Tracker import — Child Programme')

    // 1. Fetch metadata ---------------------------------------------------
    const program = await api.get(`/api/programs/${PROGRAM_ID}?fields=${encodeURIComponent(PROGRAM_FIELDS)}`)
    step('fetch program metadata', 'OK',
        `${program.displayName}, ${program.programStages.length} stages, ${program.organisationUnits.length} org units`)

    // The app also merges program rule assignments; for test purposes the
    // raw program object is sufficient (no rules relevant to mandatory fields).
    const metadata = { ...program, assignedAttributes: [], assignedDataElements: [], ruleVarMap: {} }

    // 2. Generate template ------------------------------------------------
    const wb = generateTemplate(program, metadata)
    step('generate template', 'OK', `${wb.SheetNames.length} sheets: ${wb.SheetNames.join(', ')}`)

    // 3. Write + sanity round-trip --------------------------------------
    const outDir = path.resolve('test-harness/.tmp')
    fs.mkdirSync(outDir, { recursive: true })
    const tmplPath = path.join(outDir, 'tracker-template.xlsx')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(tmplPath, buf)
    step('write template', 'OK', `${tmplPath} (${buf.length} bytes)`)

    // 4. Inject synthetic test rows into the template --------------------
    const orgUnit = program.organisationUnits[0].id
    const teAttrs = program.trackedEntityType.trackedEntityTypeAttributes.map(a => a.trackedEntityAttribute)
    const today = new Date().toISOString().slice(0, 10)

    // TEI + Enrollment rows
    const teiSheet = wb.Sheets['TEI + Enrollment']
    const teiHeaders = XLSX.utils.sheet_to_json(teiSheet, { header: 1 })[0]
    const teiRows = []
    const N_TEI = 3
    for (let i = 0; i < N_TEI; i++) {
        const row = {}
        for (const h of teiHeaders) {
            row[h] = ''
        }
        row['TEI_ID'] = `tei-${i + 1}`
        row['ORG_UNIT_ID'] = orgUnit
        row['ENROLLMENT_DATE'] = today
        row['INCIDENT_DATE'] = today
        // Fill attribute columns with synthetic values based on value type
        for (const attr of teAttrs) {
            const col = teiHeaders.find(h => h.includes(`[${attr.id}]`))
            if (!col) continue
            row[col] = synthValue(attr, i)
        }
        teiRows.push(row)
    }
    const newTei = XLSX.utils.json_to_sheet(teiRows, { header: teiHeaders })
    wb.Sheets['TEI + Enrollment'] = newTei

    // Fill one row per TEI per non-repeatable stage (avoid E1039)
    for (const stage of program.programStages) {
        const sheetName = wb.SheetNames.find(s => s.includes(stage.id.slice(0, 5)) || s === stage.displayName.slice(0, 31))
        const actualSheetName = findStageSheet(wb, stage)
        if (!actualSheetName) {
            warn(`no sheet for stage ${stage.displayName}`)
            continue
        }
        const stageSheet = wb.Sheets[actualSheetName]
        const stageHeaders = XLSX.utils.sheet_to_json(stageSheet, { header: 1 })[0]
        const stageRows = []
        for (let i = 0; i < N_TEI; i++) {
            const row = {}
            for (const h of stageHeaders) row[h] = ''
            row['TEI_ID'] = `tei-${i + 1}`
            row['ORG_UNIT_ID'] = orgUnit
            row['EVENT_DATE'] = today
            for (const psde of stage.programStageDataElements) {
                const de = psde.dataElement
                const col = stageHeaders.find(h => h.includes(`[${de.id}]`))
                if (!col) continue
                row[col] = synthValue(de)
            }
            stageRows.push(row)
        }
        wb.Sheets[actualSheetName] = XLSX.utils.json_to_sheet(stageRows, { header: stageHeaders })
    }

    // Write the filled template back to disk
    const filledPath = path.join(outDir, 'tracker-filled.xlsx')
    const filledBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(filledPath, filledBuf)
    step('inject synthetic rows', 'OK', `${N_TEI} TEIs × ${program.programStages.length} stages`)

    // 5. Parse back via fileParser ---------------------------------------
    const file = new File([filledBuf], 'tracker-filled.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const parsed = await parseUploadedFile(file, metadata)
    const stageCounts = Object.fromEntries(
        Object.entries(parsed.stageData).map(([k, v]) => [k, v.length])
    )
    step('parseUploadedFile', 'OK',
        `TEIs=${parsed.trackedEntities.length}, stageRows=${JSON.stringify(stageCounts)}`)

    if (parsed.trackedEntities.length !== N_TEI) {
        throw new Error(`expected ${N_TEI} TEIs, got ${parsed.trackedEntities.length}`)
    }

    // 6. Validate --------------------------------------------------------
    const { errors, warnings } = validateParsedData(parsed, metadata)
    if (errors.length > 0) {
        step('validate', 'FAIL', `${errors.length} errors: ${JSON.stringify(errors.slice(0, 3))}`)
        result.errors.push({ phase: 'validate', errors: errors.slice(0, 5) })
    } else {
        step('validate', 'OK', `${warnings.length} warnings`)
    }

    // 7. Build payload ---------------------------------------------------
    const { payload, rowMap } = buildTrackerPayload(parsed, metadata)
    step('buildTrackerPayload', 'OK',
        `TEs=${payload.trackedEntities.length}, rowMap size=${Object.keys(rowMap).length}`)

    // Dump payload for inspection
    fs.writeFileSync(path.join(outDir, 'tracker-payload.json'), JSON.stringify(payload, null, 2))

    // 8. POST /api/tracker (sync for small payload) -----------------------
    const importUrl = '/api/tracker?async=false&importStrategy=CREATE_AND_UPDATE&atomicMode=OBJECT'
    const submission = await api.post(importUrl, payload)
    const report = submission.body
    const status = report?.status ?? submission.status
    const stats = report?.stats ?? report?.bundleReport?.stats ?? {}
    const errs = collectErrors(report)
    const ignored = stats?.ignored ?? 0
    const created = stats?.created ?? 0
    if (submission.ok && (status === 'OK' || status === 'SUCCESS') && errs.length === 0 && ignored === 0) {
        step('POST /api/tracker', 'OK',
            `status=${status} stats=${JSON.stringify(stats)}`)
    } else {
        const sample = errs.slice(0, 5).map(e => `${e.errorCode ?? ''}:${(e.message ?? '').slice(0, 160)}`)
        step('POST /api/tracker', errs.length > 0 || ignored > 0 ? 'FAIL' : 'WARN',
            `http=${submission.status} status=${status} stats=${JSON.stringify(stats)} errors=${errs.length}`)
        for (const s of sample) info('    ' + s)
        result.errors.push({ phase: 'submit', stats, errors: errs.slice(0, 10) })
    }

    // 9. Verify one of the created TEs -----------------------------------
    const createdUid = payload.trackedEntities[0].trackedEntity
    try {
        const te = await api.get(`/api/tracker/trackedEntities/${createdUid}?program=${PROGRAM_ID}&fields=trackedEntity,attributes,enrollments[program,events[programStage,occurredAt]]`)
        step('verify TE exists', 'OK',
            `TE=${te.trackedEntity}, attrs=${te.attributes?.length ?? 0}, enrollments=${te.enrollments?.length ?? 0}, events=${te.enrollments?.[0]?.events?.length ?? 0}`)
    } catch (e) {
        step('verify TE exists', 'FAIL', String(e.message).slice(0, 300))
    }

    // 10. Clean up via DELETE payload ------------------------------------
    const deletePayload = {
        trackedEntities: payload.trackedEntities.map(te => ({ trackedEntity: te.trackedEntity })),
    }
    const del = await api.post(
        '/api/tracker?async=false&importStrategy=DELETE',
        deletePayload
    )
    step('cleanup DELETE', del.ok ? 'OK' : 'WARN',
        `http=${del.status} status=${del.body?.status}`)
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message ?? e))
    result.errors.push({ phase: 'harness', error: String(e.stack ?? e.message) })
    process.exitCode = 1
}

// Summary -----------------------------------------------------------------
section('Summary')
const okCount = result.steps.filter(s => s.status === 'OK').length
const failCount = result.steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount, steps: result.steps.length }, null, 2))
fs.writeFileSync(
    path.resolve('test-harness/.tmp', `result-${result.flow}.json`),
    JSON.stringify(result, null, 2)
)

// ---- helpers ------------------------------------------------------------

function synthValue(attrOrDe, idx = 0) {
    const vt = attrOrDe.valueType
    const os = attrOrDe.optionSet
    const unique = !!attrOrDe.unique
    // Skip types we can't fake safely; return '' so the column stays blank.
    if (vt === 'FILE_RESOURCE' || vt === 'IMAGE' || vt === 'COORDINATE'
        || vt === 'ORGANISATION_UNIT' || vt === 'REFERENCE'
        || vt === 'TRACKER_ASSOCIATE' || vt === 'USERNAME' || vt === 'URL') {
        return ''
    }
    if (os?.options?.length) {
        // Use first option's displayName (the template uses display names)
        return os.options[0].displayName
    }
    const suffix = unique ? `-${Date.now().toString(36)}-${idx}` : ''
    switch (vt) {
        case 'TEXT':
        case 'LONG_TEXT':
            return 'TestValue' + suffix
        case 'NUMBER':
        case 'INTEGER':
        case 'INTEGER_POSITIVE':
        case 'INTEGER_ZERO_OR_POSITIVE':
            return 1
        case 'INTEGER_NEGATIVE':
            return -1
        case 'PERCENTAGE':
            return 50
        case 'DATE':
            return '2026-01-15'
        case 'DATETIME':
            return '2026-01-15T10:00:00.000'
        case 'TRUE_ONLY':
        case 'BOOLEAN':
            return 'true'
        case 'PHONE_NUMBER':
            return '+23276000000'
        case 'EMAIL':
            return 'test@example.com'
        default:
            return 'X'
    }
}

function findStageSheet(wb, stage) {
    // The template truncates stage names at 31 chars; try a few variants
    const exact = stage.displayName.slice(0, 31)
    if (wb.Sheets[exact]) return exact
    for (const s of wb.SheetNames) {
        if (s.toLowerCase().includes(stage.displayName.toLowerCase().slice(0, 15))) return s
    }
    return null
}

function collectErrors(report) {
    if (!report) return []
    const errs = []
    const tr = report.validationReport
    if (tr?.errorReports) errs.push(...tr.errorReports)
    if (report.bundleReport?.typeReportMap) {
        for (const tr of Object.values(report.bundleReport.typeReportMap)) {
            for (const obj of tr.objectReports ?? []) {
                errs.push(...(obj.errorReports ?? []))
            }
        }
    }
    return errs
}
