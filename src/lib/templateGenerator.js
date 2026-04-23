import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import {
    colLetter, colRefToIndex, sortRowCells, escapeXml,
    setColumnWidths, injectHeaderStyles, injectFreezePanes,
    ENROLLMENT_COLOR, STAGE_COLORS, DATA_ENTRY_COLOR,
} from '../utils/xlsxFormatting'

/**
 * Generate an Excel template workbook from program metadata.
 *
 * Sheets:
 *  1. Instructions
 *  2. TEI + Enrollment (one row per tracked entity)
 *  3. One sheet per program stage (repeatable stages allow multiple rows per TEI)
 *  4. Validation (option set lookups)
 */
export function generateTemplate(program, metadata) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { attrOs, deOs } = buildOptionSetIndex(metadata)

    // --- Instructions sheet (sheet1.xml) ---
    const instructions = [
        ['Tracker Bulk Import Template'],
        [`Program: ${program.displayName}`],
        [`Generated: ${new Date().toISOString()}`],
        [],
        ['How to fill in this template:'],
        ['1. The "TEI + Enrollment" sheet collects tracked entity attributes and enrollment details.'],
        ['2. Each program stage has its own sheet for event data.'],
        ['3. For REPEATABLE stages, add multiple rows with the same TEI_ID to create multiple events.'],
        ['4. For NON-REPEATABLE stages, only ONE row per TEI_ID is allowed.'],
        ['5. Columns with an asterisk (*) are mandatory.'],
        ['6. Date columns use format YYYY-MM-DD.'],
        ['7. For option-set fields, select from the dropdown or use the CODE from the Validation sheet.'],
        ['8. TEI_ID is a local identifier you assign to link rows across sheets. It is NOT sent to DHIS2.'],
        [],
        ['Column Types & Validation:'],
        ['  TEXT — free text'],
        ['  LONG_TEXT — multi-line text'],
        ['  NUMBER — any numeric value (decimal allowed)'],
        ['  INTEGER — whole number only'],
        ['  POSITIVE_INTEGER — whole number > 0'],
        ['  ZERO_OR_POSITIVE_INTEGER — whole number >= 0'],
        ['  NEGATIVE_INTEGER — whole number < 0'],
        ['  PERCENTAGE — number between 0 and 100'],
        ['  UNIT_INTERVAL — decimal between 0 and 1'],
        ['  DATE / AGE — YYYY-MM-DD format'],
        ['  BOOLEAN — true or false'],
        ['  TRUE_ONLY — true or leave blank'],
        ['  PHONE_NUMBER — 7-20 character phone number'],
        ['  EMAIL — valid email address (must contain @ and .)'],
        ['  OPTION_SET — use code from Validation sheet (dropdown provided)'],
        [],
        ['Visual Indicators:'],
        ['  Grey italic columns — auto-calculated by program rules (do not edit, overwritten on import)'],
        ['  Orange highlight — duplicate value in a column that requires unique values'],
        ['  Red highlight — value not found in dropdown list'],
    ]
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions)
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    // --- TEI + Enrollment sheet (sheet2.xml) ---
    const teiHeaders = ['TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE', 'INCIDENT_DATE']
    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
            name: a.trackedEntityAttribute?.displayName ?? a.displayName,
            mandatory: a.mandatory,
            valueType: a.trackedEntityAttribute?.valueType ?? a.valueType,
            unique: a.trackedEntityAttribute?.unique ?? false,
        })) ?? []

    for (const attr of teiAttributes) {
        const required = attr.mandatory ? ' *' : ''
        teiHeaders.push(`${attr.name}${required} [${attr.id}]`)
    }

    const wsTei = XLSX.utils.aoa_to_sheet([teiHeaders])
    setColumnWidths(wsTei, teiHeaders)
    XLSX.utils.book_append_sheet(wb, wsTei, 'TEI + Enrollment')

    // Track validation rules for TEI sheet (sheet index 2)
    const teiDvRules = []
    if (valInfo.orgUnitRef) {
        teiDvRules.push({ col: 1, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1000 })
    }
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) {
            teiDvRules.push({ col: 4 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1000 })
        }
    }

    // Data-type validations for TEI attributes (skip columns with option set dropdowns)
    const teiTypeRules = []
    // Enrollment Date (col 2) and Incident Date (col 3) are date columns
    const dateVt = valueTypeToValidation('DATE')
    teiTypeRules.push({ col: 2, startRow: 2, maxRow: 1000, ...dateVt })
    teiTypeRules.push({ col: 3, startRow: 2, maxRow: 1000, ...dateVt })
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) continue // already has dropdown
        const vt = valueTypeToValidation(teiAttributes[i].valueType)
        if (vt) teiTypeRules.push({ col: 4 + i, startRow: 2, maxRow: 1000, ...vt })
    }

    // Track unique columns for duplicate highlighting
    const teiUniqueRules = teiAttributes
        .map((a, i) => a.unique ? { col: 4 + i, startRow: 2, maxRow: 1000 } : null)
        .filter(Boolean)

    const validationRules = {}
    const typeValidationRules = {}
    const uniqueRules = {}
    if (teiDvRules.length > 0) validationRules[2] = teiDvRules
    if (teiTypeRules.length > 0) typeValidationRules[2] = teiTypeRules
    if (teiUniqueRules.length > 0) uniqueRules[2] = teiUniqueRules

    // --- Stage sheets (sheet3.xml, sheet4.xml, ...) ---
    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    let sheetIdx = 3
    for (const stage of stages) {
        const label = stage.repeatable ? '(repeatable)' : '(single)'
        const headers = ['TEI_ID', 'EVENT_DATE', 'ORG_UNIT_ID']

        const dataElements =
            stage.programStageDataElements?.map((psde) => ({
                id: psde.dataElement?.id ?? psde.id,
                name: psde.dataElement?.displayName ?? psde.displayName,
                compulsory: psde.compulsory,
                valueType: psde.dataElement?.valueType ?? psde.valueType,
            })) ?? []

        for (const de of dataElements) {
            const required = de.compulsory ? ' *' : ''
            headers.push(`${de.name}${required} [${de.id}]`)
        }

        const wsStage = XLSX.utils.aoa_to_sheet([headers])
        setColumnWidths(wsStage, headers)
        let sheetName = `${stage.displayName} ${label}`.slice(0, 31)
        if (wb.SheetNames.includes(sheetName)) {
            sheetName = `${stage.displayName}`.slice(0, 28) + '...'
        }
        XLSX.utils.book_append_sheet(wb, wsStage, sheetName)

        // Track validation rules for this stage sheet
        const stageDvRules = []
        if (valInfo.orgUnitRef) {
            stageDvRules.push({ col: 2, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1000 })
        }
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) {
                stageDvRules.push({ col: 3 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1000 })
            }
        }

        // Data-type validations for stage data elements
        const stageTypeRules = []
        // EVENT_DATE (col 1) is a date column
        stageTypeRules.push({ col: 1, startRow: 2, maxRow: 1000, ...valueTypeToValidation('DATE') })
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) continue
            const vt = valueTypeToValidation(dataElements[i].valueType)
            if (vt) stageTypeRules.push({ col: 3 + i, startRow: 2, maxRow: 1000, ...vt })
        }

        if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules
        if (stageTypeRules.length > 0) typeValidationRules[sheetIdx] = stageTypeRules
        sheetIdx++
    }

    // --- Validation sheet (last) ---
    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }

    if (Object.keys(validationRules).length > 0) {
        wb._validationRules = validationRules
    }
    if (Object.keys(typeValidationRules).length > 0) {
        wb._typeValidationRules = typeValidationRules
    }
    if (Object.keys(uniqueRules).length > 0) {
        wb._uniqueRules = uniqueRules
    }

    // --- ASSIGN rule formulas for TEI sheet (sheet2) ---
    const teiFormulaCols = buildAssignFormulas(metadata, teiAttributes, teiHeaders, 2, 1000)
    if (teiFormulaCols.length > 0) {
        wb._formulaColumns = { 2: teiFormulaCols }
    }

    // --- Conditional formatting for TEI sheet + stage sheets ---
    const cfRulesAll = {}
    if (teiDvRules.length > 0) {
        cfRulesAll[2] = buildConditionalFormattingRules(teiDvRules, 2, 1000)
    }
    for (const [sIdx, dvRules] of Object.entries(validationRules)) {
        if (parseInt(sIdx) !== 2) {
            cfRulesAll[sIdx] = buildConditionalFormattingRules(dvRules, 2, 1000)
        }
    }
    if (Object.keys(cfRulesAll).length > 0) {
        wb._conditionalFormatting = cfRulesAll
    }

    // --- Header colors: enrollment blue for TEI sheet, stage colors for stage sheets ---
    const headerColors = {}
    headerColors[2] = [{ startCol: 0, endCol: teiHeaders.length - 1, color: ENROLLMENT_COLOR }]
    let stageSheetIdx = 3
    for (let si = 0; si < stages.length; si++) {
        const stage = stages[si]
        const des = stage.programStageDataElements ?? []
        const colCount = 3 + des.length // TEI_ID, EVENT_DATE, ORG_UNIT_ID + data elements
        headerColors[stageSheetIdx] = [{ startCol: 0, endCol: colCount - 1, color: STAGE_COLORS[si % STAGE_COLORS.length] }]
        stageSheetIdx++
    }
    wb._headerColors = headerColors

    return wb
}

/**
 * Generate a flat (single-sheet) Excel template from program metadata.
 *
 * Layout matches the Zimba/Chadiza format:
 *   Row 0: Category header spans (stage names above their column groups)
 *   Row 1: Column headers — TEI attributes first, then stage DE columns
 *   Row 2+: data rows (one row per TEI, events inline)
 *
 * Non-repeatable stages: columns appear once.
 * Repeatable stages: columns repeat `repeatCount` times (default 1, user can add groups in mapper).
 *
 * Sheets:
 *  1. Data Entry (the flat sheet)
 *  2. Validation (option sets + org units)
 */
