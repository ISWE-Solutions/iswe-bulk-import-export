import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import {
    Button,
    ButtonStrip,
    CircularLoader,
    DataTable,
    DataTableHead,
    DataTableBody,
    DataTableRow,
    DataTableCell,
    DataTableColumnHeader,
    NoticeBox,
    Tag,
    TabBar,
    Tab,
} from '@dhis2/ui'
import { analyzeImportErrors } from '../lib/dataCleaner'
import { getTrackerAttributes } from '../lib/trackerAttributes'
import { toCsv, downloadTextFile, groupErrorCodes, formatApiException } from '../lib/errorFormatter'
import * as XLSX from 'xlsx'

const POLL_INTERVAL = 2000

/** Batch sizes tuned per API — dataValueSets handles larger payloads than nested tracker. */
const BATCH_SIZE_TRACKER = 50
const BATCH_SIZE_EVENT = 200
const BATCH_SIZE_DATA_ENTRY = 500
const MAX_RETRIES = 2
const RETRY_DELAY = 3000

/**
 * Map DHIS2 import errors back to Excel rows using the rowMap from payloadBuilder.
 *
 * Since we generate client-side UIDs and include them in the payload,
 * DHIS2 error reports reference the same UIDs. Direct lookup by uid.
 *
 * Captures every diagnostic field DHIS2 exposes on the error report:
 *   errorCode, message, trackerType, uid, fieldName, fieldValue,
 *   trackedEntity, enrollment, event (parent UIDs for hierarchical errors).
 *
 * Also merges object-level errorReports from bundleReport.typeReportMap[*].objectReports[*]
 * because some DHIS2 versions populate these instead of validationReport.
 *
 * rowMap is { [uid]: { excelRow, teiId, type, stageName? } }
 */
function mapErrorsToRows(report, rowMap) {
    const out = []
    const push = (err, fallbackType) => {
        const info = rowMap?.[err.uid]
        out.push({
            errorCode: err.errorCode || '',
            message: err.message || '',
            trackerType: err.trackerType || info?.type || fallbackType || 'Unknown',
            uid: err.uid || '',
            fieldName: err.fieldName || err.errorProperty || '',
            fieldValue: err.fieldValue != null ? String(err.fieldValue) : '',
            trackedEntity: err.trackedEntity || '',
            enrollment: err.enrollment || '',
            event: err.event || '',
            excelRow: info?.excelRow ?? null,
            teiId: info?.teiId ?? null,
            stageName: info?.stageName ?? null,
        })
    }

    for (const err of report?.validationReport?.errorReports ?? []) {
        push(err)
    }
    const typeMap = report?.bundleReport?.typeReportMap || {}
    for (const [type, tr] of Object.entries(typeMap)) {
        for (const or of tr?.objectReports ?? []) {
            for (const er of or?.errorReports ?? []) {
                // Skip if already captured via validationReport (match by uid+code+message)
                const dup = out.some(
                    (e) => e.uid === (er.uid || or.uid) && e.errorCode === er.errorCode && e.message === er.message
                )
                if (dup) continue
                push({ ...er, uid: er.uid || or.uid, trackerType: type }, type)
            }
        }
    }
    return out
}

/** Column set for tracker/event/data-entry import errors. */
const ERROR_CSV_COLUMNS = [
    { key: 'errorCode', label: 'Error Code' },
    { key: 'trackerType', label: 'Type' },
    { key: 'excelRow', label: 'Excel Row' },
    { key: 'teiId', label: 'TEI_ID' },
    { key: 'stageName', label: 'Stage' },
    { key: 'fieldName', label: 'Field' },
    { key: 'fieldValue', label: 'Invalid Value' },
    { key: 'uid', label: 'Object UID' },
    { key: 'trackedEntity', label: 'Parent TEI UID' },
    { key: 'enrollment', label: 'Parent Enrollment UID' },
    { key: 'event', label: 'Parent Event UID' },
    { key: 'message', label: 'Message' },
]

