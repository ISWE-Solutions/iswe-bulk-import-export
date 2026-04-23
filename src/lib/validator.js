/**
 * Validate parsed data against program metadata before import.
 *
 * Returns { errors: ErrorObj[], warnings: ErrorObj[] } where each ErrorObj is:
 *   { source: string, row: number|null, field: string|null, message: string }
 */
import { getTrackerAttributes } from './trackerAttributes'

/** Check if a date string is in the future relative to today. */
function isFutureDate(dateStr) {
    if (!dateStr) return false
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return false
    const today = new Date()
    today.setHours(23, 59, 59, 999) // allow today
    return d > today
}

/** Check if a value is a valid YYYY-MM-DD date that DHIS2 will accept. */
function isInvalidDateValue(val) {
    if (!val) return false
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const d = new Date(val)
        return isNaN(d.getTime())
    }
    // Anything not matching YYYY-MM-DD is invalid for DHIS2
    return true
}

/**
 * Build a value-type index from metadata for date format validation.
 * Returns { attrs: { attrId: valueType }, des: { deId: valueType } }
 */
function buildValueTypeIndex(metadata) {
    const attrs = {}
    const des = {}
    const allAttrs = getTrackerAttributes(metadata)
    for (const a of allAttrs) {
        const tea = a.trackedEntityAttribute ?? a
        if (tea.valueType) attrs[tea.id] = tea.valueType
    }
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            if (de.valueType) des[de.id] = de.valueType
        }
    }
    return { attrs, des }
}

