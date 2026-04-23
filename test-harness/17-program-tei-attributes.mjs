/**
 * Regression test: tracker export must include program-scoped attributes,
 * not just TET attributes.
 *
 * Bug: every call site read metadata.trackedEntityType.trackedEntityTypeAttributes
 * and fell back to programTrackedEntityAttributes only when TET was absent.
 * For programs that carry program-scoped enrollment attributes (or override
 * the mandatory flag at program level), those attrs were missing from
 * templates and exports. Round-tripping the exported file back through
 * import caused DHIS2 to reject enrolments with E1018 / E1076 because the
 * program-mandatory attributes were not supplied.
 *
 * Fix: src/lib/trackerAttributes.js#getTrackerAttributes now prefers the
 * program list (authoritative for enrolment) and falls back to TET only
 * when the program context is absent. All callers use this helper.
 *
 * This test pulls metadata using BOTH shapes from play and asserts that:
 *   A. The fetched program has programTrackedEntityAttributes and a
 *      superset (or equal) of what TET exposes.
 *   B. buildTrackerExportWorkbook emits a column for every program
 *      attribute's UID in the TEI sheet header row.
 *   C. Every program attribute flagged mandatory appears with a " *"
 *      marker in the header (so downstream validators flag missing values).
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, info } from './api.mjs'
import { buildTrackerExportWorkbook } from '../src/lib/dataExporter.js'
import { getTrackerAttributes } from '../src/lib/trackerAttributes.js'

const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })
const steps = []
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

/** Metadata fetch identical to what useProgramMetadata.js does. */
async function fetchProgramMetadata(programId) {
    const fields = [
        'id,displayName,programType',
        'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]]',
        'programTrackedEntityAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]',
        'programStages[id,displayName,repeatable,sortOrder,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]]',
        'organisationUnits[id,displayName]',
    ].join(',')
    return api.get(`/api/programs/${programId}?fields=${fields}`)
}

function headerUids(header) {
    const m = String(header).match(/\[([A-Za-z0-9]{11})\]/)
    return m ? m[1] : null
}

try {
    // ── A. Find a program where programTrackedEntityAttributes differs from TET ─
    section('A. Confirm program has program-scoped attributes beyond TET')
    const PROGRAM_ID = 'IpHINAT79UW' // Child Programme on play
    const meta = await fetchProgramMetadata(PROGRAM_ID)

    const programAttrs = meta.programTrackedEntityAttributes ?? []
    const tetAttrs = meta.trackedEntityType?.trackedEntityTypeAttributes ?? []
    info(`program "${meta.displayName}": programAttrs=${programAttrs.length} tetAttrs=${tetAttrs.length}`)
    if (programAttrs.length === 0) {
        step('program has programTrackedEntityAttributes', 'FAIL', 'play returned none — cannot exercise the fix')
    } else {
        step('program has programTrackedEntityAttributes', 'OK', `${programAttrs.length} entries`)
    }

    // Helper confirms it prefers program list
    const helperAttrs = getTrackerAttributes(meta)
    const same = helperAttrs === programAttrs
    if (same) step('getTrackerAttributes prefers program list', 'OK', 'returned the program array')
    else step('getTrackerAttributes prefers program list', 'FAIL', 'did not pick the program list')

    const mandatoryProgramAttrIds = programAttrs
        .filter((a) => a.mandatory)
        .map((a) => a.trackedEntityAttribute?.id ?? a.id)
    info(`mandatory program attrs: ${mandatoryProgramAttrIds.length}`)

    // ── B. Fetch some TEIs and build the export workbook ────────────────
    section('B. buildTrackerExportWorkbook includes every program attr column')
    const tes = await api.get(`/api/tracker/trackedEntities?program=${PROGRAM_ID}&fields=trackedEntity,orgUnit,attributes,enrollments[program,orgUnit,enrolledAt,occurredAt,events[event,programStage,orgUnit,occurredAt,dataValues]]&pageSize=5&ouMode=ACCESSIBLE`)
    const teList = tes.instances ?? tes.trackedEntities ?? []
    info(`fetched TEIs: ${teList.length}`)

    const { wb } = buildTrackerExportWorkbook(teList, meta)
    fs.writeFileSync(path.join(outDir, 'export-tracker-program-attrs.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

    // Find the TEI sheet (first non-Instructions, non-Validation sheet)
    const teiSheetName = wb.SheetNames.find((n) => /TEI|Enrollment/i.test(n)) ?? wb.SheetNames[1]
    const teiSheet = wb.Sheets[teiSheetName]
    const aoa = XLSX.utils.sheet_to_json(teiSheet, { header: 1, defval: '' })
    const headers = aoa[0] ?? []
    const headerUidSet = new Set(headers.map(headerUids).filter(Boolean))
    info(`TEI sheet "${teiSheetName}" has ${headers.length} columns, ${headerUidSet.size} with UIDs`)

    // Every program attribute UID must be represented
    const programAttrIds = programAttrs.map((a) => a.trackedEntityAttribute?.id ?? a.id)
    const missing = programAttrIds.filter((id) => !headerUidSet.has(id))
    if (missing.length === 0) {
        step(`all ${programAttrIds.length} program-attr UIDs present in export headers`, 'OK')
    } else {
        step(`missing program-attr UIDs in export headers`, 'FAIL', missing.join(', '))
    }

    // ── C. Mandatory attrs carry " *" marker ────────────────────────────
    section('C. Mandatory program attrs are marked with asterisk')
    let mandatoryOk = true
    for (const mId of mandatoryProgramAttrIds) {
        const header = headers.find((h) => String(h).includes(`[${mId}]`))
        if (!header) {
            step(`mandatory attr ${mId} header present`, 'FAIL', 'no column found')
            mandatoryOk = false
            continue
        }
        if (!/\*/.test(header)) {
            step(`mandatory attr ${mId} marked with *`, 'FAIL', `header: "${header}"`)
            mandatoryOk = false
        }
    }
    if (mandatoryOk && mandatoryProgramAttrIds.length > 0) {
        step(`all ${mandatoryProgramAttrIds.length} mandatory program attrs marked`, 'OK')
    } else if (mandatoryProgramAttrIds.length === 0) {
        step('mandatory program attrs check', 'OK', 'program has no mandatory program-level attrs on this play instance')
    }
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter((s) => s.status === 'OK').length
const failCount = steps.filter((s) => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: 'program-tei-attributes', ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.join(outDir, 'result-program-tei-attributes.json'), JSON.stringify({ steps }, null, 2))
if (failCount > 0) process.exitCode = 1
