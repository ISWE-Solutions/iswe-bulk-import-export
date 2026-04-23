import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, ButtonStrip, CircularLoader, NoticeBox, Tag } from '@dhis2/ui'
import {
    buildTrackerExportWorkbook,
    buildTrackerFlatExportWorkbook,
    buildEventExportWorkbook,
    buildDataEntryExportWorkbook,
    downloadWorkbook,
} from '../lib/dataExporter'
import { fetchOUHierarchy, collectOUIds } from '../lib/ouHierarchy'
import { formatApiException } from '../lib/errorFormatter'

const PAGE_SIZE = 200

/** Audit/ownership fields DHIS2 data APIs may return but aren't needed for re-import. */
const DATA_AUDIT_FIELDS = [
    'createdAt', 'updatedAt', 'createdAtClient', 'updatedAtClient',
    'createdBy', 'updatedBy', 'storedBy',
    'lastUpdated', 'created', 'lastUpdatedBy',
    'href', 'access', 'deleted',
]

/** Recursively strip DATA_AUDIT_FIELDS from a cloned payload. */
function stripAuditFields(input) {
    const walk = (v) => {
        if (v == null || typeof v !== 'object') return v
        if (Array.isArray(v)) { v.forEach(walk); return v }
        for (const f of DATA_AUDIT_FIELDS) if (f in v) delete v[f]
        for (const k of Object.keys(v)) walk(v[k])
        return v
    }
    return walk(JSON.parse(JSON.stringify(input)))
}

/**
 * Export progress: fetches data from DHIS2 APIs (paginated), builds Excel, and downloads.
 *
 * Props:
 *  - metadata: program or data set metadata
 *  - exportConfig: { orgUnits, includeChildren, startDate, endDate, periods }
 *  - importType: 'tracker' | 'event' | 'dataEntry'
 *  - onReset: () => void
 *  - onBack: () => void
 */
