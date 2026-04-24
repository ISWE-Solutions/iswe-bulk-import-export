/**
 * Shared helpers for surfacing import/export errors in a structured, copy-able,
 * and downloadable way across all flows (tracker, event, data entry, metadata, geo, export).
 *
 * Each helper returns plain-data structures so components can render them in a DataTable
 * and also download them as CSV.
 */

/**
 * Extract structured error rows from a DHIS2 /api/metadata import response.
 *
 * Response shape (v2.40+):
 *   {
 *     typeReports: [{
 *       klass: 'org.hisp.dhis.organisationunit.OrganisationUnit',
 *       stats: {...},
 *       objectReports: [{
 *         klass, uid, index, displayName?,
 *         errorReports: [{ errorCode, message, mainKlass, errorProperty?, errorProperties?, value? }]
 *       }]
 *     }]
 *   }
 *
 * @param {object} response
 * @returns {Array<{errorCode, objectType, objectId, objectName, property, value, message}>}
 */
export function extractMetadataErrors(response) {
    const out = []
    const typeReports =
        response?.typeReports ?? response?.response?.typeReports ?? []

    for (const tr of typeReports) {
        const objectType = classToType(tr.klass)
        for (const or of tr.objectReports ?? []) {
            const objectId = or.uid || or.id || ''
            const objectName = or.displayName || or.name || ''
            const index = or.index
            for (const er of or.errorReports ?? []) {
                out.push({
                    errorCode: er.errorCode || '',
                    objectType,
                    objectId,
                    objectName: objectName || (index != null ? `row ${index}` : ''),
                    property: er.errorProperty || (er.errorProperties?.[0] ?? ''),
                    value: er.value != null ? String(er.value) : '',
                    message: er.message || '',
                })
            }
        }
        // Also surface top-level errorReports (rare but happens with bundle validation)
        for (const er of tr.errorReports ?? []) {
            out.push({
                errorCode: er.errorCode || '',
                objectType,
                objectId: '',
                objectName: '',
                property: er.errorProperty || '',
                value: er.value != null ? String(er.value) : '',
                message: er.message || '',
            })
        }
    }
    return out
}

/**
 * Extract a short object-type label from a fully-qualified DHIS2 Java class name.
 * e.g. 'org.hisp.dhis.dataelement.DataElement' -> 'DataElement'
 */
function classToType(klass) {
    if (!klass) return ''
    const parts = String(klass).split('.')
    return parts[parts.length - 1] || klass
}

/**
 * Format a thrown error from engine.mutate / engine.query into a human-readable
 * structured object, extracting DHIS2-specific fields where available.
 *
 * The app-runtime wraps HTTP errors so the original response body is usually on
 * err.details (DHIS2 importReport-style) or err.response.
 *
 * @param {Error|object} err
 * @param {string} [context] short label of what was running (e.g. 'Submitting batch 3')
 * @returns {{title, httpStatus, errorCode, message, details, context}}
 */
export function formatApiException(err, context = '') {
    const resp = err?.details ?? err?.response ?? {}
    const httpStatus = resp.httpStatusCode || resp.status || err?.httpStatusCode || ''
    const errorCode = resp.errorCode || err?.errorCode || ''
    const message =
        resp.message || err?.message || 'Unknown error'

    let title = 'Request failed'
    if (httpStatus === 401 || httpStatus === 403) title = 'Not authorised'
    else if (httpStatus === 404) title = 'Not found'
    else if (httpStatus === 409) title = 'Conflict'
    else if (httpStatus >= 500) title = 'Server error'
    else if (httpStatus >= 400) title = 'Bad request'

    return {
        title,
        httpStatus: httpStatus ? String(httpStatus) : '',
        errorCode: errorCode ? String(errorCode) : '',
        message,
        details: resp,
        context,
    }
}

/**
 * Produce a CSV string from an array of column definitions and row objects.
 * Safely quotes any cell containing commas, quotes, or newlines.
 *
 * @param {Array<{key, label}>} columns
 * @param {Array<object>} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
    const esc = (v) => {
        const s = v == null ? '' : String(v)
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
        return s
    }
    const header = columns.map((c) => esc(c.label)).join(',')
    const body = rows.map((r) =>
        columns.map((c) => esc(r[c.key])).join(',')
    )
    return [header, ...body].join('\n')
}

/**
 * Trigger a download of the given text content as a file in the browser.
 *
 * @param {string} content
 * @param {string} filename
 * @param {string} [mime='text/csv;charset=utf-8']
 */