export function validateParsedData(parsedData, metadata) {
    const errors = []
    const warnings = []

    const { trackedEntities, stageData } = parsedData
    const stages = metadata.programStages ?? []
    const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))
    const orgUnitIds = new Set((metadata.organisationUnits ?? []).map((ou) => ou.id))

    // Validate TEIs
    if (!trackedEntities || trackedEntities.length === 0) {
        errors.push({ source: 'File', row: null, field: null, message: 'No tracked entities found in the uploaded file.' })
        return { errors, warnings }
    }

    const teiIds = new Set()
    for (let i = 0; i < trackedEntities.length; i++) {
        const tei = trackedEntities[i]
        const row = i + 2 // 1-indexed + header row

        if (!tei.teiId) {
            errors.push({ source: 'TEI Sheet', row, field: 'TEI_ID', message: 'TEI_ID is missing.' })
            continue
        }

        if (teiIds.has(tei.teiId)) {
            errors.push({ source: 'TEI Sheet', row, field: 'TEI_ID', message: `Duplicate TEI_ID "${tei.teiId}".` })
        }
        teiIds.add(tei.teiId)

        if (!tei.orgUnit) {
            errors.push({ source: 'TEI Sheet', row, field: 'ORG_UNIT_ID', message: `ORG_UNIT_ID is missing for TEI "${tei.teiId}".` })
        } else if (orgUnitIds.size > 0 && !orgUnitIds.has(tei.orgUnit)) {
            errors.push({
                source: 'TEI Sheet', row, field: 'ORG_UNIT_ID',
                message: `Org unit "${tei.orgUnit}" is not valid for this program.`,
            })
        }

        if (!tei.enrollmentDate) {
            errors.push({ source: 'TEI Sheet', row, field: 'ENROLLMENT_DATE', message: `ENROLLMENT_DATE is missing for TEI "${tei.teiId}".` })
        } else if (isFutureDate(tei.enrollmentDate)) {
            errors.push({
                source: 'TEI Sheet', row, field: 'ENROLLMENT_DATE',
                message: `Enrollment date "${tei.enrollmentDate}" is in the future. DHIS2 will reject this (E1020).`,
            })
        }

        if (tei.incidentDate && isFutureDate(tei.incidentDate)) {
            errors.push({
                source: 'TEI Sheet', row, field: 'INCIDENT_DATE',
                message: `Incident date "${tei.incidentDate}" is in the future. DHIS2 will reject this (E1021).`,
            })
        }

        // Validate mandatory attributes
        const requiredAttrs = getTrackerAttributes(metadata)
            .filter((a) => a.mandatory)
            .map((a) => ({
                id: a.trackedEntityAttribute?.id ?? a.id,
                name: a.trackedEntityAttribute?.displayName ?? a.displayName,
            }))

        for (const attr of requiredAttrs) {
            if (!tei.attributes[attr.id]) {
                errors.push({
                    source: 'TEI Sheet', row, field: attr.name,
                    message: `Mandatory attribute "${attr.name}" is missing for TEI "${tei.teiId}".`,
                })
            }
        }
    }

    // Validate unique attributes — detect duplicate values across TEIs (E1064)
    const uniqueAttrs = getTrackerAttributes(metadata)
        .filter((a) => (a.trackedEntityAttribute ?? a).unique)
        .map((a) => ({
            id: (a.trackedEntityAttribute ?? a).id,
            name: (a.trackedEntityAttribute ?? a).displayName,
        }))

    for (const attr of uniqueAttrs) {
        const seen = {} // value -> first row
        for (let i = 0; i < trackedEntities.length; i++) {
            const val = trackedEntities[i].attributes?.[attr.id]
            if (!val) continue
            const row = i + 2
            if (seen[val] !== undefined) {
                errors.push({
                    source: 'TEI Sheet', row, field: attr.name,
                    message: `Duplicate value "${val}" for unique attribute "${attr.name}". First seen at row ${seen[val]} (E1064).`,
                })
            } else {
                seen[val] = row
            }
        }
    }

    // Build indexes upfront so value-type checks can skip option-set fields
    const vtIndex = buildValueTypeIndex(metadata)
    const optionSetIndex = buildOptionSetIndex(metadata)

    // Validate attribute value types (skip option-set fields — validated separately)
    for (let i = 0; i < trackedEntities.length; i++) {
        const tei = trackedEntities[i]
        const row = i + 2
        for (const [attrId, val] of Object.entries(tei.attributes ?? {})) {
            if (optionSetIndex.attrs[attrId]) continue
            const vt = vtIndex.attrs[attrId]
            if (vt && val) {
                const vtError = checkValueType(val, vt)
                if (vtError) {
                    errors.push({
                        source: 'TEI Sheet', row, field: attrId,
                        message: `${vtError} (expected ${vt}). DHIS2 will reject this.`,
                    })
                }
            }
        }
    }

    // Validate stage data — skip stages with no events (unmapped stages)
    for (const [stageId, events] of Object.entries(stageData ?? {})) {
        if (!events || events.length === 0) continue

        const stage = stageMap[stageId]
        if (!stage) {
            warnings.push({ source: stageId, row: null, field: null, stageId, message: `Data found for unknown stage ID "${stageId}". It will be ignored.` })
            continue
        }

        // Check non-repeatable stages for duplicate TEI_IDs
        if (!stage.repeatable) {
            const stageTeiIds = new Set()
            for (let i = 0; i < events.length; i++) {
                const event = events[i]
                if (stageTeiIds.has(event.teiId)) {
                    errors.push({
                        source: stage.displayName, row: i + 2, field: 'TEI_ID', stageId,
                        message: `Duplicate TEI_ID "${event.teiId}". This stage is NOT repeatable — only one event per tracked entity is allowed.`,
                    })
                }
                stageTeiIds.add(event.teiId)
            }
        }

        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            if (!event.teiId) {
                errors.push({ source: stage.displayName, row, field: 'TEI_ID', stageId, message: 'TEI_ID is missing.' })
                continue
            }

            if (!teiIds.has(event.teiId)) {
                errors.push({
                    source: stage.displayName, row, field: 'TEI_ID', stageId,
                    message: `TEI_ID "${event.teiId}" not found in TEI sheet.`,
                })
            }

            if (!event.eventDate) {
                warnings.push({
                    source: stage.displayName, row, field: 'EVENT_DATE', stageId,
                    message: `EVENT_DATE is missing for TEI "${event.teiId}". This event will be skipped but the TEI and enrollment will still be imported.`,
                })
            } else if (isFutureDate(event.eventDate)) {
                errors.push({
                    source: stage.displayName, row, field: 'EVENT_DATE', stageId,
                    message: `Event date "${event.eventDate}" is in the future. DHIS2 will reject this.`,
                })
            } else if (isInvalidDateValue(event.eventDate)) {
                errors.push({
                    source: stage.displayName, row, field: 'EVENT_DATE', stageId,
                    message: `Event date "${event.eventDate}" is not a valid date (expected YYYY-MM-DD). DHIS2 will reject this (E1007).`,
                })
            }

            // Validate compulsory data elements
            const requiredDes =
                stage.programStageDataElements
                    ?.filter((psde) => psde.compulsory)
                    ?.map((psde) => ({
                        id: psde.dataElement?.id ?? psde.id,
                        name: psde.dataElement?.displayName ?? psde.displayName,
                    })) ?? []

            for (const de of requiredDes) {
                if (!event.dataValues[de.id]) {
                    errors.push({
                        source: stage.displayName, row, field: de.name, stageId,
                        message: `Mandatory data element "${de.name}" is missing.`,
                    })
                }
            }

            // Validate data element value types (skip option-set fields — validated separately)
            for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
                if (optionSetIndex.des[deId]) continue
                const vt = vtIndex.des[deId]
                if (vt && val) {
                    const vtError = checkValueType(val, vt)
                    if (vtError) {
                        errors.push({
                            source: stage.displayName, row, field: deId, stageId,
                            message: `${vtError} (expected ${vt}). DHIS2 will reject this.`,
                        })
                    }
                }
            }
        }
    }

    // Validate option-set values
    for (let i = 0; i < trackedEntities.length; i++) {
        const tei = trackedEntities[i]
        const row = i + 2
        for (const [attrId, val] of Object.entries(tei.attributes ?? {})) {
            const valid = optionSetIndex.attrs[attrId]
            if (valid && !valid.has(val)) {
                errors.push({
                    source: 'TEI Sheet', row, field: attrId,
                    message: diagnoseOptionError(val, attrId, valid, optionSetIndex),
                })
            }
        }
    }

    for (const [stageId, events] of Object.entries(stageData ?? {})) {
        const stage = stageMap[stageId]
        if (!stage) continue
        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2
            for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
                const valid = optionSetIndex.des[deId]
                if (valid && !valid.has(val)) {
                    errors.push({
                        source: stage.displayName, row, field: deId, stageId,
                        message: diagnoseOptionError(val, deId, valid, optionSetIndex),
                    })
                }
            }
        }
    }

    // Warning for stages with no data (skip unmapped stages quietly)
    for (const stage of stages) {
        if (!stageData?.[stage.id] || stageData[stage.id].length === 0) {
            warnings.push({ source: stage.displayName, row: null, field: null, stageId: stage.id, message: 'No data provided — stage will be skipped.' })
        }
    }

    return { errors, warnings }
}

