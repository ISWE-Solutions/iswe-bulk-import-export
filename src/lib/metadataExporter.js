import * as XLSX from 'xlsx'
import { unzipSync, zipSync } from 'fflate'
import {
    setColumnWidths, injectHeaderStyles, injectFreezePanes, colLetter,
} from '../utils/xlsxFormatting'
import { injectDataValidations } from './templateGenerator'

/**
 * Enum value sets for DHIS2 metadata columns with constrained values.
 * Used to inject Excel data-validation dropdowns on export/template sheets.
 */
const ENUMS = {
    valueType: [
        'TEXT', 'LONG_TEXT', 'LETTER', 'PHONE_NUMBER', 'EMAIL',
        'BOOLEAN', 'TRUE_ONLY',
        'DATE', 'DATETIME', 'TIME',
        'NUMBER', 'UNIT_INTERVAL', 'PERCENTAGE',
        'INTEGER', 'INTEGER_POSITIVE', 'INTEGER_NEGATIVE', 'INTEGER_ZERO_OR_POSITIVE',
        'COORDINATE', 'ORGANISATION_UNIT', 'REFERENCE', 'AGE',
        'URL', 'FILE_RESOURCE', 'IMAGE',
        'USERNAME', 'TRACKER_ASSOCIATE',
        'GEOJSON', 'MULTI_TEXT',
    ],
    domainType: ['AGGREGATE', 'TRACKER'],
    aggregationType: [
        'SUM', 'AVERAGE', 'AVERAGE_SUM_ORG_UNIT',
        'LAST', 'LAST_AVERAGE_ORG_UNIT',
        'FIRST', 'FIRST_AVERAGE_ORG_UNIT',
        'COUNT', 'STDDEV', 'VARIANCE',
        'MIN', 'MAX', 'NONE', 'CUSTOM', 'DEFAULT',
    ],
    featureType: ['NONE', 'POINT', 'POLYGON', 'MULTI_POLYGON'],
    boolean: ['true', 'false'],
}

/** Column key -> enum key. Determines which columns get dropdown validation. */
const COLUMN_ENUM_MAP = {
    valueType: 'valueType',
    domainType: 'domainType',
    aggregationType: 'aggregationType',
    featureType: 'featureType',
    zeroIsSignificant: 'boolean',
    compulsory: 'boolean',
    dataDimension: 'boolean',
    number: 'boolean',
    annualized: 'boolean',
}

/**
 * Scan a column definition array and return enum-column descriptors
 * for the given 1-based worksheet index.
 */
function collectEnumCols(columns, sheetIdx) {
    const out = []
    columns.forEach((c, i) => {
        const enumKey = COLUMN_ENUM_MAP[c.key]
        if (enumKey) out.push({ sheetIdx, colIdx: i, enumKey })
    })
    return out
}

/**
 * Normalize a cell value for a column whose key maps to an enum.
 * Booleans are rendered as lowercase strings so DHIS2 and Excel dropdown entries agree.
 */
function formatEnumCell(value, columnKey) {
    const enumKey = COLUMN_ENUM_MAP[columnKey]
    if (!enumKey) return value
    if (enumKey === 'boolean') {
        if (value === true || value === 'true' || value === 'TRUE') return 'true'
        if (value === false || value === 'false' || value === 'FALSE') return 'false'
    }
    return value
}

/**
 * Build an Excel workbook for metadata export or template.
 *
 * @param {Object} metadataType - Type definition from METADATA_TYPES
 * @param {Array} [data] - Metadata records (omit for empty template)
 * @returns {{ wb: Object, filename: string, sheetColors: Object }}
 */
export function buildMetadataWorkbook(metadataType, data) {
    const wb = XLSX.utils.book_new()
    const sheetColors = {}
    const TYPE_COLOR = metadataType.color ? metadataType.color.replace('#', '') : '6A1B9A'

    if (metadataType.key === 'optionSets') {
        return buildOptionSetWorkbook(metadataType, data)
    }

    if (metadataType.key === 'organisationUnits') {
        return buildOrgUnitWorkbook(metadataType, data)
    }

    if (metadataType.memberConfig) {
        return buildGroupWorkbook(metadataType, data)
    }

    // Generic metadata type (dataElements, indicators, indicatorTypes, categoryOptions, etc.)
    const columns = metadataType.columns
    const headers = columns.map((c) => c.label)
    const rows = (data ?? []).map((item) =>
        columns.map((c) => formatEnumCell(getNestedValue(item, c.key), c.key))
    )

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    setColumnWidths(ws, headers)
    XLSX.utils.book_append_sheet(wb, ws, metadataType.label.slice(0, 31))

    sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: TYPE_COLOR }]
    wb._enumCols = collectEnumCols(columns, 1)

    const suffix = data ? 'Export' : 'Template'
    const filename = `${metadataType.label.replace(/\s/g, '')}_${suffix}_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Org units get special handling — include a reference sheet with existing org units
 * for parent lookup, plus a hierarchy path column.
 */
function buildOrgUnitWorkbook(metadataType, data) {
    const wb = XLSX.utils.book_new()
    const sheetColors = {}
    const OU_COLOR = '0277BD'

    // Sort by hierarchy level so tree reads top-down
    const sorted = data ? [...data].sort((a, b) => (a.level || 999) - (b.level || 999)) : null

    // Build id→ou lookup for hierarchy path computation
    const idToOu = {}
    for (const ou of (sorted || [])) { if (ou.id) idToOu[ou.id] = ou }

    const columns = metadataType.columns
    const headers = columns.map((c) => c.label)
    const rows = (sorted ?? []).map((item) => {
        return columns.map((c) => {
            if (c.key === 'geometry') return formatGeometry(item.geometry)
            if (c.key === 'hierarchyPath') return buildHierarchyPath(item, idToOu)
            return formatEnumCell(getNestedValue(item, c.key), c.key)
        })
    })

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    setColumnWidths(ws, headers)
    XLSX.utils.book_append_sheet(wb, ws, 'Organisation Units')

    sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: OU_COLOR }]
    wb._enumCols = collectEnumCols(columns, 1)

    // Build reference sheet with id + name + level for parent lookup
    if (sorted && sorted.length > 0) {
        const refHeaders = ['ID', 'Name', 'Level', 'Parent ID']
        const refRows = sorted.map((ou) => [
            ou.id ?? '',
            ou.name ?? '',
            ou.level ?? '',
            ou.parent?.id ?? '',
        ])
        const wsRef = XLSX.utils.aoa_to_sheet([refHeaders, ...refRows])
        setColumnWidths(wsRef, refHeaders)
        XLSX.utils.book_append_sheet(wb, wsRef, 'OrgUnit Reference')
        sheetColors[2] = [{ startCol: 0, endCol: refHeaders.length - 1, color: '546E7A' }]
    }

    const suffix = data ? 'Export' : 'Template'
    const filename = `OrganisationUnits_${suffix}_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Build full hierarchy path string from root to the given org unit.
 */
