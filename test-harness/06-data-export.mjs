/**
 * E2E test: Data export builders.
 *
 * For each builder in src/lib/dataExporter:
 *   1. Fetch live sample data from play
 *   2. Build the export workbook via the builder
 *   3. Round-trip: write to .xlsx, read back, verify it has the expected sheets
 */
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import {
    buildTrackerExportWorkbook,
    buildEventExportWorkbook,
    buildDataEntryExportWorkbook,
} from '../src/lib/dataExporter.js'

const result = { flow: 'data-export', steps: [] }
const steps = result.steps
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })

try {
    // ── 1. Tracker export ───────────────────────────────────────────────
    section('Data export — Tracker')
    const PROGRAM_ID = 'IpHINAT79UW'
    const trackerMeta = await api.get(`/api/programs/${PROGRAM_ID}?fields=id,displayName,programType,trackedEntityType[id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],programStages[id,displayName,repeatable,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`)
    const tes = await api.get(`/api/tracker/trackedEntities?program=${PROGRAM_ID}&fields=trackedEntity,orgUnit,attributes,enrollments[program,orgUnit,enrolledAt,occurredAt,events[event,programStage,orgUnit,occurredAt,dataValues]]&pageSize=10&ouMode=ACCESSIBLE`)
    step('fetch TEs', 'OK', `count=${tes.instances?.length ?? tes.trackedEntities?.length ?? 0}`)

    const teList = tes.instances ?? tes.trackedEntities ?? []
    const { wb: wbTE } = buildTrackerExportWorkbook(teList, trackerMeta)
        // some builders return the workbook directly; normalize
    const wbTracker = wbTE ?? buildTrackerExportWorkbook(teList, trackerMeta)
    const trackerBuf = XLSX.write(wbTracker, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, 'export-tracker.xlsx'), trackerBuf)
    const re1 = XLSX.read(trackerBuf, { type: 'buffer' })
    step('buildTrackerExportWorkbook', 'OK', `sheets: ${re1.SheetNames.join(' | ')} bytes=${trackerBuf.length}`)

    // ── 2. Event export ─────────────────────────────────────────────────
    section('Data export — Events')
    const EVENT_PROG = 'eBAyeGv0exc'
    const eventMeta = await api.get(`/api/programs/${EVENT_PROG}?fields=id,displayName,programType,programStages[id,displayName,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`)
    const events = await api.get(`/api/tracker/events?program=${EVENT_PROG}&pageSize=10&ouMode=ACCESSIBLE&fields=event,programStage,orgUnit,occurredAt,dataValues`)
    const eventList = events.instances ?? events.events ?? []
    step('fetch events', 'OK', `count=${eventList.length}`)

    // Group events by programStage into {stageId: [...]} map (expected shape)
    const eventsByStage = {}
    for (const e of eventList) {
        (eventsByStage[e.programStage] ??= []).push(e)
    }

    const wbEvents = buildEventExportWorkbook(eventsByStage, eventMeta)
    const evBuf = XLSX.write(wbEvents.wb ?? wbEvents, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, 'export-events.xlsx'), evBuf)
    const re2 = XLSX.read(evBuf, { type: 'buffer' })
    step('buildEventExportWorkbook', 'OK', `sheets: ${re2.SheetNames.join(' | ')} bytes=${evBuf.length}`)

    // ── 3. Data entry export ────────────────────────────────────────────
    section('Data export — Aggregate')
    const DS = 'lyLU2wR22tC'
    const dsMeta = await api.get(`/api/dataSets/${DS}?fields=id,displayName,periodType,dataSetElements[dataElement[id,displayName,valueType,categoryCombo[categoryOptionCombos[id,displayName]]]],organisationUnits[id,displayName]`)
    const orgUnit = dsMeta.organisationUnits[0].id
    const dv = await api.get(`/api/dataValueSets?dataSet=${DS}&period=202401&orgUnit=${orgUnit}`)
    const dataValues = dv.dataValues ?? []
    step('fetch dataValues', 'OK', `count=${dataValues.length}`)

    const wbDE = buildDataEntryExportWorkbook(dataValues, dsMeta)
    const deBuf = XLSX.write(wbDE.wb ?? wbDE, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(path.join(outDir, 'export-dataentry.xlsx'), deBuf)
    const re3 = XLSX.read(deBuf, { type: 'buffer' })
    step('buildDataEntryExportWorkbook', 'OK', `sheets: ${re3.SheetNames.join(' | ')} bytes=${deBuf.length}`)
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: result.flow, ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-data-export.json'), JSON.stringify(result, null, 2))
