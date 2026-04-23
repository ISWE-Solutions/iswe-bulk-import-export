import * as XLSX from 'xlsx'
import { unzipSync, zipSync } from 'fflate'
import {
    buildValidationSheet,
    buildOptionSetIndex,
    collectOptionSets,
    injectDataValidations,
} from './templateGenerator'
import {
    setColumnWidths, injectHeaderStyles, injectFreezePanes,
    ENROLLMENT_COLOR, STAGE_COLORS, DATA_ENTRY_COLOR,
} from '../utils/xlsxFormatting'

/**
 * Build reverse-lookup maps for replacing UIDs/codes with display names in exports.
 * Returns { ouMap: { uid: displayName }, optDisplayMaps: { osId: { code: displayName } } }
 */
function buildReverseLookups(metadata) {
    const ouMap = {}
    for (const ou of metadata.organisationUnits ?? []) {
        ouMap[ou.id] = ou.displayName
    }
    const optDisplayMaps = {}
    for (const os of collectOptionSets(metadata)) {
        const m = {}
        for (const opt of os.options) {
            if (opt.code != null) m[opt.code] = opt.displayName ?? opt.code
        }
        optDisplayMaps[os.id] = m
    }
    return { ouMap, optDisplayMaps }
}

/**
 * Resolve a raw cell value through option set display name lookup.
 */
function resolveOptionDisplay(value, osId, optDisplayMaps) {
    if (!value || !osId || !optDisplayMaps[osId]) return value
    return optDisplayMaps[osId][value] ?? value
}

/**
 * Build an Excel workbook from tracker data (TEIs with enrollments + events).
 *
 * Output structure matches the import template:
 *  - "TEI + Enrollment" sheet with attribute columns
 *  - One sheet per program stage with data element columns
 *
 * @param {Array} trackedEntities - Array from /api/tracker/trackedEntities
 * @param {Object} metadata - Program metadata (same shape as useProgramMetadata)
 * @returns {{ wb: Object, filename: string }}
 */
