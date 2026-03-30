/**
 * Build a DHIS2 Tracker API payload (nested format) from parsed spreadsheet data.
 *
 * The nested format groups everything under trackedEntities:
 *   trackedEntities -> enrollments -> events
 *
 * Repeatable stages: multiple events with different eventDate per TEI.
 * Non-repeatable stages: exactly one event per TEI.
 *
 * Generates client-side UIDs so DHIS2 error reports can be traced back to
 * source Excel rows via the returned rowMap (uid → row info).
 *
 * Returns { payload, rowMap } where rowMap is { [uid]: { excelRow, teiId, type, stageName? } }
 */
export function buildTrackerPayload(parsedData, metadata) {
    const { trackedEntities, stageData } = parsedData
    const programId = metadata.id
    const trackedEntityTypeId = metadata.trackedEntityType?.id
    const skipAttrs = new Set(metadata.assignedAttributes ?? [])
    const skipDEs = new Set(metadata.assignedDataElements ?? [])

    const payload = { trackedEntities: [] }
    // uid → { excelRow, teiId, type, stageName? }
    const rowMap = {}

    for (let teiIdx = 0; teiIdx < trackedEntities.length; teiIdx++) {
        const tei = trackedEntities[teiIdx]
        const teUid = generateUid()
        const enrUid = generateUid()
        const excelRow = teiIdx + 2 // 1-indexed + header row

        rowMap[teUid] = { excelRow, teiId: tei.teiId, type: 'TRACKED_ENTITY' }
        rowMap[enrUid] = { excelRow, teiId: tei.teiId, type: 'ENROLLMENT' }

        const { events, eventRowEntries } = buildEventsForTei(
            tei.teiId,
            tei.orgUnit,
            metadata.programStages,
            stageData,
            skipDEs
        )

        for (const [uid, info] of eventRowEntries) {
            rowMap[uid] = info
        }

        const trackedEntity = {
            trackedEntity: teUid,
            trackedEntityType: trackedEntityTypeId,
            orgUnit: tei.orgUnit,
            attributes: Object.entries(tei.attributes)
                .filter(([attribute]) => !skipAttrs.has(attribute))
                .map(([attribute, value]) => ({
                    attribute,
                    value,
                })),
            enrollments: [
                {
                    enrollment: enrUid,
                    program: programId,
                    orgUnit: tei.orgUnit,
                    enrolledAt: tei.enrollmentDate,
                    occurredAt: tei.incidentDate || tei.enrollmentDate,
                    events,
                },
            ],
        }

        payload.trackedEntities.push(trackedEntity)
    }

    return { payload, rowMap }
}

/**
 * Collect all events for a given TEI across all program stages.
 * Falls back to the TEI's orgUnit when an event has no explicit orgUnit.
 * Skips events without an occurredAt date (DHIS2 requires it).
 * Excludes data elements assigned by program rules.
 *
 * Returns { events, eventRowEntries } where eventRowEntries are [uid, info] pairs.
 */
function buildEventsForTei(teiId, teiOrgUnit, programStages, stageData, skipDEs) {
    const events = []
    const eventRowEntries = []

    for (const stage of programStages ?? []) {
        const stageEvents = stageData?.[stage.id]
        if (!stageEvents || stageEvents.length === 0) continue

        for (let i = 0; i < stageEvents.length; i++) {
            const event = stageEvents[i]
            if (event.teiId !== teiId) continue
            // Skip events without a date — DHIS2 requires occurredAt
            if (!event.eventDate) continue

            const dataValues = Object.entries(event.dataValues)
                .filter(([dataElement]) => !skipDEs.has(dataElement))
                .map(([dataElement, value]) => ({ dataElement, value }))

            // Skip events with no data values after filtering
            if (dataValues.length === 0) continue

            const evtUid = generateUid()

            events.push({
                event: evtUid,
                programStage: stage.id,
                orgUnit: event.orgUnit || teiOrgUnit,
                occurredAt: event.eventDate,
                status: 'COMPLETED',
                dataValues,
            })

            eventRowEntries.push([evtUid, {
                excelRow: i + 2, // 1-indexed + header row
                teiId: event.teiId,
                type: 'EVENT',
                stageId: stage.id,
                stageName: stage.displayName,
            }])
        }
    }

    return { events, eventRowEntries }
}

/**
 * Generate a valid DHIS2 UID (11 chars, first char a letter, rest alphanumeric).
 */
const UID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const UID_ALL = UID_CHARS + '0123456789'

function generateUid() {
    let uid = UID_CHARS.charAt(Math.floor(Math.random() * UID_CHARS.length))
    for (let i = 1; i < 11; i++) {
        uid += UID_ALL.charAt(Math.floor(Math.random() * UID_ALL.length))
    }
    return uid
}

/**
 * Build a DHIS2 Tracker API payload for event programs (WITHOUT_REGISTRATION).
 *
 * Event programs use a flat events array:
 *   { events: [{ program, orgUnit, occurredAt, dataValues }] }
 *
 * Returns { payload, rowMap } where rowMap maps UIDs to Excel rows.
 */
export function buildEventPayload(parsedData, metadata) {
    const programId = metadata.id
    const skipDEs = new Set(metadata.assignedDataElements ?? [])
    const payload = { events: [] }
    const rowMap = {}

    for (const stage of metadata.programStages ?? []) {
        const stageEvents = parsedData.events?.[stage.id]
        if (!stageEvents || stageEvents.length === 0) continue

        for (let i = 0; i < stageEvents.length; i++) {
            const event = stageEvents[i]
            if (!event.eventDate) continue

            const evtUid = generateUid()
            const excelRow = i + 2

            const dataValues = Object.entries(event.dataValues)
                .filter(([dataElement]) => !skipDEs.has(dataElement))
                .map(([dataElement, value]) => ({ dataElement, value }))

            if (dataValues.length === 0) continue

            payload.events.push({
                event: evtUid,
                program: programId,
                programStage: stage.id,
                orgUnit: event.orgUnit,
                occurredAt: event.eventDate,
                status: 'COMPLETED',
                dataValues,
            })

            rowMap[evtUid] = {
                excelRow,
                type: 'EVENT',
                stageId: stage.id,
                stageName: stage.displayName,
            }
        }
    }

    return { payload, rowMap }
}

/**
 * Build a DHIS2 dataValueSets payload from parsed data entry data.
 *
 * parsedData: { dataValues: [{ orgUnit, period, dataElement, categoryOptionCombo, value }] }
 *
 * Returns { payload, rowMap } where payload is { dataValues: [...] }
 * and rowMap maps index → { excelRow } for error tracing.
 *
 * The dataValueSets API uses a flat format:
 *   { dataValues: [{ dataElement, period, orgUnit, categoryOptionCombo, value }] }
 */
export function buildDataEntryPayload(parsedData) {
    const payload = { dataValues: [] }
    const rowMap = {}

    for (let i = 0; i < (parsedData.dataValues ?? []).length; i++) {
        const dv = parsedData.dataValues[i]
        const excelRow = i + 2

        const entry = {
            dataElement: dv.dataElement,
            period: dv.period,
            orgUnit: dv.orgUnit,
            value: dv.value,
        }

        if (dv.categoryOptionCombo) {
            entry.categoryOptionCombo = dv.categoryOptionCombo
        }

        payload.dataValues.push(entry)
        rowMap[i] = { excelRow, type: 'DATA_VALUE' }
    }

    return { payload, rowMap }
}
