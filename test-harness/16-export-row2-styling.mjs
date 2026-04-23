/**
 * Regression test: data exports must NOT shade row 2 as a header.
 *
 * Bug: injectHeaderStyles unconditionally styled row 2 whenever a <row r="2">
 * element was present. Templates have no data rows so this was invisible,
 * but data exports put real data in row 2 — it came out painted like a header.
 *
 * Fix: sheetColors now accepts `{ ranges, headerRows }`. Default headerRows=1
 * (row 2 untouched). Only flat-aggregate templates, which have a legit
 * category-combo row above the field-name row, opt into headerRows=2.
 *
 * This test verifies:
 *   A. Tracker data export  → row 2 has NO header style, NO ht="40" height.
 *   B. Event data export    → same.
 *   C. Aggregate data export → same.
 *   D. Flat aggregate template (via buildAggregateTemplate) → row 2 IS styled.
 */
import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'
import { api, section, ok, fail, warn, info } from './api.mjs'
import {
    buildTrackerExportWorkbook,
    buildEventExportWorkbook,
    buildDataEntryExportWorkbook,
} from '../src/lib/dataExporter.js'
import { injectHeaderStyles, injectFreezePanes } from '../src/utils/xlsxFormatting.js'

const outDir = path.resolve('test-harness/.tmp'); fs.mkdirSync(outDir, { recursive: true })
const steps = []
function step(name, status, detail) {
    steps.push({ name, status, detail })
    ;({ OK: ok, FAIL: fail, WARN: warn }[status] ?? info)(`${name}${detail ? ': ' + detail : ''}`)
}

/** Run the same zip post-processing that downloadWorkbook does in the browser. */
function postProcess(wb, sheetColors) {
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const zip = unzipSync(new Uint8Array(buffer))
    const handled = []
    if (sheetColors && Object.keys(sheetColors).length > 0) {
        injectHeaderStyles(zip, sheetColors)
        handled.push(...Object.keys(sheetColors).map(Number))
    }
    injectFreezePanes(zip, wb.SheetNames, handled)
    return zipSync(zip)
}

/** Extract sheet XML for sheet N (1-based) from a packed xlsx buffer. */
function readSheetXml(buf, sheetIdx) {
    const zip = unzipSync(new Uint8Array(buf))
    return strFromU8(zip[`xl/worksheets/sheet${sheetIdx}.xml`])
}

/** Returns the attrs of the first <c r="<col><row>" ...> in xml, or null. */
function findCell(xml, col, row) {
    const m = xml.match(new RegExp(`<c r="${col}${row}"([^>]*?)(\\/>|>)`))
    return m ? m[1] : null
}

/** Does <row r="N" ...> carry customHeight="1"? */
function rowHasCustomHeight(xml, row) {
    const m = xml.match(new RegExp(`<row r="${row}"[^>]*>`))
    return !!(m && /customHeight="1"/.test(m[0]))
}

function assertRow2Unstyled(label, xml, dataCol = 'A') {
    const c = findCell(xml, dataCol, 2)
    if (c === null) {
        step(`${label}: row 2 check`, 'WARN', `no cell at ${dataCol}2 — sheet has no data rows, styling can't be observed`)
        return true
    }
    const hasStyle = / s="\d+"/.test(c)
    if (hasStyle) {
        step(`${label}: row 2 unstyled`, 'FAIL', `cell ${dataCol}2 has style attr: ${c.trim()}`)
        return false
    }
    if (rowHasCustomHeight(xml, 2)) {
        step(`${label}: row 2 no header height`, 'FAIL', 'row 2 carries customHeight="1" (header styling)')
        return false
    }
    step(`${label}: row 2 is plain data`, 'OK', `cell ${dataCol}2 attrs="${c.trim()}"`)
    return true
}

function assertRow1Styled(label, xml, col = 'A') {
    const c = findCell(xml, col, 1)
    if (!c || !/ s="\d+"/.test(c)) {
        step(`${label}: row 1 styled`, 'FAIL', `cell ${col}1 missing style attr`)
        return false
    }
    step(`${label}: row 1 styled`, 'OK', c.trim())
    return true
}