/**
 * Validate parsed event program data against metadata before import.
 *
 * parsedData shape: { events: { stageId: [{ orgUnit, eventDate, dataValues }] } }
 *
 * Returns { errors: ErrorObj[], warnings: ErrorObj[] }
 */
export function validateEventData(parsedData, metadata) {
    const errors = []
    const warnings = []

    const stages = metadata.programStages ?? []
    const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))
    const orgUnitIds = new Set((metadata.organisationUnits ?? []).map((ou) => ou.id))
    const eventsMap = parsedData.events ?? {}

    let totalEvents = 0
    for (const arr of Object.values(eventsMap)) totalEvents += arr?.length ?? 0

    if (totalEvents === 0) {
        errors.push({ source: 'File', row: null, field: null, message: 'No events found in the uploaded file.' })
        return { errors, warnings }
    }

    const evtVtIndex = buildValueTypeIndex(metadata)
    const optionSetIndex = buildOptionSetIndex(metadata)

    for (const [stageId, events] of Object.entries(eventsMap)) {
        if (!events || events.length === 0) continue

        const stage = stageMap[stageId]
        if (!stage) {
            warnings.push({ source: stageId, row: null, field: null, stageId, message: `Data found for unknown stage ID "${stageId}". It will be ignored.` })
            continue
        }

        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            if (!event.orgUnit) {
                errors.push({ source: stage.displayName, row, field: 'ORG_UNIT_ID', stageId, message: 'ORG_UNIT_ID is missing.' })
            } else if (orgUnitIds.size > 0 && !orgUnitIds.has(event.orgUnit)) {
                errors.push({
                    source: stage.displayName, row, field: 'ORG_UNIT_ID', stageId,
                    message: `Org unit "${event.orgUnit}" is not valid for this program.`,
                })
            }

            if (!event.eventDate) {
                errors.push({ source: stage.displayName, row, field: 'EVENT_DATE', stageId, message: 'EVENT_DATE is missing.' })
            } else if (isFutureDate(event.eventDate)) {
                errors.push({ source: stage.displayName, row, field: 'EVENT_DATE', stageId, message: 'EVENT_DATE cannot be a future date (DHIS2 will reject with E1020).' })
            } else if (isInvalidDateValue(event.eventDate)) {
                errors.push({ source: stage.displayName, row, field: 'EVENT_DATE', stageId, message: `Event date "${event.eventDate}" is not a valid date (expected YYYY-MM-DD). DHIS2 will reject this (E1007).` })
            }

            // Validate compulsory data elements
            const requiredDes =
                stage.programStageDataElements
                    ?.filter((psde) => psde.compulsory)
                    ?.map((psde) => ({
                        id: psde.dataElement?.id ?? psde.id,
                        name: psde.dataElement?.displayName ?? psde.displayName,
                    })) ?? []

            for (const de of requiredDes) {
                if (!event.dataValues[de.id]) {
                    errors.push({
                        source: stage.displayName, row, field: de.name, stageId,
                        message: `Mandatory data element "${de.name}" is missing.`,
                    })
                }
            }

            // Validate data element value types (skip option-set fields — validated separately)
            for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
                if (optionSetIndex.des[deId]) continue
                const vt = evtVtIndex.des[deId]
                if (vt && val) {
                    const vtError = checkValueType(val, vt)
                    if (vtError) {
                        errors.push({
                            source: stage.displayName, row, field: deId, stageId,
                            message: `${vtError} (expected ${vt}). DHIS2 will reject this.`,
                        })
                    }
                }
            }
        }
    }

    // Validate option-set values
    for (const [stageId, events] of Object.entries(eventsMap)) {
        const stage = stageMap[stageId]
        if (!stage) continue
        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2
            for (const [deId, val] of Object.entries(event.dataValues ?? {})) {
                const valid = optionSetIndex.des[deId]
                if (valid && !valid.has(val)) {
                    errors.push({
                        source: stage.displayName, row, field: deId, stageId,
                        message: diagnoseOptionError(val, deId, valid, optionSetIndex),
                    })
                }
            }
        }
    }

    // Warning for stages with no data
    for (const stage of stages) {
        if (!eventsMap[stage.id] || eventsMap[stage.id].length === 0) {
            warnings.push({ source: stage.displayName, row: null, field: null, stageId: stage.id, message: 'No data provided — stage will be skipped.' })
        }
    }

    return { errors, warnings }
}

