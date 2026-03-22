/**
 * Validate parsed data against program metadata before import.
 * Returns { errors: string[], warnings: string[] }
 */
export function validateParsedData(parsedData, metadata) {
    const errors = []
    const warnings = []

    const { trackedEntities, stageData } = parsedData
    const stages = metadata.programStages ?? []
    const stageMap = Object.fromEntries(stages.map((s) => [s.id, s]))

    // Validate TEIs
    if (!trackedEntities || trackedEntities.length === 0) {
        errors.push('No tracked entities found in the uploaded file.')
        return { errors, warnings }
    }

    const teiIds = new Set()
    for (let i = 0; i < trackedEntities.length; i++) {
        const tei = trackedEntities[i]
        const row = i + 2 // 1-indexed + header row

        if (!tei.teiId) {
            errors.push(`TEI sheet row ${row}: TEI_ID is missing.`)
            continue
        }

        if (teiIds.has(tei.teiId)) {
            errors.push(`TEI sheet row ${row}: Duplicate TEI_ID "${tei.teiId}".`)
        }
        teiIds.add(tei.teiId)

        if (!tei.orgUnit) {
            errors.push(`TEI sheet row ${row}: ORG_UNIT_ID is missing for TEI "${tei.teiId}".`)
        }

        if (!tei.enrollmentDate) {
            errors.push(`TEI sheet row ${row}: ENROLLMENT_DATE is missing for TEI "${tei.teiId}".`)
        }

        // Validate mandatory attributes
        const requiredAttrs =
            metadata.trackedEntityType?.trackedEntityTypeAttributes
                ?.filter((a) => a.mandatory)
                ?.map((a) => ({
                    id: a.trackedEntityAttribute?.id ?? a.id,
                    name: a.trackedEntityAttribute?.displayName ?? a.displayName,
                })) ?? []

        for (const attr of requiredAttrs) {
            if (!tei.attributes[attr.id]) {
                errors.push(
                    `TEI sheet row ${row}: Mandatory attribute "${attr.name}" is missing for TEI "${tei.teiId}".`
                )
            }
        }
    }

    // Validate stage data
    for (const [stageId, events] of Object.entries(stageData ?? {})) {
        const stage = stageMap[stageId]
        if (!stage) {
            warnings.push(`Data found for unknown stage ID "${stageId}". It will be ignored.`)
            continue
        }

        // Check non-repeatable stages for duplicate TEI_IDs
        if (!stage.repeatable) {
            const stageTeiIds = new Set()
            for (let i = 0; i < events.length; i++) {
                const event = events[i]
                if (stageTeiIds.has(event.teiId)) {
                    errors.push(
                        `Stage "${stage.displayName}" row ${i + 2}: Duplicate TEI_ID "${event.teiId}". ` +
                            'This stage is NOT repeatable — only one event per tracked entity is allowed.'
                    )
                }
                stageTeiIds.add(event.teiId)
            }
        }

        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const row = i + 2

            if (!event.teiId) {
                errors.push(`Stage "${stage.displayName}" row ${row}: TEI_ID is missing.`)
                continue
            }

            if (!teiIds.has(event.teiId)) {
                errors.push(
                    `Stage "${stage.displayName}" row ${row}: TEI_ID "${event.teiId}" not found in TEI sheet.`
                )
            }

            if (!event.eventDate) {
                errors.push(
                    `Stage "${stage.displayName}" row ${row}: EVENT_DATE is missing for TEI "${event.teiId}".`
                )
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
                    errors.push(
                        `Stage "${stage.displayName}" row ${row}: Mandatory data element "${de.name}" is missing.`
                    )
                }
            }
        }
    }

    // Warning for stages with no data
    for (const stage of stages) {
        if (!stageData?.[stage.id] || stageData[stage.id].length === 0) {
            warnings.push(`No data provided for stage "${stage.displayName}".`)
        }
    }

    return { errors, warnings }
}