/** Download all errors as a CSV file (no row limit — full list). */
function downloadErrorsCsv(errors) {
    const csv = toCsv(ERROR_CSV_COLUMNS, errors)
    downloadTextFile(csv, 'import-errors.csv')
}

/**
 * Export failed/skipped rows as an Excel workbook matching the original template columns.
 *
 * skippedRows: [{ source, row, teiId?, data, errors }]
 * importErrors: mapped DHIS2 import errors (from aggregatedErrors)
 * metadata: program/dataSet metadata with attributes and stage data elements
 */
function exportFailedRowsExcel(skippedRows, importErrors, metadata) {
    const wb = XLSX.utils.book_new()
    const isDataEntry = !metadata.programStages
    const stages = metadata.programStages ?? []

    if (isDataEntry) {
        // Data entry: single "Failed Rows" sheet
        const headers = ['Row', 'ORG_UNIT_ID', 'PERIOD', 'DATA_ELEMENT', 'COC', 'VALUE', 'Error']
        const rows = (skippedRows ?? []).map((s) => [
            s.row, s.data?.orgUnit ?? '', s.data?.period ?? '', s.data?.dataElement ?? '',
            s.data?.categoryOptionCombo ?? '', s.data?.value ?? '',
            s.errors.map((e) => e.message).join('; '),
        ])
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
        XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows')
    } else {
        // Build attribute column info from metadata
        const attrDefs = getTrackerAttributes(metadata).map((a) => {
            const tea = a.trackedEntityAttribute ?? a
            return { id: tea.id, name: tea.displayName ?? tea.id }
        })

        // TEI sheet for skipped TEIs
        const teiSkipped = (skippedRows ?? []).filter((s) => s.source === 'TEI Sheet')
        if (teiSkipped.length > 0) {
            const headers = ['Row', 'TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE', 'INCIDENT_DATE',
                ...attrDefs.map((a) => a.name), 'Error']
            const rows = teiSkipped.map((s) => {
                const d = s.data ?? {}
                return [
                    s.row, d.teiId ?? '', d.orgUnit ?? '', d.enrollmentDate ?? '', d.incidentDate ?? '',
                    ...attrDefs.map((a) => d.attributes?.[a.id] ?? ''),
                    s.errors.map((e) => e.message).join('; '),
                ]
            })
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
            XLSX.utils.book_append_sheet(wb, ws, 'TEI Errors')
        }

        // Stage sheets for skipped events
        for (const stage of stages) {
            const deDefs = (stage.programStageDataElements ?? []).map((psde) => {
                const de = psde.dataElement ?? psde
                return { id: de.id, name: de.displayName ?? de.id }
            })
            const stageSkipped = (skippedRows ?? []).filter(
                (s) => s.stageId === stage.id || s.source === stage.displayName
            )
            if (stageSkipped.length === 0) continue

            const headers = ['Row', 'TEI_ID', 'EVENT_DATE', 'ORG_UNIT_ID',
                ...deDefs.map((d) => d.name), 'Error']
            const rows = stageSkipped.map((s) => {
                const d = s.data ?? {}
                return [
                    s.row, d.teiId ?? '', d.eventDate ?? '', d.orgUnit ?? '',
                    ...deDefs.map((de) => d.dataValues?.[de.id] ?? ''),
                    s.errors.map((e) => e.message).join('; '),
                ]
            })
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
            // Sheet names max 31 chars
            const sheetName = (stage.displayName || stage.id).slice(0, 24) + ' Errors'
            XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
        }

        // Import errors (DHIS2 server-rejected rows) as a separate sheet
        if (importErrors?.length > 0) {
            const headers = ['Error Code', 'Type', 'Excel Row', 'TEI_ID', 'Stage', 'Message']
            const rows = importErrors.map((e) => [
                e.errorCode ?? '', e.trackerType ?? '', e.excelRow ?? '', e.teiId ?? '',
                e.stageName ?? '', e.message ?? '',
            ])
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
            XLSX.utils.book_append_sheet(wb, ws, 'Server Errors')
        }
    }

    if (wb.SheetNames.length === 0) {
        // Nothing to export
        const ws = XLSX.utils.aoa_to_sheet([['No failed rows to export.']])
        XLSX.utils.book_append_sheet(wb, ws, 'Info')
    }

    XLSX.writeFile(wb, 'failed-rows.xlsx')
}

