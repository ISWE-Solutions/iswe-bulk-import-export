import { useState, useCallback } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'

/**
 * Fetch existing tracked entities with enrollments and events for a program,
 * to pre-populate the template with sample data.
 *
 * Uses the /api/tracker/trackedEntities endpoint (v2.40+).
 * Paginates automatically to collect all results up to a limit.
 */
export const useSampleData = (programId) => {
    const engine = useDataEngine()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [data, setData] = useState(null)

    const fetchSampleData = useCallback(
        async ({ startDate, endDate, maxTeis = 50 } = {}) => {
            setLoading(true)
            setError(null)
            setData(null)

            try {
                const params = {
                    program: programId,
                    fields: 'trackedEntity,orgUnit,attributes[attribute,value],enrollments[enrollment,enrolledAt,occurredAt,events[event,programStage,orgUnit,occurredAt,status,dataValues[dataElement,value]]]',
                    pageSize: Math.min(maxTeis, 50),
                    order: 'createdAt:desc',
                    ouMode: 'ACCESSIBLE',
                }

                if (startDate) params.enrolledAfter = startDate
                if (endDate) params.enrolledBefore = endDate

                const allEntities = []
                let page = 1
                let hasMore = true

                while (hasMore && allEntities.length < maxTeis) {
                    const result = await engine.query({
                        teis: {
                            resource: 'tracker/trackedEntities',
                            params: { ...params, page },
                        },
                    })

                    // DHIS2 2.40–2.41: { trackedEntities: […] }; 2.42+: { instances: […] }
                    const envelope = result?.teis ?? {}
                    const items = envelope.trackedEntities ?? envelope.instances ?? []
                    allEntities.push(...items)

                    if (items.length < params.pageSize || allEntities.length >= maxTeis) {
                        hasMore = false
                    } else {
                        page++
                    }
                }

                const trimmed = allEntities.slice(0, maxTeis)
                setData(trimmed)
                return trimmed
            } catch (e) {
                setError(e.message || 'Failed to fetch sample data')
                return null
            } finally {
                setLoading(false)
            }
        },
        [engine, programId]
    )

    return { fetchSampleData, data, loading, error }
}

/**
 * Fetch existing events (for event-only programs) to pre-populate an event template.
 * Uses /api/tracker/events with ouMode=ACCESSIBLE to sample across all accessible OUs.
 *
 * Returns a flat array of events; the template populator groups them per stage.
 */
export const useEventSampleData = (programId) => {
    const engine = useDataEngine()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const fetchEventSample = useCallback(
        async ({ startDate, endDate, maxEvents = 100 } = {}) => {
            setLoading(true)
            setError(null)
            try {
                const pageSize = Math.min(maxEvents, 50)
                const params = {
                    program: programId,
                    fields: 'event,programStage,orgUnit,occurredAt,dataValues[dataElement,value]',
                    pageSize,
                    order: 'occurredAt:desc',
                    ouMode: 'ACCESSIBLE',
                }
                if (startDate) params.occurredAfter = startDate
                if (endDate) params.occurredBefore = endDate

                const all = []
                let page = 1
                while (all.length < maxEvents) {
                    const result = await engine.query({
                        evts: {
                            resource: 'tracker/events',
                            params: { ...params, page },
                        },
                    })
                    // 2.40–2.41: { events: […] }; 2.42+: { instances: […] }
                    const envelope = result?.evts ?? {}
                    const items = envelope.events ?? envelope.instances ?? []
                    all.push(...items)
                    if (items.length < pageSize || all.length >= maxEvents) break
                    page++
                }
                return all.slice(0, maxEvents)
            } catch (e) {
                setError(e.message || 'Failed to fetch sample events')
                return null
            } finally {
                setLoading(false)
            }
        },
        [engine, programId]
    )

    return { fetchEventSample, loading, error }
}

/**
 * Fetch existing data values for a dataSet + period range + org units
 * to pre-populate an aggregate data-entry template.
 */
export const useDataEntrySampleData = (dataSetId) => {
    const engine = useDataEngine()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const fetchDataEntrySample = useCallback(
        async ({ startDate, endDate, orgUnits = [], maxValues = 5000 } = {}) => {
            setLoading(true)
            setError(null)
            try {
                // dataValueSets requires at least one orgUnit. When the caller did
                // not provide any, resolve the current user's capture OUs so a
                // super-user can still get a sample instead of silently getting [].
                let ouList = orgUnits
                if (!ouList?.length) {
                    try {
                        const meResult = await engine.query({
                            me: { resource: 'me', params: { fields: 'organisationUnits[id],dataViewOrganisationUnits[id]' } },
                        })
                        const meOus = meResult?.me?.dataViewOrganisationUnits?.length
                            ? meResult.me.dataViewOrganisationUnits
                            : meResult?.me?.organisationUnits ?? []
                        ouList = meOus.map((o) => o.id)
                    } catch {
                        ouList = []
                    }
                }
                if (!ouList.length) {
                    setError('No organisation units available for sample data. Select at least one org unit.')
                    return []
                }
                const all = []
                for (const ou of ouList) {
                    if (all.length >= maxValues) break
                    const params = {
                        dataSet: dataSetId,
                        startDate,
                        endDate,
                        orgUnit: ou,
                        children: true,
                    }
                    const result = await engine.query({
                        dvs: { resource: 'dataValueSets', params },
                    })
                    const items = result?.dvs?.dataValues ?? []
                    all.push(...items)
                }
                return all.slice(0, maxValues)
            } catch (e) {
                setError(e.message || 'Failed to fetch sample data values')
                return null
            } finally {
                setLoading(false)
            }
        },
        [engine, dataSetId]
    )

    return { fetchDataEntrySample, loading, error }
}