export function buildTrackerExportWorkbook(trackedEntities, metadata) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { attrOs, deOs } = buildOptionSetIndex(metadata)
    const { ouMap, optDisplayMaps } = buildReverseLookups(metadata)

    const teiAttributes = extractTeiAttributes(metadata)
    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    // --- TEI + Enrollment sheet ---
    const teiHeaders = ['TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE', 'INCIDENT_DATE']
    for (const attr of teiAttributes) {
        teiHeaders.push(`${attr.name} [${attr.id}]`)
    }
    const sheetColors = {}
    const validationRules = {}

    // Validation rules for TEI sheet (sheet index 1)
    const teiDvRules = []
    if (valInfo.orgUnitRef) {
        teiDvRules.push({ col: 1, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1000, trackedEntities.length + 10) })
    }
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) {
            teiDvRules.push({ col: 4 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1000, trackedEntities.length + 10) })
        }
    }
    if (teiDvRules.length > 0) validationRules[1] = teiDvRules

    const teiRows = []
    for (const tei of trackedEntities) {
        const attrMap = Object.fromEntries(
            (tei.attributes ?? []).map((a) => [a.attribute, a.value])
        )
        const enrollment = tei.enrollments?.[0]
        const row = [
            tei.trackedEntity ?? '',
            ouMap[tei.orgUnit] ?? tei.orgUnit ?? '',
            enrollment?.enrolledAt?.slice(0, 10) ?? '',
            enrollment?.occurredAt?.slice(0, 10) ?? '',
        ]
        for (const attr of teiAttributes) {
            const raw = attrMap[attr.id] ?? ''
            row.push(resolveOptionDisplay(raw, attrOs[attr.id], optDisplayMaps))
        }
        teiRows.push(row)
    }

    const wsTei = XLSX.utils.aoa_to_sheet([teiHeaders, ...teiRows])
    setColumnWidths(wsTei, teiHeaders)
    XLSX.utils.book_append_sheet(wb, wsTei, 'TEI + Enrollment')
    sheetColors[1] = [{ startCol: 0, endCol: teiHeaders.length - 1, color: ENROLLMENT_COLOR }]

    // --- Stage sheets ---
    for (let si = 0; si < stages.length; si++) {
        const stage = stages[si]
        const dataElements = extractStageDataElements(stage)
        const label = stage.repeatable ? '(repeatable)' : '(single)'
        const headers = ['TEI_ID', 'EVENT_DATE', 'ORG_UNIT_ID']
        for (const de of dataElements) {
            headers.push(`${de.name} [${de.id}]`)
        }

        const stageRows = []
        for (const tei of trackedEntities) {
            const enrollment = tei.enrollments?.[0]
            const events = (enrollment?.events ?? []).filter(
                (e) => e.programStage === stage.id
            )
            for (const evt of events) {
                const dvMap = Object.fromEntries(
                    (evt.dataValues ?? []).map((dv) => [dv.dataElement, dv.value])
                )
                const row = [
                    tei.trackedEntity ?? '',
                    evt.occurredAt?.slice(0, 10) ?? '',
                    ouMap[evt.orgUnit] ?? evt.orgUnit ?? '',
                ]
                for (const de of dataElements) {
                    const raw = dvMap[de.id] ?? ''
                    row.push(resolveOptionDisplay(raw, deOs[de.id], optDisplayMaps))
                }
                stageRows.push(row)
            }
        }

        const ws = XLSX.utils.aoa_to_sheet([headers, ...stageRows])
        setColumnWidths(ws, headers)
        let sheetName = `${stage.displayName} ${label}`.slice(0, 31)
        if (wb.SheetNames.includes(sheetName)) {
            sheetName = `${stage.displayName}`.slice(0, 28) + '...'
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName)
        const sheetIdx = wb.SheetNames.length
        sheetColors[sheetIdx] = [{ startCol: 0, endCol: headers.length - 1, color: STAGE_COLORS[si % STAGE_COLORS.length] }]

        // Validation rules for this stage sheet
        const stageDvRules = []
        if (valInfo.orgUnitRef) {
            stageDvRules.push({ col: 2, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1000, stageRows.length + 10) })
        }
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) {
                stageDvRules.push({ col: 3 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1000, stageRows.length + 10) })
            }
        }
        if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules
    }

    // --- Validation sheet (last) ---
    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }
    if (Object.keys(validationRules).length > 0) {
        wb._validationRules = validationRules
    }

    const filename = `${metadata.displayName ?? 'Tracker'}_Export_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Build a flat (single-sheet) Excel workbook from tracker data.
 * Matches the import template layout:
 *   Row 0: Category row — "Enrollment" span + stage name spans
 *   Row 1: Column headers — Org Unit, dates, attributes, then stage date + DEs
 *   Row 2+: One row per TEI, events filled inline under their stage columns
 *
 * Repeatable stages auto-expand to the max number of events found per TEI.
 *
 * @param {Array} trackedEntities - Array from /api/tracker/trackedEntities
 * @param {Object} metadata - Program metadata
 * @returns {{ wb: Object, filename: string, sheetColors: Object }}
 */
export function buildTrackerFlatExportWorkbook(trackedEntities, metadata) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { attrOs, deOs } = buildOptionSetIndex(metadata)
    const { ouMap, optDisplayMaps } = buildReverseLookups(metadata)

    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
            name: a.trackedEntityAttribute?.displayName ?? a.displayName,
            mandatory: a.mandatory,
            valueType: a.trackedEntityAttribute?.valueType ?? a.valueType,
        })) ?? []

    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    // Determine repeat counts per stage from the actual data
    const stageRepeatCounts = {}
    for (const stage of stages) {
        if (!stage.repeatable) {
            stageRepeatCounts[stage.id] = 1
            continue
        }
        let maxEvents = 1
        for (const tei of trackedEntities) {
            const events = (tei.enrollments?.[0]?.events ?? []).filter(
                (e) => e.programStage === stage.id
            )
            if (events.length > maxEvents) maxEvents = events.length
        }
        stageRepeatCounts[stage.id] = maxEvents
    }

    // --- Build TEI / enrollment columns ---
    const systemCols = ['Org Unit [orgUnit]', 'Enrollment Date (YYYY-MM-DD)', 'Incident Date (YYYY-MM-DD)']
    const attrCols = teiAttributes.map((a) => {
        const req = a.mandatory ? ' *' : ''
        return `${a.name}${req} [${a.id}]`
    })
    const teiCols = [...systemCols, ...attrCols]

    // --- Category row + header row + merges + colors ---
    const catRow = ['Enrollment', ...new Array(teiCols.length - 1).fill('')]
    const headerRow = [...teiCols]
    const merges = []
    const colorRanges = []

    if (teiCols.length > 1) {
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: teiCols.length - 1 } })
    }
    colorRanges.push({ startCol: 0, endCol: teiCols.length - 1, color: ENROLLMENT_COLOR })

    let col = teiCols.length
    let stageColorIdx = 0

    // --- Stage column groups ---
    // stageSlots[stageId] = [ { dateCol, deCols: [{col, deId}] }, ... ] per iteration
    const stageSlots = {}

    for (const stage of stages) {
        const dataElements = stage.programStageDataElements?.map((psde) => ({
            id: psde.dataElement?.id ?? psde.id,
            name: psde.dataElement?.displayName ?? psde.displayName,
            compulsory: psde.compulsory,
        })) ?? []

        const iterations = stageRepeatCounts[stage.id] ?? 1
        stageSlots[stage.id] = []

        for (let iter = 0; iter < iterations; iter++) {
            const suffix = iterations > 1 ? ` (${iter + 1})` : ''
            const groupStart = col
            const slot = { dateCol: col, deCols: [] }

            catRow.push(stage.displayName + suffix)
            headerRow.push(`${stage.displayName}${suffix}-Date (YYYY-MM-DD)`)
            col++

            for (const de of dataElements) {
                catRow.push('')
                const req = de.compulsory ? ' *' : ''
                headerRow.push(`${de.name}${req} [${de.id}]`)
                slot.deCols.push({ col, deId: de.id })
                col++
            }

            stageSlots[stage.id].push(slot)

            if (col - 1 > groupStart) {
                merges.push({ s: { r: 0, c: groupStart }, e: { r: 0, c: col - 1 } })
            }
            colorRanges.push({
                startCol: groupStart,
                endCol: col - 1,
                color: STAGE_COLORS[stageColorIdx % STAGE_COLORS.length],
            })
            stageColorIdx++
        }
    }

    // --- Build data rows: one row per TEI ---
    const totalCols = col
    const rows = []
    for (const tei of trackedEntities) {
        const attrMap = Object.fromEntries(
            (tei.attributes ?? []).map((a) => [a.attribute, a.value])
        )
        const enrollment = tei.enrollments?.[0]
        const row = new Array(totalCols).fill('')

        // TEI / enrollment columns
        row[0] = ouMap[tei.orgUnit] ?? tei.orgUnit ?? ''
        row[1] = enrollment?.enrolledAt?.slice(0, 10) ?? ''
        row[2] = enrollment?.occurredAt?.slice(0, 10) ?? ''
        for (let i = 0; i < teiAttributes.length; i++) {
            const raw = attrMap[teiAttributes[i].id] ?? ''
            row[3 + i] = resolveOptionDisplay(raw, attrOs[teiAttributes[i].id], optDisplayMaps)
        }

        // Fill stage slots with events
        const allEvents = enrollment?.events ?? []
        for (const stage of stages) {
            const stageEvents = allEvents.filter((e) => e.programStage === stage.id)
            const slots = stageSlots[stage.id] ?? []
            for (let si = 0; si < slots.length && si < stageEvents.length; si++) {
                const evt = stageEvents[si]
                const slot = slots[si]
                row[slot.dateCol] = evt.occurredAt?.slice(0, 10) ?? ''
                const dvMap = Object.fromEntries(
                    (evt.dataValues ?? []).map((dv) => [dv.dataElement, dv.value])
                )
                for (const dc of slot.deCols) {
                    const raw = dvMap[dc.deId] ?? ''
                    row[dc.col] = resolveOptionDisplay(raw, deOs[dc.deId], optDisplayMaps)
                }
            }
        }

        rows.push(row)
    }

    const ws = XLSX.utils.aoa_to_sheet([catRow, headerRow, ...rows])
    ws['!merges'] = merges
    setColumnWidths(ws, headerRow)
    XLSX.utils.book_append_sheet(wb, ws, 'Data Entry')

    // --- Validation sheet + dropdown rules ---
    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }
    const maxRow = Math.max(1000, rows.length + 10)
    const flatDvRules = []
    // Org unit is col 0, data starts at row 3 (after category + header rows)
    if (valInfo.orgUnitRef) {
        flatDvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: 3, maxRow })
    }
    // Attribute columns with option sets
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) {
            flatDvRules.push({ col: 3 + i, ref: valInfo.optionRefs[osId], startRow: 3, maxRow })
        }
    }
    // Stage DE columns with option sets
    for (const stage of stages) {
        const slots = stageSlots[stage.id] ?? []
        for (const slot of slots) {
            for (const dc of slot.deCols) {
                const osId = deOs[dc.deId]
                if (osId && valInfo.optionRefs[osId]) {
                    flatDvRules.push({ col: dc.col, ref: valInfo.optionRefs[osId], startRow: 3, maxRow })
                }
            }
        }
    }
    if (flatDvRules.length > 0) {
        wb._validationRules = { 1: flatDvRules }
    }

    const sheetColors = { 1: colorRanges }
    const filename = `${metadata.displayName ?? 'Tracker'}_FlatExport_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Build an Excel workbook from event data (events without tracked entities).
 *
 * @param {Object} eventsMap - { [stageId]: Event[] }
 * @param {Object} metadata - Program metadata
 * @returns {{ wb: Object, filename: string }}
 */