/**
 * Build a set of valid option codes per attribute / data element,
 * plus reverse indexes for smart error diagnosis.
 *
 * Returns {
 *   attrs:        { fieldId: Set<trimmedCode> }
 *   des:          { fieldId: Set<trimmedCode> }
 *   codeToFields: { lowerValue: [{ fieldId, fieldName }] }  — reverse index for misalignment detection
 *   fieldNames:   { fieldId: displayName }                   — human-readable field names
 *   headerNames:  Set<displayName>                           — known headers for header-as-data detection
 * }
 */
function buildOptionSetIndex(metadata) {
    const attrs = {}
    const des = {}
    const codeToFields = {}
    const fieldNames = {}
    const headerNames = new Set()
    // Per-field full option list [{ code, displayName }] — used for fuzzy "did you mean" diagnosis.
    const fieldOptions = {}

    function indexOptions(fieldId, fieldName, options, target) {
        target[fieldId] = new Set(options.map((o) => (o.code ?? '').trim()))
        fieldOptions[fieldId] = options.map((o) => ({
            code: (o.code ?? '').trim(),
            displayName: (o.displayName ?? '').trim(),
        })).filter((o) => o.code || o.displayName)
        for (const opt of options) {
            const code = (opt.code ?? '').trim()
            const lower = code.toLowerCase()
            if (lower) {
                (codeToFields[lower] ??= []).push({ fieldId, fieldName })
            }
            if (opt.displayName) {
                const dn = opt.displayName.trim().toLowerCase()
                if (dn !== lower) {
                    (codeToFields[dn] ??= []).push({ fieldId, fieldName })
                }
            }
        }
    }

    const allAttrs = getTrackerAttributes(metadata)
    for (const a of allAttrs) {
        const tea = a.trackedEntityAttribute ?? a
        fieldNames[tea.id] = tea.displayName
        headerNames.add(tea.displayName)
        const os = tea.optionSet
        if (os?.options?.length) indexOptions(tea.id, tea.displayName, os.options, attrs)
    }

    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            fieldNames[de.id] = de.displayName
            headerNames.add(de.displayName)
            const os = de.optionSet
            if (os?.options?.length) indexOptions(de.id, de.displayName, os.options, des)
        }
    }

    // Data set elements (for data entry validation)
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        if (!de) continue
        fieldNames[de.id] = de.displayName
        headerNames.add(de.displayName)
        const os = de.optionSet
        if (os?.options?.length) indexOptions(de.id, de.displayName, os.options, des)
    }

    return { attrs, des, codeToFields, fieldNames, headerNames, fieldOptions }
}

