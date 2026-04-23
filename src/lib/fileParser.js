import * as XLSX from 'xlsx'
import { parseDate, normalizeBoolean, cleanInvisibleChars } from './dataCleaner'

/**
 * Get column headers from a specific sheet starting at a given row (1-indexed).
 * Row 1 means the first row of the sheet contains headers.
 */
export function getSheetHeaders(workbook, sheetName, headerRow = 1) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return []
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRow - 1 })
    return rows.length > 0 ? Object.keys(rows[0]) : []
}

/**
 * Read an Excel file and return workbook info (sheets, headers, row counts)
 * without applying any mapping. Used to power the ColumnMapper UI.
 */
export async function readWorkbook(file) {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

    const sheets = {}
    for (const name of wb.SheetNames) {
        const headers = getSheetHeaders(wb, name, 1)
        const ref = wb.Sheets[name]['!ref']
        const range = ref ? XLSX.utils.decode_range(ref) : null
        const rowCount = range ? range.e.r - range.s.r : 0
        sheets[name] = { headers, rowCount }
    }

    return { workbook: wb, sheets, sheetNames: wb.SheetNames }
}

/**
 * Detect whether an uploaded file uses our app-generated template format
 * (columns have "[UID]" suffixes and known system columns like TEI_ID).
 */
export function isAppTemplate(sheetsInfo) {
    const teiSheet = sheetsInfo['TEI + Enrollment']
    if (!teiSheet) return false

    const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/
    const hasUidCols = teiSheet.headers.some((h) => uidPattern.test(h))
    const hasSystemCols = teiSheet.headers.some((h) =>
        ['TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE'].includes(h)
    )
    return hasUidCols && hasSystemCols
}

/**
 * Detect whether an uploaded file uses our event program template format.
 * Event templates have stage-named sheets with ORG_UNIT_ID, EVENT_DATE, and [UID] columns.
 */
export function isEventTemplate(sheetsInfo, metadata) {
    const stages = metadata.programStages ?? []
    const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/

    for (const stage of stages) {
        const sheet = findSheetByStage(Object.keys(sheetsInfo), stage.displayName)
        if (!sheet) continue
        const info = sheetsInfo[sheet]
        if (!info) continue
        const hasUidCols = info.headers.some((h) => uidPattern.test(h))
        const hasSystemCols = info.headers.some((h) =>
            ['ORG_UNIT_ID', 'EVENT_DATE', 'EVENT_DATE *'].includes(h)
        )
        if (hasUidCols && hasSystemCols) return true
    }
    return false
}

/**
 * Auto-detect which row contains column headers by scoring each row
 * against known DHIS2 field names from metadata.
 *
 * Heuristic: the header row is the one with the most cells matching
 * attribute/data-element names, UIDs, or known system column names.
 * Scans up to the first 10 rows.
 *
 * @returns {number} 1-indexed row number (default 1 if nothing detected)
 */
export function detectHeaderRow(workbook, sheetName, metadata) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return 1

    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
    if (!range) return 1

    // Build a set of known terms to match against
    const knownTerms = new Set()
    const systemCols = [
        'tei_id', 'org_unit_id', 'enrollment_date', 'incident_date', 'event_date',
        's/n', 'id', 'orgunit', 'organisation unit', 'org unit', 'date',
    ]
    for (const t of systemCols) knownTerms.add(t)

    const attrs = getAttributes(metadata)
    for (const a of attrs) {
        knownTerms.add(a.displayName.toLowerCase())
        knownTerms.add(a.id.toLowerCase())
        // Also add pipe-stripped names
        const stripped = stripPipePrefix(a.displayName.toLowerCase())
        if (stripped !== a.displayName.toLowerCase()) knownTerms.add(stripped)
    }
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            knownTerms.add(de.displayName.toLowerCase())
            knownTerms.add(de.id.toLowerCase())
            const stripped = stripPipePrefix(de.displayName.toLowerCase())
            if (stripped !== de.displayName.toLowerCase()) knownTerms.add(stripped)
        }
    }

    const maxRow = Math.min(range.e.r, 9) // scan first 10 rows (0-indexed)
    let bestRow = 0
    let bestScore = 0

    for (let r = range.s.r; r <= maxRow; r++) {
        let score = 0
        let cellCount = 0
        for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c })
            const cell = sheet[addr]
            if (!cell || cell.v == null) continue
            cellCount++
            const val = String(cell.v).toLowerCase().trim()
            if (!val) continue
            // Check exact match
            if (knownTerms.has(val)) { score += 2; continue }
            // Check stripped match
            const stripped = stripPipePrefix(normalize(val))
            if (knownTerms.has(stripped)) { score += 2; continue }
            // Check if contains a UID pattern [UID]
            if (/\[[A-Za-z0-9]{11}\]/.test(val)) { score += 2; continue }
            // Partial match against any known term
            for (const term of knownTerms) {
                if (term.length >= 3 && (val.includes(term) || term.includes(val))) {
                    score += 1
                    break
                }
            }
        }
        // Penalize rows with very few cells (likely a grouping/title row)
        if (cellCount < 3) score = Math.max(0, score - 2)
        if (score > bestScore) {
            bestScore = score
            bestRow = r
        }
    }

    return bestRow + 1 // convert to 1-indexed
}

/**
 * Auto-generate a mapping by trying to match Excel columns to DHIS2 metadata.
 * Returns a mapping object that can be used by applyMapping().
 *
 * mapping shape:
 * {
 *   teiSheet: string,                   // sheet name for TEI + Enrollment
 *   teiIdColumn: string,                // column for local TEI reference
 *   orgUnitColumn: string,              // column for org unit
 *   enrollmentDateColumn: string,       // column for enrollment date
 *   incidentDateColumn: string,         // column for incident date
 *   attributeMapping: { attrId: columnName },
 *   stages: {
 *     stageId: {
 *       sheet: string,                  // sheet name for this stage
 *       headerRow: number,
 *       teiIdColumn: string,            // only needed when stage sheet != TEI sheet
 *       eventGroups: [                  // one per event instance on the same row
 *         {
 *           eventDateColumn: string,
 *           orgUnitColumn: string,
 *           dataElementMapping: { deId: columnName },
 *         }
 *       ]
 *     }
 *   }
 * }
 */
