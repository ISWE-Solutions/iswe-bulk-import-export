import * as XLSX from 'xlsx'

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

    // --- Instructions sheet ---
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
        ['7. For option-set fields, use the CODE from the Validation sheet.'],
        ['8. TEI_ID is a local identifier you assign to link rows across sheets. It is NOT sent to DHIS2.'],
        [],
        ['Column Types:'],
        ['  TEXT — free text'],
        ['  NUMBER — numeric value'],
        ['  INTEGER — whole number'],
        ['  DATE — YYYY-MM-DD'],
        ['  BOOLEAN — true / false'],
        ['  OPTION_SET — use code from Validation sheet'],
    ]
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions)
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions')

    // --- TEI + Enrollment sheet ---
    const teiHeaders = ['TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE', 'INCIDENT_DATE']
    const teiAttributes =
        metadata.trackedEntityType?.trackedEntityTypeAttributes?.map((a) => ({
            id: a.trackedEntityAttribute?.id ?? a.id,
            name: a.trackedEntityAttribute?.displayName ?? a.displayName,
            mandatory: a.mandatory,
            valueType: a.trackedEntityAttribute?.valueType ?? a.valueType,
        })) ?? []

    for (const attr of teiAttributes) {
        const required = attr.mandatory ? ' *' : ''
        teiHeaders.push(`${attr.name}${required} [${attr.id}]`)
    }

    const wsTei = XLSX.utils.aoa_to_sheet([teiHeaders])
    XLSX.utils.book_append_sheet(wb, wsTei, 'TEI + Enrollment')

    // --- Stage sheets ---
    const stages = [...(metadata.programStages ?? [])].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    )

    for (const stage of stages) {
        const label = stage.repeatable ? '(repeatable)' : '(single)'
        const headers = ['TEI_ID', 'EVENT_DATE', 'ORG_UNIT_ID']

        const dataElements =
            stage.programStageDataElements?.map((psde) => ({
                id: psde.dataElement?.id ?? psde.id,
                name: psde.dataElement?.displayName ?? psde.displayName,
                compulsory: psde.compulsory,
                valueType: psde.dataElement?.valueType,
            })) ?? []

        for (const de of dataElements) {
            const required = de.compulsory ? ' *' : ''
            headers.push(`${de.name}${required} [${de.id}]`)
        }

        const wsStage = XLSX.utils.aoa_to_sheet([headers])
        // Truncate sheet name to 31 chars (Excel limit)
        const sheetName = `${stage.displayName} ${label}`.slice(0, 31)
        XLSX.utils.book_append_sheet(wb, wsStage, sheetName)
    }

    // --- Validation sheet (option sets) ---
    const optionSets = collectOptionSets(metadata)
    if (optionSets.length > 0) {
        const maxRows = Math.max(...optionSets.map((os) => os.options.length))
        const valHeaders = []
        const valData = []

        for (const os of optionSets) {
            valHeaders.push(`${os.name} [code]`, `${os.name} [display]`)
        }

        for (let i = 0; i < maxRows; i++) {
            const row = []
            for (const os of optionSets) {
                if (i < os.options.length) {
                    row.push(os.options[i].code, os.options[i].displayName)
                } else {
                    row.push('', '')
                }
            }
            valData.push(row)
        }

        const wsValidation = XLSX.utils.aoa_to_sheet([valHeaders, ...valData])
        XLSX.utils.book_append_sheet(wb, wsValidation, 'Validation')
    }

    return wb
}

function collectOptionSets(metadata) {
    const seen = new Set()
    const result = []

    const check = (optionSet) => {
        if (optionSet && !seen.has(optionSet.id)) {
            seen.add(optionSet.id)
            result.push({
                id: optionSet.id,
                name: optionSet.id,
                options: optionSet.options ?? [],
            })
        }
    }

    // From tracked entity attributes
    for (const a of metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
        check(a.trackedEntityAttribute?.optionSet)
    }

    // From data elements in stages
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            check(psde.dataElement?.optionSet)
        }
    }

    return result
}
