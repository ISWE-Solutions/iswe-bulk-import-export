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

                    const items = result?.teis?.trackedEntities ?? []
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