export function buildAutoMapping(sheetsInfo, metadata, workbook) {
    const mapping = {
        teiSheet: '',
        headerRow: 1,
        teiIdColumn: '',
        orgUnitColumn: '',
        enrollmentDateColumn: '',
        incidentDateColumn: '',
        attributeMapping: {},
        stages: {},
    }

    const allSheetNames = Object.keys(sheetsInfo).filter((n) => n !== 'Validation')

    // Find best TEI sheet — fall back to first data sheet if named candidates miss
    const teiSheetName = findBestSheet(allSheetNames, [
        'TEI + Enrollment', 'TEI', 'Enrollment', 'Registration', 'Beneficiar', 'Data Entry',
    ]) || (allSheetNames.length > 0 ? allSheetNames[0] : null)
    if (!teiSheetName) return mapping

    mapping.teiSheet = teiSheetName

    // Auto-detect header row when workbook is available
    let detectedHeaderRow = 1
    if (workbook) {
        detectedHeaderRow = detectHeaderRow(workbook, teiSheetName, metadata)
    }
    mapping.headerRow = detectedHeaderRow

    // Re-read headers from the detected row (sheetsInfo may have row-1 headers)
    const teiHeaders = workbook
        ? getSheetHeaders(workbook, teiSheetName, detectedHeaderRow)
        : sheetsInfo[teiSheetName].headers

    // Auto-detect system columns on TEI sheet
    mapping.teiIdColumn = findBestColumn(teiHeaders, [
        'TEI_ID', 'tei_id', 'S/N', 'ID', 'Row', 'No', '#',
    ]) || ''
    mapping.orgUnitColumn = findBestColumn(teiHeaders, [
        'ORG_UNIT_ID', 'org_unit', 'Organisation Unit', 'Org Unit', 'OrgUnit', 'orgUnit',
        'District', 'Facility', 'Club Name',
    ]) || ''
    mapping.enrollmentDateColumn = findBestColumn(teiHeaders, [
        'ENROLLMENT_DATE', 'Enrollment Date', 'enrollment_date', 'Registration Date',
        'Date of Registration', 'Date Enrolled',
    ]) || ''
    mapping.incidentDateColumn = findBestColumn(teiHeaders, [
        'INCIDENT_DATE', 'Incident Date', 'incident_date', 'Date of Incident',
        'Occurrence Date',
    ]) || ''

    // Auto-map attributes
    const attrs = getAttributes(metadata)
    for (const attr of attrs) {
        const col = matchColumn(teiHeaders, attr.id, attr.displayName)
        if (col) {
            mapping.attributeMapping[attr.id] = col
        }
    }

    // Auto-map program stages
    const stages = metadata.programStages ?? []
    for (const stage of stages) {
        // Try to find a dedicated sheet for this stage
        let sheetName = findBestSheet(allSheetNames, [
            stage.displayName, stage.displayName.slice(0, 25), stage.id,
        ])

        // If no dedicated sheet found, fall back to the TEI sheet (flat/single-sheet layout)
        if (!sheetName) sheetName = teiSheetName

        // Use the same detected header row when on the TEI sheet, or detect separately
        const stageHeaderRow = sheetName === teiSheetName
            ? detectedHeaderRow
            : (workbook ? detectHeaderRow(workbook, sheetName, metadata) : 1)

        const stageMapping = {
            sheet: sheetName,
            headerRow: stageHeaderRow,
            teiIdColumn: '',
            eventGroups: [],
        }

        // Re-read headers from the correct row
        const stageHeaders = workbook
            ? getSheetHeaders(workbook, sheetName, stageHeaderRow)
            : (sheetsInfo[sheetName]?.headers ?? [])

        // Only set teiIdColumn when using a different sheet than TEI
        if (sheetName !== teiSheetName) {
            stageMapping.teiIdColumn = findBestColumn(stageHeaders, [
                'TEI_ID', 'tei_id', 'S/N', 'ID', 'Row', 'No',
            ]) || ''
        }

        const des = stage.programStageDataElements ?? []

        // Detect repeated column groups for repeatable stages.
        // Uses category row above headers and/or SheetJS _N dedup suffixes.
        const repeatedGroups = stage.repeatable && workbook
            ? detectRepeatedColumnGroups(workbook, sheetName, stageHeaderRow, des, stage.displayName)
            : null

        if (repeatedGroups && repeatedGroups.length > 1) {
            // Multiple event groups detected from repeated columns
            for (const rg of repeatedGroups) {
                stageMapping.eventGroups.push(rg)
            }
        } else {
            // Single event group — standard auto-mapping
            const stageDateCandidates = [
                `${stage.displayName}-Date`, `${stage.displayName} Date`,
                ...stripPrefix(stage.displayName).flatMap((n) => [`${n}-Date`, `${n} Date`]),
                'EVENT_DATE', 'Event Date', 'event_date', 'Date', 'Training Date',
                'Session Date', 'Date of Event',
            ]
            const eventGroup = {
                eventDateColumn: findBestColumn(stageHeaders, stageDateCandidates) || '',
                orgUnitColumn: findBestColumn(stageHeaders, [
                    'ORG_UNIT_ID', 'org_unit', 'Organisation Unit', 'Org Unit',
                    'District', 'Facility',
                ]) || '',
                dataElementMapping: {},
            }

            for (const psde of des) {
                const de = psde.dataElement ?? psde
                const col = matchColumn(stageHeaders, de.id, de.displayName)
                if (col) {
                    eventGroup.dataElementMapping[de.id] = col
                }
            }

            stageMapping.eventGroups.push(eventGroup)
        }

        mapping.stages[stage.id] = stageMapping

        // Debug: log per-stage auto-mapping results
        const totalGroups = stageMapping.eventGroups.length
        const mappedDEs = stageMapping.eventGroups.reduce((n, g) =>
            n + Object.values(g.dataElementMapping ?? {}).filter(Boolean).length, 0)
        const hasDate = stageMapping.eventGroups.some((g) => g.eventDateColumn)
        console.log(
            `[AutoMap] ${stage.displayName} (${stage.id}): ` +
            `sheet="${sheetName}" row=${stageHeaderRow} groups=${totalGroups} ` +
            `DEs=${mappedDEs}/${des.length} date=${hasDate}`
        )
    }

    // Inherit TEI orgUnitColumn for event groups that have none mapped
    if (mapping.orgUnitColumn) {
        for (const stageMap of Object.values(mapping.stages)) {
            for (const group of stageMap.eventGroups ?? []) {
                if (!group.orgUnitColumn) {
                    group.orgUnitColumn = mapping.orgUnitColumn
                }
            }
        }
    }

    return mapping
}

/**
 * Apply a column mapping to a workbook and produce the parsed import data.
 * This is the main entry point when using the mapping UI.
 */