export function buildEventExportWorkbook(eventsMap, metadata) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { deOs } = buildOptionSetIndex(metadata)
    const { ouMap, optDisplayMaps } = buildReverseLookups(metadata)
    const sheetColors = {}
    const validationRules = {}
    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    for (let si = 0; si < stages.length; si++) {
        const stage = stages[si]
        const dataElements = extractStageDataElements(stage)
        const headers = ['EVENT_DATE', 'ORG_UNIT_ID']
        for (const de of dataElements) {
            headers.push(`${de.name} [${de.id}]`)
        }

        const events = eventsMap[stage.id] ?? []
        const rows = events.map((evt) => {
            const dvMap = Object.fromEntries(
                (evt.dataValues ?? []).map((dv) => [dv.dataElement, dv.value])
            )
            const row = [
                evt.occurredAt?.slice(0, 10) ?? '',
                ouMap[evt.orgUnit] ?? evt.orgUnit ?? '',
            ]
            for (const de of dataElements) {
                const raw = dvMap[de.id] ?? ''
                row.push(resolveOptionDisplay(raw, deOs[de.id], optDisplayMaps))
            }
            return row
        })

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
        setColumnWidths(ws, headers)
        let sheetName = stage.displayName.slice(0, 31)
        if (wb.SheetNames.includes(sheetName)) {
            sheetName = stage.displayName.slice(0, 28) + '...'
        }
        XLSX.utils.book_append_sheet(wb, ws, sheetName)
        const sheetIdx = wb.SheetNames.length
        sheetColors[sheetIdx] = [{ startCol: 0, endCol: headers.length - 1, color: STAGE_COLORS[si % STAGE_COLORS.length] }]

        // Validation rules for this stage sheet
        const stageDvRules = []
        if (valInfo.orgUnitRef) {
            stageDvRules.push({ col: 1, ref: valInfo.orgUnitRef, startRow: 2, maxRow: Math.max(1000, rows.length + 10) })
        }
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) {
                stageDvRules.push({ col: 2 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: Math.max(1000, rows.length + 10) })
            }
        }
        if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules
    }

    // --- Validation sheet (last) ---
    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }
    if (Object.keys(validationRules).length > 0) {
        wb._validationRules = validationRules
    }

    const filename = `${metadata.displayName ?? 'Events'}_Export_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Build an Excel workbook from aggregate data values.
 *
 * Column format matches import template: ORG_UNIT_ID, PERIOD, then DE columns.
 *
 * @param {Array} dataValues - Array from /api/dataValueSets
 * @param {Object} metadata - Data set metadata (same shape as useDataSetMetadata)
 * @returns {{ wb: Object, filename: string }}
 */
export function buildDataEntryExportWorkbook(dataValues, metadata) {
    const wb = XLSX.utils.book_new()
    const columns = buildDataEntryColumns(metadata)

    const headers = ['ORG_UNIT_ID', 'PERIOD', ...columns.map((c) => c.header)]
    // Build a lookup: "deId" or "deId.cocId" → column index
    const colIdx = {}
    columns.forEach((c, i) => {
        const key = c.cocId ? `${c.deId}.${c.cocId}` : c.deId
        colIdx[key] = i
    })

    // Group data values by orgUnit + period
    const rowKey = (dv) => `${dv.orgUnit}||${dv.period}`
    const grouped = {}
    for (const dv of dataValues) {
        const k = rowKey(dv)
        if (!grouped[k]) grouped[k] = { orgUnit: dv.orgUnit, period: dv.period, values: {} }
        const cKey = dv.categoryOptionCombo ? `${dv.dataElement}.${dv.categoryOptionCombo}` : dv.dataElement
        grouped[k].values[cKey] = dv.value
    }

    const rows = Object.values(grouped).map((g) => {
        const row = [g.orgUnit, g.period]
        for (const col of columns) {
            const key = col.cocId ? `${col.deId}.${col.cocId}` : col.deId
            row.push(g.values[key] ?? '')
        }
        return row
    })

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    setColumnWidths(ws, headers)
    XLSX.utils.book_append_sheet(wb, ws, 'Data Entry')

    const sheetColors = { 1: [{ startCol: 0, endCol: headers.length - 1, color: '4472C4' }] }
    const filename = `${metadata.displayName ?? 'DataSet'}_Export_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Write a workbook to an Excel file and trigger browser download.
 * @param {Object} wb - XLSX workbook
 * @param {string} filename - Download filename
 * @param {Object} [sheetColors] - Optional color config for header styling: { sheetIdx: [{ startCol, endCol, color }] }
 */
