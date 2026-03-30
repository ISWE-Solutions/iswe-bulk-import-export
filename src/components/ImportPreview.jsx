import React, { useMemo, useState, useCallback } from 'react'
import {
    Button,
    ButtonStrip,
    Checkbox,
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
import { buildTrackerPayload, buildEventPayload, buildDataEntryPayload } from '../lib/payloadBuilder'
import { validateParsedData, validateEventData, validateDataEntryData, filterValidRows } from '../lib/validator'
import { analyzeData, applySuggestions } from '../lib/dataCleaner'

export const ImportPreview = ({ parsedData, metadata, onConfirm, onBack }) => {
    const [activeTab, setActiveTab] = useState('summary')
    const [cleanedData, setCleanedData] = useState(null)
    const [accepted, setAccepted] = useState({}) // { index: boolean }
    const [appliedCount, setAppliedCount] = useState(0)
    const isEventProgram = metadata.programType === 'WITHOUT_REGISTRATION'
    const isDataEntry = !!parsedData.dataValues

    // Use cleaned data if available, otherwise original
    const activeData = cleanedData ?? parsedData

    const validationResult = useMemo(
        () => isDataEntry
            ? validateDataEntryData(activeData, metadata)
            : isEventProgram
                ? validateEventData(activeData, metadata)
                : validateParsedData(activeData, metadata),
        [activeData, metadata, isEventProgram, isDataEntry]
    )

    // Level 2: Analyze data for fuzzy-match suggestions
    const suggestions = useMemo(
        () => analyzeData(activeData, metadata),
        [activeData, metadata]
    )

    // Toggle a single suggestion
    const toggleSuggestion = useCallback((idx) => {
        setAccepted((prev) => ({ ...prev, [idx]: !prev[idx] }))
    }, [])

    // Accept / reject all
    const acceptAll = useCallback(() => {
        const map = {}
        suggestions.forEach((_, i) => { map[i] = true })
        setAccepted(map)
    }, [suggestions])

    const rejectAll = useCallback(() => {
        setAccepted({})
    }, [])

    // Deep-clone parsedData and apply accepted suggestions, then re-validate
    const applyFixes = useCallback(() => {
        const clone = JSON.parse(JSON.stringify(parsedData))
        const toApply = suggestions.map((s, i) => ({ ...s, accepted: !!accepted[i] }))
        applySuggestions(clone, toApply)
        setCleanedData(clone)
        setAppliedCount(toApply.filter((s) => s.accepted).length)
        setAccepted({})
        setActiveTab('summary')
    }, [parsedData, suggestions, accepted])

    const acceptedCount = Object.values(accepted).filter(Boolean).length

    const summary = useMemo(() => {
        if (isDataEntry) {
            const dvCount = activeData.dataValues?.length ?? 0
            const orgUnits = new Set(activeData.dataValues?.map((dv) => dv.orgUnit) ?? [])
            const periods = new Set(activeData.dataValues?.map((dv) => dv.period) ?? [])
            return { dvCount, orgUnitCount: orgUnits.size, periodCount: periods.size }
        }
        if (isEventProgram) {
            const eventCounts = {}
            for (const stage of metadata.programStages ?? []) {
                eventCounts[stage.displayName] = activeData.events?.[stage.id]?.length ?? 0
            }
            const totalEvents = Object.values(eventCounts).reduce((s, c) => s + c, 0)
            return { teiCount: 0, totalEvents, eventCounts }
        }
        const teiCount = activeData.trackedEntities?.length ?? 0
        const eventCounts = {}
        for (const stage of metadata.programStages ?? []) {
            const stageData = activeData.stageData?.[stage.id]
            eventCounts[stage.displayName] = stageData?.length ?? 0
        }
        return { teiCount, eventCounts }
    }, [activeData, metadata, isEventProgram])

    const handleConfirm = () => {
        const { payload, rowMap } = isDataEntry
            ? buildDataEntryPayload(activeData)
            : isEventProgram
                ? buildEventPayload(activeData, metadata)
                : buildTrackerPayload(activeData, metadata)
        onConfirm(payload, rowMap)
    }

    // Import only valid rows — filter out errored rows, build payload from the rest
    const handleConfirmValid = () => {
        const { filtered, skippedRows } = filterValidRows(activeData, validationResult.errors)
        const { payload, rowMap } = isDataEntry
            ? buildDataEntryPayload(filtered)
            : isEventProgram
                ? buildEventPayload(filtered, metadata)
                : buildTrackerPayload(filtered, metadata)
        onConfirm(payload, rowMap, skippedRows)
    }

    const errorCount = validationResult.errors.length
    const warningCount = validationResult.warnings.length

    // Estimate total items for large-import notice
    const totalImportItems = useMemo(() => {
        if (isDataEntry) return activeData.dataValues?.length ?? 0
        if (isEventProgram) {
            return Object.values(activeData.events ?? {}).reduce((s, arr) => s + arr.length, 0)
        }
        return activeData.trackedEntities?.length ?? 0
    }, [activeData, isEventProgram, isDataEntry])
    const isLargeImport = totalImportItems > 5000
    const itemLabel = isDataEntry ? 'data values' : isEventProgram ? 'events' : 'tracked entities'

    // Count how many distinct rows have errors (for the "Import N valid rows" label)
    // For tracker: count only TEI-level errored rows (stage errors remove events, not TEIs)
    const erroredRowCount = useMemo(() => {
        const keys = new Set()
        for (const e of validationResult.errors) {
            if (e.row == null) continue
            if (!isDataEntry && !isEventProgram) {
                // Tracker: only count TEI Sheet errors toward the primary count
                if (e.source === 'TEI Sheet') keys.add(`${e.source}:${e.row}`)
            } else {
                keys.add(`${e.stageId ?? e.source}:${e.row}`)
            }
        }
        return keys.size
    }, [validationResult.errors, isDataEntry, isEventProgram])

    // Count stage-level errored event rows separately for the label
    const erroredEventRowCount = useMemo(() => {
        if (isDataEntry || isEventProgram) return 0
        const keys = new Set()
        for (const e of validationResult.errors) {
            if (e.row != null && e.stageId) keys.add(`${e.stageId}:${e.row}`)
        }
        return keys.size
    }, [validationResult.errors, isDataEntry, isEventProgram])

    const validRowCount = totalImportItems - erroredRowCount

    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Preview &amp; Validate</h2>
            <p style={{ color: '#4a5568', margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 }}>
                Review the parsed data below. Fix any validation errors in your spreadsheet and re-upload, or continue to import.
            </p>

            <TabBar>
                <Tab selected={activeTab === 'summary'} onClick={() => setActiveTab('summary')}>
                    Summary
                </Tab>
                {suggestions.length > 0 && (
                    <Tab selected={activeTab === 'cleaning'} onClick={() => setActiveTab('cleaning')}>
                        Data Cleaning <Tag neutral>{suggestions.length}</Tag>
                    </Tab>
                )}
                <Tab selected={activeTab === 'errors'} onClick={() => setActiveTab('errors')}>
                    Errors {errorCount > 0 && <Tag negative>{errorCount}</Tag>}
                </Tab>
                <Tab selected={activeTab === 'warnings'} onClick={() => setActiveTab('warnings')}>
                    Warnings {warningCount > 0 && <Tag neutral>{warningCount}</Tag>}
                </Tab>
            </TabBar>

            <div style={{ marginTop: 16 }}>
                {activeTab === 'summary' && (
                    <>
                        <DataTable>
                            <DataTableHead>
                                <DataTableRow>
                                    <DataTableColumnHeader>Item</DataTableColumnHeader>
                                    <DataTableColumnHeader>Count</DataTableColumnHeader>
                                </DataTableRow>
                            </DataTableHead>
                            <DataTableBody>
                                {isDataEntry && (
                                    <>
                                        <DataTableRow>
                                            <DataTableCell>Data Values</DataTableCell>
                                            <DataTableCell>{summary.dvCount}</DataTableCell>
                                        </DataTableRow>
                                        <DataTableRow>
                                            <DataTableCell>Organisation Units</DataTableCell>
                                            <DataTableCell>{summary.orgUnitCount}</DataTableCell>
                                        </DataTableRow>
                                        <DataTableRow>
                                            <DataTableCell>Periods</DataTableCell>
                                            <DataTableCell>{summary.periodCount}</DataTableCell>
                                        </DataTableRow>
                                    </>
                                )}
                                {!isDataEntry && !isEventProgram && (
                                <DataTableRow>
                                    <DataTableCell>Tracked Entities</DataTableCell>
                                    <DataTableCell>{summary.teiCount}</DataTableCell>
                                </DataTableRow>
                                )}
                                {!isDataEntry && Object.entries(summary.eventCounts ?? {}).map(([name, count]) => (
                                    <DataTableRow key={name}>
                                        <DataTableCell>Events: {name}</DataTableCell>
                                        <DataTableCell>{count}</DataTableCell>
                                    </DataTableRow>
                                ))}
                            </DataTableBody>
                        </DataTable>

                        {errorCount === 0 && (
                            <NoticeBox title="Validation Passed" style={{ marginTop: 16 }}>
                                All rows passed validation. Ready to import.
                            </NoticeBox>
                        )}
                        {errorCount > 0 && (() => {
                            const totalErroredRows = erroredRowCount + erroredEventRowCount
                            const detail = erroredEventRowCount > 0
                                ? `${erroredRowCount} ${itemLabel} and ${erroredEventRowCount} event row${erroredEventRowCount !== 1 ? 's' : ''}`
                                : `${erroredRowCount} row${erroredRowCount !== 1 ? 's' : ''}`
                            return (
                            <NoticeBox error title={`${errorCount} validation error${errorCount !== 1 ? 's' : ''} in ${detail}`} style={{ marginTop: 16 }}>
                                {validRowCount > 0
                                    ? `You can skip errored rows and import the remaining ${validRowCount} valid ${itemLabel}. Failed rows can be exported for correction.`
                                    : 'All rows have errors. Fix them in your spreadsheet and re-upload.'}
                            </NoticeBox>
                            )
                        })()}
                        {suggestions.length > 0 && (
                            <NoticeBox warning title={`${suggestions.length} data cleaning suggestions`} style={{ marginTop: 16 }}>
                                The Data Cleaning tab has suggestions that may fix issues. Review before importing.
                            </NoticeBox>
                        )}
                    </>
                )}

                {activeTab === 'cleaning' && (
                    <>
                        {appliedCount > 0 && (
                            <NoticeBox title={`${appliedCount} fixes applied`} style={{ marginBottom: 12 }}>
                                Data has been cleaned and re-validated. Review the Summary and Errors tabs.
                            </NoticeBox>
                        )}
                        {suggestions.length === 0 ? (
                            <NoticeBox title="No Suggestions">No data cleaning suggestions.</NoticeBox>
                        ) : (
                            <>
                                <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 12 }}>
                                    {suggestions.length} potential fix{suggestions.length !== 1 ? 'es' : ''} found.
                                    Select which to apply, then click &quot;Apply Fixes &amp; Re-validate&quot;.
                                </p>
                                <ButtonStrip style={{ marginBottom: 12 }}>
                                    <Button small onClick={acceptAll}>Accept All</Button>
                                    <Button small secondary onClick={rejectAll}>Reject All</Button>
                                    <Button
                                        small
                                        primary
                                        disabled={acceptedCount === 0}
                                        onClick={applyFixes}
                                    >
                                        Apply {acceptedCount} Fix{acceptedCount !== 1 ? 'es' : ''} &amp; Re-validate
                                    </Button>
                                </ButtonStrip>
                                <DataTable>
                                    <DataTableHead>
                                        <DataTableRow>
                                            <DataTableColumnHeader width="48px" />
                                            <DataTableColumnHeader>Source</DataTableColumnHeader>
                                            <DataTableColumnHeader>Row</DataTableColumnHeader>
                                            <DataTableColumnHeader>Field</DataTableColumnHeader>
                                            <DataTableColumnHeader>Original</DataTableColumnHeader>
                                            <DataTableColumnHeader>Suggested</DataTableColumnHeader>
                                            <DataTableColumnHeader>Confidence</DataTableColumnHeader>
                                        </DataTableRow>
                                    </DataTableHead>
                                    <DataTableBody>
                                        {suggestions.slice(0, 200).map((s, i) => (
                                            <DataTableRow key={i}>
                                                <DataTableCell>
                                                    <Checkbox
                                                        checked={!!accepted[i]}
                                                        onChange={() => toggleSuggestion(i)}
                                                    />
                                                </DataTableCell>
                                                <DataTableCell>{s.source || '-'}</DataTableCell>
                                                <DataTableCell>{s.row ?? '-'}</DataTableCell>
                                                <DataTableCell>{s.fieldLabel || s.field || '-'}</DataTableCell>
                                                <DataTableCell>
                                                    <span style={{ color: '#c53030' }}>{s.original}</span>
                                                </DataTableCell>
                                                <DataTableCell>
                                                    <span style={{ color: '#2b6cb0', fontWeight: 600 }}>{s.suggested}</span>
                                                </DataTableCell>
                                                <DataTableCell>
                                                    <Tag positive={s.confidence >= 80} neutral={s.confidence < 80}>
                                                        {s.confidence}%
                                                    </Tag>
                                                </DataTableCell>
                                            </DataTableRow>
                                        ))}
                                    </DataTableBody>
                                </DataTable>
                                {suggestions.length > 200 && (
                                    <p style={{ marginTop: 8, color: '#4a5568' }}>
                                        Showing first 200 of {suggestions.length} suggestions.
                                    </p>
                                )}
                            </>
                        )}
                    </>
                )}

                {activeTab === 'errors' && (
                    <>
                        {errorCount === 0 ? (
                            <NoticeBox title="No Errors">No validation errors found.</NoticeBox>
                        ) : (
                            <DataTable>
                                <DataTableHead>
                                    <DataTableRow>
                                        <DataTableColumnHeader>Source</DataTableColumnHeader>
                                        <DataTableColumnHeader>Row</DataTableColumnHeader>
                                        <DataTableColumnHeader>Field</DataTableColumnHeader>
                                        <DataTableColumnHeader>Message</DataTableColumnHeader>
                                    </DataTableRow>
                                </DataTableHead>
                                <DataTableBody>
                                    {validationResult.errors.slice(0, 100).map((e, i) => (
                                        <DataTableRow key={i}>
                                            <DataTableCell>{e.source || '-'}</DataTableCell>
                                            <DataTableCell>{e.row ?? '-'}</DataTableCell>
                                            <DataTableCell>{e.field || '-'}</DataTableCell>
                                            <DataTableCell>{e.message}</DataTableCell>
                                        </DataTableRow>
                                    ))}
                                </DataTableBody>
                            </DataTable>
                        )}
                        {errorCount > 100 && (
                            <p style={{ marginTop: 8, color: '#4a5568' }}>
                                Showing first 100 of {errorCount} errors.
                            </p>
                        )}
                    </>
                )}

                {activeTab === 'warnings' && (
                    <>
                        {warningCount === 0 ? (
                            <NoticeBox title="No Warnings">No warnings.</NoticeBox>
                        ) : (
                            <DataTable>
                                <DataTableHead>
                                    <DataTableRow>
                                        <DataTableColumnHeader>Source</DataTableColumnHeader>
                                        <DataTableColumnHeader>Row</DataTableColumnHeader>
                                        <DataTableColumnHeader>Field</DataTableColumnHeader>
                                        <DataTableColumnHeader>Message</DataTableColumnHeader>
                                    </DataTableRow>
                                </DataTableHead>
                                <DataTableBody>
                                    {validationResult.warnings.slice(0, 100).map((w, i) => (
                                        <DataTableRow key={i}>
                                            <DataTableCell>{w.source || '-'}</DataTableCell>
                                            <DataTableCell>{w.row ?? '-'}</DataTableCell>
                                            <DataTableCell>{w.field || '-'}</DataTableCell>
                                            <DataTableCell>{w.message}</DataTableCell>
                                        </DataTableRow>
                                    ))}
                                </DataTableBody>
                            </DataTable>
                        )}
                        {warningCount > 100 && (
                            <p style={{ marginTop: 8, color: '#4a5568' }}>
                                Showing first 100 of {warningCount} warnings.
                            </p>
                        )}
                    </>
                )}
            </div>

            {isLargeImport && (
                <NoticeBox warning title="Large Import" style={{ marginTop: 16 }}>
                    This file contains {totalImportItems.toLocaleString()} {itemLabel}. The import will be submitted
                    in batches and may take several minutes. Do not close this page during import.
                </NoticeBox>
            )}

            <ButtonStrip style={{ marginTop: 16 }}>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                {errorCount > 0 && validRowCount > 0 && (
                    <Button onClick={handleConfirmValid} destructive>
                        Skip Errors — Import {validRowCount} Valid {itemLabel}
                    </Button>
                )}
                <Button
                    onClick={handleConfirm}
                    primary
                    disabled={errorCount > 0}
                >
                    Start Import
                </Button>
            </ButtonStrip>
        </div>
    )
}