export function applyMapping(workbook, mapping, metadata) {
    const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? [])
    const optMaps = buildOptionMaps(metadata)
    const vtIndex = buildValueTypeIndex(metadata)
    const result = { trackedEntities: [], stageData: {} }

    // Parse TEI sheet
    const teiSheet = workbook.Sheets[mapping.teiSheet]
    if (!teiSheet) {
        throw new Error(`Sheet "${mapping.teiSheet}" not found in workbook.`)
    }

    const teiHeaderRow = mapping.headerRow || 1
    const teiRows = XLSX.utils.sheet_to_json(teiSheet, { defval: '', range: teiHeaderRow - 1 })

    // Deduplicate TEIs by teiId — when the same person appears on multiple rows
    // (e.g. single sheet with repeatable stage events), keep first occurrence.
    const seenTeiIds = new Set()
    for (let i = 0; i < teiRows.length; i++) {
        const row = teiRows[i]
        const teiId = mapping.teiIdColumn
            ? String(row[mapping.teiIdColumn] ?? '').trim()
            : String(i + 1)
        if (!teiId || seenTeiIds.has(teiId)) continue
        seenTeiIds.add(teiId)

        const attributes = {}
        for (const [attrId, col] of Object.entries(mapping.attributeMapping)) {
            const val = row[col]
            if (val !== '' && val != null) {
                const formatted = formatValue(val)
                attributes[attrId] = normalizeByType(resolveOption(formatted, optMaps.attrs[attrId]), vtIndex.attrs[attrId])
            }
        }

        const rawOrgUnit = mapping.orgUnitColumn
            ? String(row[mapping.orgUnitColumn] ?? '').trim()
            : ''
        const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

        result.trackedEntities.push({
            teiId,
            orgUnit,
            enrollmentDate: mapping.enrollmentDateColumn
                ? formatDate(row[mapping.enrollmentDateColumn])
                : '',
            incidentDate: mapping.incidentDateColumn
                ? formatDate(row[mapping.incidentDateColumn])
                : '',
            attributes,
        })
    }

    // Parse stage data
    for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
        if (!stageMap.sheet) continue
        const stageSheet = workbook.Sheets[stageMap.sheet]
        if (!stageSheet) continue

        const eventGroups = stageMap.eventGroups ?? []
        if (eventGroups.length === 0) continue

        const sameSheet = stageMap.sheet === mapping.teiSheet
        const stageHeaderRow = stageMap.headerRow || 1
        // If same sheet as TEI, reuse already-parsed rows; otherwise parse the stage sheet
        const stageRows = sameSheet
            ? teiRows
            : XLSX.utils.sheet_to_json(stageSheet, { defval: '', range: stageHeaderRow - 1 })

        const events = []

        for (let i = 0; i < stageRows.length; i++) {
            const row = stageRows[i]

            // Determine teiId: same-sheet uses the TEI row's own id, separate sheet uses its own column
            let teiId
            if (sameSheet) {
                teiId = mapping.teiIdColumn
                    ? String(row[mapping.teiIdColumn] ?? '').trim()
                    : String(i + 1)
            } else {
                teiId = stageMap.teiIdColumn
                    ? String(row[stageMap.teiIdColumn] ?? '').trim()
                    : String(i + 1)
            }
            if (!teiId) continue

            // Each event group on the same row produces one event (if it has data)
            for (const group of eventGroups) {
                const dataValues = {}
                for (const [deId, col] of Object.entries(group.dataElementMapping ?? {})) {
                    if (!col) continue
                    const val = row[col]
                    if (val !== '' && val != null) {
                        const formatted = formatValue(val)
                        dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId])
                    }
                }

                // Skip empty event groups (no data values filled in for this row)
                if (Object.keys(dataValues).length === 0) continue

                const rawOrgUnit = group.orgUnitColumn
                    ? String(row[group.orgUnitColumn] ?? '').trim()
                    : ''
                const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

                events.push({
                    teiId,
                    eventDate: group.eventDateColumn
                        ? formatDate(row[group.eventDateColumn])
                        : '',
                    orgUnit,
                    dataValues,
                })
            }
        }

        result.stageData[stageId] = events
    }

    return result
}

/**
 * Parse an uploaded Excel file into structured data keyed by TEI_ID.
 * Uses auto-detection for app-generated templates (backward compatible).
 * For event programs, pass metadata with programType === 'WITHOUT_REGISTRATION'.
 */
export async function parseUploadedFile(file, metadata) {
    const { workbook, sheets } = await readWorkbook(file)
    const isEvent = metadata.programType === 'WITHOUT_REGISTRATION'

    if (isEvent && isEventTemplate(sheets, metadata)) {
        return parseEventTemplateWorkbook(workbook, metadata)
    }

    if (!isEvent && isAppTemplate(sheets)) {
        // App-generated tracker template — use built-in column resolution
        return parseTemplateWorkbook(workbook, metadata)
    }

    if (isEvent) {
        // External event file — auto-map and apply for events
        const mapping = buildEventAutoMapping(sheets, metadata, workbook)
        return applyEventMapping(workbook, mapping, metadata)
    }

    // External tracker file — auto-map and apply
    const mapping = buildAutoMapping(sheets, metadata, workbook)
    return applyMapping(workbook, mapping, metadata)
}

/**
 * Parse a workbook that uses the app-generated template format
 * (columns have "[UID]" suffixes and system columns TEI_ID, ORG_UNIT_ID, etc.)
 */
function parseTemplateWorkbook(wb, metadata) {
    const result = { trackedEntities: [], stageData: {} }
    const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? [])
    const optMaps = buildOptionMaps(metadata)
    const vtIndex = buildValueTypeIndex(metadata)
    const attrLookup = buildAttributeLookup(metadata)

    const teiSheet = wb.Sheets['TEI + Enrollment']
    if (!teiSheet) {
        throw new Error('Missing "TEI + Enrollment" sheet in the uploaded file.')
    }

    const teiRows = XLSX.utils.sheet_to_json(teiSheet, { defval: '' })
    if (teiRows.length === 0) {
        throw new Error('"TEI + Enrollment" sheet has no data rows.')
    }

    const teiHeaders = Object.keys(teiRows[0])
    const attrColumns = resolveColumns(teiHeaders, attrLookup)

    for (const row of teiRows) {
        const teiId = String(row['TEI_ID'] ?? '').trim()
        if (!teiId) continue

        const attributes = {}
        for (const [col, attrId] of Object.entries(attrColumns)) {
            const val = row[col]
            if (val !== '' && val != null) {
                const formatted = formatValue(val)
                attributes[attrId] = normalizeByType(resolveOption(formatted, optMaps.attrs[attrId]), vtIndex.attrs[attrId])
            }
        }

        const rawOrgUnit = String(row['ORG_UNIT_ID'] ?? '').trim()
        const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

        result.trackedEntities.push({
            teiId,
            orgUnit,
            enrollmentDate: formatDate(row['ENROLLMENT_DATE']),
            incidentDate: formatDate(row['INCIDENT_DATE']),
            attributes,
        })
    }

    const stages = metadata.programStages ?? []
    for (const stage of stages) {
        const sheetName = findStageSheet(wb.SheetNames, stage.displayName)
        if (!sheetName) continue

        const stageSheet = wb.Sheets[sheetName]
        const stageRows = XLSX.utils.sheet_to_json(stageSheet, { defval: '' })
        if (stageRows.length === 0) continue

        const stageHeaders = Object.keys(stageRows[0])
        const stageDeLookup = buildStageDeLookup(stage)
        const deColumns = resolveColumns(stageHeaders, stageDeLookup)
        const events = []

        for (const row of stageRows) {
            const teiId = String(row['TEI_ID'] ?? '').trim()
            if (!teiId) continue

            const dataValues = {}
            for (const [col, deId] of Object.entries(deColumns)) {
                const val = row[col]
                if (val !== '' && val != null) {
                    const formatted = formatValue(val)
                    dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId])
                }
            }

            const rawOrgUnit = String(row['ORG_UNIT_ID'] ?? '').trim()
            const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

            events.push({
                teiId,
                eventDate: formatDate(row['EVENT_DATE']),
                orgUnit,
                dataValues,
            })
        }

        result.stageData[stage.id] = events
    }

    return result
}

/**
 * Parse an event program template workbook.
 * Returns { events: { stageId: [{ orgUnit, eventDate, dataValues }] } }
 */
function parseEventTemplateWorkbook(wb, metadata) {
    const result = { events: {} }
    const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? [])
    const optMaps = buildOptionMaps(metadata)
    const vtIndex = buildValueTypeIndex(metadata)

    const stages = metadata.programStages ?? []
    for (const stage of stages) {
        const sheetName = findSheetByStage(wb.SheetNames, stage.displayName)
        if (!sheetName) continue

        const stageSheet = wb.Sheets[sheetName]
        const stageRows = XLSX.utils.sheet_to_json(stageSheet, { defval: '' })
        if (stageRows.length === 0) continue

        const stageHeaders = Object.keys(stageRows[0])
        const stageDeLookup = buildStageDeLookup(stage)
        const deColumns = resolveColumns(stageHeaders, stageDeLookup)
        const events = []

        for (const row of stageRows) {
            const rawOrgUnit = String(row['ORG_UNIT_ID'] ?? '').trim()
            if (!rawOrgUnit) continue
            const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

            // Try both "EVENT_DATE *" and "EVENT_DATE"
            const eventDate = formatDate(row['EVENT_DATE *'] ?? row['EVENT_DATE'])

            const dataValues = {}
            for (const [col, deId] of Object.entries(deColumns)) {
                const val = row[col]
                if (val !== '' && val != null) {
                    const formatted = formatValue(val)
                    dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId])
                }
            }

            events.push({ orgUnit, eventDate, dataValues })
        }

        result.events[stage.id] = events
    }

    return result
}