export function downloadWorkbook(wb, filename, sheetColors) {
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const zip = unzipSync(new Uint8Array(buffer))

    const handledSheets = []
    if (sheetColors && Object.keys(sheetColors).length > 0) {
        injectHeaderStyles(zip, sheetColors)
        handledSheets.push(...Object.keys(sheetColors).map(Number))
    }
    if (wb._validationRules) {
        injectDataValidations(zip, wb._validationRules)
    }
    injectFreezePanes(zip, wb.SheetNames, handledSheets)
    const modified = zipSync(zip)

    const blob = new Blob([modified], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

// --- Internal helpers ---

function today() {
    return new Date().toISOString().slice(0, 10)
}

function extractTeiAttributes(metadata) {
    return (
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((tea) => ({
            id: tea.trackedEntityAttribute?.id ?? tea.id,
            name: tea.trackedEntityAttribute?.displayName ?? tea.displayName,
            valueType: tea.trackedEntityAttribute?.valueType ?? tea.valueType,
        })) ?? []
    )
}

function extractStageDataElements(stage) {
    return (
        stage.programStageDataElements?.map((psde) => ({
            id: psde.dataElement?.id ?? psde.id,
            name: psde.dataElement?.displayName ?? psde.displayName,
            valueType: psde.dataElement?.valueType ?? psde.valueType,
        })) ?? []
    )
}

function buildDataEntryColumns(dataSet) {
    const columns = []
    const dataElements = (dataSet.dataSetElements ?? []).map((dse) => dse.dataElement)
    const sections = [...(dataSet.sections ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    let orderedDes

    if (sections.length > 0) {
        const sectionDeIds = sections.flatMap((s) => (s.dataElements ?? []).map((de) => de.id))
        const deMap = Object.fromEntries(dataElements.map((de) => [de.id, de]))
        orderedDes = sectionDeIds.map((id) => deMap[id]).filter(Boolean)
        const grouped = new Set(sectionDeIds)
        for (const de of dataElements) {
            if (!grouped.has(de.id)) orderedDes.push(de)
        }
    } else {
        orderedDes = [...dataElements].sort((a, b) =>
            (a.displayName || '').localeCompare(b.displayName || '')
        )
    }

    for (const de of orderedDes) {
        const cc = de.categoryCombo
        const cocs = cc?.categoryOptionCombos ?? []
        if (cocs.length <= 1) {
            columns.push({ header: `${de.displayName} [${de.id}]`, deId: de.id, cocId: cocs[0]?.id ?? null })
        } else {
            for (const coc of cocs) {
                columns.push({ header: `${de.displayName} - ${coc.displayName} [${de.id}.${coc.id}]`, deId: de.id, cocId: coc.id })
            }
        }
    }
    return columns
}