export function generateFlatTemplate(program, metadata, { repeatCount = 1, repeatCounts = {} } = {}) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { attrOs, deOs } = buildOptionSetIndex(metadata)

    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    // --- Collect TEI attribute columns ---
    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
            name: a.trackedEntityAttribute?.displayName ?? a.displayName,
            mandatory: a.mandatory,
            valueType: a.trackedEntityAttribute?.valueType ?? a.valueType,
            unique: a.trackedEntityAttribute?.unique ?? false,
        })) ?? []

    const systemCols = ['Org Unit *', 'Enrollment Date * (YYYY-MM-DD)', 'Incident Date (YYYY-MM-DD)']
    const attrCols = teiAttributes.map((a) => {
        const req = a.mandatory ? ' *' : ''
        return `${a.name}${req} [${a.id}]`
    })
    const teiCols = [...systemCols, ...attrCols]

    // --- Build category row (row 0) and header row (row 1) ---
    const catRow = ['Enrollment', ...new Array(teiCols.length - 1).fill('')]
    const headerRow = [...teiCols]
    const merges = []

    if (teiCols.length > 1) {
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: teiCols.length - 1 } })
    }

    // Color ranges for the category row
    const ENROLLMENT_COLOR = '4472C4'
    const STAGE_COLORS = ['548235', 'BF8F00', 'C55A11', '7030A0', '2E75B6']
    const headerColors = [
        { startCol: 0, endCol: teiCols.length - 1, color: ENROLLMENT_COLOR },
    ]
    let stageColorIdx = 0

    // Track dropdown validations (Data Entry = sheet1.xml, data starts row 3)
    const dvRules = []
    const DATA_START = 3
    const DATA_END = 1000

    // Col 0 = Org Unit
    if (valInfo.orgUnitRef) {
        dvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: DATA_START, maxRow: DATA_END })
    }
    // Attribute columns (after 3 system cols)
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) {
            dvRules.push({ col: 3 + i, ref: valInfo.optionRefs[osId], startRow: DATA_START, maxRow: DATA_END })
        }
    }

    // Data-type validations for TEI attributes
    const typeRules = []
    // Enrollment Date (col 1) and Incident Date (col 2) are date columns
    const flatDateVt = valueTypeToValidation('DATE')
    typeRules.push({ col: 1, startRow: DATA_START, maxRow: DATA_END, ...flatDateVt })
    typeRules.push({ col: 2, startRow: DATA_START, maxRow: DATA_END, ...flatDateVt })
    for (let i = 0; i < teiAttributes.length; i++) {
        const osId = attrOs[teiAttributes[i].id]
        if (osId && valInfo.optionRefs[osId]) continue
        const vt = valueTypeToValidation(teiAttributes[i].valueType)
        if (vt) typeRules.push({ col: 3 + i, startRow: DATA_START, maxRow: DATA_END, ...vt })
    }

    // Track unique columns for duplicate highlighting
    const flatUniqueRules = teiAttributes
        .map((a, i) => a.unique ? { col: 3 + i, startRow: DATA_START, maxRow: DATA_END } : null)
        .filter(Boolean)

    let col = teiCols.length

    for (const stage of stages) {
        const dataElements = stage.programStageDataElements?.map((psde) => ({
            id: psde.dataElement?.id ?? psde.id,
            name: psde.dataElement?.displayName ?? psde.displayName,
            compulsory: psde.compulsory,
            valueType: psde.dataElement?.valueType ?? psde.valueType,
        })) ?? []

        const iterations = stage.repeatable ? (repeatCounts[stage.id] ?? repeatCount) : 1

        for (let iter = 0; iter < iterations; iter++) {
            const suffix = iterations > 1 ? ` (${iter + 1})` : ''
            const groupStart = col

            catRow.push(stage.displayName + suffix)
            headerRow.push(`${stage.displayName}${suffix}-Date * (YYYY-MM-DD)`)
            // Stage date column gets date validation
            typeRules.push({ col, startRow: DATA_START, maxRow: DATA_END, ...flatDateVt })
            col++

            for (const de of dataElements) {
                catRow.push('')
                const req = de.compulsory ? ' *' : ''
                headerRow.push(`${de.name}${req} [${de.id}]`)

                const osId = deOs[de.id]
                if (osId && valInfo.optionRefs[osId]) {
                    dvRules.push({ col, ref: valInfo.optionRefs[osId], startRow: DATA_START, maxRow: DATA_END })
                } else {
                    const vt = valueTypeToValidation(de.valueType)
                    if (vt) typeRules.push({ col, startRow: DATA_START, maxRow: DATA_END, ...vt })
                }
                col++
            }

            if (col - 1 > groupStart) {
                merges.push({ s: { r: 0, c: groupStart }, e: { r: 0, c: col - 1 } })
            }

            headerColors.push({
                startCol: groupStart,
                endCol: col - 1,
                color: STAGE_COLORS[stageColorIdx % STAGE_COLORS.length],
            })
            stageColorIdx++
        }
    }

    const wsData = XLSX.utils.aoa_to_sheet([catRow, headerRow])
    wsData['!merges'] = merges
    setColumnWidths(wsData, headerRow)
    XLSX.utils.book_append_sheet(wb, wsData, 'Data Entry')

    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }

    if (dvRules.length > 0) {
        wb._validationRules = { 1: dvRules }
    }
    if (typeRules.length > 0) {
        wb._typeValidationRules = { 1: typeRules }
    }
    if (flatUniqueRules.length > 0) {
        wb._uniqueRules = { 1: flatUniqueRules }
    }

    if (headerColors.length > 0) {
        // Flat aggregate template has 2 header rows (category-combo row + data-element row)
        wb._headerColors = { 1: { ranges: headerColors, headerRows: 2 } }
    }

    // --- ASSIGN rule formulas (e.g. Age from DOB) ---
    const formulaCols = buildAssignFormulas(metadata, teiAttributes, headerRow, DATA_START, DATA_END)
    if (formulaCols.length > 0) {
        wb._formulaColumns = { 1: formulaCols }
    }

    // --- Conditional formatting for invalid options / org units ---
    const cfRules = buildConditionalFormattingRules(dvRules, DATA_START, DATA_END)
    if (cfRules.length > 0) {
        wb._conditionalFormatting = { 1: cfRules }
    }

    return wb
}

/**
 * Generate an Excel template for event programs (WITHOUT_REGISTRATION).
 *
 * Event programs have no tracked entity type — just events with data elements.
 * Each program stage gets its own sheet with columns:
 *   ORG_UNIT_ID | EVENT_DATE | data element columns...
 *
 * Sheets:
 *  1. Instructions
 *  2+. One sheet per program stage (usually just one)
 *  Last. Validation (option set lookups)
 */
export function generateEventTemplate(program, metadata) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildValidationSheet(metadata)
    const { deOs } = buildOptionSetIndex(metadata)

    // --- Instructions sheet ---
    const instructions = [
        ['Event Bulk Import Template'],
        [`Program: ${program.displayName}`],
        [`Generated: ${new Date().toISOString()}`],
        [],
        ['How to fill in this template:'],
        ['1. Each program stage has its own sheet for event data.'],
        ['2. ORG_UNIT_ID identifies the organisation unit for the event.'],
        ['3. EVENT_DATE is the date the event occurred (YYYY-MM-DD).'],
        ['4. Columns with an asterisk (*) are mandatory.'],
        ['5. For option-set fields, select from the dropdown or use the CODE from the Validation sheet.'],
        [],
        ['Column Types & Validation:'],
        ['  TEXT — free text'],
        ['  NUMBER — any numeric value (decimal allowed)'],
        ['  INTEGER — whole number only'],
        ['  DATE — YYYY-MM-DD format'],
        ['  BOOLEAN — true or false'],
        ['  TRUE_ONLY — true or leave blank'],
        ['  OPTION_SET — use code from Validation sheet (dropdown provided)'],
    ]
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions)
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    const validationRules = {}
    const typeValidationRules = {}
    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    let sheetIdx = 2
    for (const stage of stages) {
        const headers = ['ORG_UNIT_ID', 'EVENT_DATE *']

        const dataElements =
            stage.programStageDataElements?.map((psde) => ({
                id: psde.dataElement?.id ?? psde.id,
                name: psde.dataElement?.displayName ?? psde.displayName,
                compulsory: psde.compulsory,
                valueType: psde.dataElement?.valueType ?? psde.valueType,
            })) ?? []

        for (const de of dataElements) {
            const required = de.compulsory ? ' *' : ''
            headers.push(`${de.name}${required} [${de.id}]`)
        }

        const wsStage = XLSX.utils.aoa_to_sheet([headers])
        setColumnWidths(wsStage, headers)
        let sheetName = stage.displayName.slice(0, 31)
        if (wb.SheetNames.includes(sheetName)) {
            sheetName = `${stage.displayName}`.slice(0, 28) + '...'
        }
        XLSX.utils.book_append_sheet(wb, wsStage, sheetName)

        const stageDvRules = []
        if (valInfo.orgUnitRef) {
            stageDvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1000 })
        }
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) {
                stageDvRules.push({ col: 2 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1000 })
            }
        }

        const stageTypeRules = []
        stageTypeRules.push({ col: 1, startRow: 2, maxRow: 1000, ...valueTypeToValidation('DATE') })
        for (let i = 0; i < dataElements.length; i++) {
            const osId = deOs[dataElements[i].id]
            if (osId && valInfo.optionRefs[osId]) continue
            const vt = valueTypeToValidation(dataElements[i].valueType)
            if (vt) stageTypeRules.push({ col: 2 + i, startRow: 2, maxRow: 1000, ...vt })
        }

        if (stageDvRules.length > 0) validationRules[sheetIdx] = stageDvRules
        if (stageTypeRules.length > 0) typeValidationRules[sheetIdx] = stageTypeRules
        sheetIdx++
    }

    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }
    if (Object.keys(validationRules).length > 0) {
        wb._validationRules = validationRules
    }
    if (Object.keys(typeValidationRules).length > 0) {
        wb._typeValidationRules = typeValidationRules
    }

    return wb
}

/**
 * Populate a flat workbook with sample data from the Tracker API.
 * sampleData: array of tracked entity objects from /api/tracker/trackedEntities
 */