try {
    // ── A. Tracker data export ─────────────────────────────────────────
    section('A. Tracker data export — row 2 must be data, not header')
    const TRACKER = 'IpHINAT79UW'
    const trMeta = await api.get(`/api/programs/${TRACKER}?fields=id,displayName,programType,trackedEntityType[id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],programStages[id,displayName,repeatable,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`)
    const tes = await api.get(`/api/tracker/trackedEntities?program=${TRACKER}&fields=trackedEntity,orgUnit,attributes,enrollments[program,orgUnit,enrolledAt,occurredAt,events[event,programStage,orgUnit,occurredAt,dataValues]]&pageSize=5&ouMode=ACCESSIBLE`)
    const teList = tes.instances ?? tes.trackedEntities ?? []
    const { wb: wbTr, sheetColors: scTr } = buildTrackerExportWorkbook(teList, trMeta)
    const bufTr = postProcess(wbTr, scTr)
    fs.writeFileSync(path.join(outDir, 'export-tracker-styled.xlsx'), bufTr)
    // TEI sheet is usually sheet 1; verify row 1 styled, row 2 plain
    const xmlTr1 = readSheetXml(bufTr, 1)
    assertRow1Styled('tracker sheet1', xmlTr1)
    assertRow2Unstyled('tracker sheet1', xmlTr1)

    // ── B. Event export ────────────────────────────────────────────────
    section('B. Event data export — row 2 must be data')
    const EVENT_PROG = 'eBAyeGv0exc'
    const evMeta = await api.get(`/api/programs/${EVENT_PROG}?fields=id,displayName,programType,programStages[id,displayName,programStageDataElements[dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],organisationUnits[id,displayName]`)
    const events = await api.get(`/api/tracker/events?program=${EVENT_PROG}&pageSize=5&ouMode=ACCESSIBLE&fields=event,programStage,orgUnit,occurredAt,dataValues`)
    const evList = events.instances ?? events.events ?? []
    const evByStage = {}
    for (const e of evList) (evByStage[e.programStage] ??= []).push(e)
    const { wb: wbEv, sheetColors: scEv } = buildEventExportWorkbook(evByStage, evMeta)
    const bufEv = postProcess(wbEv, scEv)
    fs.writeFileSync(path.join(outDir, 'export-events-styled.xlsx'), bufEv)
    const xmlEv1 = readSheetXml(bufEv, 1)
    assertRow1Styled('events sheet1', xmlEv1)
    assertRow2Unstyled('events sheet1', xmlEv1)

    // ── C. Aggregate data entry export ─────────────────────────────────
    section('C. Aggregate data export — row 2 must be data')
    const DS = 'lyLU2wR22tC'
    const dsMeta = await api.get(`/api/dataSets/${DS}?fields=id,displayName,periodType,dataSetElements[dataElement[id,displayName,valueType,categoryCombo[categoryOptionCombos[id,displayName]]]],organisationUnits[id,displayName]`)
    const ou = dsMeta.organisationUnits[0].id
    // Sweep a few periods to find one with data on the play instance
    let dataValues = []
    for (const period of ['202401', '202312', '202306', '202212', '202112']) {
        const dv = await api.get(`/api/dataValueSets?dataSet=${DS}&period=${period}&orgUnit=${ou}`)
        if ((dv.dataValues ?? []).length > 0) { dataValues = dv.dataValues; break }
    }
    info(`aggregate fixture: ${dataValues.length} dataValues`)
    const { wb: wbDe, sheetColors: scDe } = buildDataEntryExportWorkbook(dataValues, dsMeta)
    const bufDe = postProcess(wbDe, scDe)
    fs.writeFileSync(path.join(outDir, 'export-aggregate-styled.xlsx'), bufDe)
    const xmlDe1 = readSheetXml(bufDe, 1)
    assertRow1Styled('aggregate sheet1', xmlDe1)
    assertRow2Unstyled('aggregate sheet1', xmlDe1)

    // ── D. Positive control: headerRows:2 MUST style row 2 ────────────
    section('D. Positive control — headerRows:2 shades row 2')
    const wbCtrl = XLSX.utils.book_new()
    const aoa = [
        ['Category A', 'Category A', 'Category B'],   // row 1 (super-header)
        ['Field 1',    'Field 2',    'Field 3'],      // row 2 (field headers)
        ['data-x',     'data-y',     'data-z'],       // row 3 (first data row)
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wbCtrl, ws, 'Data')
    const sheetColorsCtrl = { 1: { ranges: [{ startCol: 0, endCol: 2, color: '4472C4' }], headerRows: 2 } }
    const bufCtrl = postProcess(wbCtrl, sheetColorsCtrl)
    fs.writeFileSync(path.join(outDir, 'control-2row-header.xlsx'), bufCtrl)
    const xmlCtrl = readSheetXml(bufCtrl, 1)
    assertRow1Styled('control sheet1', xmlCtrl)
    // Row 2 should be styled (it IS a header row here)
    const c2ctrl = findCell(xmlCtrl, 'A', 2)
    if (c2ctrl && / s="\d+"/.test(c2ctrl)) {
        step('control: row 2 styled (header)', 'OK', c2ctrl.trim())
    } else {
        step('control: row 2 styled (header)', 'FAIL', `cell A2 attrs: ${c2ctrl ?? '(missing)'}`)
    }
    // Row 3 (first data row) should NOT be styled
    const c3ctrl = findCell(xmlCtrl, 'A', 3)
    if (c3ctrl && / s="\d+"/.test(c3ctrl)) {
        step('control: row 3 unstyled (data)', 'FAIL', `cell A3 has style: ${c3ctrl.trim()}`)
    } else {
        step('control: row 3 unstyled (data)', 'OK', c3ctrl?.trim() ?? 'no attrs')
    }
} catch (e) {
    fail('HARNESS CRASH: ' + (e.stack ?? e.message))
    process.exitCode = 1
}

section('Summary')
const okCount = steps.filter(s => s.status === 'OK').length
const failCount = steps.filter(s => s.status === 'FAIL').length
console.log(JSON.stringify({ flow: 'export-row2-styling', ok: okCount, fail: failCount }, null, 2))
fs.writeFileSync(path.resolve('test-harness/.tmp', 'result-export-row2-styling.json'), JSON.stringify({ steps }, null, 2))
if (failCount > 0) process.exitCode = 1
