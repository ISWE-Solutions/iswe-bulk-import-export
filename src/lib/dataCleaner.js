/**
 * Data Cleaning Engine — Levels 1-3
 *
 * Level 1: Silent auto-fixes (dates, booleans, whitespace)
 * Level 2: Fuzzy-match suggestions (org units, option sets) for user review
 * Level 3: Post-import error analysis with fixable suggestions
 */

// ---------------------------------------------------------------------------
// Levenshtein distance — core fuzzy matching primitive
// ---------------------------------------------------------------------------

/**
 * Compute edit distance between two strings (case-insensitive).
 * Uses the classic dynamic programming approach with O(min(m,n)) space.
 */
function levenshtein(a, b) {
    a = a.toLowerCase()
    b = b.toLowerCase()
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    // Keep shorter string in `b` for O(min) space
    if (a.length < b.length) { const t = a; a = b; b = t }

    const bLen = b.length
    let prev = Array.from({ length: bLen + 1 }, (_, i) => i)
    let curr = new Array(bLen + 1)

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        for (let j = 1; j <= bLen; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            curr[j] = Math.min(
                prev[j] + 1,      // deletion
                curr[j - 1] + 1,  // insertion
                prev[j - 1] + cost // substitution
            )
        }
        [prev, curr] = [curr, prev]
    }
    return prev[bLen]
}

/**
 * Find the closest match for `value` within `candidates`.
 * Returns { match, distance, confidence } or null if nothing is close enough.
 *
 * Confidence: 0-100 scale. 100 = exact, 0 = completely different.
 * maxDistance defaults to 40% of the value length (adaptive threshold).
 */
function findClosestMatch(value, candidates, maxDistanceOverride) {
    if (!value || candidates.length === 0) return null
    const lower = value.toLowerCase().trim()
    const maxDist = maxDistanceOverride ?? Math.max(2, Math.floor(lower.length * 0.4))

    let bestMatch = null
    let bestDist = Infinity

    for (const candidate of candidates) {
        const dist = levenshtein(lower, candidate.toLowerCase().trim())
        if (dist < bestDist) {
            bestDist = dist
            bestMatch = candidate
        }
    }

    if (bestDist > maxDist || bestDist === 0) return null // 0 = exact match (already handled)

    const maxLen = Math.max(lower.length, bestMatch.length)
    const confidence = Math.round((1 - bestDist / maxLen) * 100)

    return { match: bestMatch, distance: bestDist, confidence }
}

/**
 * Check if `value` is a substring of any candidate or vice versa (partial match).
 * Returns the matching candidate or null.
 */
function findPartialMatch(value, candidates) {
    if (!value) return null
    const lower = value.toLowerCase().trim()
    if (lower.length < 3) return null // too short for partial matching

    for (const candidate of candidates) {
        const cLower = candidate.toLowerCase().trim()
        if (cLower.includes(lower) || lower.includes(cLower)) {
            if (cLower !== lower) return candidate
        }
    }
    return null
}

// ---------------------------------------------------------------------------
// Level 1: Silent auto-fixes (enhanced date & boolean parsing)
// ---------------------------------------------------------------------------

const MONTH_NAMES = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
}

/**
 * Parse a date string in various common formats into YYYY-MM-DD.
 * Returns the ISO date string or the original value if unparseable.
 *
 * Supported formats:
 *   YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (unambiguous, year-first)
 *   DD-MMM-YYYY, DD/MMM/YYYY (e.g. 15-Jan-2024)
 *   DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (day-first, DD > 12 unambiguous)
 *   MM-DD-YYYY, MM/DD/YYYY (US format, when MM <= 12 and DD > 12)
 *   Excel serial date numbers
 *   Date objects
 */