function buildHierarchyPath(ou, idToOu) {
    const parts = []
    let current = ou
    const seen = new Set()
    while (current) {
        parts.unshift(current.name || '')
        if (!current.parent?.id || seen.has(current.parent.id)) break
        seen.add(current.parent.id)
        const parent = idToOu[current.parent.id]
        if (!parent) {
            if (current.parent?.name) parts.unshift(current.parent.name)
            break
        }
        current = parent
    }
    return parts.join(' / ')
}

/**
 * Generic group/membership workbook — Sheet 1: groups, Sheet 2: members.
 * Works for org unit groups, data element groups, indicator groups,
 * categories, category combos, and their respective group sets.
 */
function buildGroupWorkbook(metadataType, data) {
    const wb = XLSX.utils.book_new()
    const sheetColors = {}
    const COLOR = metadataType.color ? metadataType.color.replace('#', '') : '546E7A'
    const mc = metadataType.memberConfig

    // Sheet 1: Main items (groups/sets)
    const columns = metadataType.columns
    const headers = columns.map((c) => c.label)
    const rows = (data ?? []).map((item) =>
        columns.map((c) => formatEnumCell(getNestedValue(item, c.key), c.key))
    )

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    setColumnWidths(ws, headers)
    XLSX.utils.book_append_sheet(wb, ws, metadataType.label.slice(0, 31))
    sheetColors[1] = [{ startCol: 0, endCol: headers.length - 1, color: COLOR }]

    // Sheet 2: Membership (flattened)
    const memHeaders = mc.columns.map((c) => c.label)
    const memRows = []
    for (const item of (data ?? [])) {
        const members = item[mc.property] ?? []
        for (const member of members) {
            memRows.push(mc.columns.map((c) => {
                if (c.key === 'group.id') return item.id ?? ''
                if (c.key === 'group.name') return item.name ?? ''
                return formatEnumCell(getNestedValue(member, c.key), c.key)
            }))
        }
    }

    const wsM = XLSX.utils.aoa_to_sheet([memHeaders, ...memRows])
    setColumnWidths(wsM, memHeaders)
    XLSX.utils.book_append_sheet(wb, wsM, mc.sheetName.slice(0, 31))
    sheetColors[2] = [{ startCol: 0, endCol: memHeaders.length - 1, color: darkenHex(COLOR) }]
    wb._enumCols = [
        ...collectEnumCols(columns, 1),
        ...collectEnumCols(mc.columns, 2),
    ]

    const suffix = data ? 'Export' : 'Template'
    const filename = `${metadataType.label.replace(/\s/g, '')}_${suffix}_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Simple hex color darkener for member sheet headers.
 */
function darkenHex(hex) {
    const r = Math.max(0, parseInt(hex.slice(0, 2), 16) - 40)
    const g = Math.max(0, parseInt(hex.slice(2, 4), 16) - 40)
    const b = Math.max(0, parseInt(hex.slice(4, 6), 16) - 40)
    return r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0')
}

/**
 * Option sets get two sheets: one for option sets, one for options.
 */
function buildOptionSetWorkbook(metadataType, data) {
    const wb = XLSX.utils.book_new()
    const sheetColors = {}
    const OS_COLOR = 'E65100'

    // Sheet 1: Option Sets
    const osColumns = metadataType.columns
    const osHeaders = osColumns.map((c) => c.label)
    const osRows = (data ?? []).map((item) =>
        osColumns.map((c) => formatEnumCell(getNestedValue(item, c.key), c.key))
    )

    const wsOS = XLSX.utils.aoa_to_sheet([osHeaders, ...osRows])
    setColumnWidths(wsOS, osHeaders)
    XLSX.utils.book_append_sheet(wb, wsOS, 'Option Sets')
    sheetColors[1] = [{ startCol: 0, endCol: osHeaders.length - 1, color: OS_COLOR }]

    // Sheet 2: Options (flattened from all option sets)
    const optColumns = metadataType.optionColumns
    const optHeaders = optColumns.map((c) => c.label)
    const optRows = []
    for (const os of (data ?? [])) {
        for (const opt of (os.options ?? [])) {
            optRows.push(optColumns.map((c) => {
                if (c.key === 'optionSet.id') return os.id ?? ''
                if (c.key === 'optionSet.name') return os.name ?? ''
                return formatEnumCell(getNestedValue(opt, c.key), c.key)
            }))
        }
    }

    const wsOpt = XLSX.utils.aoa_to_sheet([optHeaders, ...optRows])
    setColumnWidths(wsOpt, optHeaders)
    XLSX.utils.book_append_sheet(wb, wsOpt, 'Options')
    sheetColors[2] = [{ startCol: 0, endCol: optHeaders.length - 1, color: 'BF360C' }]
    wb._enumCols = [
        ...collectEnumCols(osColumns, 1),
        ...collectEnumCols(optColumns, 2),
    ]

    const suffix = data ? 'Export' : 'Template'
    const filename = `OptionSets_${suffix}_${today()}.xlsx`
    return { wb, filename, sheetColors }
}

/**
 * Parse an uploaded metadata Excel file back into a DHIS2 metadata payload.
 *
 * @param {ArrayBuffer} buffer - File contents
 * @param {Object} metadataType - Type definition from METADATA_TYPES
 * @returns {{ payload: Object, summary: { total: number, withId: number, new: number } }}
 */
export function parseMetadataFile(input, metadataType) {
    const wb = input.SheetNames ? input : XLSX.read(input, { type: 'array' })

    if (metadataType.key === 'optionSets') {
        return parseOptionSetFile(wb, metadataType)
    }

    if (metadataType.key === 'organisationUnits') {
        return parseOrgUnitFile(wb, metadataType)
    }

    if (metadataType.memberConfig) {
        return parseGroupFile(wb, metadataType)
    }

    // Generic
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) return { payload: { [metadataType.resource]: [] }, summary: { total: 0, withId: 0, new: 0 } }

    const headers = rows[0]
    const columns = metadataType.columns.filter((c) => !c.readOnly)
    const colMap = mapHeadersToColumns(headers, columns)

    const items = []
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.every((c) => c === '' || c == null)) continue
        const item = {}
        for (const [colIdx, col] of Object.entries(colMap)) {
            const val = row[colIdx]
            if (val == null || val === '') continue
            setNestedValue(item, col.key, String(val))
        }
        items.push(item)
    }

    const withId = items.filter((i) => i.id).length
    return {
        payload: { [metadataType.resource]: items },
        summary: { total: items.length, withId, new: items.length - withId },
    }
}

/**
 * Build a combined workbook with all metadata types, each on its own sheet(s).
 *
 * @param {Array} metadataTypes - Array of type definitions (with resource !== null)
 * @param {Object} dataByType - { organisationUnits: [...], dataElements: [...], ... }
 * @returns {{ wb: Object, filename: string, sheetColors: Object }}
 */
export function buildAllMetadataWorkbook(metadataTypes, dataByType) {
    const wb = XLSX.utils.book_new()
    const sheetColors = {}
    const mergedEnumCols = []
    let sheetNum = 1

    // Build each type's workbook and merge sheets into the combined workbook
    for (const mt of metadataTypes) {
        if (!mt.resource) continue
        const data = dataByType[mt.key]
        const result = buildMetadataWorkbook(mt, data && data.length > 0 ? data : null)

        // Map old (sub-workbook) sheet idx -> new combined sheet idx for enum remap
        const sheetIdxMap = {}
        for (const name of result.wb.SheetNames) {
            // Ensure unique sheet names (Excel 31-char limit + no duplicates)
            let safeName = name.slice(0, 31)
            if (wb.SheetNames.includes(safeName)) {
                safeName = (mt.key.slice(0, 5) + '_' + name).slice(0, 31)
            }
            XLSX.utils.book_append_sheet(wb, result.wb.Sheets[name], safeName)
            const oldIdx = result.wb.SheetNames.indexOf(name) + 1
            if (result.sheetColors[oldIdx]) {
                sheetColors[sheetNum] = result.sheetColors[oldIdx]
            }
            sheetIdxMap[oldIdx] = sheetNum
            sheetNum++
        }
        for (const ec of (result.wb._enumCols ?? [])) {
            if (sheetIdxMap[ec.sheetIdx]) {
                mergedEnumCols.push({ ...ec, sheetIdx: sheetIdxMap[ec.sheetIdx] })
            }
        }
    }
    if (mergedEnumCols.length > 0) wb._enumCols = mergedEnumCols

    const hasData = Object.values(dataByType).some((d) => d && d.length > 0)
    const suffix = hasData ? 'Export' : 'Template'
    return { wb, filename: `AllMetadata_${suffix}_${today()}.xlsx`, sheetColors }
}

/**
 * Parse a combined metadata Excel file — auto-detects sheet types by name
 * and header content, then delegates to the appropriate parser.
 *
 * @param {ArrayBuffer} buffer - File contents
 * @param {Array} metadataTypes - Array of type definitions (with resource !== null)
 * @returns {Object} - { organisationUnits: { payload, summary }, dataElements: { ... }, ... }
 */
export function parseAllMetadataFile(buffer, metadataTypes) {
    const wb = XLSX.read(buffer, { type: 'array' })
    const results = {}

    // Build a sheet-name → metadataType key mapping using label and memberConfig.sheetName
    const sheetGroups = {}
    const claimed = new Set()

    // First pass: exact label match (sheet name matches metadataType.label or memberConfig.sheetName)
    for (const name of wb.SheetNames) {
        const lower = name.toLowerCase().trim()
        for (const mt of metadataTypes) {
            if (!mt.resource) continue
            if (lower === mt.label.toLowerCase()) {
                if (!sheetGroups[mt.key]) sheetGroups[mt.key] = []
                sheetGroups[mt.key].push(name)
                claimed.add(name)
                break
            }
            if (mt.memberConfig && lower === mt.memberConfig.sheetName.toLowerCase()) {
                if (!sheetGroups[mt.key]) sheetGroups[mt.key] = []
                sheetGroups[mt.key].push(name)
                claimed.add(name)
                break
            }
            // optionSets special: "Options" sheet for the option details
            if (mt.key === 'optionSets' && lower === 'options') {
                if (!sheetGroups[mt.key]) sheetGroups[mt.key] = []
                sheetGroups[mt.key].push(name)
                claimed.add(name)
                break
            }
            // orgUnits special: reference sheet
            if (mt.key === 'organisationUnits' && lower.includes('reference') && lower.includes('org')) {
                if (!sheetGroups[mt.key]) sheetGroups[mt.key] = []
                sheetGroups[mt.key].push(name)
                claimed.add(name)
                break
            }
        }
    }

    // Second pass: fuzzy matching for unclaimed sheets (substring match on label)
    for (const name of wb.SheetNames) {
        if (claimed.has(name)) continue
        const lower = name.toLowerCase().trim()

        for (const mt of metadataTypes) {
            if (!mt.resource) continue
            const labelLower = mt.label.toLowerCase()
            if (lower.includes(labelLower) || labelLower.includes(lower)) {
                if (!sheetGroups[mt.key]) sheetGroups[mt.key] = []
                sheetGroups[mt.key].push(name)
                claimed.add(name)
                break
            }
        }
    }

    // Parse each detected type via sub-workbook
    for (const [key, sheetNames] of Object.entries(sheetGroups)) {
        const mt = metadataTypes.find((t) => t.key === key)
        if (!mt) continue

        const subWb = XLSX.utils.book_new()
        for (const sn of sheetNames) {
            XLSX.utils.book_append_sheet(subWb, wb.Sheets[sn], sn)
        }

        try {
            results[key] = parseMetadataFile(subWb, mt)
        } catch (e) {
            results[key] = { error: e.message, payload: {}, summary: { total: 0, withId: 0, new: 0 } }
        }
    }

    return results
}

/**
 * Parse org unit file — handles parent reference by name or ID, geometry,
 * and sorts by hierarchy level so parents are imported before children.
 *
 * Parent resolution strategy:
 *  1. If parent.id is a valid UID (11 alphanum) → use as-is
 *  2. If parent.id looks like a name → try to resolve via reference sheet or within-file lookup
 *  3. If parent.name is provided but parent.id is empty → resolve name → UID via reference sheet
 *  4. If parent resolves to another new row in the same file → assign generated UID and link
 */
function parseOrgUnitFile(wb, metadataType) {
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) return { payload: { organisationUnits: [] }, summary: { total: 0, withId: 0, new: 0 } }

    const headers = rows[0]
    // Include parent.name and level as parseable (not just readOnly columns)
    const allColumns = metadataType.columns
    const colMap = mapHeadersToColumns(headers, allColumns)

    // Build org unit reference lookup from the reference sheet (if present)
    const refMap = buildOrgUnitRefMap(wb)

    // Step 1: Parse all rows
    const items = []
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.every((c) => c === '' || c == null)) continue
        const item = { _row: r + 1 }
        let rawParentName = ''
        for (const [colIdx, col] of Object.entries(colMap)) {
            const val = row[colIdx]
            if (val == null || val === '') continue

            if (col.key === 'geometry') {
                item.geometry = parseGeometry(String(val))
            } else if (col.key === 'level') {
                item._level = parseInt(val, 10) || 0
            } else if (col.key === 'parent.name') {
                rawParentName = String(val).trim()
            } else if (col.readOnly) {
                // skip other read-only columns
            } else {
                setNestedValue(item, col.key, String(val))
            }
        }

        // Store raw parent name for within-file resolution in step 3
        item._parentName = rawParentName

        // Step 2: Resolve parent ID from reference sheet
        const parentId = item.parent?.id ?? ''
        if (parentId && /^[A-Za-z0-9]{11}$/.test(parentId)) {
            // Already a valid UID — keep it
        } else if (parentId) {
            // Parent ID column contains a name instead of UID — resolve it
            const resolved = refMap[parentId.toLowerCase()]
            if (resolved) {
                setNestedValue(item, 'parent.id', resolved)
            }
        }
        if (!item.parent?.id && rawParentName) {
            // No parent ID but parent name given — resolve name → UID
            const resolved = refMap[rawParentName.toLowerCase()]
            if (resolved) {
                setNestedValue(item, 'parent.id', resolved)
            }
        }

        items.push(item)
    }

    // Step 3: Resolve within-file parent references (new parents in same file)
    // Build a name → item map for items that have names
    const nameToItem = {}
    for (const item of items) {
        if (item.name) nameToItem[item.name.toLowerCase()] = item
    }
    for (const item of items) {
        const pid = item.parent?.id ?? ''
        if (pid && /^[A-Za-z0-9]{11}$/.test(pid)) continue // already resolved

        // Try matching by parent.id value (if it's a name), or by _parentName
        const candidates = [pid, item._parentName].filter(Boolean)
        let matched = false
        for (const candidate of candidates) {
            const parentItem = nameToItem[candidate.toLowerCase()]
            if (parentItem && parentItem !== item) {
                // Ensure the parent row has an ID (assign generated UID if needed)
                if (!parentItem.id) {
                    parentItem.id = generateUid()
                }
                setNestedValue(item, 'parent.id', parentItem.id)
                matched = true
                break
            }
        }
        // If still no parent and no candidates — this is a root org unit (level 1)
    }

    // Step 4: Compute hierarchy levels from parent chain (if not set)
    const idToItem = {}
    for (const item of items) {
        if (item.id) idToItem[item.id] = item
    }
    for (const item of items) {
        if (!item._level) {
            item._level = computeLevel(item, idToItem, refMap)
        }
    }

    // Step 5: Sort by level so parents are imported before children
    items.sort((a, b) => (a._level || 999) - (b._level || 999))

    // Clean up internal fields
    const cleanItems = items.map((item) => {
        const { _row, _level, _parentName, ...rest } = item
        return rest
    })

    const withId = cleanItems.filter((i) => i.id).length
    // Group by level for display
    const levelCounts = {}
    for (const item of items) {
        const l = item._level || '?'
        levelCounts[l] = (levelCounts[l] || 0) + 1
    }

    return {
        payload: { organisationUnits: cleanItems },
        summary: { total: cleanItems.length, withId, new: cleanItems.length - withId, levelCounts },
    }
}

/**
 * Generic group/membership parser — reads Sheet 1 (groups) and Sheet 2 (members),
 * attaches member arrays to their parent groups.
 */
function parseGroupFile(wb, metadataType) {
    const mc = metadataType.memberConfig

    // Sheet 1: Parse groups
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    const columns = metadataType.columns.filter((c) => !c.readOnly)
    const colMap = rows.length > 0 ? mapHeadersToColumns(rows[0], columns) : {}

    const items = []
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row || row.every((c) => c === '' || c == null)) continue
        const item = {}
        item[mc.property] = []
        for (const [colIdx, col] of Object.entries(colMap)) {
            const val = row[colIdx]
            if (val == null || val === '') continue
            setNestedValue(item, col.key, String(val))
        }
        items.push(item)
    }

    // Sheet 2: Parse members
    if (wb.SheetNames.length > 1) {
        const wsM = wb.Sheets[wb.SheetNames[1]]
        const mRows = XLSX.utils.sheet_to_json(wsM, { header: 1 })
        const mColumns = mc.columns.filter((c) => !c.readOnly)
        const mColMap = mRows.length > 0 ? mapHeadersToColumns(mRows[0], mColumns) : {}

        const members = []
        for (let r = 1; r < mRows.length; r++) {
            const row = mRows[r]
            if (!row || row.every((c) => c === '' || c == null)) continue
            const mem = {}
            for (const [colIdx, col] of Object.entries(mColMap)) {
                const val = row[colIdx]
                if (val == null || val === '') continue
                setNestedValue(mem, col.key, String(val))
            }
            members.push(mem)
        }

        // Group members by group.id and attach to parent items
        const byGroupId = {}
        for (const m of members) {
            const gid = m.group?.id
            if (!gid) continue
            if (!byGroupId[gid]) byGroupId[gid] = []
            const clean = { ...m }
            delete clean.group
            byGroupId[gid].push(clean)
        }
        for (const item of items) {
            if (item.id && byGroupId[item.id]) {
                item[mc.property] = byGroupId[item.id]
            }
        }
    }

    const withId = items.filter((i) => i.id).length
    return {
        payload: { [metadataType.resource]: items },
        summary: { total: items.length, withId, new: items.length - withId },
    }
}

/**
 * Build a name/code → UID lookup from the OrgUnit Reference sheet.
 */
function buildOrgUnitRefMap(wb) {
    const map = {}
    const refSheetName = wb.SheetNames.find((n) => n.toLowerCase().includes('reference'))
    if (!refSheetName) return map

    const ws = wb.Sheets[refSheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) return map

    // Expect: ID, Name, Level, Parent ID
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r]
        if (!row) continue
        const id = String(row[0] ?? '').trim()
        const name = String(row[1] ?? '').trim()
        if (id && name) {
            map[name.toLowerCase()] = id
        }
    }
    return map
}

/**
 * Compute org unit level by walking up the parent chain.
 */
function computeLevel(item, idToItem, refMap) {
    let depth = 1
    let current = item
    const seen = new Set()
    while (current.parent?.id) {
        if (seen.has(current.parent.id)) break // circular reference guard
        seen.add(current.parent.id)
        const parentInFile = idToItem[current.parent.id]
        if (parentInFile) {
            depth++
            current = parentInFile
        } else {
            // Parent is external (existing in DHIS2), count it as one more level
            depth++
            break
        }
    }
    return depth
}

/**
 * Generate a DHIS2-compatible 11-character UID.
 * First char: letter. Remaining: alphanumeric.
 */
function generateUid() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    const allChars = chars + '0123456789'
    let uid = chars[Math.floor(Math.random() * chars.length)]
    for (let i = 1; i < 11; i++) {
        uid += allChars[Math.floor(Math.random() * allChars.length)]
    }
    return uid
}

/**
 * Parse option set file — reads both sheets.
 */
function parseOptionSetFile(wb, metadataType) {
    // Sheet 1: Option Sets
    const wsOS = wb.Sheets[wb.SheetNames[0]]
    const osRows = XLSX.utils.sheet_to_json(wsOS, { header: 1 })
    const osHeaders = osRows[0] ?? []
    const osColumns = metadataType.columns.filter((c) => !c.readOnly)
    const osColMap = mapHeadersToColumns(osHeaders, osColumns)

    const optionSets = []
    for (let r = 1; r < osRows.length; r++) {
        const row = osRows[r]
        if (!row || row.every((c) => c === '' || c == null)) continue
        const item = { options: [] }
        for (const [colIdx, col] of Object.entries(osColMap)) {
            const val = row[colIdx]
            if (val == null || val === '') continue
            setNestedValue(item, col.key, String(val))
        }
        optionSets.push(item)
    }

    // Sheet 2: Options
    if (wb.SheetNames.length > 1) {
        const wsOpt = wb.Sheets[wb.SheetNames[1]]
        const optRows = XLSX.utils.sheet_to_json(wsOpt, { header: 1 })
        const optHeaders = optRows[0] ?? []
        const optColumns = metadataType.optionColumns.filter((c) => !c.readOnly)
        const optColMap = mapHeadersToColumns(optHeaders, optColumns)

        // Separate options, then create standalone options array
        const options = []
        for (let r = 1; r < optRows.length; r++) {
            const row = optRows[r]
            if (!row || row.every((c) => c === '' || c == null)) continue
            const opt = {}
            for (const [colIdx, col] of Object.entries(optColMap)) {
                const val = row[colIdx]
                if (val == null || val === '') continue
                setNestedValue(opt, col.key, String(val))
            }
            options.push(opt)
        }

        // Group options by optionSet.id and attach to their respective option sets
        const byOsId = {}
        for (const opt of options) {
            const osId = opt.optionSet?.id
            if (!osId) continue
            if (!byOsId[osId]) byOsId[osId] = []
            const cleanOpt = { ...opt }
            delete cleanOpt.optionSet
            byOsId[osId].push(cleanOpt)
        }
        for (const os of optionSets) {
            if (os.id && byOsId[os.id]) {
                os.options = byOsId[os.id]
            }
        }
    }

    const withId = optionSets.filter((i) => i.id).length
    return {
        payload: { optionSets },
        summary: { total: optionSets.length, withId, new: optionSets.length - withId },
    }
}

/**
 * Append a Validation sheet with one column per used enum and return
 * data-validation rules (keyed by sheet index) that point into it.
 */
function attachValidationSheet(wb, enumCols, sheetColors) {
    if (!enumCols || enumCols.length === 0) return null

    // Distinct enum keys, preserving first-seen order
    const usedEnumKeys = []
    for (const ec of enumCols) {
        if (!usedEnumKeys.includes(ec.enumKey)) usedEnumKeys.push(ec.enumKey)
    }

    const headerLabels = {
        valueType: 'Value Type',
        domainType: 'Domain Type',
        aggregationType: 'Aggregation Type',
        featureType: 'Feature Type',
        boolean: 'Boolean',
    }
    const headers = usedEnumKeys.map((k) => headerLabels[k] || k)
    const maxLen = Math.max(...usedEnumKeys.map((k) => ENUMS[k].length))
    const rows = []
    for (let i = 0; i < maxLen; i++) {
        rows.push(usedEnumKeys.map((k) => ENUMS[k][i] ?? ''))
    }
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    setColumnWidths(ws, headers)
    XLSX.utils.book_append_sheet(wb, ws, 'Validation')
    const valSheetIdx = wb.SheetNames.length
    sheetColors[valSheetIdx] = [{ startCol: 0, endCol: headers.length - 1, color: '546E7A' }]

    // Build enumKey -> Validation sheet column range reference
    const refMap = {}
    usedEnumKeys.forEach((k, i) => {
        const cl = colLetter(i)
        refMap[k] = `Validation!$${cl}$2:$${cl}$${ENUMS[k].length + 1}`
    })

    // Group rules by data sheet index
    const rules = {}
    for (const ec of enumCols) {
        if (!rules[ec.sheetIdx]) rules[ec.sheetIdx] = []
        rules[ec.sheetIdx].push({
            col: ec.colIdx,
            ref: refMap[ec.enumKey],
            startRow: 2,
            maxRow: 1000,
        })
    }
    return rules
}

/**
 * Write a metadata workbook to Excel and trigger browser download.
 */
export function downloadMetadataWorkbook(wb, filename, sheetColors) {
    const effectiveColors = { ...(sheetColors ?? {}) }
    const validationRules = attachValidationSheet(wb, wb._enumCols, effectiveColors)

    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const zip = unzipSync(new Uint8Array(buffer))

    const handledSheets = []
    if (Object.keys(effectiveColors).length > 0) {
        injectHeaderStyles(zip, effectiveColors)
        handledSheets.push(...Object.keys(effectiveColors).map(Number))
    }
    if (validationRules) injectDataValidations(zip, validationRules)
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

// --- GeoJSON import ---

/**
 * Administrative division suffixes to strip for fuzzy matching.
 * Covers English, French, Spanish, Portuguese, Arabic (transliterated),
 * Russian (transliterated), Chinese (transliterated), Swahili, Amharic,
 * and other common administrative terms used worldwide.
 */
const GEO_STRIP_SUFFIXES = new RegExp(
    '(' + [
        // English
        'district', 'province', 'county', 'region', 'sub-?county',
        'municipality', 'city', 'town', 'ward', 'zone', 'chiefdom',
        'division', 'sub-?district', 'sector', 'cell', 'village',
        'commune', 'dept\\.?', 'department', 'parish', 'borough',
        'township', 'territory', 'state', 'prefecture', 'canton',
        // French
        'd[eé]partement', 'r[eé]gion', 'arrondissement', 'communaut[eé]',
        'quartier', 'sous-pr[eé]fecture', 'pr[eé]fecture', 'cercle',
        // Spanish / Portuguese
        'provincia', 'municipio', 'departamento', 'estado', 'distrito',
        'parroquia', 'cant[oó]n', 'regi[oó]n', 'comarca', 'concelho',
        'munic[ií]pio', 'bairro',
        // Arabic (transliterated)
        'muhafazah', 'wilayah', 'mintaqah', 'mudiriyyah', 'qada',
        'nahiyah', 'markaz', 'liwa', 'imarah', 'baladiyyah',
        // Russian (transliterated)
        'oblast', 'krai', 'kray', 'raion', 'rayon', 'okrug', 'gorod',
        // Ethiopian
        'woreda', 'kebele', 'kifle\\s*ketema',
        // East African
        'wilaya', 'kata', 'tarafa', 'mkoa',
        // South Asian
        'tehsil', 'taluk', 'mandal', 'panchayat', 'thana', 'upazila',
        // East/Southeast Asian (transliterated)
        'shi', 'xian', 'qu', 'xiang', 'zhen', 'cun',
        'amphoe', 'tambon', 'changwat',
        // Indonesian / Malay
        'kabupaten', 'kecamatan', 'kelurahan', 'desa', 'kotamadya',
        'provinsi',
    ].join('|') + ')',
    'gi'
)

/**
 * Normalize a string for fuzzy geo matching.
 * - Lowercases
 * - Strips known admin suffixes (multi-language)
 * - Removes punctuation but preserves ALL Unicode letters (Arabic, Chinese, Cyrillic, etc.)
 * - Collapses whitespace
 */
function geoNormalize(str) {
    if (!str) return ''
    return String(str)
        .toLowerCase()
        .replace(GEO_STRIP_SUFFIXES, '')
        .replace(/[^\p{L}\p{N}\s]/gu, '')  // strip punctuation, keep ALL Unicode letters + digits
        .replace(/\s+/g, ' ')
        .trim()
}

/** Validate coordinates are within valid WGS84 bounds */
function validateCoords(coords) {
    if (!Array.isArray(coords)) return false
    // Point: [lng, lat]
    if (typeof coords[0] === 'number') {
        const [lng, lat] = coords
        return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90
    }
    // Nested arrays: recurse
    return coords.every((c) => validateCoords(c))
}

/** Count coordinate points in a geometry (for complexity warnings) */
function countCoordPoints(coords) {
    if (!Array.isArray(coords)) return 0
    if (typeof coords[0] === 'number') return 1
    let n = 0
    for (const c of coords) n += countCoordPoints(c)
    return n
}

/**
 * Parse a GeoJSON file and extract features with geometry for org unit matching.
 * Intelligence:
 * - Accepts FeatureCollection, Feature, or raw Geometry
 * - Validates coordinate bounds (WGS84)
 * - Counts coordinate complexity per feature
 * - Warns about invalid/out-of-bounds geometries
 *
 * @param {string|ArrayBuffer} input - GeoJSON file content (text or buffer)
 * @returns {{ features: Array, propertyKeys: string[], warnings: string[], stats: Object }}
 */
export function parseGeoJsonFile(input) {
    const text = typeof input === 'string' ? input : new TextDecoder().decode(new Uint8Array(input))
    let geojson
    try {
        geojson = JSON.parse(text)
    } catch {
        throw new Error('Invalid JSON — file is not valid GeoJSON')
    }

    // Accept FeatureCollection, single Feature, or raw Geometry
    let features = []
    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
        features = geojson.features
    } else if (geojson.type === 'Feature') {
        features = [geojson]
    } else if (['Point', 'MultiPoint', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geojson.type)) {
        features = [{ type: 'Feature', properties: {}, geometry: geojson }]
    } else {
        throw new Error(`Unsupported GeoJSON type: "${geojson.type}". Expected FeatureCollection, Feature, or a geometry type.`)
    }

    const warnings = []
    const valid = []
    let invalidGeomCount = 0
    let outOfBoundsCount = 0
    let totalPoints = 0
    const complexFeatures = []

    for (const f of features) {
        if (!f.geometry || !f.geometry.type || !f.geometry.coordinates) {
            invalidGeomCount++
            continue
        }
        // Validate coordinate bounds
        if (!validateCoords(f.geometry.coordinates)) {
            outOfBoundsCount++
            continue
        }
        const pts = countCoordPoints(f.geometry.coordinates)
        totalPoints += pts
        if (pts > 5000) {
            complexFeatures.push({ name: f.properties?.name || '(unnamed)', points: pts })
        }
        valid.push(f)
    }

    if (valid.length === 0) {
        throw new Error('No features with valid geometry found in the file')
    }

    if (invalidGeomCount > 0) warnings.push(`${invalidGeomCount} feature(s) skipped — missing or invalid geometry`)
    if (outOfBoundsCount > 0) warnings.push(`${outOfBoundsCount} feature(s) skipped — coordinates outside valid WGS84 bounds (-180/180 lng, -90/90 lat)`)
    if (complexFeatures.length > 0) {
        const top3 = complexFeatures.slice(0, 3).map((f) => `${f.name} (${f.points.toLocaleString()} pts)`)
        warnings.push(`${complexFeatures.length} feature(s) have very complex geometry (>5,000 points): ${top3.join(', ')}${complexFeatures.length > 3 ? '...' : ''}. Consider simplifying for better DHIS2 performance.`)
    }

    // Check CRS — warn if non-WGS84 (RFC 7946 mandates WGS84 for GeoJSON)
    if (geojson.crs && geojson.crs.properties?.name) {
        const crsName = geojson.crs.properties.name.toLowerCase()
        const isWGS84 = /wgs\s*84|epsg.*4326|crs84|crs:84/.test(crsName)
        if (!isWGS84) {
            warnings.push(`CRS detected: "${geojson.crs.properties.name}". DHIS2 expects WGS84 (EPSG:4326). Coordinates may be incorrect if CRS differs.`)
        }
    }

    // Collect all unique property keys across features
    const keySet = new Set()
    for (const f of valid) {
        for (const k of Object.keys(f.properties || {})) keySet.add(k)
    }

    return {
        features: valid,
        propertyKeys: [...keySet],
        warnings,
        stats: { totalFeatures: features.length, validFeatures: valid.length, totalPoints, invalidGeomCount, outOfBoundsCount, complexCount: complexFeatures.length },
    }
}

/**
 * Match GeoJSON features to DHIS2 org units with 3-level intelligence:
 * 1. Exact match (case-insensitive, trimmed)
 * 2. Normalized match (strip admin suffixes in 15+ languages, keep Unicode letters)
 * 3. Contains match (one name contained within the other)
 *
 * Also detects: duplicates, coordinate issues, and provides match quality scores.
 *
 * @param {Array} features - Parsed GeoJSON features
 * @param {string} matchProperty - Which GeoJSON property to match (e.g. 'name', 'code', 'id')
 * @param {Array} orgUnits - DHIS2 org units with id, name, code
 * @param {string} matchField - Which DHIS2 field to match against ('name', 'code', 'id')
 * @returns {{ matched: Array, unmatched: Array, duplicates: Array, warnings: string[], payload: Object }}
 */
export function matchGeoJsonToOrgUnits(features, matchProperty, orgUnits, matchField) {
    // Build 3 lookup levels from DHIS2 org units
    const exactLookup = {}      // exact lowercase match
    const normalLookup = {}     // normalized (stripped suffixes/punctuation)
    const allOUs = []           // for contains-based fallback

    for (const ou of orgUnits) {
        const val = ou[matchField]
        if (!val) continue
        const exact = String(val).toLowerCase().trim()
        const norm = geoNormalize(val)
        exactLookup[exact] = ou
        if (norm && norm !== exact) normalLookup[norm] = ou
        allOUs.push({ ou, exact, norm })
    }

    const matched = []
    const unmatched = []
    const duplicates = []
    const warnings = []
    const seenOrgUnits = {}  // track which org units already matched (detect duplicates)

    for (const feature of features) {
        const propVal = feature.properties?.[matchProperty]
        if (!propVal) {
            unmatched.push({ feature, reason: `Missing property "${matchProperty}"` })
            continue
        }

        const rawVal = String(propVal).trim()
        const exactKey = rawVal.toLowerCase()
        const normKey = geoNormalize(rawVal)
        let ou = null
        let matchLevel = ''

        // Level 1: Exact match
        if (exactLookup[exactKey]) {
            ou = exactLookup[exactKey]
            matchLevel = 'exact'
        }

        // Level 2: Normalized match (strip suffixes)
        if (!ou && normKey) {
            if (normalLookup[normKey]) {
                ou = normalLookup[normKey]
                matchLevel = 'normalized'
            } else {
                // Check if any OU normalizes to the same key
                const found = allOUs.find((o) => o.norm === normKey)
                if (found) {
                    ou = found.ou
                    matchLevel = 'normalized'
                }
            }
        }

        // Level 3: Contains match — one contains the other (for "Bo" vs "Bo District")
        if (!ou && exactKey.length >= 2) {
            const candidates = allOUs.filter((o) =>
                o.exact.includes(exactKey) || exactKey.includes(o.exact)
            )
            if (candidates.length === 1) {
                ou = candidates[0].ou
                matchLevel = 'fuzzy'
            } else if (candidates.length > 1) {
                // Ambiguous — pick shortest name (most specific match)
                candidates.sort((a, b) => a.exact.length - b.exact.length)
                ou = candidates[0].ou
                matchLevel = 'fuzzy-ambiguous'
            }
        }

        if (!ou) {
            unmatched.push({ feature, reason: `No org unit with ${matchField} matching "${rawVal}"` })
            continue
        }

        // Duplicate detection — same org unit matched by multiple features
        if (seenOrgUnits[ou.id]) {
            duplicates.push({
                orgUnit: ou,
                feature,
                previousFeature: seenOrgUnits[ou.id].feature,
                geometry: feature.geometry,
            })
            continue
        }

        const entry = { orgUnit: ou, feature, geometry: feature.geometry, matchLevel }
        matched.push(entry)
        seenOrgUnits[ou.id] = entry
    }

    // Generate match quality summary
    const levels = { exact: 0, normalized: 0, fuzzy: 0, 'fuzzy-ambiguous': 0 }
    for (const m of matched) levels[m.matchLevel] = (levels[m.matchLevel] || 0) + 1

    if (levels.normalized > 0) warnings.push(`${levels.normalized} match(es) required name normalization (suffix stripping)`)
    if (levels.fuzzy > 0) warnings.push(`${levels.fuzzy} match(es) used fuzzy/contains logic — verify these are correct`)
    if (levels['fuzzy-ambiguous'] > 0) warnings.push(`${levels['fuzzy-ambiguous']} match(es) were ambiguous (multiple candidates) — picked best guess`)
    if (duplicates.length > 0) warnings.push(`${duplicates.length} feature(s) skipped — duplicate match to same org unit`)

    // Build DHIS2 metadata payload — only update geometry
    const payload = {
        organisationUnits: matched.map((m) => ({
            id: m.orgUnit.id,
            name: m.orgUnit.name,
            shortName: m.orgUnit.shortName || m.orgUnit.name,
            openingDate: m.orgUnit.openingDate || '1970-01-01',
            geometry: m.geometry,
        })),
    }

    return { matched, unmatched, duplicates, warnings, payload }
}

// --- Internal helpers ---

function today() {
    return new Date().toISOString().slice(0, 10)
}

function getNestedValue(obj, path) {
    const parts = path.split('.')
    let val = obj
    for (const p of parts) {
        if (val == null) return ''
        val = val[p]
    }
    return val ?? ''
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.')
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {}
        target = target[parts[i]]
    }
    target[parts[parts.length - 1]] = value
}

function mapHeadersToColumns(headers, columns) {
    // Match headers to column definitions by exact label (trimmed; the asterisk
    // suffix for required fields is optional). Prefix-based fallbacks are
    // intentionally avoided: two columns can share a prefix (e.g. "Category
    // Combo ID" vs "Category Combo Name"), which previously caused the wrong
    // column to be read on re-import and produced invalid references (E5002).
    const colMap = {}
    const norm = (s) => String(s ?? '').trim().replace(/\s*\*\s*$/, '').toLowerCase()
    for (let i = 0; i < headers.length; i++) {
        const h = norm(headers[i])
        if (!h) continue
        const col = columns.find((c) => norm(c.label) === h)
        if (col) colMap[i] = col
    }
    return colMap
}

function formatGeometry(geom) {
    if (!geom) return ''
    if (geom.type === 'Point' && geom.coordinates) {
        return `${geom.coordinates[0]},${geom.coordinates[1]}`
    }
    const json = JSON.stringify(geom)
    // Excel hard-caps cell text at 32767 characters; polygons frequently exceed this.
    // Fall back to the geometry centroid so the cell stays valid and still round-trips
    // through parseGeometry as a Point. For high-fidelity polygon editing users should
    // round-trip through the GeoJSON import flow instead.
    if (json.length <= 30000) return json
    const c = geometryCentroid(geom)
    return c ? `${c[0]},${c[1]}` : ''
}

/** Compute an unweighted centroid over all coordinate points in any geometry type. */
function geometryCentroid(geom) {
    if (!geom || !geom.coordinates) return null
    const pts = []
    const walk = (arr) => {
        if (!Array.isArray(arr)) return
        if (typeof arr[0] === 'number' && typeof arr[1] === 'number') {
            pts.push(arr)
            return
        }
        for (const a of arr) walk(a)
    }
    walk(geom.coordinates)
    if (pts.length === 0) return null
    let sx = 0, sy = 0
    for (const p of pts) { sx += p[0]; sy += p[1] }
    return [sx / pts.length, sy / pts.length]
}

function parseGeometry(val) {
    if (!val) return undefined
    const parts = val.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { type: 'Point', coordinates: parts }
    }
    try { return JSON.parse(val) } catch { return undefined }
}