/**
 * Simple Levenshtein distance for "did you mean" suggestions.
 * Iterative two-row implementation; O(n*m) space O(min(n,m)).
 */
function levenshtein(a, b) {
    a = a.toLowerCase()
    b = b.toLowerCase()
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length
    let prev = new Array(b.length + 1)
    let curr = new Array(b.length + 1)
    for (let j = 0; j <= b.length; j++) prev[j] = j
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            curr[j] = Math.min(
                curr[j - 1] + 1,
                prev[j] + 1,
                prev[j - 1] + cost,
            )
        }
        [prev, curr] = [curr, prev]
    }
    return prev[b.length]
}

/**
 * Return the closest option(s) to `val` within the provided fieldOptions list.
 * Threshold scales with input length: shorter strings tolerate fewer edits.
 */
function suggestClosestOption(val, options, max = 2) {
    if (!options?.length) return []
    const input = String(val).trim()
    if (!input) return []
    const cap = Math.max(2, Math.floor(input.length / 3)) // up to ~33% of length
    const scored = []
    for (const opt of options) {
        const dCode = opt.code ? levenshtein(input, opt.code) : Infinity
        const dName = opt.displayName ? levenshtein(input, opt.displayName) : Infinity
        const d = Math.min(dCode, dName)
        if (d <= cap) scored.push({ opt, d })
    }
    scored.sort((a, b) => a.d - b.d)
    return scored.slice(0, max).map((s) => s.opt)
}

/**
 * Produce an enriched E1125 error message with smart diagnosis.
 * Detects cross-column misalignment and header-as-data issues.
 */
function diagnoseOptionError(val, fieldId, validSet, optIndex) {
    const fieldName = optIndex.fieldNames[fieldId] || fieldId
    const lower = String(val).trim().toLowerCase()

    // Cross-column misalignment: value is valid for a DIFFERENT field
    const matchingFields = (optIndex.codeToFields[lower] || [])
        .filter((f) => f.fieldId !== fieldId)
    if (matchingFields.length > 0) {
        const otherNames = [...new Set(matchingFields.map((f) => f.fieldName))].slice(0, 3)
        return `Value "${val}" is not a valid option for "${fieldName}", but IS valid for ${otherNames.map((n) => `"${n}"`).join(', ')} — possible column misalignment in your spreadsheet.`
    }

    // Header-as-data: value matches a known column header name
    if (optIndex.headerNames.has(val) || optIndex.headerNames.has(val.replace(/\s*\*$/, ''))) {
        return `Value "${val}" in "${fieldName}" looks like a column header pasted as data — check for shifted rows.`
    }

    // Fuzzy "did you mean" — suggest the closest valid option(s) for this field.
    const suggestions = suggestClosestOption(val, optIndex.fieldOptions?.[fieldId])
    if (suggestions.length > 0) {
        const hint = suggestions
            .map((s) => s.displayName && s.displayName !== s.code ? `"${s.code}" (${s.displayName})` : `"${s.code || s.displayName}"`)
            .join(' or ')
        const sample = [...validSet].slice(0, 5).join(', ')
        return `Value "${val}" is not a valid option for "${fieldName}". Did you mean ${hint}? Valid options: ${sample}${validSet.size > 5 ? ', ...' : ''}. (E1125)`
    }

    // Default: show valid options sample
    const sample = [...validSet].slice(0, 5).join(', ')
    return `Value "${val}" is not a valid option for "${fieldName}". Valid options: ${sample}${validSet.size > 5 ? ', ...' : ''}. (E1125)`
}