export function populateFlatWorkbook(wb, metadata, sampleData, { repeatCount = 1, repeatCounts = {} } = {}) {
    if (!sampleData?.length) return wb

    const ws = wb.Sheets['Data Entry']
    if (!ws) return wb

    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
        })) ?? []

    // Build org unit lookup (id → displayName)
    const ouMap = {}
    for (const ou of metadata.organisationUnits ?? []) {
        ouMap[ou.id] = ou.displayName
    }

    // Build data element order per stage
    const stageDeOrder = {}
    for (const stage of stages) {
        stageDeOrder[stage.id] = (stage.programStageDataElements ?? []).map(
            (psde) => psde.dataElement?.id ?? psde.id
        )
    }

    const rows = []
    for (const tei of sampleData) {
        const enrollment = tei.enrollments?.[0]
        const attrMap = {}
        for (const a of tei.attributes ?? []) {
            attrMap[a.attribute] = a.value
        }

        const row = []
        // Org Unit
        row.push(ouMap[tei.orgUnit] || tei.orgUnit)
        // Enrollment Date
        row.push(formatDate(enrollment?.enrolledAt))
        // Incident Date
        row.push(formatDate(enrollment?.occurredAt))
        // Attributes
        for (const attr of teiAttributes) {
            row.push(attrMap[attr.id] ?? '')
        }

        // Stage columns — fill each iteration slot with corresponding event
        const eventsByStage = {}
        for (const evt of enrollment?.events ?? []) {
            if (!eventsByStage[evt.programStage]) {
                eventsByStage[evt.programStage] = []
            }
            eventsByStage[evt.programStage].push(evt)
        }

        for (const stage of stages) {
            const events = eventsByStage[stage.id] ?? []
            const iterations = stage.repeatable ? (repeatCounts[stage.id] ?? repeatCount) : 1
            const deOrder = stageDeOrder[stage.id] ?? []

            for (let iter = 0; iter < iterations; iter++) {
                const evt = iter < events.length ? events[iter] : undefined
                const dvMap = {}
                for (const dv of evt?.dataValues ?? []) {
                    dvMap[dv.dataElement] = dv.value
                }

                // Event date
                row.push(formatDate(evt?.occurredAt))
                // Data elements in order
                for (const deId of deOrder) {
                    row.push(dvMap[deId] ?? '')
                }
            }
        }

        rows.push(row)
    }

    XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A3' })
    return wb
}

/**
 * Populate a multi-sheet workbook with sample data.
 */
export function populateMultiSheetWorkbook(wb, metadata, sampleData) {
    if (!sampleData?.length) return wb

    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
        })) ?? []

    const ouMap = {}
    for (const ou of metadata.organisationUnits ?? []) {
        ouMap[ou.id] = ou.displayName
    }

    // TEI + Enrollment sheet
    const teiSheet = wb.Sheets['TEI + Enrollment']
    if (teiSheet) {
        const teiRows = []
        for (let i = 0; i < sampleData.length; i++) {
            const tei = sampleData[i]
            const enrollment = tei.enrollments?.[0]
            const attrMap = {}
            for (const a of tei.attributes ?? []) {
                attrMap[a.attribute] = a.value
            }

            const teiId = `TEI_${i + 1}`
            const row = [
                teiId,
                tei.orgUnit,
                formatDate(enrollment?.enrolledAt),
                formatDate(enrollment?.occurredAt),
            ]
            for (const attr of teiAttributes) {
                row.push(attrMap[attr.id] ?? '')
            }
            teiRows.push(row)
        }
        XLSX.utils.sheet_add_aoa(teiSheet, teiRows, { origin: 'A2' })
    }

    // Stage sheets
    for (const stage of stages) {
        const label = stage.repeatable ? '(repeatable)' : '(single)'
        let sheetName = `${stage.displayName} ${label}`.slice(0, 31)
        if (!wb.Sheets[sheetName]) {
            sheetName = `${stage.displayName}`.slice(0, 28) + '...'
        }
        const ws = wb.Sheets[sheetName]
        if (!ws) continue

        const deOrder = (stage.programStageDataElements ?? []).map(
            (psde) => psde.dataElement?.id ?? psde.id
        )

        const stageRows = []
        for (let i = 0; i < sampleData.length; i++) {
            const tei = sampleData[i]
            const teiId = `TEI_${i + 1}`
            const enrollment = tei.enrollments?.[0]

            for (const evt of enrollment?.events ?? []) {
                if (evt.programStage !== stage.id) continue

                const dvMap = {}
                for (const dv of evt.dataValues ?? []) {
                    dvMap[dv.dataElement] = dv.value
                }

                const row = [teiId, formatDate(evt.occurredAt), evt.orgUnit]
                for (const deId of deOrder) {
                    row.push(dvMap[deId] ?? '')
                }
                stageRows.push(row)
            }
        }

        if (stageRows.length > 0) {
            XLSX.utils.sheet_add_aoa(ws, stageRows, { origin: 'A2' })
        }
    }

    return wb
}

/** Format an ISO datetime to YYYY-MM-DD, or return empty string. */
function formatDate(value) {
    if (!value) return ''
    return value.slice(0, 10)
}

/**
 * Populate an event-program workbook with sample events from the Tracker API.
 *
 * @param {XLSX.WorkBook} wb - workbook produced by generateEventTemplate
 * @param {object} metadata - program metadata
 * @param {object|Array} events - either { [stageId]: [event,...] } or a flat event array
 *   Each event must have: programStage, orgUnit, occurredAt, dataValues[{dataElement,value}]
 */
export function populateEventWorkbook(wb, metadata, events) {
    if (!events) return wb

    // Normalise to { [stageId]: [events] }
    let eventsMap = events
    if (Array.isArray(events)) {
        eventsMap = {}
        for (const e of events) {
            const sid = e.programStage
            if (!sid) continue
            if (!eventsMap[sid]) eventsMap[sid] = []
            eventsMap[sid].push(e)
        }
    }

    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    for (const stage of stages) {
        const list = eventsMap[stage.id] ?? []
        if (list.length === 0) continue

        // Resolve the stage sheet name (generateEventTemplate uses displayName slice(0,31))
        let sheetName = stage.displayName.slice(0, 31)
        let ws = wb.Sheets[sheetName]
        if (!ws) {
            sheetName = stage.displayName.slice(0, 28) + '...'
            ws = wb.Sheets[sheetName]
        }
        if (!ws) continue

        const deOrder = (stage.programStageDataElements ?? []).map(
            (psde) => psde.dataElement?.id ?? psde.id
        )

        const rows = list.map((evt) => {
            const dvMap = {}
            for (const dv of evt.dataValues ?? []) dvMap[dv.dataElement] = dv.value
            // Column order matches generateEventTemplate: ORG_UNIT_ID, EVENT_DATE *, then data elements
            const row = [evt.orgUnit ?? '', formatDate(evt.occurredAt)]
            for (const deId of deOrder) row.push(dvMap[deId] ?? '')
            return row
        })

        XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A2' })
    }

    return wb
}

/**
 * Populate a data-entry workbook with sample data values from /api/dataValueSets.
 *
 * Rows are grouped by (orgUnit, period); each grouped value is placed into the
 * matching DE [+ COC] column emitted by buildDataEntryColumns.
 */
export function populateDataEntryWorkbook(wb, dataSet, dataValues) {
    if (!dataValues?.length) return wb
    const ws = wb.Sheets['Data Entry']
    if (!ws) return wb

    const columns = buildDataEntryColumns(dataSet)
    const colIdx = {}
    columns.forEach((c, i) => {
        const key = c.cocId ? `${c.deId}.${c.cocId}` : c.deId
        colIdx[key] = i
    })

    const grouped = {}
    for (const dv of dataValues) {
        const k = `${dv.orgUnit}||${dv.period}`
        if (!grouped[k]) grouped[k] = { orgUnit: dv.orgUnit, period: dv.period, values: {} }
        const cKey = dv.categoryOptionCombo ? `${dv.dataElement}.${dv.categoryOptionCombo}` : dv.dataElement
        grouped[k].values[cKey] = dv.value
    }

    const rows = Object.values(grouped).map((g) => {
        const row = [g.orgUnit, g.period, ...columns.map(() => '')]
        for (const [key, value] of Object.entries(g.values)) {
            const i = colIdx[key]
            if (i != null) row[2 + i] = value
            else {
                // Try matching deId-only against any column that shares the same deId
                const justDe = key.split('.')[0]
                const fallback = columns.findIndex((c) => c.deId === justDe)
                if (fallback >= 0) row[2 + fallback] = value
            }
        }
        return row
    })

    XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A2' })
    return wb
}

/**
 * Generate an Excel template for aggregate data entry import.
 *
 * Data set metadata shape (from useDataSetMetadata):
 *   { id, displayName, periodType, categoryCombo, dataSetElements, sections, organisationUnits }
 *
 * Template layout:
 *   - Sheet 1: Instructions
 *   - Sheet 2: Data Entry (rows = org units × periods; columns = data elements × COCs)
 *   - Sheet 3: Validation (org units, option sets)
 *
 * For data elements with a non-default categoryCombo, columns are decomposed:
 *   "DE Name - COC Name [deId.cocId]"
 *
 * For data elements with the default categoryCombo (single COC), columns are:
 *   "DE Name [deId]"
 */