export function downloadTextFile(content, filename, mime = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type: mime })
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
 * Group error rows by errorCode for the UI filter. Returns a sorted array
 * of { code, count } descending by count, plus an 'ALL' bucket.
 *
 * @param {Array<{errorCode: string}>} errors
 * @returns {Array<{code: string, count: number}>}
 */
export function groupErrorCodes(errors) {
    const counts = new Map()
    for (const e of errors) {
        const code = e.errorCode || 'UNKNOWN'
        counts.set(code, (counts.get(code) || 0) + 1)
    }
    const groups = Array.from(counts.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
    return [{ code: 'ALL', count: errors.length }, ...groups]
}

/**
 * Actionable hints for the common DHIS2 tracker / aggregate / metadata error codes.
 * Keep these short — they render inline beside the raw server message.
 */
const ERROR_HINTS = {
    E1000: 'Authentication or session problem. Log out and back in, then retry.',
    E1005: 'Tracked-entity type is missing or not accessible to this user.',
    E1007: 'Value does not match the attribute or data-element type. Common cause: numeric fields with leading zeros (e.g. "0007") or stray spaces. Remove leading zeros, or ask the admin to change the value type to TEXT if the leading zero is meaningful.',
    E1019: 'Enrollment date is missing. Each TEI needs an ENROLLMENT_DATE.',
    E1020: 'Enrollment date is in the future. DHIS2 rejects future enrollment dates.',
    E1021: 'Incident date is in the future.',
    E1041: 'Missing org unit. Every TEI, enrollment, and event must reference a valid ORG_UNIT_ID the user has access to.',
    E1048: 'Generic tracker validation error — see message for specifics.',
    E1055: 'Only one enrollment is allowed per program for this TEI (program is non-repeatable).',
    E1063: 'TEI already exists with this UID. Either update instead of create, or use a different UID.',
    E1064: 'This value already exists on the server for a "unique" attribute. Fix: (a) dedupe duplicates within your Excel file, (b) delete the existing TEI on the server, or (c) switch to an update flow instead of create.',
    E1076: 'Attribute is missing a mandatory value. Check your template for missing cells.',
    E1083: 'User is not allowed to assign this value.',
    E1084: 'Date format invalid. Use YYYY-MM-DD.',
    E1085: 'Attribute value does not match its configured type (duplicate of E1007 from a second validator phase). Same fix as E1007.',
    E1089: 'Enrollment references a program not allowed for this org unit.',
    E1103: 'Event date is in the future and the program stage does not allow that.',
    E1125: 'Value is not a valid option in the attribute or data-element option set. Check exact spelling or use the option code.',
    E1300: 'Program rule violation — value conflicts with a rule set on the program.',
    E1302: 'Program rule ASSIGN action is conflicting with an explicit value you supplied.',
    E1309: 'The app sent a value for an attribute/data-element that is assigned by a program rule. The value was ignored to avoid a conflict.',
    E5000: 'Cascade failure — this enrollment or event was skipped because its parent TEI could not be created. Fix the parent error (shown above for the same Excel row) and this one will disappear.',
    E7600: 'Category-option-combo is not valid for this data element.',
}

/**
 * Human-readable hint for a DHIS2 error code. Returns '' if we have no mapping.
 */
export function getErrorHint(errorCode) {
    if (!errorCode) return ''
    return ERROR_HINTS[errorCode] || ''
}

/**
 * Detect whether an error is a pure cascade failure (child rejected solely because
 * its parent was rejected). These are noise — the real problem is on the parent row.
 *
 * DHIS2 surfaces these with errorCode "E5000" and a message that explicitly states
 * the dependency could not be created. We also match on the message pattern as a
 * safety net for versions that reuse the code for other conditions.
 */
export function isCascadeError(err) {
    if (!err) return false
    if (err.errorCode === 'E5000') return true
    const msg = String(err.message || '')
    return /cannot be (?:created|updated|deleted) because/i.test(msg)
        && /(?:trackedEntity|enrollment|event)\s+`[^`]+`/i.test(msg)
}

/**
 * Summarise errors by code for a compact "what went wrong" panel.
 * Returns rows of { code, count, hint, example } sorted by count desc.
 *
 * example is one representative server message per code (first encountered).
 */
export function summarizeErrors(errors) {
    const byCode = new Map()
    for (const e of errors) {
        const code = e.errorCode || 'UNKNOWN'
        if (!byCode.has(code)) {
            byCode.set(code, { code, count: 0, hint: getErrorHint(code), example: e.message || '' })
        }
        byCode.get(code).count += 1
    }
    return Array.from(byCode.values()).sort((a, b) => b.count - a.count)
}