/**
 * Build auto-mapping for an event program file (no TEI/enrollment mapping needed).
 */
export function buildEventAutoMapping(sheetsInfo, metadata, workbook) {
    const mapping = { stages: {} }
    const allSheetNames = Object.keys(sheetsInfo).filter((n) => n !== 'Validation' && n !== 'Instructions')
    const stages = metadata.programStages ?? []

    for (const stage of stages) {
        let sheetName = findBestSheet(allSheetNames, [
            stage.displayName, stage.displayName.slice(0, 25), stage.id,
        ])
        if (!sheetName && allSheetNames.length > 0) {
            sheetName = allSheetNames[0]
        }
        if (!sheetName) continue

        const stageHeaderRow = workbook
            ? detectHeaderRow(workbook, sheetName, metadata)
            : 1
        const stageHeaders = workbook
            ? getSheetHeaders(workbook, sheetName, stageHeaderRow)
            : (sheetsInfo[sheetName]?.headers ?? [])

        const des = stage.programStageDataElements ?? []
        const eventGroup = {
            eventDateColumn: findBestColumn(stageHeaders, [
                'EVENT_DATE', 'EVENT_DATE *', 'Event Date', 'Date', 'event_date',
                `${stage.displayName}-Date`, `${stage.displayName} Date`,
            ]) || '',
            orgUnitColumn: findBestColumn(stageHeaders, [
                'ORG_UNIT_ID', 'org_unit', 'Organisation Unit', 'Org Unit',
                'District', 'Facility',
            ]) || '',
            dataElementMapping: {},
        }

        for (const psde of des) {
            const de = psde.dataElement ?? psde
            const col = matchColumn(stageHeaders, de.id, de.displayName)
            if (col) {
                eventGroup.dataElementMapping[de.id] = col
            }
        }

        mapping.stages[stage.id] = {
            sheet: sheetName,
            headerRow: stageHeaderRow,
            eventGroups: [eventGroup],
        }
    }

    // Inherit top-level orgUnitColumn for event groups that have none mapped
    if (mapping.orgUnitColumn) {
        for (const stageMap of Object.values(mapping.stages)) {
            for (const group of stageMap.eventGroups ?? []) {
                if (!group.orgUnitColumn) {
                    group.orgUnitColumn = mapping.orgUnitColumn
                }
            }
        }
    }

    return mapping
}

/**
 * Apply an event mapping to a workbook and produce parsed event data.
 */
export function applyEventMapping(workbook, mapping, metadata) {
    const orgUnitMap = buildOrgUnitMap(metadata.organisationUnits ?? [])
    const optMaps = buildOptionMaps(metadata)
    const vtIndex = buildValueTypeIndex(metadata)
    const result = { events: {} }

    for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
        if (!stageMap.sheet) continue
        const stageSheet = workbook.Sheets[stageMap.sheet]
        if (!stageSheet) continue

        const eventGroups = stageMap.eventGroups ?? []
        if (eventGroups.length === 0) continue

        const stageHeaderRow = stageMap.headerRow || 1
        const stageRows = XLSX.utils.sheet_to_json(stageSheet, { defval: '', range: stageHeaderRow - 1 })
        const events = []

        for (let i = 0; i < stageRows.length; i++) {
            const row = stageRows[i]

            for (const group of eventGroups) {
                const dataValues = {}
                for (const [deId, col] of Object.entries(group.dataElementMapping ?? {})) {
                    if (!col) continue
                    const val = row[col]
                    if (val !== '' && val != null) {
                        const formatted = formatValue(val)
                        dataValues[deId] = normalizeByType(resolveOption(formatted, optMaps.des[deId]), vtIndex.des[deId])
                    }
                }
                if (Object.keys(dataValues).length === 0) continue

                const rawOrgUnit = group.orgUnitColumn
                    ? String(row[group.orgUnitColumn] ?? '').trim()
                    : ''
                const orgUnit = resolveOrgUnit(rawOrgUnit, orgUnitMap)

                events.push({
                    orgUnit,
                    eventDate: group.eventDateColumn
                        ? formatDate(row[group.eventDateColumn])
                        : '',
                    dataValues,
                })
            }
        }

        result.events[stageId] = events
    }

    return result
}

/**
 * Find a sheet name matching a stage display name (case-insensitive prefix match).
 */
function findSheetByStage(sheetNames, stageName) {
    const lower = stageName.toLowerCase()
    return sheetNames.find((n) => n.toLowerCase() === lower)
        || sheetNames.find((n) => n.toLowerCase().startsWith(lower.slice(0, 25)))
        || null
}

/**
 * Extract tracked entity attributes from metadata (handles both shapes).
 */
export function getAttributes(metadata) {
    const attrs = metadata.trackedEntityType?.trackedEntityTypeAttributes
        ?? metadata.programTrackedEntityAttributes
        ?? []
    return attrs.map((a) => {
        const tea = a.trackedEntityAttribute ?? a
        return { id: tea.id, displayName: tea.displayName }
    })
}

/**
 * Read raw cell values from a specific row (0-indexed) of a sheet.
 * Returns an array of { col, value } in column order.
 */
function readRawRow(sheet, rowIdx) {
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
    if (!range) return []
    const cells = []
    for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c })
        const cell = sheet[addr]
        cells.push({ col: c, value: cell ? String(cell.v ?? '').trim() : '' })
    }
    return cells
}

/**
 * Detect repeated column groups for repeatable stages on a flat sheet.
 *
 * Uses two strategies:
 *
 * 1. **Category row** (row above header row): If a grouping row exists with the stage
 *    name repeated across column spans, group the columns under each occurrence.
 *
 * 2. **SheetJS deduplication suffixes**: When duplicate header names exist, SheetJS
 *    appends _1, _2, ... (e.g. "Date", "Topic", "Date_1", "Topic_1").
 *    Also handles explicit numbering: "Topic 1"/"Topic 2", "(1)"/"(2)", etc.
 *
 * @param {object} workbook - The XLSX workbook object
 * @param {string} sheetName - Sheet name to scan
 * @param {number} headerRow - 1-indexed header row number
 * @param {Array} des - programStageDataElements
 * @param {string} stageName - display name of the stage
 * @returns {Array|null} Array of eventGroup objects, or null if no repeats found
 */
function detectRepeatedColumnGroups(workbook, sheetName, headerRow, des, stageName) {
    const sheet = workbook?.Sheets?.[sheetName]
    if (!sheet || des.length === 0) return null

    const headers = getSheetHeaders(workbook, sheetName, headerRow)
    if (headers.length === 0) return null

    // Strategy 1: Use category row (row above header row) if available
    if (headerRow > 1) {
        const groups = detectFromCategoryRow(sheet, headerRow, headers, des, stageName)
        if (groups && groups.length > 1) return groups
    }

    // Strategy 2: Detect SheetJS _N suffixes and explicit numbering patterns
    const groups = detectFromSuffixPatterns(headers, des, stageName)
    if (groups && groups.length > 1) return groups

    return null
}