export function generateDataEntryTemplate(dataSet) {
    const wb = XLSX.utils.book_new()
    const { wsValidation, valInfo } = buildDataEntryValidationSheet(dataSet)
    const deOs = buildDataEntryOptionSetIndex(dataSet)

    // --- Instructions sheet ---
    const instructions = [
        ['Data Entry Bulk Import Template'],
        [`Data Set: ${dataSet.displayName}`],
        [`Period Type: ${dataSet.periodType}`],
        [`Generated: ${new Date().toISOString()}`],
        [],
        ['How to fill in this template:'],
        ['1. Each row represents one org unit + period combination.'],
        ['2. ORG_UNIT_ID identifies the organisation unit (use UID from dropdown).'],
        ['3. PERIOD is the reporting period in DHIS2 format (e.g. 202401, 2024Q1, 2024).'],
        ['4. Fill in data values for each data element column.'],
        ['5. Columns ending with [deId] or [deId.cocId] indicate the DHIS2 identifiers.'],
        ['6. Columns with an asterisk (*) are mandatory system columns.'],
        ['7. For option-set fields, select from the dropdown or use the CODE from the Validation sheet.'],
        [],
        ['Period Formats:'],
        ['  Daily: YYYYMMDD (e.g. 20240115)'],
        ['  Weekly: YYYYWn (e.g. 2024W3)'],
        ['  Monthly: YYYYMM (e.g. 202401)'],
        ['  BiMonthly: YYYYMMB (e.g. 202401B)'],
        ['  Quarterly: YYYYQn (e.g. 2024Q1)'],
        ['  SixMonthly: YYYYSn (e.g. 2024S1)'],
        ['  Yearly: YYYY (e.g. 2024)'],
        ['  Financial April: YYYYApril (e.g. 2024April)'],
        ['  Financial July: YYYYJuly (e.g. 2024July)'],
        ['  Financial October: YYYYOct (e.g. 2024Oct)'],
    ]
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions)
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    // --- Build data element columns ---
    // Determine the default categoryCombo (single COC = "default")
    const columns = buildDataEntryColumns(dataSet)

    const headers = ['ORG_UNIT_ID *', 'PERIOD *', ...columns.map((c) => c.header)]
    const wsData = XLSX.utils.aoa_to_sheet([headers])
    setColumnWidths(wsData, headers)
    XLSX.utils.book_append_sheet(wb, wsData, 'Data Entry')

    // --- Dropdown validations ---
    const validationRules = {}
    const typeValidationRules = {}
    const sheetIdx = 2 // Data Entry is sheet 2 (1-indexed)
    const dvRules = []
    const tRules = []

    // Org unit dropdown
    if (valInfo.orgUnitRef) {
        dvRules.push({ col: 0, ref: valInfo.orgUnitRef, startRow: 2, maxRow: 1000 })
    }

    // Option set dropdowns for data elements
    for (let i = 0; i < columns.length; i++) {
        const osId = columns[i].optionSetId
        if (osId && valInfo.optionRefs[osId]) {
            dvRules.push({ col: 2 + i, ref: valInfo.optionRefs[osId], startRow: 2, maxRow: 1000 })
        }
    }

    // Value type validations
    for (let i = 0; i < columns.length; i++) {
        const osId = columns[i].optionSetId
        if (osId && valInfo.optionRefs[osId]) continue
        const vt = valueTypeToValidation(columns[i].valueType)
        if (vt) tRules.push({ col: 2 + i, startRow: 2, maxRow: 1000, ...vt })
    }

    if (dvRules.length > 0) validationRules[sheetIdx] = dvRules
    if (tRules.length > 0) typeValidationRules[sheetIdx] = tRules

    // --- Validation sheet ---
    if (wsValidation) {
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }
    if (Object.keys(validationRules).length > 0) {
        wb._validationRules = validationRules
    }
    if (Object.keys(typeValidationRules).length > 0) {
        wb._typeValidationRules = typeValidationRules
    }

    // --- Header colors: data entry blue for the data sheet ---
    wb._headerColors = {
        2: [{ startCol: 0, endCol: headers.length - 1, color: DATA_ENTRY_COLOR }],
    }

    return wb
}

/**
 * Build column definitions for data entry template.
 * Returns [{ header, deId, cocId, valueType, optionSetId }]
 */
function buildDataEntryColumns(dataSet) {
    const columns = []
    const dataElements = (dataSet.dataSetElements ?? []).map((dse) => dse.dataElement)

    // Order by sections if present, otherwise by displayName
    const sections = [...(dataSet.sections ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    let orderedDes

    if (sections.length > 0) {
        const sectionDeIds = sections.flatMap((s) => (s.dataElements ?? []).map((de) => de.id))
        const deMap = Object.fromEntries(dataElements.map((de) => [de.id, de]))
        orderedDes = sectionDeIds.map((id) => deMap[id]).filter(Boolean)
        // Add any ungrouped data elements at the end
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
            // Default COC — single column per DE
            columns.push({
                header: `${de.displayName} [${de.id}]`,
                deId: de.id,
                cocId: cocs[0]?.id ?? null,
                valueType: de.valueType,
                optionSetId: de.optionSet?.id ?? null,
            })
        } else {
            // Multiple COCs — one column per DE×COC
            for (const coc of cocs) {
                columns.push({
                    header: `${de.displayName} - ${coc.displayName} [${de.id}.${coc.id}]`,
                    deId: de.id,
                    cocId: coc.id,
                    valueType: de.valueType,
                    optionSetId: de.optionSet?.id ?? null,
                })
            }
        }
    }

    return columns
}

/**
 * Collect unique option sets from data set elements.
 */
function collectDataEntryOptionSets(dataSet) {
    const seen = new Set()
    const result = []
    for (const dse of dataSet.dataSetElements ?? []) {
        const os = dse.dataElement?.optionSet
        if (os && !seen.has(os.id)) {
            seen.add(os.id)
            result.push({ id: os.id, name: os.displayName ?? os.id, options: os.options ?? [] })
        }
    }
    return result
}

/**
 * Build validation sheet for data entry template (org units + option sets).
 */
function buildDataEntryValidationSheet(dataSet) {
    const optionSets = collectDataEntryOptionSets(dataSet)
    const orgUnits = dataSet.organisationUnits ?? []
    const valInfo = { orgUnitRef: null, optionRefs: {} }

    if (optionSets.length === 0 && orgUnits.length === 0) {
        return { wsValidation: null, valInfo }
    }

    const valHeaders = []
    let colIdx = 0

    if (orgUnits.length > 0) {
        valHeaders.push('Org Unit [name]', 'Org Unit [UID]')
        const cl = colLetter(colIdx)
        valInfo.orgUnitRef = `Validation!$${cl}$2:$${cl}$${orgUnits.length + 1}`
        colIdx += 2
    }

    for (const os of optionSets) {
        valHeaders.push(`${os.name} [code]`, `${os.name} [display]`)
        const codeCl = colLetter(colIdx)
        valInfo.optionRefs[os.id] = `Validation!$${codeCl}$2:$${codeCl}$${os.options.length + 1}`
        colIdx += 2
    }

    const maxOptRows = optionSets.length > 0
        ? Math.max(...optionSets.map((os) => os.options.length))
        : 0
    const maxRows = Math.max(maxOptRows, orgUnits.length)
    const valData = []

    for (let i = 0; i < maxRows; i++) {
        const row = []
        if (orgUnits.length > 0) {
            row.push(i < orgUnits.length ? orgUnits[i].displayName : '')
            row.push(i < orgUnits.length ? orgUnits[i].id : '')
        }
        for (const os of optionSets) {
            row.push(i < os.options.length ? os.options[i].code : '')
            row.push(i < os.options.length ? os.options[i].displayName : '')
        }
        valData.push(row)
    }

    const wsValidation = XLSX.utils.aoa_to_sheet([valHeaders, ...valData])
    return { wsValidation, valInfo }
}

/**
 * Map DE IDs to their option set IDs for data entry.
 */
function buildDataEntryOptionSetIndex(dataSet) {
    const deOs = {}
    for (const dse of dataSet.dataSetElements ?? []) {
        const de = dse.dataElement
        if (de?.optionSet?.id) deOs[de.id] = de.optionSet.id
    }
    return deOs
}

export function collectOptionSets(metadata) {
    const seen = new Set()
    const result = []

    const check = (optionSet) => {
        if (optionSet && !seen.has(optionSet.id)) {
            seen.add(optionSet.id)
            result.push({
                id: optionSet.id,
                name: optionSet.displayName ?? optionSet.id,
                options: optionSet.options ?? [],
            })
        }
    }

    for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
        check(a.trackedEntityAttribute?.optionSet)
    }

    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            check(psde.dataElement?.optionSet)
        }
    }

    return result
}

/**
 * Build the Validation sheet and return references for dropdown formulas.
 * Returns { wsValidation, valInfo: { orgUnitRef, optionRefs: { osId: ref } } }
 */
export function buildValidationSheet(metadata) {
    const optionSets = collectOptionSets(metadata)
    const orgUnits = metadata.organisationUnits ?? []
    const valInfo = { orgUnitRef: null, optionRefs: {} }

    if (optionSets.length === 0 && orgUnits.length === 0) {
        return { wsValidation: null, valInfo }
    }

    const valHeaders = []
    let colIdx = 0

    if (orgUnits.length > 0) {
        valHeaders.push('Org Unit [name]', 'Org Unit [UID]')
        const cl = colLetter(colIdx)
        valInfo.orgUnitRef = `Validation!$${cl}$2:$${cl}$${orgUnits.length + 1}`
        colIdx += 2
    }

    for (const os of optionSets) {
        valHeaders.push(`${os.name} [code]`, `${os.name} [display]`)
        const codeCl = colLetter(colIdx)
        valInfo.optionRefs[os.id] = `Validation!$${codeCl}$2:$${codeCl}$${os.options.length + 1}`
        colIdx += 2
    }

    const maxOptRows = optionSets.length > 0
        ? Math.max(...optionSets.map((os) => os.options.length))
        : 0
    const maxRows = Math.max(maxOptRows, orgUnits.length)
    const valData = []

    for (let i = 0; i < maxRows; i++) {
        const row = []
        if (orgUnits.length > 0) {
            row.push(i < orgUnits.length ? orgUnits[i].displayName : '')
            row.push(i < orgUnits.length ? orgUnits[i].id : '')
        }
        for (const os of optionSets) {
            row.push(i < os.options.length ? os.options[i].code : '')
            row.push(i < os.options.length ? os.options[i].displayName : '')
        }
        valData.push(row)
    }

    const wsValidation = XLSX.utils.aoa_to_sheet([valHeaders, ...valData])
    return { wsValidation, valInfo }
}

/**
 * Map attribute/DE IDs to their option set IDs.
 */
export function buildOptionSetIndex(metadata) {
    const attrOs = {}
    for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
        const tea = a.trackedEntityAttribute ?? a
        if (tea.optionSet?.id) attrOs[tea.id] = tea.optionSet.id
    }
    const deOs = {}
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            if (de.optionSet?.id) deOs[de.id] = de.optionSet.id
        }
    }
    return { attrOs, deOs }
}

/**
 * Write a workbook to file, injecting Excel data-validation dropdowns
 * and header colors via xlsx zip post-processing.
 */