export function parseDate(val) {
    if (!val) return ''
    if (val instanceof Date) {
        return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0]
    }
    // Excel serial date numbers
    if (typeof val === 'number' && val > 30000 && val < 80000) {
        const date = new Date((val - 25569) * 86400 * 1000)
        return date.toISOString().split('T')[0]
    }

    const s = String(val).trim()
    if (!s) return ''

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

    // YYYY/MM/DD or YYYY.MM.DD
    const ymdSlash = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/)
    if (ymdSlash) {
        return `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`
    }

    // DD-Mon-YYYY or DD/Mon/YYYY or DD Mon YYYY (e.g., 15-Jan-2024, 15 January 2024)
    const dmy = s.match(/^(\d{1,2})[-/\s]([A-Za-z]+)[-/\s](\d{4})$/)
    if (dmy) {
        const monthNum = MONTH_NAMES[dmy[2].toLowerCase()]
        if (monthNum) {
            return `${dmy[3]}-${monthNum}-${dmy[1].padStart(2, '0')}`
        }
    }

    // Mon DD, YYYY or Mon DD YYYY (e.g., Jan 15, 2024)
    const mdy = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
    if (mdy) {
        const monthNum = MONTH_NAMES[mdy[1].toLowerCase()]
        if (monthNum) {
            return `${mdy[3]}-${monthNum}-${mdy[2].padStart(2, '0')}`
        }
    }

    // Numeric: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, MM/DD/YYYY
    const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
    if (numeric) {
        const [, a, b, year] = numeric
        const ai = parseInt(a, 10)
        const bi = parseInt(b, 10)

        // If first part > 12, it must be a day (DD/MM/YYYY)
        if (ai > 12 && bi <= 12) {
            return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
        }
        // If second part > 12, it must be a day (MM/DD/YYYY)
        if (bi > 12 && ai <= 12) {
            return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`
        }
        // Ambiguous (both ≤ 12) — default to DD/MM/YYYY (international convention)
        if (ai <= 12 && bi <= 12) {
            return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
        }
    }

    return s
}

/**
 * Normalize boolean-like values to DHIS2 expected format.
 * DHIS2 BOOLEAN type expects "true" or "false".
 * DHIS2 TRUE_ONLY type expects "true" or empty.
 */
export function normalizeBoolean(val, valueType) {
    if (!val) return val
    const s = String(val).trim().toLowerCase()

    const trueValues = new Set(['true', 'yes', 'y', '1', 'oui', 'si', 'ja'])
    const falseValues = new Set(['false', 'no', 'n', '0', 'non', 'nein'])

    if (valueType === 'TRUE_ONLY') {
        return trueValues.has(s) ? 'true' : ''
    }
    if (valueType === 'BOOLEAN') {
        if (trueValues.has(s)) return 'true'
        if (falseValues.has(s)) return 'false'
    }
    return val
}

/**
 * Strip invisible unicode whitespace characters that can sneak in from
 * copy-paste operations (zero-width spaces, non-breaking spaces, etc.).
 */
export function cleanInvisibleChars(val) {
    if (typeof val !== 'string') return val
    return val
        .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '') // zero-width chars
        .replace(/\u00A0/g, ' ') // NBSP → regular space
        .trim()
}

// ---------------------------------------------------------------------------
// Level 2: Analyze data and generate cleaning suggestions
// ---------------------------------------------------------------------------

/**
 * Suggestion types returned by analyzeData.
 * Each suggestion can be accepted or rejected by the user.
 */
// { type, source, row, field, fieldLabel, original, suggested, confidence }

/**
 * Analyze parsed data against metadata to find fixable issues.
 * Returns an array of cleaning suggestions.
 *
 * Works for tracker, event, and data entry data shapes.
 */
export function analyzeData(parsedData, metadata) {
    const suggestions = []
    const orgUnits = metadata.organisationUnits ?? []
    const orgUnitIds = new Set(orgUnits.map((ou) => ou.id))
    const orgUnitNames = orgUnits.map((ou) => ou.displayName)

    const isDataEntry = !!parsedData.dataValues
    const isEvent = !!parsedData.events && !parsedData.trackedEntities
    const isTracker = !!parsedData.trackedEntities

    // Build option set lookup: { fieldId: { validCodes: Set, codeToDisplay: Map, displayNames: [] } }
    const optionIndex = buildFullOptionIndex(metadata)

    if (isTracker) {
        analyzeTrackerData(parsedData, orgUnitIds, orgUnitNames, optionIndex, metadata, suggestions)
    } else if (isEvent) {
        analyzeEventData(parsedData, orgUnitIds, orgUnitNames, optionIndex, metadata, suggestions)
    } else if (isDataEntry) {
        analyzeDataEntryData(parsedData, orgUnitIds, orgUnitNames, metadata, suggestions)
    }

    return suggestions
}

function analyzeTrackerData(parsedData, orgUnitIds, orgUnitNames, optionIndex, metadata, suggestions) {
    const { trackedEntities, stageData } = parsedData
    const stages = metadata.programStages ?? []
    const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))

    for (let i = 0; i < (trackedEntities ?? []).length; i++) {
        const tei = trackedEntities[i]
        const row = i + 2

        // Check org unit
        suggestOrgUnit(tei.orgUnit, orgUnitIds, orgUnitNames, 'TEI Sheet', row, 'ORG_UNIT_ID', suggestions)

        // Check attributes
        const attrDefs = metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []
        for (const aDef of attrDefs) {
            const tea = aDef.trackedEntityAttribute ?? aDef
            const attrId = tea.id
            const val = tei.attributes?.[attrId]
            if (!val) continue

            const label = tea.displayName ?? attrId
            suggestOptionValue(val, attrId, label, optionIndex.attrs, 'TEI Sheet', row, suggestions)
        }
    }

    for (const [stageId, events] of Object.entries(stageData ?? {})) {
        const stage = stageMap[stageId]
        if (!stage) continue
        const source = stage.displayName

        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            suggestOrgUnit(event.orgUnit, orgUnitIds, orgUnitNames, source, row, 'ORG_UNIT_ID', suggestions)

            for (const psde of stage.programStageDataElements ?? []) {
                const de = psde.dataElement ?? psde
                const val = event.dataValues?.[de.id]
                if (!val) continue

                suggestOptionValue(val, de.id, de.displayName ?? de.id, optionIndex.des, source, row, suggestions)
            }
        }
    }
}

function analyzeEventData(parsedData, orgUnitIds, orgUnitNames, optionIndex, metadata, suggestions) {
    const stages = metadata.programStages ?? []
    const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))

    for (const [stageId, events] of Object.entries(parsedData.events ?? {})) {
        const stage = stageMap[stageId]
        if (!stage) continue
        const source = stage.displayName

        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            suggestOrgUnit(event.orgUnit, orgUnitIds, orgUnitNames, source, row, 'ORG_UNIT_ID', suggestions)

            for (const psde of stage.programStageDataElements ?? []) {
                const de = psde.dataElement ?? psde
                const val = event.dataValues?.[de.id]
                if (!val) continue

                suggestOptionValue(val, de.id, de.displayName ?? de.id, optionIndex.des, source, row, suggestions)
            }
        }
    }
}

function analyzeDataEntryData(parsedData, orgUnitIds, orgUnitNames, metadata, suggestions) {
    // Build DE option set index from data set metadata
    const deOptions = {}
    for (const dse of metadata.dataSetElements ?? []) {
        const de = dse.dataElement
        if (de?.optionSet?.options?.length) {
            const codes = de.optionSet.options.map((o) => (o.code ?? '').trim())
            const displays = de.optionSet.options.map((o) => o.displayName ?? o.code ?? '')
            deOptions[de.id] = { validCodes: new Set(codes), codes, displays }
        }
    }

    for (let i = 0; i < (parsedData.dataValues ?? []).length; i++) {
        const dv = parsedData.dataValues[i]
        const row = i + 2

        suggestOrgUnit(dv.orgUnit, orgUnitIds, orgUnitNames, 'Data Entry', row, 'ORG_UNIT_ID', suggestions)

        if (dv.value && deOptions[dv.dataElement]) {
            const info = deOptions[dv.dataElement]
            if (!info.validCodes.has(dv.value)) {
                const allCandidates = [...info.codes, ...info.displays]
                const fuzzy = findClosestMatch(dv.value, allCandidates)
                if (fuzzy && fuzzy.confidence >= 50) {
                    suggestions.push({
                        type: 'option',
                        source: 'Data Entry',
                        row,
                        field: dv.dataElement,
                        fieldLabel: dv.dataElement,
                        original: dv.value,
                        suggested: fuzzy.match,
                        confidence: fuzzy.confidence,
                    })
                }
            }
        }
    }
}

/** Suggest org unit fix if unresolved. */
function suggestOrgUnit(value, orgUnitIds, orgUnitNames, source, row, field, suggestions) {
    if (!value || orgUnitIds.has(value)) return

    // Try partial match first (substring)
    const partial = findPartialMatch(value, orgUnitNames)
    if (partial) {
        suggestions.push({
            type: 'orgUnit',
            source, row, field,
            fieldLabel: 'Organisation Unit',
            original: value,
            suggested: partial,
            confidence: 75,
        })
        return
    }

    // Try fuzzy match
    const fuzzy = findClosestMatch(value, orgUnitNames)
    if (fuzzy && fuzzy.confidence >= 50) {
        suggestions.push({
            type: 'orgUnit',
            source, row, field,
            fieldLabel: 'Organisation Unit',
            original: value,
            suggested: fuzzy.match,
            confidence: fuzzy.confidence,
        })
    }
}

/** Suggest option value fix if invalid. Always suggests a CODE, not a display name. */
function suggestOptionValue(value, fieldId, fieldLabel, optionLookup, source, row, suggestions) {
    const info = optionLookup[fieldId]
    if (!info) return
    if (info.validCodes.has(value)) return

    // Fuzzy match against both codes and display names
    const allCandidates = [...info.codes, ...info.displays]
    const fuzzy = findClosestMatch(value, allCandidates)
    if (fuzzy && fuzzy.confidence >= 50) {
        // Always resolve the match back to a code — if the match was a display name,
        // convert it using the displayToCode map; if already a code, keep it.
        const suggestedCode = info.displayToCode[fuzzy.match] ?? fuzzy.match
        suggestions.push({
            type: 'option',
            source, row,
            field: fieldId,
            fieldLabel,
            original: value,
            suggested: suggestedCode,
            confidence: fuzzy.confidence,
        })
    }
}

/** Build comprehensive option index from metadata (for tracker/event programs). */
function buildFullOptionIndex(metadata) {
    const attrs = {}
    const des = {}

    const buildEntry = (optionSet) => {
        const codes = optionSet.options.map((o) => (o.code ?? '').trim())
        const displays = optionSet.options.map((o) => o.displayName ?? o.code ?? '')
        // Map every display name → its corresponding code so suggestions always resolve to codes
        const displayToCode = {}
        for (let i = 0; i < displays.length; i++) {
            displayToCode[displays[i]] = codes[i]
        }
        // Also map codes to themselves for consistent lookup
        for (const c of codes) {
            displayToCode[c] = c
        }
        return { validCodes: new Set(codes), codes, displays, displayToCode }
    }

    for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
        const tea = a.trackedEntityAttribute ?? a
        const os = tea.optionSet
        if (os?.options?.length) {
            attrs[tea.id] = buildEntry(os)
        }
    }

    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement ?? psde
            const os = de.optionSet
            if (os?.options?.length) {
                des[de.id] = buildEntry(os)
            }
        }
    }

    return { attrs, des }
}

// ---------------------------------------------------------------------------
// Level 2: Apply accepted suggestions to parsed data (mutates in place)
// ---------------------------------------------------------------------------

/**
 * Apply accepted cleaning suggestions to the parsed data.
 * Returns the modified parsedData (same reference, mutated).
 *
 * Each suggestion must have: { type, source, row, field, original, suggested, accepted }
 */
export function applySuggestions(parsedData, suggestions) {
    const accepted = suggestions.filter((s) => s.accepted)
    if (accepted.length === 0) return parsedData

    const orgUnitMap = {}
    for (const ou of accepted.filter((s) => s.type === 'orgUnit')) {
        // Build a name → name mapping; the parser's resolveOrgUnit will handle the actual UID mapping
        // But since we're post-parse, the value in parsedData is the original unresolved string.
        // We need to apply the fix directly.
    }

    const isDataEntry = !!parsedData.dataValues
    const isEvent = !!parsedData.events && !parsedData.trackedEntities
    const isTracker = !!parsedData.trackedEntities

    if (isTracker) {
        applyTrackerSuggestions(parsedData, accepted)
    } else if (isEvent) {
        applyEventSuggestions(parsedData, accepted)
    } else if (isDataEntry) {
        applyDataEntrySuggestions(parsedData, accepted)
    }

    return parsedData
}

function applyTrackerSuggestions(parsedData, accepted) {
    const { trackedEntities, stageData } = parsedData

    for (const s of accepted) {
        const rowIdx = s.row - 2 // Convert back from 1-indexed+header to array index

        if (s.source === 'TEI Sheet') {
            const tei = trackedEntities?.[rowIdx]
            if (!tei) continue

            if (s.type === 'orgUnit') {
                tei.orgUnit = s.suggested
            } else if (s.type === 'option' && tei.attributes) {
                if (tei.attributes[s.field] === s.original) {
                    tei.attributes[s.field] = s.suggested
                }
            }
        } else {
            // Stage data — find the stage by display name
            for (const [stageId, events] of Object.entries(stageData ?? {})) {
                // s.source is stage.displayName; we iterate to find it
                const event = events?.[rowIdx]
                if (!event) continue

                if (s.type === 'orgUnit') {
                    if (event.orgUnit === s.original) event.orgUnit = s.suggested
                } else if (s.type === 'option' && event.dataValues) {
                    if (event.dataValues[s.field] === s.original) {
                        event.dataValues[s.field] = s.suggested
                    }
                }
            }
        }
    }
}

function applyEventSuggestions(parsedData, accepted) {
    for (const s of accepted) {
        const rowIdx = s.row - 2
        for (const [stageId, events] of Object.entries(parsedData.events ?? {})) {
            const event = events?.[rowIdx]
            if (!event) continue

            if (s.type === 'orgUnit') {
                if (event.orgUnit === s.original) event.orgUnit = s.suggested
            } else if (s.type === 'option' && event.dataValues) {
                if (event.dataValues[s.field] === s.original) {
                    event.dataValues[s.field] = s.suggested
                }
            }
        }
    }
}

function applyDataEntrySuggestions(parsedData, accepted) {
    for (const s of accepted) {
        const rowIdx = s.row - 2
        const dv = parsedData.dataValues?.[rowIdx]
        if (!dv) continue

        if (s.type === 'orgUnit') {
            if (dv.orgUnit === s.original) dv.orgUnit = s.suggested
        } else if (s.type === 'option') {
            if (dv.value === s.original) dv.value = s.suggested
        }
    }
}

// ---------------------------------------------------------------------------
// Level 3: Post-import error analysis
// ---------------------------------------------------------------------------

/**
 * Known DHIS2 tracker error codes and whether they're fixable client-side.
 */
const ERROR_FIXES = {
    E1076: { fixable: true, type: 'orgUnit', label: 'Org unit not found' },
    E1049: { fixable: true, type: 'orgUnit', label: 'Org unit not in search scope' },
    E4030: { fixable: true, type: 'option', label: 'Invalid option value' },
    E1085: { fixable: true, type: 'option', label: 'Attribute value not valid for option set' },
    E1125: { fixable: true, type: 'option', label: 'Data value not valid for option set' },
    E1039: { fixable: false, type: 'duplicate', label: 'Non-repeatable stage already has event' },
    E1063: { fixable: true, type: 'date', label: 'Invalid date format' },
    E1043: { fixable: true, type: 'missing', label: 'Mandatory attribute missing' },
}

/**
 * Analyze DHIS2 import errors and categorize them as fixable or not.
 *
 * @param {Array} errors - Mapped errors from ImportProgress (errorCode, message, uid, excelRow, etc.)
 * @param {Object} metadata - Program metadata
 * @returns {{ fixable: Array, unfixable: Array, summary: Object }}
 */
export function analyzeImportErrors(errors, metadata) {
    const fixable = []
    const unfixable = []
    const summary = { totalErrors: errors.length, fixableCount: 0, unfixableCount: 0 }

    for (const err of errors) {
        const codeDef = ERROR_FIXES[err.errorCode]
        if (codeDef?.fixable) {
            fixable.push({
                ...err,
                fixType: codeDef.type,
                fixLabel: codeDef.label,
                suggestion: extractSuggestionFromError(err, metadata),
            })
            summary.fixableCount++
        } else {
            unfixable.push(err)
            summary.unfixableCount++
        }
    }

    return { fixable, unfixable, summary }
}

/**
 * Try to extract a fixing suggestion from the error message.
 * DHIS2 error messages often contain the invalid value in quotes.
 */
function extractSuggestionFromError(err, metadata) {
    const msg = err.message ?? ''

    // Extract value in backticks or quotes from error message
    const valueMatch = msg.match(/`([^`]+)`/) || msg.match(/"([^"]+)"/) || msg.match(/'([^']+)'/)
    if (!valueMatch) return null

    const invalidValue = valueMatch[1]

    if (err.fixType === 'orgUnit') {
        const orgUnitNames = (metadata.organisationUnits ?? []).map((ou) => ou.displayName)
        const fuzzy = findClosestMatch(invalidValue, orgUnitNames)
        return fuzzy ? { value: fuzzy.match, confidence: fuzzy.confidence } : null
    }

    if (err.fixType === 'option') {
        // Build an index of all option codes + display names across attributes and data elements
        const optionIndex = buildFullOptionIndex(metadata)
        const allEntries = { ...optionIndex.attrs, ...optionIndex.des }
        for (const info of Object.values(allEntries)) {
            const allCandidates = [...info.codes, ...info.displays]
            const fuzzy = findClosestMatch(invalidValue, allCandidates)
            if (fuzzy && fuzzy.confidence >= 50) {
                // Always resolve to a code
                const code = info.displayToCode[fuzzy.match] ?? fuzzy.match
                return { value: code, confidence: fuzzy.confidence }
            }
        }
    }

    return null
}

// ---------------------------------------------------------------------------
// Exports for use in fileParser.js (Level 1 helpers)
// ---------------------------------------------------------------------------
export { levenshtein, findClosestMatch, findPartialMatch }