export const ExportProgress = ({ metadata, exportConfig, importType, onReset, onBack }) => {
    const engine = useDataEngine()
    const [status, setStatus] = useState('fetching') // fetching | building | complete | error | empty
    const [error, setError] = useState(null)
    const [fetched, setFetched] = useState(0)
    const [statusMsg, setStatusMsg] = useState('Fetching data...')
    const resultRef = useRef(null)

    const ouParam = exportConfig.orgUnits.join(',')
    // DHIS2 2.40 uses legacy `orgUnit` + `ouMode`; 2.41+ also accepts these as aliases.
    // Avoids mixing new/legacy names which fails silently or with E1003 on 2.42.
    const ouMode = exportConfig.includeChildren ? 'DESCENDANTS' : 'SELECTED'

    // Diagnostics captured during the last fetch — shown on empty/error screens.
    const diagRef = useRef({ totalsPerPage: [], responseShape: '', sampleParams: null })

    const fetchTrackerData = useCallback(async () => {
        const allTeis = []
        let page = 1
        // eslint-disable-next-line no-constant-condition
        while (true) {
            setStatusMsg(`Fetching tracked entities (page ${page})...`)
            // DHIS2 2.42+ renamed tracker query params:
            //   orgUnit → orgUnits, ouMode → orgUnitMode,
            //   enrollmentEnrolledAfter/Before → enrolledAfter/Before.
            // Sending both keeps 2.40/41 and 2.42+ working; unknown params are ignored.
            const params = {
                program: metadata.id,
                orgUnit: ouParam,
                orgUnits: ouParam,
                ouMode,
                orgUnitMode: ouMode,
                includeDeleted: exportConfig.includeDeleted ? 'true' : 'false',
                fields: 'trackedEntity,orgUnit,attributes[attribute,value],enrollments[enrolledAt,occurredAt,events[programStage,orgUnit,occurredAt,dataValues[dataElement,value]]]',
                page,
                pageSize: PAGE_SIZE,
            }
            if (exportConfig.startDate) {
                params.enrollmentEnrolledAfter = exportConfig.startDate
                params.enrolledAfter = exportConfig.startDate
            }
            if (exportConfig.endDate) {
                params.enrollmentEnrolledBefore = exportConfig.endDate
                params.enrolledBefore = exportConfig.endDate
            }
            if (page === 1) diagRef.current.sampleParams = { ...params }
            const result = await engine.query({
                teis: { resource: 'tracker/trackedEntities', params },
            })
            // DHIS2 v2.40–2.41 returns { trackedEntities: […] }; v2.42+ returns { instances: […] }.
            const envelope = result?.teis ?? {}
            const items = envelope.trackedEntities ?? envelope.instances ?? []
            if (page === 1) {
                diagRef.current.responseShape = envelope.trackedEntities
                    ? 'trackedEntities[]' : envelope.instances ? 'instances[]' : 'unknown'
            }
            diagRef.current.totalsPerPage.push(items.length)
            allTeis.push(...items)
            setFetched(allTeis.length)
            if (items.length < PAGE_SIZE) break
            page++
        }
        return allTeis
    }, [engine, metadata, exportConfig, ouParam, ouMode])

    const fetchEventData = useCallback(async () => {
        const stages = metadata.programStages ?? []
        const orgUnits = exportConfig.orgUnits ?? []
        const eventsMap = {}
        for (const stage of stages) {
            eventsMap[stage.id] = []
            for (const ou of orgUnits) {
                let page = 1
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    setStatusMsg(`Fetching ${stage.displayName} events (page ${page})...`)
                    const evParams = {
                        program: metadata.id,
                        programStage: stage.id,
                        orgUnit: ou,
                        orgUnits: ou,
                        ouMode,
                        orgUnitMode: ouMode,
                        includeDeleted: exportConfig.includeDeleted ? 'true' : 'false',
                        fields: 'event,orgUnit,occurredAt,dataValues[dataElement,value]',
                        page,
                        pageSize: PAGE_SIZE,
                    }
                    if (exportConfig.startDate) evParams.occurredAfter = exportConfig.startDate
                    if (exportConfig.endDate) evParams.occurredBefore = exportConfig.endDate
                    if (page === 1 && !diagRef.current.sampleParams) diagRef.current.sampleParams = { ...evParams }
                    const result = await engine.query({
                        events: { resource: 'tracker/events', params: evParams },
                    })
                    // v2.40–2.41: { events: […] }; v2.42+: { instances: […] }.
                    const envelope = result?.events ?? {}
                    const items = envelope.events ?? envelope.instances ?? []
                    if (page === 1 && !diagRef.current.responseShape) {
                        diagRef.current.responseShape = envelope.events
                            ? 'events[]' : envelope.instances ? 'instances[]' : 'unknown'
                    }
                    diagRef.current.totalsPerPage.push(items.length)
                    eventsMap[stage.id].push(...items)
                    setFetched((prev) => prev + items.length)
                    if (items.length < PAGE_SIZE) break
                    page++
                }
            }
        }
        return eventsMap
    }, [engine, metadata, exportConfig, ouMode])

    const fetchDataEntryData = useCallback(async () => {
        const periods = exportConfig.periods ?? []
        const orgUnits = exportConfig.orgUnits ?? []
        const allValues = []
        for (const ouId of orgUnits) {
            for (const period of periods) {
                setStatusMsg(`Fetching data for ${ouId} / ${period}...`)
                const result = await engine.query({
                    dvs: {
                        resource: 'dataValueSets',
                        params: {
                            dataSet: metadata.id,
                            period,
                            orgUnit: ouId,
                            children: exportConfig.includeChildren,
                            includeDeleted: exportConfig.includeDeleted ? 'true' : 'false',
                        },
                    },
                })
                const values = result?.dvs?.dataValues ?? []
                allValues.push(...values)
                setFetched((prev) => prev + values.length)
            }
        }
        return allValues
    }, [engine, metadata, exportConfig])

    useEffect(() => {
        const run = async () => {
            try {
                let data
                if (importType === 'tracker') {
                    data = await fetchTrackerData()
                } else if (importType === 'event') {
                    data = await fetchEventData()
                } else {
                    data = await fetchDataEntryData()
                }

                // Check if any data was returned
                const isEmpty = importType === 'event'
                    ? Object.values(data).every((arr) => arr.length === 0)
                    : (Array.isArray(data) && data.length === 0)

                if (isEmpty) {
                    setStatus('empty')
                    return
                }

                setStatus('building')
                setStatusMsg('Building output file...')

                // Fetch OU hierarchy for every org unit referenced in the data so
                // exports can include ancestor-level name columns and UIDs.
                let ouHierarchy = { map: {}, maxLevel: 0 }
                if (exportConfig.fileFormat !== 'json') {
                    const ouIds = importType === 'tracker'
                        ? collectOUIds({ trackedEntities: data })
                        : importType === 'event'
                            ? collectOUIds({ eventsMap: data })
                            : collectOUIds({ dataValues: data })
                    if (ouIds.length > 0) {
                        setStatusMsg('Resolving organisation unit hierarchy...')
                        ouHierarchy = await fetchOUHierarchy(engine, ouIds)
                    }
                }
                const ouOpts = {
                    ouHierarchy,
                    includeUids: !!exportConfig.includeUids,
                    includeHierarchy: exportConfig.includeHierarchy !== false,
                }

                let result
                if (exportConfig.fileFormat === 'json') {
                    // JSON output: wrap the fetched data into the native DHIS2 payload shape so the
                    // file can be re-imported directly via the JSON upload flow.
                    const safeName = (metadata.displayName || metadata.id || 'export').replace(/[^A-Za-z0-9_-]+/g, '_')
                    const stamp = new Date().toISOString().slice(0, 10)
                    let payload
                    if (importType === 'tracker') {
                        payload = { trackedEntities: data }
                    } else if (importType === 'event') {
                        // data is { [stageId]: [events] } — flatten for a native /api/tracker { events: [...] } payload
                        const events = Object.values(data).flat()
                        payload = { events }
                    } else {
                        payload = { dataSet: metadata.id, dataValues: data }
                    }
                    if (exportConfig.stripAudit) {
                        payload = stripAuditFields(payload)
                    }
                    result = {
                        kind: 'json',
                        filename: `${safeName}-${importType}-${stamp}.json`,
                        content: JSON.stringify(payload, null, 2),
                    }
                } else if (importType === 'tracker') {
                    result = exportConfig.exportFormat === 'flat'
                        ? buildTrackerFlatExportWorkbook(data, metadata, ouOpts)
                        : buildTrackerExportWorkbook(data, metadata, ouOpts)
                } else if (importType === 'event') {
                    result = buildEventExportWorkbook(data, metadata, ouOpts)
                } else {
                    result = buildDataEntryExportWorkbook(data, metadata, ouOpts)
                }

                resultRef.current = result
                setStatus('complete')
            } catch (e) {
                setError(formatApiException(e, statusMsg))
                setStatus('error')
            }
        }
        run()
    // eslint-disable-next-line
    }, [])

    const handleDownload = () => {
        const r = resultRef.current
        if (!r) return
        if (r.kind === 'json') {
            const blob = new Blob([r.content], { type: 'application/json;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = r.filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
            return
        }
        const { wb, filename, sheetColors } = r
        downloadWorkbook(wb, filename, sheetColors)
    }

    if (status === 'fetching' || status === 'building') {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CircularLoader />
                <p style={{ color: '#4a5568', fontSize: 14, marginTop: 16 }}>{statusMsg}</p>
                {fetched > 0 && (
                    <p style={{ color: '#6b7280', fontSize: 13 }}>{fetched} records fetched so far</p>
                )}
            </div>
        )
    }

    if (status === 'empty') {
        const ouCount = exportConfig.orgUnits?.length ?? 0
        const hasDateRange = !!(exportConfig.startDate || exportConfig.endDate)
        const periodCount = exportConfig.periods?.length ?? 0
        const diag = diagRef.current
        return (
            <div>
                <NoticeBox warning title="No Data Found">
                    <p style={{ margin: '0 0 8px' }}>
                        No records were found for the selected organisation unit(s) and {importType === 'dataEntry' ? 'period(s)' : 'date range'}.
                    </p>
                    <div style={{ fontSize: 13, color: '#4a5568', marginTop: 8 }}>
                        <div><strong>Filters used:</strong></div>
                        <ul style={{ margin: '4px 0 0 18px' }}>
                            <li>{ouCount} organisation unit{ouCount !== 1 ? 's' : ''} {exportConfig.includeChildren ? '(+ descendants)' : '(selected only)'}</li>
                            {importType !== 'dataEntry' && (
                                hasDateRange
                                    ? <li>Date range: {exportConfig.startDate || '(any start)'} → {exportConfig.endDate || '(any end)'}</li>
                                    : <li>Date range: none (all time)</li>
                            )}
                            {importType === 'dataEntry' && (
                                <li>{periodCount} period{periodCount !== 1 ? 's' : ''}</li>
                            )}
                            {exportConfig.includeDeleted && <li>Includes deleted records</li>}
                        </ul>
                        {importType !== 'dataEntry' && (
                            <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                                Server returned shape <code>{diag.responseShape || 'unknown'}</code>.
                                {hasDateRange && importType === 'tracker' && (
                                    <> Tracker date filter uses <strong>enrollment dates</strong>, not event dates — if your data was enrolled outside this window, remove the date filter.</>
                                )}
                            </div>
                        )}
                        <div style={{ marginTop: 8 }}>
                            <strong>Try:</strong> clearing the date range, selecting a specific child org unit that holds data, or verifying your user has data-capture access to the selected OU(s).
                        </div>
                    </div>
                </NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    if (status === 'error') {
        const errInfo = typeof error === 'object' && error !== null && error.title
            ? error
            : { title: 'Export Failed', message: String(error || 'Export failed'), errorCode: '', httpStatus: '', context: '' }
        return (
            <div>
                <NoticeBox error title={errInfo.title}>
                    {errInfo.context && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                            Failed during: {errInfo.context}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {errInfo.httpStatus && <Tag negative>HTTP {errInfo.httpStatus}</Tag>}
                        {errInfo.errorCode && <Tag negative>{errInfo.errorCode}</Tag>}
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {errInfo.message}
                    </div>
                    {errInfo.errorCode === 'E1006' && (
                        <div style={{ fontSize: 13, marginTop: 10, padding: 10, background: '#fef3c7', borderRadius: 4 }}>
                            <strong>How to fix:</strong> Your DHIS2 user account lacks <em>data read</em> sharing access for program <code>{metadata?.id}</code>.
                            <ul style={{ margin: '4px 0 0 18px' }}>
                                <li>Ask a DHIS2 administrator to grant your user (or one of your user groups) at least <strong>Data read</strong> sharing on this program, or</li>
                                <li>Sign in as a user who has been granted that access.</li>
                            </ul>
                        </div>
                    )}
                    {errInfo.httpStatus === 403 && errInfo.errorCode !== 'E1006' && (
                        <div style={{ fontSize: 13, marginTop: 10, padding: 10, background: '#fef3c7', borderRadius: 4 }}>
                            <strong>How to fix:</strong> Your user lacks the required sharing or authority. Contact a DHIS2 administrator to review the program/dataset sharing settings or your user role authorities.
                        </div>
                    )}
                    {fetched > 0 && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                            {fetched} records had already been fetched before the error.
                        </div>
                    )}
                </NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    // Complete
    return (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: '#E8F5E9', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                    <path d="M8 16l5 5L24 10" stroke="#2E7D32" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a202c' }}>
                Export Ready
            </h2>
            <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 4 }}>
                {fetched} records exported into a structured {resultRef.current?.kind === 'json' ? 'JSON' : 'Excel'} file.
            </p>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
                {resultRef.current?.filename}
            </p>
            <ButtonStrip style={{ justifyContent: 'center' }}>
                <Button primary onClick={handleDownload}>
                    {resultRef.current?.kind === 'json' ? 'Download JSON' : 'Download Excel'}
                </Button>
                <Button onClick={onReset}>Start Over</Button>
            </ButtonStrip>
        </div>
    )
}