export function writeTemplateFile(wb, filename) {
    const rules = wb._validationRules
    const colors = wb._headerColors
    const formulaCols = wb._formulaColumns
    const cfRules = wb._conditionalFormatting
    const typeRules = wb._typeValidationRules
    const uniqueRules = wb._uniqueRules
    const needsPostProcess =
        (rules && Object.keys(rules).length > 0) ||
        (colors && Object.keys(colors).length > 0) ||
        (formulaCols && Object.keys(formulaCols).length > 0) ||
        (cfRules && Object.keys(cfRules).length > 0) ||
        (typeRules && Object.keys(typeRules).length > 0) ||
        (uniqueRules && Object.keys(uniqueRules).length > 0)

    if (!needsPostProcess) {
        XLSX.writeFile(wb, filename)
        return
    }

    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const zip = unzipSync(new Uint8Array(buffer))

    // OOXML element order: sheetData → mergeCells → conditionalFormatting → dataValidations
    // Inject CF first, then DV, so the final XML has correct element order.
    if (colors) injectHeaderStyles(zip, colors)
    if (formulaCols) injectFormulas(zip, formulaCols)
    if (typeRules) injectDateFormats(zip, typeRules)
    if (cfRules) injectConditionalFormatting(zip, cfRules)
    if (uniqueRules) injectUniqueHighlighting(zip, uniqueRules)
    if (rules) injectDataValidations(zip, rules)
    if (typeRules) injectTypeValidations(zip, typeRules)
    if (formulaCols) injectComputedColumnStyles(zip, formulaCols)
    // Freeze panes on all data sheets that weren't already handled by injectHeaderStyles
    injectFreezePanes(zip, wb.SheetNames, colors ? Object.keys(colors).map(Number) : [])

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

/**
 * Inject <dataValidations> XML into xlsx zip for the specified sheets.
 * Mutates the zip object in place.
 */
export function injectDataValidations(zip, sheetValidations) {
    for (const [sheetIdx, rules] of Object.entries(sheetValidations)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        const dvItems = rules.map((r) => {
            const cl = colLetter(r.col)
            const sqref = `${cl}${r.startRow}:${cl}${r.maxRow}`
            return (
                '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"' +
                ` errorTitle="Invalid value" error="Please select from the dropdown list." sqref="${sqref}">` +
                `<formula1>${escapeXml(r.ref)}</formula1></dataValidation>`
            )
        }).join('')

        const dvXml = `<dataValidations count="${rules.length}">${dvItems}</dataValidations>`

        // Insert AFTER conditionalFormatting (OOXML order: CF before DV)
        const lastCfIdx = xml.lastIndexOf('</conditionalFormatting>')
        if (lastCfIdx >= 0) {
            const insertAt = lastCfIdx + '</conditionalFormatting>'.length
            xml = xml.slice(0, insertAt) + dvXml + xml.slice(insertAt)
        } else if (xml.includes('</mergeCells>')) {
            xml = xml.replace('</mergeCells>', '</mergeCells>' + dvXml)
        } else if (xml.includes('</sheetData>')) {
            xml = xml.replace('</sheetData>', '</sheetData>' + dvXml)
        } else {
            xml = xml.replace('</worksheet>', dvXml + '</worksheet>')
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Apply yyyy-mm-dd number format to date columns via <col> elements.
 * This ensures Excel treats typed values as dates so date validation works.
 */
function injectDateFormats(zip, sheetTypeRules) {
    const stylesPath = 'xl/styles.xml'
    if (!zip[stylesPath]) return

    // Collect date columns per sheet
    const dateCols = {}
    for (const [sheetIdx, rules] of Object.entries(sheetTypeRules)) {
        const cols = rules.filter((r) => r.type === 'date').map((r) => r.col)
        if (cols.length > 0) dateCols[sheetIdx] = cols
    }
    if (Object.keys(dateCols).length === 0) return

    let stylesXml = strFromU8(zip[stylesPath])

    // Add custom numFmt for yyyy-mm-dd (id 164 — first available custom id)
    const numFmtId = 164
    const numFmtEntry = `<numFmt numFmtId="${numFmtId}" formatCode="yyyy-mm-dd"/>`
    if (stylesXml.includes('<numFmts')) {
        stylesXml = stylesXml.replace(
            /(<numFmts[^>]*count=")(\d+)(")/,
            (m, pre, cnt, post) => `${pre}${parseInt(cnt) + 1}${post}`
        )
        stylesXml = stylesXml.replace('</numFmts>', numFmtEntry + '</numFmts>')
    } else {
        stylesXml = stylesXml.replace(
            '<fonts',
            `<numFmts count="1">${numFmtEntry}</numFmts><fonts`
        )
    }

    // Add cellXf entry for date format
    const xfCountMatch = stylesXml.match(/<cellXfs[^>]*count="(\d+)"/)
    const oldXfCount = xfCountMatch ? parseInt(xfCountMatch[1]) : 1
    const dateStyleIdx = oldXfCount
    stylesXml = stylesXml.replace(
        /(<cellXfs[^>]*count=")(\d+)(")/,
        `$1${oldXfCount + 1}$3`
    )
    stylesXml = stylesXml.replace(
        '</cellXfs>',
        `<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>`
    )
    zip[stylesPath] = strToU8(stylesXml)

    // Apply date style to columns via <col> elements in each sheet
    for (const [sheetIdx, cols] of Object.entries(dateCols)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        // Build <col> elements for each date column (1-indexed in OOXML)
        // If a <col> already exists for that column (from !cols), update it with the style
        if (xml.includes('<cols>')) {
            for (const c of cols) {
                const ooxmlCol = c + 1
                const existingColRegex = new RegExp(`<col[^>]*min="${ooxmlCol}"[^>]*max="${ooxmlCol}"[^>]*/>`)
                const existingMatch = xml.match(existingColRegex)
                if (existingMatch) {
                    let updated = existingMatch[0]
                    if (!updated.includes('style=')) {
                        updated = updated.replace('/>', ` style="${dateStyleIdx}"/>`)
                    }
                    xml = xml.replace(existingMatch[0], updated)
                } else {
                    xml = xml.replace('</cols>',
                        `<col min="${ooxmlCol}" max="${ooxmlCol}" style="${dateStyleIdx}" bestFit="1" customWidth="1" width="14"/></cols>`)
                }
            }
        } else {
            const colEntries = cols.map((c) => {
                const ooxmlCol = c + 1
                return `<col min="${ooxmlCol}" max="${ooxmlCol}" style="${dateStyleIdx}" bestFit="1" customWidth="1" width="14"/>`
            }).join('')
            xml = xml.replace('<sheetData', `<cols>${colEntries}</cols><sheetData`)
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Inject data-type validations (number, integer, date, email, phone, boolean)
 * into xlsx zip. Appends to existing <dataValidations> if present.
 */
function injectTypeValidations(zip, sheetTypeRules) {
    for (const [sheetIdx, rules] of Object.entries(sheetTypeRules)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        const dvItems = rules.map((r) => {
            const cl = colLetter(r.col)
            const sqref = `${cl}${r.startRow}:${cl}${r.maxRow}`
            const errTitle = escapeXml(r.errorTitle ?? 'Invalid value')
            const errMsg = escapeXml(r.error ?? 'Invalid input.')
            const promptTitle = r.promptTitle ? ` promptTitle="${escapeXml(r.promptTitle)}"` : ''
            const prompt = r.prompt ? ` prompt="${escapeXml(r.prompt)}"` : ''

            if (r.type === 'custom' && r.customFormula) {
                const cellRef = `${cl}${r.startRow}`
                const formula = r.customFormula(cellRef)
                return (
                    `<dataValidation type="custom" allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
                    ` errorTitle="${errTitle}" error="${errMsg}"${promptTitle}${prompt} sqref="${sqref}">` +
                    `<formula1>${escapeXml(formula)}</formula1></dataValidation>`
                )
            }

            if (r.type === 'list' && r.listValues) {
                return (
                    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
                    ` errorTitle="${errTitle}" error="${errMsg}"${promptTitle}${prompt} sqref="${sqref}">` +
                    `<formula1>${escapeXml(r.listValues)}</formula1></dataValidation>`
                )
            }

            // Numeric / date / textLength types
            const operator = r.operator ? ` operator="${r.operator}"` : ''
            let formulas = ''
            if (r.formula1 != null) formulas += `<formula1>${escapeXml(String(r.formula1))}</formula1>`
            if (r.formula2 != null) formulas += `<formula2>${escapeXml(String(r.formula2))}</formula2>`

            return (
                `<dataValidation type="${r.type}"${operator} allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
                ` errorTitle="${errTitle}" error="${errMsg}"${promptTitle}${prompt} sqref="${sqref}">` +
                `${formulas}</dataValidation>`
            )
        }).join('')

        if (!dvItems) continue

        // Merge into existing dataValidations block or insert new
        const existingMatch = xml.match(/<dataValidations[^>]*count="(\d+)"/)
        if (existingMatch) {
            const newCount = parseInt(existingMatch[1]) + rules.length
            xml = xml.replace(
                /<dataValidations[^>]*count="\d+"/,
                `<dataValidations count="${newCount}"`
            )
            xml = xml.replace('</dataValidations>', dvItems + '</dataValidations>')
        } else {
            const dvXml = `<dataValidations count="${rules.length}">${dvItems}</dataValidations>`
            const lastCfIdx = xml.lastIndexOf('</conditionalFormatting>')
            if (lastCfIdx >= 0) {
                const insertAt = lastCfIdx + '</conditionalFormatting>'.length
                xml = xml.slice(0, insertAt) + dvXml + xml.slice(insertAt)
            } else if (xml.includes('</mergeCells>')) {
                xml = xml.replace('</mergeCells>', '</mergeCells>' + dvXml)
            } else if (xml.includes('</sheetData>')) {
                xml = xml.replace('</sheetData>', '</sheetData>' + dvXml)
            } else {
                xml = xml.replace('</worksheet>', dvXml + '</worksheet>')
            }
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Add a grey background + italic font to computed (ASSIGN rule) column headers
 * and an input message on the data cells indicating they are auto-calculated.
 */
function injectComputedColumnStyles(zip, sheetFormulas) {
    const stylesPath = 'xl/styles.xml'
    if (!zip[stylesPath]) return

    let stylesXml = strFromU8(zip[stylesPath])

    // Add italic grey font for computed headers
    const fontCountMatch = stylesXml.match(/<fonts[^>]*count="(\d+)"/)
    const oldFontCount = fontCountMatch ? parseInt(fontCountMatch[1]) : 1
    const italicFontId = oldFontCount
    stylesXml = stylesXml.replace(
        /(<fonts[^>]*count=")(\d+)(")/,
        `$1${oldFontCount + 1}$3`
    )
    stylesXml = stylesXml.replace(
        '</fonts>',
        '<font><i/><sz val="11"/><color rgb="FF666666"/><name val="Calibri"/></font></fonts>'
    )

    // Add light grey fill for computed columns
    const fillCountMatch = stylesXml.match(/<fills[^>]*count="(\d+)"/)
    const oldFillCount = fillCountMatch ? parseInt(fillCountMatch[1]) : 2
    const greyFillId = oldFillCount
    stylesXml = stylesXml.replace(
        /(<fills[^>]*count=")(\d+)(")/,
        `$1${oldFillCount + 1}$3`
    )
    stylesXml = stylesXml.replace(
        '</fills>',
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE0E0E0"/><bgColor indexed="64"/></patternFill></fill></fills>'
    )

    // Add cellXf entry for computed data cells (italic grey font + grey fill)
    const xfCountMatch = stylesXml.match(/<cellXfs[^>]*count="(\d+)"/)
    const oldXfCount = xfCountMatch ? parseInt(xfCountMatch[1]) : 1
    const computedStyleIdx = oldXfCount
    stylesXml = stylesXml.replace(
        /(<cellXfs[^>]*count=")(\d+)(")/,
        `$1${oldXfCount + 1}$3`
    )
    stylesXml = stylesXml.replace(
        '</cellXfs>',
        `<xf numFmtId="0" fontId="${italicFontId}" fillId="${greyFillId}" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
    )

    zip[stylesPath] = strToU8(stylesXml)

    // Apply grey style to formula cells and add input messages
    for (const [sheetIdx, formulas] of Object.entries(sheetFormulas)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        // Style the formula cells with the computed style (replace existing s= if present)
        for (const f of formulas) {
            const cl = colLetter(f.col)
            const cellPattern = new RegExp(`<c r="${cl}(\\d+)"([^>]*)`, 'g')
            xml = xml.replace(cellPattern, (match, row, rest) => {
                const cleanRest = rest.replace(/\s*s="\d+"/, '')
                return `<c r="${cl}${row}" s="${computedStyleIdx}"${cleanRest}`
            })
        }

        // Add input message validations for computed columns (informational only)
        const computedDvItems = formulas.map((f) => {
            const cl = colLetter(f.col)
            const sqref = `${cl}${f.startRow}:${cl}${f.endRow}`
            return (
                '<dataValidation allowBlank="1" showInputMessage="1" showErrorMessage="0"' +
                ` promptTitle="Auto-calculated" prompt="This field is computed by a program rule. It will be overwritten on import."` +
                ` sqref="${sqref}"></dataValidation>`
            )
        }).join('')

        if (computedDvItems) {
            const existingMatch = xml.match(/<dataValidations[^>]*count="(\d+)"/)
            if (existingMatch) {
                const newCount = parseInt(existingMatch[1]) + formulas.length
                xml = xml.replace(
                    /<dataValidations[^>]*count="\d+"/,
                    `<dataValidations count="${newCount}"`
                )
                xml = xml.replace('</dataValidations>', computedDvItems + '</dataValidations>')
            } else {
                const dvXml = `<dataValidations count="${formulas.length}">${computedDvItems}</dataValidations>`
                const lastCfIdx = xml.lastIndexOf('</conditionalFormatting>')
                if (lastCfIdx >= 0) {
                    const insertAt = lastCfIdx + '</conditionalFormatting>'.length
                    xml = xml.slice(0, insertAt) + dvXml + xml.slice(insertAt)
                } else if (xml.includes('</mergeCells>')) {
                    xml = xml.replace('</mergeCells>', '</mergeCells>' + dvXml)
                } else if (xml.includes('</sheetData>')) {
                    xml = xml.replace('</sheetData>', '</sheetData>' + dvXml)
                } else {
                    xml = xml.replace('</worksheet>', dvXml + '</worksheet>')
                }
            }
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Add conditional formatting to highlight duplicate values in unique columns.
 * Uses COUNTIF — if a value appears more than once, both cells get an orange fill.
 */
function injectUniqueHighlighting(zip, sheetUniqueRules) {
    addDxfFill(zip, 'FFFFC000')

    const stylesPath = 'xl/styles.xml'
    let stylesXml = strFromU8(zip[stylesPath])
    const dxfCountMatch = stylesXml.match(/<dxfs[^>]*count="(\d+)"/)
    const dxfId = dxfCountMatch ? parseInt(dxfCountMatch[1]) - 1 : 0

    for (const [sheetIdx, rules] of Object.entries(sheetUniqueRules)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        const cfItems = rules.map((r, i) => {
            const cl = colLetter(r.col)
            const sqref = `${cl}${r.startRow}:${cl}${r.maxRow}`
            const cellRef = `${cl}${r.startRow}`
            // Highlight when cell is non-empty and value appears more than once
            const formula = `AND(${cellRef}<>"",COUNTIF(${cl}:${cl},${cellRef})>1)`
            return (
                `<conditionalFormatting sqref="${sqref}">` +
                `<cfRule type="expression" dxfId="${dxfId}" priority="${100 + i}">` +
                `<formula>${escapeXml(formula)}</formula>` +
                `</cfRule></conditionalFormatting>`
            )
        }).join('')

        // Insert CF BEFORE dataValidations (OOXML requires CF before DV)
        if (xml.includes('<dataValidations')) {
            xml = xml.replace('<dataValidations', cfItems + '<dataValidations')
        } else if (xml.includes('</mergeCells>')) {
            xml = xml.replace('</mergeCells>', '</mergeCells>' + cfItems)
        } else if (xml.includes('</sheetData>')) {
            xml = xml.replace('</sheetData>', '</sheetData>' + cfItems)
        } else {
            xml = xml.replace('</worksheet>', cfItems + '</worksheet>')
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Add a differential formatting record (dxf) for a given fill color.
 */
function addDxfFill(zip, rgb) {
    const stylesPath = 'xl/styles.xml'
    if (!zip[stylesPath]) return

    let stylesXml = strFromU8(zip[stylesPath])
    const dxfEntry = `<dxf><fill><patternFill><bgColor rgb="${rgb}"/></patternFill></fill></dxf>`

    if (stylesXml.includes('</dxfs>')) {
        // Non-self-closing <dxfs>...</dxfs>: increment count and append entry
        stylesXml = stylesXml.replace(
            /(<dxfs[^>]*count=")(\d+)(")/,
            (m, pre, cnt, post) => `${pre}${parseInt(cnt) + 1}${post}`
        )
        stylesXml = stylesXml.replace('</dxfs>', dxfEntry + '</dxfs>')
    } else if (stylesXml.includes('<dxfs')) {
        // Self-closing <dxfs count="0"/> — replace with open/close form
        stylesXml = stylesXml.replace(
            /(<dxfs\b)[^/]*\/>/,
            `$1 count="1">${dxfEntry}</dxfs>`
        )
    } else {
        // No dxfs element — insert before <tableStyles> or at end
        const newDxfs = `<dxfs count="1">${dxfEntry}</dxfs>`
        if (stylesXml.includes('<tableStyles')) {
            stylesXml = stylesXml.replace('<tableStyles', newDxfs + '<tableStyles')
        } else {
            stylesXml = stylesXml.replace('</styleSheet>', newDxfs + '</styleSheet>')
        }
    }

    zip[stylesPath] = strToU8(stylesXml)
}

/**
 * Inject Excel formulas into sheet XML for computed columns (e.g. Age from DOB).
 * sheetFormulas: { [sheetIndex]: [{ col, formulaTemplate, startRow, endRow }] }
 * formulaTemplate uses {ROW} placeholder replaced with concrete row numbers.
 */
function injectFormulas(zip, sheetFormulas) {
    for (const [sheetIdx, formulas] of Object.entries(sheetFormulas)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        const startRow = Math.min(...formulas.map((f) => f.startRow))
        const endRow = Math.max(...formulas.map((f) => f.endRow))
        const sortedFormulas = [...formulas].sort((a, b) => a.col - b.col)
        const formulaColSet = new Set(sortedFormulas.map((f) => colLetter(f.col)))

        // Build formula cell objects keyed by row number (sorted by column)
        const formulaCellsByRow = {}
        for (let r = startRow; r <= endRow; r++) {
            const cells = sortedFormulas
                .filter((f) => r >= f.startRow && r <= f.endRow)
                .map((f) => {
                    const cl = colLetter(f.col)
                    const formula = f.formulaTemplate.replace(/\{ROW\}/g, String(r))
                    return { col: f.col, xml: `<c r="${cl}${r}"><f>${escapeXml(formula)}</f></c>` }
                })
            if (cells.length > 0) {
                formulaCellsByRow[r] = cells
            }
        }

        // Merge formula cells into existing rows, replacing overlapping cells and sorting by column
        const merged = new Set()
        xml = xml.replace(
            /<row\s+r="(\d+)"([^>]*?)>(.*?)<\/row>/gs,
            (match, rowNum, attrs, content) => {
                const r = parseInt(rowNum)
                if (!formulaCellsByRow[r]) return match
                merged.add(r)

                // Parse existing cells, excluding those in formula columns
                const existingCells = []
                const cellRegex = /<c\s+r="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g
                let cm
                while ((cm = cellRegex.exec(content)) !== null) {
                    if (!formulaColSet.has(cm[1])) {
                        existingCells.push({ col: colRefToIndex(cm[1]), xml: cm[0] })
                    }
                }

                // Combine existing + formula cells, sort by column for valid OOXML
                const allCells = [...existingCells, ...formulaCellsByRow[r]]
                allCells.sort((a, b) => a.col - b.col)
                return `<row r="${rowNum}"${attrs}>${allCells.map((c) => c.xml).join('')}</row>`
            }
        )

        // Create new rows for those that don't already exist
        const newRowXmls = []
        for (let r = startRow; r <= endRow; r++) {
            if (formulaCellsByRow[r] && !merged.has(r)) {
                newRowXmls.push(`<row r="${r}">${formulaCellsByRow[r].map((c) => c.xml).join('')}</row>`)
            }
        }

        if (newRowXmls.length > 0) {
            xml = xml.replace('</sheetData>', newRowXmls.join('') + '</sheetData>')
        }

        // Update dimension to cover the full data range
        xml = xml.replace(
            /<dimension\s+ref="([A-Z]+)\d+:([A-Z]+)\d+"/,
            (m, startCol, endCol) => `<dimension ref="${startCol}1:${endCol}${endRow}"`
        )

        zip[path] = strToU8(xml)
    }
}

/**
 * Inject conditional formatting rules to highlight invalid dropdown values in red.
 * Uses COUNTIF against the validation range — if the cell value doesn't appear in
 * the dropdown list, the cell gets a red fill.
 * sheetCfRules: { [sheetIndex]: [{ col, ref, startRow, maxRow }] }
 */
function injectConditionalFormatting(zip, sheetCfRules) {
    // Add a dxf (differential formatting) entry for the red fill
    addDxfFill(zip, 'FFFF6666')

    // Determine the dxfId — it's the last entry (count - 1) after adding
    const stylesPath = 'xl/styles.xml'
    let stylesXml = strFromU8(zip[stylesPath])
    const dxfCountMatch = stylesXml.match(/<dxfs[^>]*count="(\d+)"/)
    const dxfId = dxfCountMatch ? parseInt(dxfCountMatch[1]) - 1 : 0

    // Inject CF rules into each sheet
    for (const [sheetIdx, rules] of Object.entries(sheetCfRules)) {
        const path = `xl/worksheets/sheet${sheetIdx}.xml`
        if (!zip[path]) continue

        let xml = strFromU8(zip[path])

        const cfItems = rules.map((r, i) => {
            const cl = colLetter(r.col)
            const sqref = `${cl}${r.startRow}:${cl}${r.maxRow}`
            const cellRef = `${cl}${r.startRow}`
            // COUNTIF formula: count matching values in validation range; if 0 and cell not blank → red
            const formula = `AND(${cellRef}<>"",COUNTIF(${r.ref},${cellRef})=0)`
            return (
                `<conditionalFormatting sqref="${sqref}">` +
                `<cfRule type="expression" dxfId="${dxfId}" priority="${i + 1}">` +
                `<formula>${escapeXml(formula)}</formula>` +
                `</cfRule></conditionalFormatting>`
            )
        }).join('')

        // Insert CF BEFORE dataValidations (OOXML requires CF before DV)
        if (xml.includes('<dataValidations')) {
            xml = xml.replace('<dataValidations', cfItems + '<dataValidations')
        } else if (xml.includes('</mergeCells>')) {
            xml = xml.replace('</mergeCells>', '</mergeCells>' + cfItems)
        } else if (xml.includes('</sheetData>')) {
            xml = xml.replace('</sheetData>', '</sheetData>' + cfItems)
        } else {
            xml = xml.replace('</worksheet>', cfItems + '</worksheet>')
        }

        zip[path] = strToU8(xml)
    }
}

/**
 * Map a DHIS2 valueType to an Excel data validation rule.
 * Returns { type, operator?, formula1?, formula2?, errorTitle, error, promptTitle?, prompt? }
 * or null if no validation applies (e.g. TEXT, LONG_TEXT).
 */
function valueTypeToValidation(valueType) {
    switch (valueType) {
        case 'INTEGER':
            return {
                type: 'whole', operator: 'between',
                formula1: '-2147483648', formula2: '2147483647',
                errorTitle: 'Invalid integer', error: 'Please enter a whole number.',
                promptTitle: 'Integer', prompt: 'Enter a whole number.',
            }
        case 'POSITIVE_INTEGER':
            return {
                type: 'whole', operator: 'greaterThan',
                formula1: '0',
                errorTitle: 'Invalid value', error: 'Please enter a positive whole number (> 0).',
                promptTitle: 'Positive integer', prompt: 'Enter a whole number greater than 0.',
            }
        case 'NEGATIVE_INTEGER':
            return {
                type: 'whole', operator: 'lessThan',
                formula1: '0',
                errorTitle: 'Invalid value', error: 'Please enter a negative whole number (< 0).',
                promptTitle: 'Negative integer', prompt: 'Enter a whole number less than 0.',
            }
        case 'ZERO_OR_POSITIVE_INTEGER':
            return {
                type: 'whole', operator: 'greaterThanOrEqual',
                formula1: '0',
                errorTitle: 'Invalid value', error: 'Please enter zero or a positive whole number.',
                promptTitle: 'Integer >= 0', prompt: 'Enter 0 or a positive whole number.',
            }
        case 'NUMBER':
            return {
                type: 'decimal', operator: 'between',
                formula1: '-999999999999', formula2: '999999999999',
                errorTitle: 'Invalid number', error: 'Please enter a numeric value.',
                promptTitle: 'Number', prompt: 'Enter a numeric value.',
            }
        case 'PERCENTAGE':
            return {
                type: 'decimal', operator: 'between',
                formula1: '0', formula2: '100',
                errorTitle: 'Invalid percentage', error: 'Please enter a value between 0 and 100.',
                promptTitle: 'Percentage', prompt: 'Enter a value between 0 and 100.',
            }
        case 'UNIT_INTERVAL':
            return {
                type: 'decimal', operator: 'between',
                formula1: '0', formula2: '1',
                errorTitle: 'Invalid value', error: 'Please enter a value between 0 and 1.',
                promptTitle: 'Unit interval', prompt: 'Enter a decimal between 0 and 1.',
            }
        case 'DATE':
        case 'AGE':
            return {
                type: 'date', operator: 'between',
                formula1: '1', formula2: '73415',
                errorTitle: 'Invalid date', error: 'Please enter a valid date (YYYY-MM-DD).',
                promptTitle: 'Date', prompt: 'Enter a date in YYYY-MM-DD format.',
            }
        case 'PHONE_NUMBER':
            return {
                type: 'textLength', operator: 'between',
                formula1: '7', formula2: '20',
                errorTitle: 'Invalid phone number', error: 'Phone number must be 7-20 characters.',
                promptTitle: 'Phone number', prompt: 'Enter a phone number (7-20 digits).',
            }
        case 'EMAIL':
            return {
                type: 'custom',
                customFormula: (cellRef) =>
                    `AND(LEN(${cellRef})>5,ISERROR(FIND(" ",${cellRef})),NOT(ISERROR(FIND("@",${cellRef}))),NOT(ISERROR(FIND(".",${cellRef},FIND("@",${cellRef})))))`,
                errorTitle: 'Invalid email', error: 'Please enter a valid email address.',
                promptTitle: 'Email', prompt: 'Enter a valid email address.',
            }
        case 'BOOLEAN':
            return {
                type: 'list',
                listValues: '"true,false"',
                errorTitle: 'Invalid value', error: 'Please select true or false.',
                promptTitle: 'Boolean', prompt: 'Select true or false.',
            }
        case 'TRUE_ONLY':
            return {
                type: 'list',
                listValues: '"true"',
                errorTitle: 'Invalid value', error: 'Only "true" is allowed, or leave blank.',
                promptTitle: 'True only', prompt: 'Enter "true" or leave blank.',
            }
        default:
            return null
    }
}

/**
 * Map of DHIS2 d2: functions → Excel formula generators.
 * Each entry receives an array of already-translated argument strings.
 * Covers all documented program rule functions from DHIS2 v2.41 docs.
 */
const D2_TO_EXCEL = {
    // --- Date/time functions ---
    'd2:yearsBetween':   (a) => `DATEDIF(${a[0]},${a[1]},"Y")`,
    'd2:monthsBetween':  (a) => `DATEDIF(${a[0]},${a[1]},"M")`,
    'd2:weeksBetween':   (a) => `INT(DATEDIF(${a[0]},${a[1]},"D")/7)`,
    'd2:daysBetween':    (a) => `DATEDIF(${a[0]},${a[1]},"D")`,
    'd2:minutesBetween': (a) => `INT((${a[1]}-${a[0]})*1440)`,
    'd2:addDays':        (a) => `(${a[0]}+${a[1]})`,

    // --- Conditional ---
    'd2:condition': (a) => {
        let cond = a[0]
        if ((cond.startsWith("'") && cond.endsWith("'")) ||
            (cond.startsWith('"') && cond.endsWith('"'))) {
            cond = cond.slice(1, -1)
        }
        return `IF(${cond},${a[1]},${a[2]})`
    },
    'd2:hasValue': (a) => `(${a[0]}<>"")`,

    // --- Math ---
    'd2:ceil':    (a) => `ROUNDUP(${a[0]},0)`,
    'd2:floor':   (a) => `ROUNDDOWN(${a[0]},0)`,
    'd2:round':   (a) => a.length >= 2 ? `ROUND(${a[0]},${a[1]})` : `ROUND(${a[0]},0)`,
    'd2:modulus':  (a) => `MOD(${a[0]},${a[1]})`,
    'd2:oizp':    (a) => `IF(${a[0]}>=0,1,0)`,
    'd2:zing':    (a) => `IF(${a[0]}<0,0,${a[0]})`,
    'd2:zpvc':    (a) => `SUMPRODUCT((${a.join('+0>=0)*1,(')})`,

    // --- String ---
    'd2:concatenate': (a) => `CONCATENATE(${a.join(',')})`,
    'd2:length':      (a) => `LEN(${a[0]})`,
    'd2:left':        (a) => `LEFT(${a[0]},${a[1]})`,
    'd2:right':       (a) => `RIGHT(${a[0]},${a[1]})`,
    'd2:substring':   (a) => `MID(${a[0]},${a[1]}+1,${a[2]}-${a[1]})`,
    'd2:split':       (a) => `TRIM(MID(SUBSTITUTE(${a[0]},${a[1]},REPT(" ",999)),${a[2]}*999+1,999))`,

    // --- Counting (single-column approximations) ---
    'd2:count':           (a) => `COUNTA(${a[0]})`,
    'd2:countIfValue':    (a) => `COUNTIF(${a[0]},${a[1]})`,
    'd2:countIfZeroPos':  (a) => `COUNTIF(${a[0]},">="&0)`,

    // --- Formatting ---
    'd2:zpfv': (a) => `TEXT(${a[0]},REPT("0",${a[1]}))`,
}

/**
 * Extract function arguments from an expression string starting at the opening '('.
 * Respects nested parentheses and quoted strings.
 * Returns { args: string[], endIdx: number } or null if unmatched.
 */
function extractFuncArgs(expr, openParen) {
    let depth = 0
    const args = []
    let current = ''

    for (let i = openParen; i < expr.length; i++) {
        const ch = expr[i]
        if (ch === '(') {
            depth++
            if (depth === 1) continue
            current += ch
        } else if (ch === ')') {
            depth--
            if (depth === 0) {
                if (current.trim()) args.push(current.trim())
                return { args, endIdx: i }
            }
            current += ch
        } else if (ch === ',' && depth === 1) {
            args.push(current.trim())
            current = ''
        } else {
            current += ch
        }
    }
    return null
}

/**
 * Replace the first d2: function call found in the expression with its Excel equivalent.
 * Processes the innermost call first (no nested d2: inside arguments).
 * Returns the modified string, the original string if no d2: call found, or null if unsupported.
 */
/**
 * Non-d2 built-in functions used in DHIS2 program rules/indicators.
 * These appear without the d2: prefix in expressions.
 */
const BUILTIN_TO_EXCEL = {
    'if':           (a) => `IF(${a[0]},${a[1]},${a[2]})`,
    'isNull':       (a) => `(${a[0]}="")`,
    'isNotNull':    (a) => `(${a[0]}<>"")`,
    'firstNonNull': (a) => a.reduceRight((acc, v) => `IF(${v}<>"",${v},${acc})`, '""'),
    'greatest':     (a) => `MAX(${a.join(',')})`,
    'least':        (a) => `MIN(${a.join(',')})`,
    'log':          (a) => a.length >= 2 ? `LOG(${a[0]},${a[1]})` : `LN(${a[0]})`,
    'log10':        (a) => `LOG10(${a[0]})`,
}

/**
 * Replace the innermost d2: or built-in function call with its Excel equivalent.
 * Returns modified string, original string if no call found, or null if unsupported.
 */
function replaceD2Call(expr) {
    const calls = []
    // Match d2: prefixed functions
    const d2Re = /d2:(\w+)\s*\(/g
    let m
    while ((m = d2Re.exec(expr)) !== null) {
        calls.push({ name: `d2:${m[1]}`, index: m.index, parenPos: m.index + m[0].length - 1 })
    }
    // Match non-d2 built-in functions (word boundary to avoid matching inside other names)
    const builtinNames = Object.keys(BUILTIN_TO_EXCEL).join('|')
    const builtinRe = new RegExp(`\\b(${builtinNames})\\s*\\(`, 'g')
    while ((m = builtinRe.exec(expr)) !== null) {
        // Skip if preceded by d2: (already handled above)
        if (m.index >= 3 && expr.slice(m.index - 3, m.index) === 'd2:') continue
        calls.push({ name: m[1], index: m.index, parenPos: m.index + m[0].length - 1 })
    }
    if (calls.length === 0) return expr

    // Sort by position and process the LAST one (innermost)
    calls.sort((a, b) => a.index - b.index)
    const call = calls[calls.length - 1]
    const result = extractFuncArgs(expr, call.parenPos)
    if (!result) return null

    const xlFn = D2_TO_EXCEL[call.name] ?? BUILTIN_TO_EXCEL[call.name]
    if (!xlFn) return null

    const replacement = xlFn(result.args)
    return expr.slice(0, call.index) + replacement + expr.slice(result.endIdx + 1)
}

/**
 * Translate a DHIS2 program rule expression into an Excel formula template.
 *
 * @param {string} expr - DHIS2 expression (e.g. "d2:yearsBetween(A{DOB}, V{current_date})")
 * @param {Function} resolveRef - (type: 'A'|'#'|'V', id: string) => Excel cell ref or null
 * @returns {{ formula: string, isBoolean: boolean } | null}
 */
function translateToExcel(expr, resolveRef) {
    if (!expr?.trim()) return null
    let f = expr.trim()
    let failed = false

    // 1. Replace V{...} program variables
    f = f.replace(/V\{([^}]+)\}/g, (match, v) => {
        const ref = resolveRef('V', v.trim())
        if (!ref) { failed = true; return match }
        return ref
    })

    // 2. Replace A{...} attribute references
    f = f.replace(/A\{([^}]+)\}/g, (match, a) => {
        const ref = resolveRef('A', a.trim())
        if (!ref) { failed = true; return match }
        return ref
    })

    // 3. Replace #{...} data element references
    f = f.replace(/#\{([^}]+)\}/g, (match, d) => {
        const ref = resolveRef('#', d.trim())
        if (!ref) { failed = true; return match }
        return ref
    })

    if (failed) return null

    // 4. Translate d2: function calls (iterative, innermost first)
    for (let pass = 0; pass < 10; pass++) {
        const translated = replaceD2Call(f)
        if (translated === null) return null
        if (translated === f) break
        f = translated
    }

    // 5. Operator replacements
    f = f.replace(/==/g, '=')
    f = f.replace(/!=/g, '<>')

    // 6. Logical operators (simple top-level only)
    if (f.includes('&&')) {
        f = `AND(${f.split('&&').map((p) => p.trim()).join(',')})`
    } else if (f.includes('||')) {
        f = `OR(${f.split('||').map((p) => p.trim()).join(',')})`
    }

    // 7. Single-quoted strings → double-quoted
    f = f.replace(/'([^']*)'/g, '"$1"')

    // 8. Detect if result is boolean (comparison that isn't already inside IF)
    const isBoolean = !f.startsWith('IF(') && /[><=]/.test(f)

    return { formula: f, isBoolean }
}

/**
 * Build Excel formula specs from DHIS2 ASSIGN program rules.
 * Generic: translates any supported d2: expression, handles both attribute
 * and data element targets, and wraps boolean results for option-set fields.
 */
function buildAssignFormulas(metadata, teiAttributes, headerRow, dataStart, dataEnd) {
    const assignRules = metadata.assignRules ?? []
    if (assignRules.length === 0) return []

    // Column index map: UID → 0-based column index in headerRow
    const colMap = {}
    for (let i = 0; i < headerRow.length; i++) {
        const m = headerRow[i].match(/\[([A-Za-z0-9]+)\]/)
        if (m) colMap[m[1]] = i
    }

    // Name → UID lookup: program rule variable names first, then displayNames
    const nameToId = {}
    // 1. Program rule variable names → UIDs
    for (const [varName, uid] of Object.entries(metadata.ruleVarMap ?? {})) {
        nameToId[varName] = uid
        nameToId[varName.trim()] = uid
    }
    // 2. Attribute displayNames
    for (const a of teiAttributes) {
        nameToId[a.name.trim()] = a.id
    }
    // 3. Data element displayNames from all stages
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            const name = de.displayName ?? de.name
            if (name) nameToId[name.trim()] = de.id
        }
    }

    // Option display names for a given attribute or data element
    const getOptionDisplayNames = (id) => {
        for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
            const tea = a.trackedEntityAttribute ?? a
            if (tea.id === id && tea.optionSet?.options) {
                return tea.optionSet.options.map((o) => o.displayName ?? o.code)
            }
        }
        for (const stage of metadata.programStages ?? []) {
            for (const psde of stage.programStageDataElements ?? []) {
                const de = psde.dataElement ?? psde
                if (de.id === id && de.optionSet?.options) {
                    return de.optionSet.options.map((o) => o.displayName ?? o.code)
                }
            }
        }
        return null
    }

    // Reference resolver: maps DHIS2 references to Excel cell letters
    const resolveRef = (type, name) => {
        if (type === 'V') {
            if (name === 'current_date') return 'TODAY()'
            const varColPatterns = {
                'enrollment_date': /enrollment.date/i,
                'incident_date':   /incident.date/i,
                'event_date':      /event.date|occurred.at|report.date/i,
                'due_date':        /due.date|scheduled.date/i,
            }
            const pattern = varColPatterns[name]
            if (pattern) {
                const col = headerRow.findIndex((h) => pattern.test(h))
                if (col >= 0) return `${colLetter(col)}{ROW}`
            }
            return null
        }
        // For A{} and #{}, resolve by UID first, then by variable/display name
        const id = colMap[name] !== undefined ? name
            : nameToId[name] ?? nameToId[name.trim()]
        if (id && colMap[id] !== undefined) return `${colLetter(colMap[id])}{ROW}`
        return null
    }

    const formulas = []

    for (const rule of assignRules) {
        const targetCol = colMap[rule.targetId]
        if (targetCol === undefined) continue

        const result = translateToExcel(rule.expression, resolveRef)
        if (!result) continue

        let formulaTemplate = result.formula

        // Wrap with condition if the rule has a non-trivial condition
        const cond = (rule.condition ?? '').trim()
        if (cond && cond !== 'true' && cond !== '1') {
            const condResult = translateToExcel(cond, resolveRef)
            if (condResult) {
                formulaTemplate = `IF(${condResult.formula},${formulaTemplate},"")`
            }
        }

        // If the expression returns boolean and target has an option set,
        // wrap in IF(source="","", IF(expr, optionB, optionA))
        if (result.isBoolean) {
            const options = getOptionDisplayNames(rule.targetId)
            if (options && options.length === 2) {
                // Options are in DHIS2 sort order (lower category first).
                // Boolean TRUE from >=|> means higher → second option.
                formulaTemplate = `IF(${formulaTemplate},"${options[1]}","${options[0]}")`
            }
        }

        // Wrap with empty-check on source cells to avoid errors on blank rows
        const srcRefs = [...formulaTemplate.matchAll(/([A-Z]+)\{ROW\}/g)]
        if (srcRefs.length > 0) {
            const firstSrc = srcRefs[0][1]
            formulaTemplate = `IF(${firstSrc}{ROW}="","",${formulaTemplate})`
        }

        formulas.push({
            col: targetCol,
            formulaTemplate,
            startRow: dataStart,
            endRow: dataEnd,
        })
    }

    return formulas
}

/**
 * Build conditional formatting rules that highlight cells red when their value
 * doesn't match the dropdown validation list.
 * dvRules: array of { col, ref, startRow, maxRow } from dropdown validations.
 * Returns array of { col, ref, startRow, maxRow } (same shape, used for CF injection).
 */
function buildConditionalFormattingRules(dvRules, dataStart, dataEnd) {
    return dvRules.map((r) => ({
        col: r.col,
        ref: r.ref,
        startRow: dataStart,
        maxRow: dataEnd,
    }))
}