/**
 * Validate a value against DHIS2 value type.
 * Returns an error string if invalid, null if OK.
 */
function checkValueType(value, valueType) {
    if (!value || !valueType) return null
    const v = String(value).trim()
    if (!v) return null
    switch (valueType) {
    case 'NUMBER':
    case 'UNIT_INTERVAL':
        if (isNaN(Number(v))) return `"${v}" is not a valid number`
        if (valueType === 'UNIT_INTERVAL' && (Number(v) < 0 || Number(v) > 1))
            return `"${v}" must be between 0 and 1`
        break
    case 'INTEGER':
        if (!/^-?\d+$/.test(v)) return `"${v}" is not a valid integer`
        break
    case 'INTEGER_POSITIVE':
        if (!/^\d+$/.test(v) || Number(v) <= 0) return `"${v}" must be a positive integer`
        break
    case 'INTEGER_NEGATIVE':
        if (!/^-\d+$/.test(v) || Number(v) >= 0) return `"${v}" must be a negative integer`
        break
    case 'INTEGER_ZERO_OR_POSITIVE':
        if (!/^\d+$/.test(v)) return `"${v}" must be zero or a positive integer`
        break
    case 'PERCENTAGE':
        if (isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100)
            return `"${v}" must be a number between 0 and 100`
        break
    case 'BOOLEAN':
        if (!['true', 'false', '1', '0'].includes(v.toLowerCase()))
            return `"${v}" must be true/false`
        break
    case 'TRUE_ONLY':
        if (!['true', '1'].includes(v.toLowerCase()))
            return `"${v}" must be true (or empty)`
        break
    case 'DATE':
    case 'AGE':
        if (isInvalidDateValue(v)) return `"${v}" is not a valid date (expected YYYY-MM-DD)`
        break
    case 'PHONE_NUMBER':
        if (!/^\+?[\d\s()-]{6,20}$/.test(v)) return `"${v}" is not a valid phone number`
        break
    case 'EMAIL':
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `"${v}" is not a valid email`
        break
    default:
        break
    }
    return null
}

/**
 * Validate parsed data entry (aggregate) data against data set metadata.
 *
 * parsedData shape: { dataValues: [{ orgUnit, period, dataElement, categoryOptionCombo, value }] }
 *
 * Returns { errors: ErrorObj[], warnings: ErrorObj[] }
 */
