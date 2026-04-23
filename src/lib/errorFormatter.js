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
