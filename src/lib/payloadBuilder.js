/**
 * Build a DHIS2 Tracker API payload (nested format) from parsed spreadsheet data.
 *
 * The nested format groups everything under trackedEntities:
 *   trackedEntities -> enrollments -> events
 *
 * Repeatable stages: multiple events with different eventDate per TEI.
 * Non-repeatable stages: exactly one event per TEI.
 *
 * Generates UIDs client-side to allow cross-referencing within the payload.
 */
export function buildTrackerPayload(parsedData, metadata) {
    const { trackedEntities, stageData } = parsedData
    const programId = metadata.id
    const trackedEntityTypeId = metadata.trackedEntityType?.id

    const payload = {
        trackedEntities: [],
    }

    for (const tei of trackedEntities) {
        const trackedEntity = {
            trackedEntityType: trackedEntityTypeId,
            orgUnit: tei.orgUnit,
            attributes: Object.entries(tei.attributes).map(([attribute, value]) => ({
                attribute,
                value,
            })),
            enrollments: [
                {
                    program: programId,
                    orgUnit: tei.orgUnit,
                    enrolledAt: tei.enrollmentDate,
                    occurredAt: tei.incidentDate || tei.enrollmentDate,
                    events: buildEventsForTei(tei.teiId, metadata.programStages, stageData),
                },
            ],
        }

        payload.trackedEntities.push(trackedEntity)
    }

    return payload
}

/**
 * Collect all events for a given TEI across all program stages.
 */
function buildEventsForTei(teiId, programStages, stageData) {
    const events = []

    for (const stage of programStages ?? []) {
        const stageEvents = stageData?.[stage.id] ?? []
        const teiEvents = stageEvents.filter((e) => e.teiId === teiId)

        for (const event of teiEvents) {
            events.push({
                programStage: stage.id,
                orgUnit: event.orgUnit || undefined,
                occurredAt: event.eventDate,
                status: 'COMPLETED',
                dataValues: Object.entries(event.dataValues).map(([dataElement, value]) => ({
                    dataElement,
                    value,
                })),
            })
        }
    }

    return events
}