/**
 * Strategy 1: Use the category/grouping row above the header row.
 * If the stage name appears multiple times in the category row,
 * each occurrence spans a group of columns forming one event group.
 */
function detectFromCategoryRow(sheet, headerRow, headers, des, stageName) {
    const catRowIdx = headerRow - 2 // 0-indexed row above headers
    const catCells = readRawRow(sheet, catRowIdx)
    if (catCells.length === 0) return null

    const stageNameLower = stageName.toLowerCase()
    const stageStripped = stripPipePrefix(stageNameLower)

    // Find column ranges where category matches the stage name
    // Category cells might use merged cells — fill forward from non-empty cells
    const filledCat = []
    let lastVal = ''
    for (const cell of catCells) {
        if (cell.value) lastVal = cell.value
        filledCat.push({ col: cell.col, value: lastVal })
    }

    // Also account for actual merges
    const merges = sheet['!merges'] ?? []
    for (const merge of merges) {
        if (merge.s.r !== catRowIdx) continue
        const addr = XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })
        const cell = sheet[addr]
        const val = cell ? String(cell.v ?? '').trim() : ''
        for (let c = merge.s.c; c <= merge.e.c; c++) {
            const idx = filledCat.findIndex((f) => f.col === c)
            if (idx >= 0) filledCat[idx].value = val
        }
    }

    // Find groups of columns matching the stage name.
    // Split into a new group whenever the category value changes — this handles
    // repeated stages whose category cells read "Stage (1)", "Stage (2)", etc.
    const stageGroups = [] // each: [colIndex, colIndex, ...]
    let currentGroup = null
    let prevCatValue = null

    for (const cell of filledCat) {
        const cellLower = cell.value.toLowerCase()
        const matches = cellLower === stageNameLower
            || cellLower === stageStripped
            || stripPipePrefix(cellLower) === stageStripped
            || cellLower.includes(stageStripped)
            || stageStripped.includes(cellLower)

        if (matches) {
            // Start a new group when first match or when category value changes
            if (prevCatValue === null || cellLower !== prevCatValue) {
                currentGroup = []
                stageGroups.push(currentGroup)
            }
            currentGroup.push(cell.col)
            prevCatValue = cellLower
        } else {
            prevCatValue = null
        }
    }

    if (stageGroups.length < 2) return null

    // Map column indices back to header names
    // headers array is ordered by column — we need to map col index to header name
    const headerRowIdx = headerRow - 1
    const headerCells = readRawRow(sheet, headerRowIdx)

    // Build col→header mapping using the deduped header names from SheetJS
    // SheetJS headers are in order, so headers[i] corresponds to the (i+1)th non-empty header cell
    const colToHeader = {}
    for (let i = 0; i < headers.length; i++) {
        if (i < headerCells.length) {
            colToHeader[headerCells[i].col] = headers[i]
        }
    }

    const groups = []
    for (const colGroup of stageGroups) {
        const groupHeaders = colGroup
            .map((c) => colToHeader[c])
            .filter(Boolean)

        if (groupHeaders.length === 0) continue

        // Strip SheetJS _N dedup suffixes for matching, but map back to actual header
        const baseHeaders = groupHeaders.map((h) => h.replace(/_\d+$/, ''))
        const baseToActual = Object.fromEntries(
            groupHeaders.map((h, i) => [baseHeaders[i], h])
        )

        const deMapping = {}
        let mappedCount = 0
        for (const psde of des) {
            const de = psde.dataElement ?? psde
            const baseMatch = matchColumn(baseHeaders, de.id, de.displayName)
            if (baseMatch) {
                deMapping[de.id] = baseToActual[baseMatch] || baseMatch
                mappedCount++
            }
        }
        if (mappedCount === 0) continue

        const dateCandidates = [
            'Date', 'Event Date', `${stageName} Date`, `${stageName}-Date`,
            'Training Date', 'Session Date',
        ]
        const baseDateMatch = findBestColumn(baseHeaders, dateCandidates)
        groups.push({
            eventDateColumn: baseDateMatch ? (baseToActual[baseDateMatch] || baseDateMatch) : '',
            orgUnitColumn: findBestColumn(groupHeaders, ['Org Unit', 'Organisation Unit', 'District', 'Facility']) || '',
            dataElementMapping: deMapping,
        })
    }

    return groups.length > 1 ? groups : null
}

/**
 * Strategy 2: Detect repeated columns from naming patterns.
 * Handles SheetJS auto-dedup suffixes (_1, _2) and explicit numbering.
 */
function detectFromSuffixPatterns(headers, des, stageName) {
    // Extract base name and repetition index from a header
    function parseHeader(header) {
        const h = header.trim()
        // SheetJS dedup: "Field_1", "Field_2" (underscore + digits at end)
        const sheetjsDedup = h.match(/^(.+?)_(\d+)$/)
        if (sheetjsDedup) return { base: sheetjsDedup[1].trim(), index: parseInt(sheetjsDedup[2], 10) }
        // "Field Name 1", "Field Name 2"
        const trailingNum = h.match(/^(.+?)\s+(\d+)\s*$/)
        if (trailingNum) return { base: trailingNum[1].trim(), index: parseInt(trailingNum[2], 10) }
        // "Field Name (1)", "Field Name (2)"
        const parenNum = h.match(/^(.+?)\s*\((\d+)\)\s*$/)
        if (parenNum) return { base: parenNum[1].trim(), index: parseInt(parenNum[2], 10) }
        // "Field Name (1)-Rest of name", "Field Name (2)-Rest of name"
        const midParen = h.match(/^(.+?)\s*\((\d+)\)\s*[-–]\s*(.+)$/)
        if (midParen) return { base: `${midParen[1].trim()}-${midParen[3].trim()}`, index: parseInt(midParen[2], 10) }
        // "1. Field Name", "2. Field Name"
        const leadingDot = h.match(/^(\d+)\.\s*(.+)$/)
        if (leadingDot) return { base: leadingDot[2].trim(), index: parseInt(leadingDot[1], 10) }
        // "Event 1 - Field", "Event 2 - Field"
        const prefixDash = h.match(/^(?:\w+\s+)?(\d+)\s*[-–]\s*(.+)$/)
        if (prefixDash) return { base: prefixDash[2].trim(), index: parseInt(prefixDash[1], 10) }
        return null
    }

    // Headers without a suffix are group 0 (the "original" column)
    const baseGroups = {} // base (lowercase) -> [{ header, index }]
    const unsuffixed = [] // headers with no number pattern

    for (const h of headers) {
        const parsed = parseHeader(h)
        if (parsed) {
            const key = parsed.base.toLowerCase()
            if (!baseGroups[key]) baseGroups[key] = []
            baseGroups[key].push({ header: h, index: parsed.index })
        } else {
            unsuffixed.push(h)
        }
    }

    // Check if any base names have suffixed versions — if so, the unsuffixed
    // original is group 0
    for (const h of unsuffixed) {
        const key = h.toLowerCase()
        if (baseGroups[key]) {
            baseGroups[key].push({ header: h, index: 0 })
        }
    }

    // Collect all indices that appear
    const allIndices = new Set()
    for (const [, entries] of Object.entries(baseGroups)) {
        if (entries.length < 2) continue
        for (const e of entries) allIndices.add(e.index)
    }

    if (allIndices.size < 2) return null

    const sortedIndices = [...allIndices].sort((a, b) => a - b)

    // Build a reverse map: for each index, collect { actualHeader, baseName } pairs
    // so we can match against the base name but store the actual header in the mapping
    const groups = []
    for (const idx of sortedIndices) {
        const indexEntries = [] // { header: actual, base: baseName }
        for (const [baseName, entries] of Object.entries(baseGroups)) {
            const entry = entries.find((e) => e.index === idx)
            if (entry) indexEntries.push({ header: entry.header, base: entry.header.replace(/_\d+$/, '') })
        }
        if (indexEntries.length === 0) continue

        // Match DEs against the base names, then map to actual header names
        const baseHeaders = indexEntries.map((e) => e.base)
        const baseToActual = Object.fromEntries(indexEntries.map((e) => [e.base, e.header]))

        const deMapping = {}
        let mappedCount = 0
        for (const psde of des) {
            const de = psde.dataElement ?? psde
            const baseMatch = matchColumn(baseHeaders, de.id, de.displayName)
            if (baseMatch) {
                deMapping[de.id] = baseToActual[baseMatch] || baseMatch
                mappedCount++
            }
        }
        // Require at least 40% of DEs to match — prevents false positives when
        // suffix groups from OTHER stages on the same sheet get matched via fuzzy
        const minMatches = Math.ceil(des.length * 0.4)
        if (mappedCount < minMatches) continue

        // Match date column against base names too
        const dateCandidates = [
            `${stageName}-Date`, `${stageName} Date`, 'Date', 'Event Date',
            'Training Date', 'Session Date',
        ]
        const baseDateMatch = findBestColumn(baseHeaders, dateCandidates)
        const eventDateColumn = baseDateMatch ? (baseToActual[baseDateMatch] || baseDateMatch) : ''

        groups.push({
            eventDateColumn,
            orgUnitColumn: '',
            dataElementMapping: deMapping,
        })
    }

    return groups.length > 1 ? groups : null
}