export const ImportProgress = ({ payload, rowMap, metadata, skippedRows, onReset }) => {
    const engine = useDataEngine()
    const [status, setStatus] = useState('importing') // importing | complete | error
    const [error, setError] = useState(null)
    const [activeTab, setActiveTab] = useState('summary')
    const [errorCodeFilter, setErrorCodeFilter] = useState('ALL')

    // Detect payload type: dataValues (data entry) vs events (event) vs trackedEntities (tracker)
    const isDataEntryPayload = !!(payload.dataValues)
    const isEventPayload = !!(payload.events && !payload.trackedEntities)
    const items = isDataEntryPayload
        ? (payload.dataValues ?? [])
        : isEventPayload
            ? (payload.events ?? [])
            : (payload.trackedEntities ?? [])
    const totalItems = items.length
    const itemLabel = isDataEntryPayload ? 'data values' : isEventPayload ? 'events' : 'tracked entities'

    // Batching state
    const [batchIndex, setBatchIndex] = useState(0)
    const [totalBatches, setTotalBatches] = useState(0)
    const [completedItems, setCompletedItems] = useState(0)

    // Aggregate stats and errors across batches
    const aggregatedStats = useRef({ created: 0, updated: 0, ignored: 0, deleted: 0, total: 0 })
    const aggregatedTypeStats = useRef({})
    const aggregatedErrors = useRef([])
    const batchesRef = useRef([])

    // Split payload into batches on mount
    useEffect(() => {
        const batchSize = isDataEntryPayload
            ? BATCH_SIZE_DATA_ENTRY
            : isEventPayload ? BATCH_SIZE_EVENT : BATCH_SIZE_TRACKER
        const batches = []
        for (let i = 0; i < items.length; i += batchSize) {
            const slice = items.slice(i, i + batchSize)
            if (isDataEntryPayload) {
                batches.push({ dataValues: slice })
            } else if (isEventPayload) {
                batches.push({ events: slice })
            } else {
                batches.push({ trackedEntities: slice })
            }
        }
        batchesRef.current = batches
        setTotalBatches(batches.length)
    }, [payload, items, isEventPayload, isDataEntryPayload])

    /** Wait for an async tracker job to complete, then return the report. */
    const waitForJob = useCallback(async (jobId) => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL))
            try {
                const nResult = await engine.query({
                    notifications: { resource: `tracker/jobs/${jobId}` },
                })
                const notifs = nResult?.notifications
                const done = Array.isArray(notifs)
                    ? notifs.some((n) => n.completed)
                    : notifs?.completed
                if (!done) continue

                const rResult = await engine.query({
                    report: { resource: `tracker/jobs/${jobId}/report` },
                })
                return rResult?.report ?? {}
            } catch (_) {
                // Not ready yet — keep polling
            }
        }
    }, [engine])

    /** Merge a single batch report into the aggregated accumulators. */
    const mergeBatchReport = useCallback((report) => {
        // Merge top-level stats
        const s = report?.stats || report?.response?.stats || {}
        for (const k of ['created', 'updated', 'ignored', 'deleted', 'total']) {
            aggregatedStats.current[k] += parseInt(s[k] ?? 0, 10)
        }

        // Merge per-type stats
        const typeMap = report?.bundleReport?.typeReportMap
        if (typeMap) {
            const labels = {
                TRACKED_ENTITY: 'Tracked Entities',
                ENROLLMENT: 'Enrollments',
                EVENT: 'Events',
            }
            for (const [type, label] of Object.entries(labels)) {
                const ts = typeMap[type]?.stats
                if (!ts) continue
                if (!aggregatedTypeStats.current[label]) {
                    aggregatedTypeStats.current[label] = { created: 0, updated: 0, ignored: 0, deleted: 0, total: 0 }
                }
                for (const k of ['created', 'updated', 'ignored', 'deleted', 'total']) {
                    aggregatedTypeStats.current[label][k] += parseInt(ts[k] ?? 0, 10)
                }
            }
        }

        // Merge errors
        const errs = mapErrorsToRows(report, rowMap)
        if (errs.length > 0) aggregatedErrors.current.push(...errs)
    }, [rowMap])

    /** Merge a dataValueSets import response into aggregated accumulators. */
    const mergeDataEntryReport = useCallback((response, batchOffset) => {
        // dataValueSets response: { importCount: { imported, updated, ignored, deleted }, conflicts: [...] }
        const ic = response?.importCount ?? response?.response?.importCount ?? {}
        aggregatedStats.current.created += parseInt(ic.imported ?? 0, 10)
        aggregatedStats.current.updated += parseInt(ic.updated ?? 0, 10)
        aggregatedStats.current.ignored += parseInt(ic.ignored ?? 0, 10)
        aggregatedStats.current.deleted += parseInt(ic.deleted ?? 0, 10)
        aggregatedStats.current.total +=
            parseInt(ic.imported ?? 0, 10) +
            parseInt(ic.updated ?? 0, 10) +
            parseInt(ic.ignored ?? 0, 10) +
            parseInt(ic.deleted ?? 0, 10)

        // Map conflicts to error format with dimensional context.
        // DHIS2 conflict shape varies: { errorCode, value, property, object, indexes, message,
        //                                dataElement, period, orgUnit, categoryOptionCombo }
        const conflicts = response?.conflicts ?? response?.response?.conflicts ?? []
        for (const c of conflicts) {
            let excelRow = null
            const idxMatch = String(c.indexes ?? c.object ?? '').match(/(\d+)/)
            if (idxMatch) {
                const globalIdx = batchOffset + parseInt(idxMatch[1], 10)
                excelRow = rowMap?.[globalIdx]?.excelRow ?? null
            }
            const msg = c.message || c.value || c.object || 'Unknown conflict'
            const parts = [msg]
            if (c.dataElement) parts.push(`dataElement=${c.dataElement}`)
            if (c.period) parts.push(`period=${c.period}`)
            if (c.orgUnit) parts.push(`orgUnit=${c.orgUnit}`)
            if (c.categoryOptionCombo) parts.push(`coc=${c.categoryOptionCombo}`)
            aggregatedErrors.current.push({
                errorCode: c.errorCode ?? 'CONFLICT',
                message: parts.join(' — '),
                trackerType: 'DATA_VALUE',
                uid: '',
                fieldName: c.property || '',
                fieldValue: c.value != null ? String(c.value) : '',
                trackedEntity: '',
                enrollment: '',
                event: '',
                excelRow,
                teiId: null,
                stageName: null,
            })
        }
    }, [rowMap])

    /** Submit a single batch with retry logic for transient failures. */
    const submitBatchWithRetry = useCallback(async (batch, batchSize, batchOffset) => {
        let lastError
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (isDataEntryPayload) {
                    const mutation = {
                        resource: 'dataValueSets',
                        type: 'create',
                        params: { importStrategy: 'CREATE_AND_UPDATE' },
                        data: batch,
                    }
                    const response = await engine.mutate(mutation)
                    mergeDataEntryReport(response, batchOffset)
                } else {
                    const useAsync = batchSize > 10
                    const mutation = {
                        resource: 'tracker',
                        type: 'create',
                        params: {
                            async: useAsync,
                            importStrategy: 'CREATE_AND_UPDATE',
                            atomicMode: 'OBJECT',
                            skipRuleEngine: true,
                        },
                        data: batch,
                    }
                    const response = await engine.mutate(mutation)
                    let report
                    if (response?.response?.id) {
                        report = await waitForJob(response.response.id)
                    } else {
                        report = response
                    }
                    mergeBatchReport(report)
                }
                return // success
            } catch (e) {
                lastError = e
                if (attempt < MAX_RETRIES) {
                    await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)))
                }
            }
        }
        throw lastError // all retries exhausted
    }, [engine, isDataEntryPayload, waitForJob, mergeBatchReport, mergeDataEntryReport])

    // Process batches sequentially
    useEffect(() => {
        if (totalBatches === 0) return // batches not split yet
        if (status !== 'importing') return

        const processBatches = async () => {
            try {
                let offset = 0
                for (let i = 0; i < batchesRef.current.length; i++) {
                    setBatchIndex(i)
                    const batch = batchesRef.current[i]
                    const batchSize = isDataEntryPayload
                        ? (batch.dataValues?.length ?? 0)
                        : isEventPayload
                            ? (batch.events?.length ?? 0)
                            : (batch.trackedEntities?.length ?? 0)

                    await submitBatchWithRetry(batch, batchSize, offset)
                    offset += batchSize
                    setCompletedItems((prev) => prev + batchSize)
                }
                setStatus('complete')
            } catch (e) {
                setError(formatApiException(e, `Batch ${batchIndex + 1} of ${totalBatches}`))
                setStatus('error')
            }
        }
        processBatches()
    // eslint-disable-next-line
    }, [totalBatches])

    const stats = aggregatedStats.current
    const typeStats = Object.keys(aggregatedTypeStats.current).length > 0 ? aggregatedTypeStats.current : null
    const mappedErrors = aggregatedErrors.current
    const errorCount = mappedErrors.length
    const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0

    // Level 3: Analyze import errors for fixable suggestions
    const errorAnalysis = useMemo(() => {
        if (status !== 'complete' || mappedErrors.length === 0 || !metadata) return null
        return analyzeImportErrors(mappedErrors, metadata)
    }, [status, mappedErrors, metadata])

    const skippedCount = skippedRows?.length ?? 0
    const allFailedCount = skippedCount + errorCount

    if (status === 'importing') {
        return (
            <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Importing...</h2>
                <div style={{ margin: '16px 0' }}><CircularLoader /></div>
                <p style={{ color: '#4a5568', fontSize: 14, lineHeight: 1.5 }}>
                    Processing batch {batchIndex + 1} of {totalBatches} ({completedItems} / {totalItems} {itemLabel})
                </p>
                {/* Progress bar */}
                <div style={{ background: '#e5e7eb', borderRadius: 6, height: 10, marginTop: 12, overflow: 'hidden' }}>
                    <div style={{
                        background: '#2563EB',
                        height: '100%',
                        width: `${pct}%`,
                        borderRadius: 6,
                        transition: 'width 0.3s ease',
                    }} />
                </div>
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{pct}% complete</p>
            </div>
        )
    }

    if (status === 'error') {
        const errInfo = typeof error === 'object' && error !== null && error.title
            ? error
            : { title: 'Import Error', message: String(error || 'Import failed'), errorCode: '', httpStatus: '', context: '' }
        return (
            <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Import Failed</h2>
                <NoticeBox error title={errInfo.title}>
                    {errInfo.context && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                            {errInfo.context}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {errInfo.httpStatus && <Tag negative>HTTP {errInfo.httpStatus}</Tag>}
                        {errInfo.errorCode && <Tag negative>{errInfo.errorCode}</Tag>}
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {errInfo.message}
                    </div>
                </NoticeBox>
                {completedItems > 0 && (
                    <p style={{ color: '#4a5568', fontSize: 14, marginTop: 8 }}>
                        {completedItems} of {totalItems} {itemLabel} were processed before the error.
                        {mappedErrors.length > 0 && ' Partial errors available — download below.'}
                    </p>
                )}
                <ButtonStrip style={{ marginTop: 16 }}>
                    {mappedErrors.length > 0 && (
                        <Button small onClick={() => downloadErrorsCsv(mappedErrors)}>
                            Download Partial Errors ({mappedErrors.length})
                        </Button>
                    )}
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    // Complete
    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Import Complete</h2>

            {/* Overall stats */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, marginTop: 12, flexWrap: 'wrap' }}>
                <Tag positive>Created: {stats.created ?? 0}</Tag>
                <Tag neutral>Updated: {stats.updated ?? 0}</Tag>
                <Tag negative>Ignored: {stats.ignored ?? 0}</Tag>
                <Tag>Deleted: {stats.deleted ?? 0}</Tag>
                <Tag>Total: {stats.total ?? 0}</Tag>
            </div>

            <TabBar>
                <Tab selected={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>
                    Summary
                </Tab>
                {skippedCount > 0 && (
                    <Tab selected={activeTab === 'skipped'} onClick={() => setActiveTab('skipped')}>
                        Skipped Rows <Tag negative>{skippedCount}</Tag>
                    </Tab>
                )}
                <Tab selected={activeTab === 'errors'} onClick={() => setActiveTab('errors')}>
                    Errors {errorCount > 0 && <Tag negative>{errorCount}</Tag>}
                </Tab>
                {errorAnalysis?.fixable?.length > 0 && (
                    <Tab selected={activeTab === 'fixes'} onClick={() => setActiveTab('fixes')}>
                        Suggested Fixes <Tag neutral>{errorAnalysis.fixable.length}</Tag>
                    </Tab>
                )}
            </TabBar>

            <div style={{ marginTop: 16 }}>
                {activeTab === 'summary' && (
                    <>
                        {/* Per-type stats breakdown */}
                        {typeStats && (
                            <DataTable>
                                <DataTableHead>
                                    <DataTableRow>
                                        <DataTableColumnHeader>Type</DataTableColumnHeader>
                                        <DataTableColumnHeader>Created</DataTableColumnHeader>
                                        <DataTableColumnHeader>Updated</DataTableColumnHeader>
                                        <DataTableColumnHeader>Ignored</DataTableColumnHeader>
                                        <DataTableColumnHeader>Deleted</DataTableColumnHeader>
                                        <DataTableColumnHeader>Total</DataTableColumnHeader>
                                    </DataTableRow>
                                </DataTableHead>
                                <DataTableBody>
                                    {Object.entries(typeStats).map(([label, s]) => (
                                        <DataTableRow key={label}>
                                            <DataTableCell>{label}</DataTableCell>
                                            <DataTableCell>
                                                <Tag positive>{s.created ?? 0}</Tag>
                                            </DataTableCell>
                                            <DataTableCell>
                                                <Tag neutral>{s.updated ?? 0}</Tag>
                                            </DataTableCell>
                                            <DataTableCell>
                                                <Tag negative>{s.ignored ?? 0}</Tag>
                                            </DataTableCell>
                                            <DataTableCell>{s.deleted ?? 0}</DataTableCell>
                                            <DataTableCell>{s.total ?? 0}</DataTableCell>
                                        </DataTableRow>
                                    ))}
                                </DataTableBody>
                            </DataTable>
                        )}

                        {errorCount === 0 && skippedCount === 0 && (
                            <NoticeBox title="Success" style={{ marginTop: 16 }}>
                                All records imported successfully.
                            </NoticeBox>
                        )}
                        {skippedCount > 0 && (
                            <NoticeBox warning title={`${skippedCount} row${skippedCount !== 1 ? 's' : ''} skipped before import`} style={{ marginTop: 16 }}>
                                These rows had validation errors and were excluded. See the Skipped Rows tab.
                            </NoticeBox>
                        )}
                        {errorCount > 0 && (
                            <NoticeBox warning title={`${errorCount} import errors`} style={{ marginTop: 16 }}>
                                Some records could not be imported. See the Errors tab for details.
                            </NoticeBox>
                        )}
                        {allFailedCount > 0 && (
                            <div style={{ marginTop: 12 }}>
                                <Button small onClick={() => exportFailedRowsExcel(skippedRows, mappedErrors, metadata)}>
                                    Export All Failed Rows to Excel
                                </Button>
                            </div>
                        )}
                        {errorAnalysis?.fixable?.length > 0 && (
                            <NoticeBox title={`${errorAnalysis.fixable.length} fixable errors detected`} style={{ marginTop: 12 }}>
                                The Suggested Fixes tab has recommendations. Fix your spreadsheet and re-import.
                            </NoticeBox>
                        )}
                    </>
                )}

                {activeTab === 'skipped' && (
                    <>
                        <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 12 }}>
                            {skippedCount} row{skippedCount !== 1 ? 's were' : ' was'} excluded from the import due to validation errors.
                            Export them to fix in your spreadsheet and re-import.
                        </p>
                        <div style={{ marginBottom: 12 }}>
                            <Button small onClick={() => exportFailedRowsExcel(skippedRows, [], metadata)}>
                                Export Skipped Rows to Excel
                            </Button>
                        </div>
                        <DataTable>
                            <DataTableHead>
                                <DataTableRow>
                                    <DataTableColumnHeader>Source</DataTableColumnHeader>
                                    <DataTableColumnHeader>Row</DataTableColumnHeader>
                                    <DataTableColumnHeader>TEI_ID</DataTableColumnHeader>
                                    <DataTableColumnHeader>Error(s)</DataTableColumnHeader>
                                </DataTableRow>
                            </DataTableHead>
                            <DataTableBody>
                                {(skippedRows ?? []).slice(0, 200).map((s, i) => (
                                    <DataTableRow key={i}>
                                        <DataTableCell>{s.source || '-'}</DataTableCell>
                                        <DataTableCell>{s.row ?? '-'}</DataTableCell>
                                        <DataTableCell>{s.teiId ?? '-'}</DataTableCell>
                                        <DataTableCell>
                                            {s.errors.map((e) => e.message).join('; ')}
                                        </DataTableCell>
                                    </DataTableRow>
                                ))}
                            </DataTableBody>
                        </DataTable>
                        {skippedCount > 200 && (
                            <p style={{ marginTop: 8, color: '#4a5568' }}>
                                Showing first 200 of {skippedCount} skipped rows. Export to Excel for full list.
                            </p>
                        )}
                    </>
                )}

                {activeTab === 'errors' && (
                    <>
                        {errorCount === 0 ? (
                            <NoticeBox title="No Errors">
                                All records imported successfully.
                            </NoticeBox>
                        ) : (
                            <>
                                {(() => {
                                    const groups = groupErrorCodes(mappedErrors)
                                    const filtered = errorCodeFilter === 'ALL'
                                        ? mappedErrors
                                        : mappedErrors.filter((e) => (e.errorCode || 'UNKNOWN') === errorCodeFilter)
                                    return (
                                        <>
                                            {/* Error-code filter chips */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                                {groups.map((g) => {
                                                    const active = errorCodeFilter === g.code
                                                    return (
                                                        <button
                                                            key={g.code}
                                                            onClick={() => setErrorCodeFilter(g.code)}
                                                            style={{
                                                                padding: '4px 10px',
                                                                borderRadius: 12,
                                                                border: active ? '1px solid #C62828' : '1px solid #e0e5ec',
                                                                background: active ? '#FFEBEE' : '#fff',
                                                                color: active ? '#C62828' : '#4a5568',
                                                                fontSize: 12,
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            {g.code} <span style={{ opacity: 0.7 }}>({g.count})</span>
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                            <div style={{ marginBottom: 12 }}>
                                                <Button small onClick={() => downloadErrorsCsv(mappedErrors)}>
                                                    Download All Errors as CSV
                                                </Button>
                                            </div>
                                            <DataTable>
                                                <DataTableHead>
                                                    <DataTableRow>
                                                        <DataTableColumnHeader>Error Code</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Type</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Excel Row</DataTableColumnHeader>
                                                        <DataTableColumnHeader>TEI_ID</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Stage</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Field</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Invalid Value</DataTableColumnHeader>
                                                        <DataTableColumnHeader>Message</DataTableColumnHeader>
                                                    </DataTableRow>
                                                </DataTableHead>
                                                <DataTableBody>
                                                    {filtered.slice(0, 100).map((e, i) => (
                                                        <DataTableRow key={i}>
                                                            <DataTableCell>
                                                                <Tag negative>{e.errorCode}</Tag>
                                                            </DataTableCell>
                                                            <DataTableCell>{e.trackerType}</DataTableCell>
                                                            <DataTableCell>{e.excelRow ?? '-'}</DataTableCell>
                                                            <DataTableCell>{e.teiId ?? '-'}</DataTableCell>
                                                            <DataTableCell>{e.stageName ?? '-'}</DataTableCell>
                                                            <DataTableCell>{e.fieldName || '-'}</DataTableCell>
                                                            <DataTableCell>
                                                                {e.fieldValue
                                                                    ? <code style={{ background: '#FFF3E0', padding: '1px 4px', borderRadius: 3, fontSize: 12 }}>{e.fieldValue}</code>
                                                                    : '-'}
                                                            </DataTableCell>
                                                            <DataTableCell>{e.message}</DataTableCell>
                                                        </DataTableRow>
                                                    ))}
                                                </DataTableBody>
                                            </DataTable>
                                            {filtered.length > 100 && (
                                                <p style={{ marginTop: 8, color: '#4a5568' }}>
                                                    Showing first 100 of {filtered.length} {errorCodeFilter === 'ALL' ? '' : errorCodeFilter + ' '}errors. Download CSV for full list.
                                                </p>
                                            )}
                                        </>
                                    )
                                })()}
                            </>
                        )}
                    </>
                )}

                {activeTab === 'fixes' && errorAnalysis && (
                    <>
                        <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 12 }}>
                            {errorAnalysis.fixable.length} error{errorAnalysis.fixable.length !== 1 ? 's' : ''} may be
                            fixable. Review the suggestions below, correct your spreadsheet, and re-import.
                        </p>
                        {errorAnalysis.unfixable.length > 0 && (
                            <NoticeBox warning title={`${errorAnalysis.unfixable.length} unfixable errors`} style={{ marginBottom: 12 }}>
                                Some errors require manual investigation (e.g. duplicate non-repeatable events).
                            </NoticeBox>
                        )}
                        <DataTable>
                            <DataTableHead>
                                <DataTableRow>
                                    <DataTableColumnHeader>Error Code</DataTableColumnHeader>
                                    <DataTableColumnHeader>Fix Type</DataTableColumnHeader>
                                    <DataTableColumnHeader>Excel Row</DataTableColumnHeader>
                                    <DataTableColumnHeader>Message</DataTableColumnHeader>
                                    <DataTableColumnHeader>Suggested Fix</DataTableColumnHeader>
                                </DataTableRow>
                            </DataTableHead>
                            <DataTableBody>
                                {errorAnalysis.fixable.slice(0, 100).map((f, i) => (
                                    <DataTableRow key={i}>
                                        <DataTableCell>
                                            <Tag neutral>{f.errorCode}</Tag>
                                        </DataTableCell>
                                        <DataTableCell>{f.fixLabel}</DataTableCell>
                                        <DataTableCell>{f.excelRow ?? '-'}</DataTableCell>
                                        <DataTableCell>{f.message}</DataTableCell>
                                        <DataTableCell>
                                            {f.suggestion ? (
                                                <span style={{ color: '#2b6cb0', fontWeight: 600 }}>
                                                    {f.suggestion.value}
                                                    {' '}
                                                    <Tag positive={f.suggestion.confidence >= 80} neutral={f.suggestion.confidence < 80}>
                                                        {f.suggestion.confidence}%
                                                    </Tag>
                                                </span>
                                            ) : (
                                                <span style={{ color: '#6b7280' }}>No suggestion</span>
                                            )}
                                        </DataTableCell>
                                    </DataTableRow>
                                ))}
                            </DataTableBody>
                        </DataTable>
                        {errorAnalysis.fixable.length > 100 && (
                            <p style={{ marginTop: 8, color: '#4a5568' }}>
                                Showing first 100 of {errorAnalysis.fixable.length} fixable errors.
                            </p>
                        )}
                    </>
                )}
            </div>

            <ButtonStrip style={{ marginTop: 16 }}>
                <Button onClick={onReset}>Import More Data</Button>
            </ButtonStrip>
        </div>
    )
}