export function validateDataEntryData(parsedData, metadata) {
    const errors = []
    const warnings = []

    const dataValues = parsedData.dataValues ?? []
    if (dataValues.length === 0) {
        errors.push({ source: 'File', row: null, field: null, message: 'No data values found in the uploaded file.' })
        return { errors, warnings }
    }

    const orgUnitIds = new Set((metadata.organisationUnits ?? []).map((ou) => ou.id))
    const validDeIds = new Set((metadata.dataSetElements ?? []).map((dse) => dse.dataElement?.id).filter(Boolean))

    // Detect org unit name collisions (multiple UIDs for the same displayName)
    const ouNameCounts = {}
    for (const ou of metadata.organisationUnits ?? []) {
        const key = ou.displayName.trim().toLowerCase()
        ouNameCounts[key] = (ouNameCounts[key] ?? 0) + 1
    }
    const ouNameCollisions = new Set(
        Object.entries(ouNameCounts).filter(([, count]) => count > 1).map(([name]) => name)
    )

    // Build enriched option set index (shared with tracker/event validators)
    const optionSetIndex = buildOptionSetIndex(metadata)

    // Build value type index for data elements
    const deValueTypes = {}
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        if (de?.valueType) deValueTypes[de.id] = de.valueType
    }

    // Build valid COC set per data element
    const deValidCocs = {}
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        const cocs = de?.categoryCombo?.categoryOptionCombos
        if (de && cocs) {
            deValidCocs[de.id] = new Set(cocs.map((c) => c.id))
        }
    }

    // Period format: covers Daily, Weekly (incl. BiWeekly), Monthly, BiMonthly,
    // Quarterly, SixMonthly, Yearly, FinancialApril/July/Oct/Nov
    const periodPattern = /^(\d{4})(\d{4}|\d{2}|0[1-9]|1[0-2]|Q[1-4]|S[1-2]|W\d{1,2}|BiW\d{1,2}|April|July|Oct|Nov|B\d{2})?$/

    for (let i = 0; i < dataValues.length; i++) {
        const dv = dataValues[i]
        const row = i + 2

        if (!dv.orgUnit) {
            errors.push({ source: 'Data Entry', row, field: 'ORG_UNIT_ID', message: 'ORG_UNIT_ID is missing.' })
        } else if (orgUnitIds.size > 0 && !orgUnitIds.has(dv.orgUnit)) {
            // Check if this is an ambiguous name collision
            const isCollision = ouNameCollisions.has(String(dv.orgUnit).trim().toLowerCase())
            errors.push({
                source: 'Data Entry', row, field: 'ORG_UNIT_ID',
                message: isCollision
                    ? `Org unit name "${dv.orgUnit}" matches multiple org units in this data set. Use the UID instead.`
                    : `Org unit "${dv.orgUnit}" is not valid for this data set.`,
            })
        }

        if (!dv.period) {
            errors.push({ source: 'Data Entry', row, field: 'PERIOD', message: 'PERIOD is missing.' })
        } else if (!periodPattern.test(dv.period)) {
            warnings.push({
                source: 'Data Entry', row, field: 'PERIOD',
                message: `Period "${dv.period}" may not be in a valid DHIS2 format.`,
            })
        }

        if (!dv.dataElement) {
            errors.push({ source: 'Data Entry', row, field: 'dataElement', message: 'Data element ID is missing.' })
        } else if (!validDeIds.has(dv.dataElement)) {
            warnings.push({
                source: 'Data Entry', row, field: 'dataElement',
                message: `Data element "${dv.dataElement}" is not part of this data set.`,
            })
        }

        // COC validation: check that COC is valid for this data element
        if (dv.dataElement && dv.categoryOptionCombo && deValidCocs[dv.dataElement]) {
            if (!deValidCocs[dv.dataElement].has(dv.categoryOptionCombo)) {
                errors.push({
                    source: 'Data Entry', row, field: dv.dataElement,
                    message: `Category option combo "${dv.categoryOptionCombo}" is not valid for data element "${dv.dataElement}".`,
                })
            }
        }

        // Option set validation
        if (dv.dataElement && optionSetIndex.des[dv.dataElement]) {
            if (!optionSetIndex.des[dv.dataElement].has(dv.value)) {
                errors.push({
                    source: 'Data Entry', row, field: dv.dataElement,
                    message: diagnoseOptionError(dv.value, dv.dataElement, optionSetIndex.des[dv.dataElement], optionSetIndex),
                })
            }
        }

        // Value type validation (skip if option set — already validated above)
        if (dv.dataElement && !optionSetIndex.des[dv.dataElement] && deValueTypes[dv.dataElement]) {
            const vtError = checkValueType(dv.value, deValueTypes[dv.dataElement])
            if (vtError) {
                errors.push({
                    source: 'Data Entry', row, field: dv.dataElement,
                    message: `${vtError} (expected ${deValueTypes[dv.dataElement]}). DHIS2 will reject this.`,
                })
            }
        }
    }

    // Duplicate org unit + period + data element + COC → error (data would be overwritten)
    const seen = new Map()
    for (let i = 0; i < dataValues.length; i++) {
        const dv = dataValues[i]
        const key = `${dv.orgUnit}|${dv.period}|${dv.dataElement}|${dv.categoryOptionCombo || ''}`
        if (seen.has(key)) {
            errors.push({
                source: 'Data Entry', row: i + 2, field: dv.dataElement,
                message: `Duplicate data value (same org unit, period, data element, and category option combo as row ${seen.get(key)}). Only one value per combination is allowed.`,
            })
        } else {
            seen.set(key, i + 2)
        }
    }

    return { errors, warnings }
}

/**
 * Filter parsed data to exclude rows that have validation errors.
 * Returns { filtered, skippedRows } where skippedRows contains the removed data + reasons.
 *
 * For tracker: TEI errors remove the TEI. Stage errors remove just that event row.
 * For event programs: event errors remove that event.
 * For data entry: row errors remove that data value.
 */
export function filterValidRows(parsedData, errors) {
    const isDataEntry = !!parsedData.dataValues
    const isEvent = !!parsedData.events && !parsedData.trackedEntities
    const isTracker = !!parsedData.trackedEntities

    if (isDataEntry) return filterDataEntryRows(parsedData, errors)
    if (isEvent) return filterEventRows(parsedData, errors)
    if (isTracker) return filterTrackerRows(parsedData, errors)
    return { filtered: parsedData, skippedRows: [] }
}