/**
 * Find the best matching sheet name from a list of candidates.
 * Tries exact → prefix → contains → pipe-stripped contains.
 */
function findBestSheet(sheetNames, candidates) {
    for (const c of candidates) {
        const lower = c.toLowerCase()
        const match = sheetNames.find((s) => s.toLowerCase() === lower)
        if (match) return match
    }
    // Partial prefix match
    for (const c of candidates) {
        const lower = c.toLowerCase()
        const match = sheetNames.find((s) => s.toLowerCase().startsWith(lower))
        if (match) return match
    }
    // Contains match
    for (const c of candidates) {
        if (c.length < 3) continue
        const lower = c.toLowerCase()
        const match = sheetNames.find((s) => s.toLowerCase().includes(lower))
        if (match) return match
    }
    return null
}

/**
 * Find the best matching column from a list of candidate names (case-insensitive).
 * Tries exact → contains → pipe-stripped.
 */
function findBestColumn(headers, candidates) {
    for (const c of candidates) {
        const lower = c.toLowerCase()
        const match = headers.find((h) => h.toLowerCase() === lower)
        if (match) return match
    }
    // Partial (contains) match — skip very short candidates to avoid false positives
    // (e.g. "ID" matching "IncIDent Date", "#" matching anything with "#")
    for (const c of candidates) {
        const lower = c.toLowerCase()
        if (lower.length < 3) continue
        const match = headers.find((h) => h.toLowerCase().includes(lower))
        if (match) return match
    }
    // Try matching after stripping pipe prefixes on both sides
    for (const c of candidates) {
        const lower = stripPipePrefix(c.toLowerCase())
        if (lower.length < 3) continue
        const match = headers.find((h) => stripPipePrefix(h.toLowerCase()) === lower)
        if (match) return match
    }
    return null
}

/**
 * Try to match a column header to a DHIS2 UID or display name.
 * Uses a tiered approach: exact UID > exact name > prefix-stripped > fuzzy.
 */
function matchColumn(headers, uid, displayName) {
    // 1. Exact UID in column header [UID]
    const uidMatch = headers.find((h) => h.includes(`[${uid}]`))
    if (uidMatch) return uidMatch

    // 2. Column header equals UID
    const uidExact = headers.find((h) => h === uid)
    if (uidExact) return uidExact

    // 3. Exact display name match (case-insensitive)
    const lower = displayName.toLowerCase()
    const nameExact = headers.find((h) => h.toLowerCase() === lower)
    if (nameExact) return nameExact

    // 4. Display name stripped of asterisk / date hints / whitespace noise
    const cleanLower = normalize(lower)
    const nameClean = headers.find((h) => normalize(h.toLowerCase()) === cleanLower)
    if (nameClean) return nameClean

    // 5. Match after stripping pipe prefixes (e.g. "Program | First Name" → "First Name")
    const strippedField = stripPipePrefix(cleanLower)
    for (const h of headers) {
        const strippedHeader = stripPipePrefix(normalize(h.toLowerCase()))
        if (strippedField === strippedHeader) return h
    }

    // 6. Fuzzy token-based match — score each header and pick the best above threshold
    if (displayName.length >= 3) {
        const best = fuzzyBestMatch(headers, displayName)
        if (best) return best
    }

    return null
}

/**
 * Strip pipe-delimited prefix common in DHIS2 naming: "Program | Field Name" → "Field Name"
 */
function stripPipePrefix(s) {
    const pipeIdx = s.lastIndexOf('|')
    return pipeIdx >= 0 ? s.slice(pipeIdx + 1).trim() : s
}

/**
 * Strip pipe prefix and return variant names for sheet/column searching.
 */
function stripPrefix(displayName) {
    const stripped = stripPipePrefix(displayName.toLowerCase())
    return stripped !== displayName.toLowerCase() ? [stripped] : []
}

/**
 * Normalize a string for comparison: strip asterisks, date format hints,
 * trim whitespace, collapse multiple spaces, remove common prefixes.
 */
function normalize(s) {
    return s
        .replace(/\s*\*\s*/g, '')           // mandatory markers
        .replace(/\(yyyy-mm-dd\)/gi, '')     // date format hints
        .replace(/\s*-date\s*$/i, '')        // trailing "-Date"
        .replace(/^imp_/i, '')               // IMP_ prefix from import templates
        .replace(/\s+/g, ' ')               // collapse whitespace
        .trim()
}

/**
 * Tokenize a string into meaningful words for fuzzy matching.
 * Also strips pipe-delimited prefixes before tokenizing.
 */
function tokenize(s) {
    const cleaned = normalize(s.toLowerCase())
    // Strip pipe prefix for tokenization so "Program | Area Name" becomes "area name"
    const core = stripPipePrefix(cleaned)
    return core
        .split(/[\s\-_/,()]+/)
        .filter((t) => t.length >= 2)
}

/**
 * Compute a fuzzy similarity score (0-1) between a DHIS2 field name and a header.
 * Based on shared token overlap.
 */
