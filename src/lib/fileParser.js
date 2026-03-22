import * as XLSX from 'xlsx'

/**
 * Parse an uploaded Excel file into structured data keyed by TEI_ID.
 * Returns:
 *   {
 *     trackedEntities: [ { teiId, orgUnit, enrollmentDate, incidentDate, attributes: { attrId: value } } ],
 *     stageData: { stageId: [ { teiId, eventDate, orgUnit, dataValues: { deId: value } } ] }
 *   }
 */
export async function parseUploadedFile(file, metadata) {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

    const result = {
        trackedEntities: [],
        stageData: {},
    }

    // Parse TEI + Enrollment sheet
    const teiSheet = wb.Sheets['TEI + Enrollment']
    if (!teiSheet) {
        throw new Error('Missing "TEI + Enrollment" sheet in the uploaded file.')
    }

    const teiRows = XLSX.utils.sheet_to_json(teiSheet, { defval: '' })
    const attrColumns = extractIdColumns(Object.keys(teiRows[0] ?? {}))

    for (const row of teiRows) {
        const teiId = String(row['TEI_ID'] ?? '').trim()
        if (!teiId) continue

        const attributes = {}
        for (const [col, attrId] of Object.entries(attrColumns)) {
            const val = row[col]
            if (val !== '' && val != null) {
                attributes[attrId] = formatValue(val)
            }
        }

        result.trackedEntities.push({
            teiId,
            orgUnit: String(row['ORG_UNIT_ID'] ?? '').trim(),
            enrollmentDate: formatDate(row['ENROLLMENT_DATE']),
            incidentDate: formatDate(row['INCIDENT_DATE']),
            attributes,
        })
    }

    // Parse stage sheets
    const stages = metadata.programStages ?? []
    for (const stage of stages) {
        // Find matching sheet — try exact name match first, then prefix
        const sheetName = findStageSheet(wb.SheetNames, stage.displayName)
        if (!sheetName) continue

        const stageSheet = wb.Sheets[sheetName]
        const stageRows = XLSX.utils.sheet_to_json(stageSheet, { defval: '' })
        if (stageRows.length === 0) continue

        const deColumns = extractIdColumns(Object.keys(stageRows[0]))
        const events = []

        for (const row of stageRows) {
            const teiId = String(row['TEI_ID'] ?? '').trim()
            if (!teiId) continue

            const dataValues = {}
            for (const [col, deId] of Object.entries(deColumns)) {
                const val = row[col]
                if (val !== '' && val != null) {
                    dataValues[deId] = formatValue(val)
                }
            }

            events.push({
                teiId,
                eventDate: formatDate(row['EVENT_DATE']),
                orgUnit: String(row['ORG_UNIT_ID'] ?? '').trim(),
                dataValues,
            })
        }

        result.stageData[stage.id] = events
    }

    return result
}

/**
 * Extract DHIS2 IDs from column headers matching pattern: "Name [uid]"
 * Returns { "Full Column Name [uid]": "uid" }
 */
function extractIdColumns(headers) {
    const map = {}
    const idPattern = /\[([A-Za-z0-9]{11})\]\s*$/
    for (const h of headers) {
        const match = h.match(idPattern)
        if (match) {
            map[h] = match[1]
        }
    }
    return map
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
    if (!val) return ''
    if (val instanceof Date) {
        return val.toISOString().split('T')[0]
    }
    return String(val).trim()
}

function formatValue(val) {
    if (val instanceof Date) {
        return val.toISOString().split('T')[0]
    }
    return String(val).trim()
}