function filterTrackerRows(parsedData, errors) {
    const skippedRows = []

    // Build sets of errored TEI rows and errored stage rows keyed by stageId
    const erroredTeiRows = new Set()
    const erroredStageRows = {} // { stageId: Set<row> }

    for (const err of errors) {
        if (err.source === 'TEI Sheet' && err.row != null) {
            erroredTeiRows.add(err.row)
        } else if (err.stageId && err.row != null) {
            if (!erroredStageRows[err.stageId]) erroredStageRows[err.stageId] = new Set()
            erroredStageRows[err.stageId].add(err.row)
        }
    }

    // Filter TEIs
    const filteredTeis = []
    const removedTeiIds = new Set()
    for (let i = 0; i < (parsedData.trackedEntities ?? []).length; i++) {
        const tei = parsedData.trackedEntities[i]
        const row = i + 2
        if (erroredTeiRows.has(row)) {
            removedTeiIds.add(tei.teiId)
            const rowErrors = errors.filter((e) => e.source === 'TEI Sheet' && e.row === row)
            skippedRows.push({
                source: 'TEI Sheet', row, teiId: tei.teiId,
                data: tei, errors: rowErrors,
            })
        } else {
            filteredTeis.push(tei)
        }
    }

    // Filter stage events — skip events for removed TEIs and events with their own errors
    const filteredStageData = {}
    for (const [stageId, events] of Object.entries(parsedData.stageData ?? {})) {
        const erroredRows = erroredStageRows[stageId]
        const filtered = []
        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            // Skip if the TEI was removed entirely
            if (removedTeiIds.has(event.teiId)) {
                skippedRows.push({
                    source: 'Stage Event', row, teiId: event.teiId, stageId,
                    data: event,
                    errors: [{ message: `TEI "${event.teiId}" was excluded due to TEI-level errors.` }],
                })
                continue
            }

            // Check if this specific event row has errors for THIS stage
            if (erroredRows?.has(row)) {
                const eventErrors = errors.filter((e) => e.stageId === stageId && e.row === row)
                skippedRows.push({
                    source: eventErrors[0]?.source ?? stageId, row, teiId: event.teiId, stageId,
                    data: event, errors: eventErrors,
                })
                continue
            }

            filtered.push(event)
        }
        filteredStageData[stageId] = filtered
    }

    return {
        filtered: { trackedEntities: filteredTeis, stageData: filteredStageData },
        skippedRows,
    }
}

function filterEventRows(parsedData, errors) {
    const skippedRows = []
    const filteredEvents = {}

    // Build errored rows keyed by stageId
    const erroredStageRows = {}
    for (const err of errors) {
        if (err.stageId && err.row != null) {
            if (!erroredStageRows[err.stageId]) erroredStageRows[err.stageId] = new Set()
            erroredStageRows[err.stageId].add(err.row)
        }
    }

    for (const [stageId, events] of Object.entries(parsedData.events ?? {})) {
        const erroredRows = erroredStageRows[stageId]
        const filtered = []
        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2
            if (erroredRows?.has(row)) {
                const rowErrors = errors.filter((e) => e.stageId === stageId && e.row === row)
                skippedRows.push({
                    source: rowErrors[0]?.source ?? stageId, row, stageId,
                    data: event, errors: rowErrors,
                })
            } else {
                filtered.push(event)
            }
        }
        filteredEvents[stageId] = filtered
    }

    return { filtered: { events: filteredEvents }, skippedRows }
}

function filterDataEntryRows(parsedData, errors) {
    const skippedRows = []
    const erroredRows = new Set(errors.filter((e) => e.row != null).map((e) => e.row))
    const filtered = []

    for (let i = 0; i < (parsedData.dataValues ?? []).length; i++) {
        const dv = parsedData.dataValues[i]
        const row = i + 2
        if (erroredRows.has(row)) {
            const rowErrors = errors.filter((e) => e.row === row)
            skippedRows.push({ source: 'Data Entry', row, data: dv, errors: rowErrors })
        } else {
            filtered.push(dv)
        }
    }

    return { filtered: { dataValues: filtered }, skippedRows }
}