function fuzzyScore(fieldName, headerName) {
    const fieldTokens = tokenize(fieldName)
    const headerTokens = tokenize(headerName)

    if (fieldTokens.length === 0 || headerTokens.length === 0) return 0

    // Count matching tokens (a token matches if one contains the other)
    let matches = 0
    const usedHeader = new Set()
    for (const ft of fieldTokens) {
        for (let hi = 0; hi < headerTokens.length; hi++) {
            if (usedHeader.has(hi)) continue
            const ht = headerTokens[hi]
            if (ft === ht || ft.includes(ht) || ht.includes(ft)) {
                matches++
                usedHeader.add(hi)
                break
            }
        }
    }

    // Score = matched tokens / max(field tokens, header tokens)
    const score = matches / Math.max(fieldTokens.length, headerTokens.length)
    return score
}

/**
 * Find the best fuzzy match for a DHIS2 field name among headers.
 * Returns the header name if score >= threshold, or null.
 */
function fuzzyBestMatch(headers, displayName) {
    let bestHeader = null
    let bestScore = 0.35 // lower threshold to catch more real-world matches

    for (const h of headers) {
        const score = fuzzyScore(displayName, h)
        if (score > bestScore) {
            bestScore = score
            bestHeader = h
        }
    }

    return bestHeader
}

/**
 * Score and rank all headers against a DHIS2 field name.
 * Exported for use by the auto-map button in the UI.
 */
export function rankColumns(headers, displayName) {
    return headers
        .map((h) => ({ header: h, score: fuzzyScore(displayName, h) }))
        .filter((r) => r.score > 0.2)
        .sort((a, b) => b.score - a.score)
}

/**
 * Resolve column headers to DHIS2 UIDs.
 * First tries extracting UIDs from "[UID]" pattern in headers.
 * Falls back to matching display names from metadata lookup.
 */
function resolveColumns(headers, lookup) {
    const map = {}
    const uidPattern = /\[([A-Za-z0-9]{11})\]\s*$/

    for (const h of headers) {
        // Try UID extraction first (app-generated templates)
        const match = h.match(uidPattern)
        if (match) {
            map[h] = match[1]
            continue
        }

        // Fall back to display name matching (strip mandatory marker)
        const cleanName = h.replace(/\s*\*\s*$/, '').trim()
        const resolvedId = lookup[h] || lookup[cleanName]
        if (resolvedId) {
            map[h] = resolvedId
        }
    }
    return map
}

/**
 * Build a map of attribute displayName -> attribute UID from metadata.
 */
function buildAttributeLookup(metadata) {
    const lookup = {}
    const attrs = metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []
    for (const a of attrs) {
        const tea = a.trackedEntityAttribute ?? a
        if (tea.displayName && tea.id) {
            lookup[tea.displayName] = tea.id
        }
    }
    return lookup
}

/**
 * Build a map of data element displayName -> UID for a single program stage.
 */
function buildStageDeLookup(stage) {
    const lookup = {}
    for (const psde of stage.programStageDataElements ?? []) {
        const de = psde.dataElement ?? psde
        if (de.displayName && de.id) {
            lookup[de.displayName] = de.id
        }
    }
    return lookup
}

/**
 * Build org unit name -> UID map (case-insensitive).
 */
function buildOrgUnitMap(orgUnits) {
    const map = {}
    for (const ou of orgUnits) {
        map[ou.displayName.toLowerCase()] = ou.id
    }
    return map
}

/**
 * Resolve org unit: if it looks like a UID (11 alphanumeric chars), use as-is.
 * Otherwise try case-insensitive name lookup.
 */
function resolveOrgUnit(value, orgUnitMap) {
    if (!value) return ''
    if (/^[A-Za-z0-9]{11}$/.test(value)) return value
    return orgUnitMap[value.toLowerCase()] ?? value
}

function findStageSheet(sheetNames, stageName) {
    // Exact match
    const exact = sheetNames.find((s) => s.startsWith(stageName))
    if (exact) return exact

    // Truncated match (Excel 31 char limit)
    const truncated = stageName.slice(0, 25)
    return sheetNames.find((s) => s.startsWith(truncated))
}

function formatDate(val) {
    return parseDate(val)
}

function formatValue(val) {
    if (val instanceof Date) {
        return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0]
    }
    return cleanInvisibleChars(String(val).trim())
}

/**
 * Build a value-type index from metadata for boolean/date normalization.
 * Returns { attrs: { attrId: valueType }, des: { deId: valueType } }
 */
function buildValueTypeIndex(metadata) {
    const attrs = {}
    const des = {}
    const allAttrs = metadata.trackedEntityType?.trackedEntityTypeAttributes
        ?? metadata.programTrackedEntityAttributes ?? []
    for (const a of allAttrs) {
        const tea = a.trackedEntityAttribute ?? a
        if (tea.valueType) attrs[tea.id] = tea.valueType
    }
    // Also index data set elements for data entry
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        if (de?.valueType) des[de.id] = de.valueType
    }
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            if (de.valueType) des[de.id] = de.valueType
        }
    }
    return { attrs, des }
}

/**
 * Normalize a value based on its DHIS2 value type.
 * Handles BOOLEAN, TRUE_ONLY, DATE, and AGE types.
 */
function normalizeByType(value, valueType) {
    if (!value || !valueType) return value
    if (valueType === 'BOOLEAN' || valueType === 'TRUE_ONLY') {
        return normalizeBoolean(value, valueType)
    }
    if (valueType === 'DATE' || valueType === 'AGE') {
        return parseDate(value)
    }
    return value
}

/**
 * Build option-set lookup maps from metadata.
 * Returns { attrs: { attrId: { lowerDisplay: code } }, des: { deId: { lowerDisplay: code } } }
 * Allows resolving display names (e.g. "Female") to option codes (e.g. "FEMALE").
 */
function buildOptionMaps(metadata) {
    const attrs = {}
    const des = {}

    for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
        const tea = a.trackedEntityAttribute ?? a
        const os = tea.optionSet
        if (os?.options?.length) {
            const m = {}
            for (const opt of os.options) {
                // Keys are trimmed+lowercase for matching; values are trimmed codes
                // so DHIS2 receives a clean code and the validator agrees.
                const code = (opt.code ?? '').trim()
                if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code
                if (code) m[code.toLowerCase()] = code
            }
            attrs[tea.id] = m
        }
    }

    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            const os = de.optionSet
            if (os?.options?.length) {
                const m = {}
                for (const opt of os.options) {
                    const code = (opt.code ?? '').trim()
                    if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code
                    if (code) m[code.toLowerCase()] = code
                }
                des[de.id] = m
            }
        }
    }

    return { attrs, des }
}

/**
 * Resolve a value through the option map. If an exact code match exists, keep it.
 * Otherwise try case-insensitive displayName → code lookup.
 */
function resolveOption(value, optMap) {
    if (!value || !optMap) return value
    const lower = value.toLowerCase()
    return optMap[lower] ?? value
}

/**
 * Detect whether an uploaded file uses our data entry template format.
 * Data entry templates have a "Data Entry" sheet with ORG_UNIT_ID, PERIOD, and [deId] or [deId.cocId] columns.
 */
export function isDataEntryTemplate(sheetsInfo) {
    const sheet = sheetsInfo['Data Entry']
    if (!sheet) return false

    const uidPattern = /\[([A-Za-z0-9]{11}(?:\.[A-Za-z0-9]{11})?)\]\s*$/
    const hasUidCols = sheet.headers.some((h) => uidPattern.test(h))
    const hasSystemCols = sheet.headers.some((h) =>
        ['ORG_UNIT_ID', 'ORG_UNIT_ID *', 'PERIOD', 'PERIOD *'].includes(h)
    )
    return hasUidCols && hasSystemCols
}

/**
 * Parse a data entry template workbook into structured data.
 *
 * Returns { dataValues: [{ orgUnit, period, dataElement, categoryOptionCombo, value }] }
 *
 * Column header format: "DE Name [deId]" or "DE Name - COC Name [deId.cocId]"
 */
export function parseDataEntryTemplate(workbook, metadata) {
    const ws = workbook.Sheets['Data Entry']
    if (!ws) throw new Error('Missing "Data Entry" sheet in workbook.')

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })?.[0] ?? []

    // Parse column headers to extract deId and optional cocId
    const uidPattern = /\[([A-Za-z0-9]{11})(?:\.([A-Za-z0-9]{11}))?\]\s*$/
    const columnDefs = []
    for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i])
        const match = h.match(uidPattern)
        if (match) {
            columnDefs.push({ colHeader: h, deId: match[1], cocId: match[2] || null })
        }
    }

    // Build org unit name→id lookup from metadata (detect collisions)
    const ouNameToId = {}
    const ouNameCollisions = new Set()
    for (const ou of metadata.organisationUnits ?? []) {
        const key = ou.displayName.trim().toLowerCase()
        if (ouNameToId[key] && ouNameToId[key] !== ou.id) {
            ouNameCollisions.add(key)
        }
        ouNameToId[key] = ou.id
    }

    // Build option set maps for data elements
    const deOptionMaps = {}
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        if (de?.optionSet?.options) {
            const m = {}
            for (const opt of de.optionSet.options) {
                const code = (opt.code ?? '').trim()
                if (opt.displayName) m[opt.displayName.trim().toLowerCase()] = code || opt.displayName
                if (code) m[code.toLowerCase()] = code
            }
            deOptionMaps[de.id] = m
        }
    }

    // Find the default COC for data elements without explicit COC in header
    const deDefaultCoc = {}
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        const cocs = de?.categoryCombo?.categoryOptionCombos ?? []
        if (cocs.length === 1) {
            deDefaultCoc[de.id] = cocs[0].id
        }
    }

    const dataValues = []

    for (const row of rows) {
        const orgUnitRaw = String(row['ORG_UNIT_ID *'] ?? row['ORG_UNIT_ID'] ?? '').trim()
        const period = String(row['PERIOD *'] ?? row['PERIOD'] ?? '').trim()

        if (!orgUnitRaw && !period) continue

        // Resolve org unit: UID (11 chars) or name lookup
        let orgUnit
        if (/^[A-Za-z0-9]{11}$/.test(orgUnitRaw)) {
            orgUnit = orgUnitRaw
        } else {
            const key = orgUnitRaw.toLowerCase()
            if (ouNameCollisions.has(key)) {
                // Ambiguous name — pass through raw value so validator catches it
                orgUnit = orgUnitRaw
            } else {
                orgUnit = ouNameToId[key] ?? orgUnitRaw
            }
        }

        for (const col of columnDefs) {
            const value = String(row[col.colHeader] ?? '').trim()
            if (!value) continue

            // Resolve option set values
            const resolvedValue = deOptionMaps[col.deId]
                ? (deOptionMaps[col.deId][value.toLowerCase()] ?? value)
                : value

            const cocId = col.cocId ?? deDefaultCoc[col.deId] ?? null

            dataValues.push({
                orgUnit,
                period,
                dataElement: col.deId,
                categoryOptionCombo: cocId,
                value: resolvedValue,
            })
        }
    }

    return { dataValues }
}

/**
 * Parse a native DHIS2 JSON payload uploaded directly by the user (bypasses template / mapping).
 *
 * Returns `{ payload, summary }` where:
 *  - `payload` is the validated, ready-to-submit DHIS2 payload:
 *      * tracker: `{ trackedEntities: [...] }`
 *      * event:   `{ events: [...] }`
 *      * dataEntry: `{ dataSet, dataValues: [...] }`  (also accepts a raw `dataValueSets` envelope)
 *      * metadata: `{ <type>: [...], ... }` returned as-is
 *  - `summary` is a small `{ label: count }` object used for the preview screen.
 *
 * Throws a human-readable Error if the file isn't parseable or shape is wrong.
 *
 * @param {string} text - file contents (utf-8)
 * @param {'tracker'|'event'|'dataEntry'|'metadata'} importType
 * @returns {{payload: object, summary: object}}
 */
export function parseNativeJsonPayload(text, importType) {
    let parsed
    try {
        parsed = JSON.parse(text)
    } catch (e) {
        throw new Error(`Not valid JSON: ${e.message}`)
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('JSON root must be an object.')
    }

    if (importType === 'tracker') {
        const tes = parsed.trackedEntities
        if (!Array.isArray(tes) || tes.length === 0) {
            throw new Error(
                'Tracker JSON must contain a non-empty "trackedEntities" array at the root. ' +
                'Example: { "trackedEntities": [ { "trackedEntityType": "...", "orgUnit": "...", "attributes": [...], "enrollments": [...] } ] }'
            )
        }
        let enrCount = 0
        let eventCount = 0
        for (const te of tes) {
            if (!te || typeof te !== 'object') {
                throw new Error('Each tracked entity must be an object.')
            }
            for (const enr of te.enrollments ?? []) {
                enrCount++
                eventCount += (enr.events ?? []).length
            }
        }
        return {
            payload: { trackedEntities: tes },
            summary: {
                'Tracked entities': tes.length,
                Enrollments: enrCount,
                Events: eventCount,
            },
        }
    }

    if (importType === 'event') {
        const events = parsed.events
        if (!Array.isArray(events) || events.length === 0) {
            throw new Error(
                'Event JSON must contain a non-empty "events" array at the root. ' +
                'Example: { "events": [ { "program": "...", "programStage": "...", "orgUnit": "...", "occurredAt": "YYYY-MM-DD", "dataValues": [...] } ] }'
            )
        }
        return {
            payload: { events },
            summary: { Events: events.length },
        }
    }

    if (importType === 'dataEntry') {
        // Accept either { dataValues: [...] } or the standard dataValueSets envelope { dataSet, dataValues: [...] }
        const dvs = parsed.dataValues
        if (!Array.isArray(dvs) || dvs.length === 0) {
            throw new Error(
                'Aggregate JSON must contain a non-empty "dataValues" array. ' +
                'Example: { "dataSet": "UID", "dataValues": [ { "dataElement": "...", "period": "...", "orgUnit": "...", "value": "..." } ] }'
            )
        }
        const orgUnits = new Set(dvs.map((d) => d.orgUnit).filter(Boolean))
        const periods = new Set(dvs.map((d) => d.period).filter(Boolean))
        return {
            payload: parsed.dataSet ? { dataSet: parsed.dataSet, dataValues: dvs } : { dataValues: dvs },
            summary: {
                'Data values': dvs.length,
                'Org units': orgUnits.size,
                Periods: periods.size,
            },
        }
    }

    if (importType === 'metadata') {
        // Any key whose value is a non-empty array counts as a metadata type bucket
        const summary = {}
        let total = 0
        for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v) && v.length > 0) {
                summary[k] = v.length
                total += v.length
            }
        }
        if (total === 0) {
            throw new Error(
                'Metadata JSON must contain at least one non-empty array of metadata objects ' +
                '(e.g. "dataElements", "optionSets", "organisationUnits").'
            )
        }
        return { payload: parsed, summary }
    }

    throw new Error(`Unsupported import type: ${importType}`)
}
