import React, { useState, useMemo } from 'react'
import { useDataQuery } from '@dhis2/app-runtime'
import {
    Button,
    ButtonStrip,
    InputField,
    NoticeBox,
    OrganisationUnitTree,
    Checkbox,
    CircularLoader,
    Radio,
} from '@dhis2/ui'
import { generatePeriods } from '../lib/periodGenerator'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/** Fetch user's assigned root org units for the tree. */
const ROOT_QUERY = {
    me: {
        resource: 'me',
        params: { fields: 'organisationUnits[id,path,displayName]' },
    },
}

/**
 * Export configuration step — org unit tree, date range / periods.
 *
 * Props:
 *  - metadata: program or data set metadata
 *  - isDataEntry: boolean
 *  - importType: 'tracker' | 'event' | 'dataEntry'
 *  - onExport: ({ orgUnits, includeChildren, startDate, endDate, periods, exportFormat, fileFormat }) => void
 *  - onBack: () => void
 */
export const ExportConfigurator = ({ metadata, isDataEntry, importType, onExport, onBack }) => {
    const { data: meData, loading: meLoading, error: meError } = useDataQuery(ROOT_QUERY)
    const [selectedPaths, setSelectedPaths] = useState([])
    const [includeChildren, setIncludeChildren] = useState(true)
    const [startDate, setStartDate] = useState('')
    const [endDate, setEndDate] = useState('')
    const [exportFormat, setExportFormat] = useState('flat')
    const [fileFormat, setFileFormat] = useState('excel') // 'excel' | 'json'
    const [includeHierarchy, setIncludeHierarchy] = useState(true)
    const [includeUids, setIncludeUids] = useState(false)
    const [stripAudit, setStripAudit] = useState(true)
    const [includeDeleted, setIncludeDeleted] = useState(false)

    // For aggregate data-entry export, derive DHIS2 period codes from the date range
    const generatedPeriods = useMemo(() => {
        if (!isDataEntry) return []
        return generatePeriods(metadata?.periodType, startDate, endDate)
    }, [isDataEntry, metadata, startDate, endDate])

    const roots = useMemo(() => {
        return (meData?.me?.organisationUnits ?? []).map((ou) => ou.id)
    }, [meData])

    /** Extract org unit ID from the last segment of a path string. */
    const idsFromPaths = useMemo(() => {
        return selectedPaths.map((p) => p.split('/').filter(Boolean).pop())
    }, [selectedPaths])

    const handleOrgUnitChange = ({ selected }) => {
        setSelectedPaths(selected)
    }

    const canExport = selectedPaths.length > 0 && startDate && endDate && (!isDataEntry || generatedPeriods.length > 0)

    const handleExport = () => {
        if (!canExport) return
        onExport({
            orgUnits: idsFromPaths,
            includeChildren,
            startDate: isDataEntry ? undefined : startDate,
            endDate: isDataEntry ? undefined : endDate,
            periods: isDataEntry ? generatedPeriods : undefined,
            exportFormat: importType === 'tracker' ? exportFormat : undefined,
            fileFormat,
            includeHierarchy,
            includeUids,
            stripAudit,
            includeDeleted,
        })
    }

    return (
        <div>
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
                <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #7B1FA2, #4A148C)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 12, boxShadow: '0 4px 12px rgba(74,20,140,0.25)',
                }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <path d="M14 3v14M10 13l4 4 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M4 20v4a2 2 0 002 2h16a2 2 0 002-2v-4" stroke="white" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a202c', fontFamily: FONT }}>
                    Configure Export
                </h2>
                <p style={{
                    color: '#4a5568', margin: '0 0 8px', fontSize: 15,
                    maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6, fontFamily: FONT,
                }}>
                    Select organisation units and {isDataEntry ? 'period(s)' : 'date range'} to export data.
                </p>
            </div>

            <div style={{ borderTop: '1px solid #e0e5ec', margin: '0 0 20px' }} />

            <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Org Unit Tree */}
                <div>
                    <div style={{
                        fontSize: 14, fontWeight: 600, color: '#1a202c',
                        marginBottom: 8, fontFamily: FONT,
                    }}>
                        Organisation Units
                        {selectedPaths.length > 0 && (
                            <span style={{
                                marginLeft: 8, fontSize: 12, fontWeight: 500,
                                color: '#1565C0', background: '#e3f2fd',
                                padding: '2px 8px', borderRadius: 10,
                            }}>
                                {selectedPaths.length} selected
                            </span>
                        )}
                    </div>
                    <div style={{
                        border: '1px solid #d1d5db', borderRadius: 6,
                        maxHeight: 280, overflowY: 'auto', padding: '8px 12px',
                        background: '#fafbfc',
                    }}>
                        {meLoading && (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
                                <CircularLoader small />
                            </div>
                        )}
                        {meError && (
                            <NoticeBox error title="Failed to load org units">
                                {meError.message || 'Could not load organisation units'}
                            </NoticeBox>
                        )}
                        {roots.length > 0 && (
                            <OrganisationUnitTree
                                roots={roots}
                                selected={selectedPaths}
                                onChange={handleOrgUnitChange}
                                initiallyExpanded={roots.map((id) => `/${id}`)}
                            />
                        )}
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <Checkbox
                            checked={includeChildren}
                            onChange={({ checked }) => setIncludeChildren(checked)}
                            label="Include child organisation units"
                        />
                    </div>
                </div>

                {importType === 'tracker' && (
                    <div>
                        <div style={{
                            fontSize: 14, fontWeight: 600, color: '#1a202c',
                            marginBottom: 8, fontFamily: FONT,
                        }}>
                            Export Format
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Radio
                                label="Separate sheets — TEI sheet + one sheet per program stage"
                                checked={exportFormat === 'sheets'}
                                onChange={() => setExportFormat('sheets')}
                                name="exportFormat"
                                value="sheets"
                            />
                            <Radio
                                label="Flat rows — one row per event with all TEI, enrollment and event data"
                                checked={exportFormat === 'flat'}
                                onChange={() => setExportFormat('flat')}
                                name="exportFormat"
                                value="flat"
                            />
                        </div>
                    </div>
                )}

                <div>
                    <div style={{
                        fontSize: 14, fontWeight: 600, color: '#1a202c',
                        marginBottom: 8, fontFamily: FONT,
                    }}>
                        Output File Format
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Radio
                            label="Excel workbook (.xlsx) — human-editable spreadsheet"
                            checked={fileFormat === 'excel'}
                            onChange={() => setFileFormat('excel')}
                            name="fileFormat"
                            value="excel"
                        />
                        <Radio
                            label="JSON (.json) — native DHIS2 payload, directly re-importable"
                            checked={fileFormat === 'json'}
                            onChange={() => setFileFormat('json')}
                            name="fileFormat"
                            value="json"
                        />
                    </div>
                </div>

                {fileFormat === 'excel' && (
                    <div>
                        <div style={{
                            fontSize: 14, fontWeight: 600, color: '#1a202c',
                            marginBottom: 8, fontFamily: FONT,
                        }}>
                            Organisation Unit Columns
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Checkbox
                                checked={includeHierarchy}
                                onChange={({ checked }) => setIncludeHierarchy(checked)}
                                label="Include full hierarchy columns (OU_L1, OU_L2 … one per level)"
                            />
                            <Checkbox
                                checked={includeUids}
                                onChange={({ checked }) => setIncludeUids(checked)}
                                label="Include org unit UID column"
                            />
                        </div>
                    </div>
                )}

                <div>
                    <div style={{
                        fontSize: 14, fontWeight: 600, color: '#1a202c',
                        marginBottom: 8, fontFamily: FONT,
                    }}>
                        Export Options
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Checkbox
                            checked={stripAudit}
                            onChange={({ checked }) => setStripAudit(checked)}
                            label="Strip audit fields (createdAt, updatedAt, storedBy, createdBy)"
                        />
                        <Checkbox
                            checked={includeDeleted}
                            onChange={({ checked }) => setIncludeDeleted(checked)}
                            label="Include soft-deleted records"
                        />
                    </div>
                </div>

                {isDataEntry ? (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <InputField
                                label="From"
                                type="date"
                                value={startDate}
                                onChange={({ value }) => setStartDate(value)}
                            />
                            <InputField
                                label="To"
                                type="date"
                                value={endDate}
                                onChange={({ value }) => setEndDate(value)}
                            />
                        </div>
                        <div style={{ marginTop: 8, fontSize: 13, color: '#4a5568', fontFamily: FONT }}>
                            {!startDate || !endDate ? (
                                <span>Pick a date range to auto-generate <strong>{metadata?.periodType ?? 'period'}</strong> codes.</span>
                            ) : generatedPeriods.length === 0 ? (
                                <span style={{ color: '#b91c1c' }}>
                                    Unable to generate periods for this range ({metadata?.periodType ?? 'unknown period type'}).
                                </span>
                            ) : (
                                <span>
                                    <strong>{generatedPeriods.length}</strong> {metadata?.periodType} period
                                    {generatedPeriods.length === 1 ? '' : 's'} will be exported:&nbsp;
                                    <code style={{ fontSize: 12 }}>
                                        {generatedPeriods.slice(0, 6).join(', ')}
                                        {generatedPeriods.length > 6 ? ` … +${generatedPeriods.length - 6} more` : ''}
                                    </code>
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <InputField
                            label="Start Date"
                            type="date"
                            value={startDate}
                            onChange={({ value }) => setStartDate(value)}
                        />
                        <InputField
                            label="End Date"
                            type="date"
                            value={endDate}
                            onChange={({ value }) => setEndDate(value)}
                        />
                    </div>
                )}

                {isDataEntry && metadata?.periodType && !['Daily','Weekly','WeeklyWednesday','WeeklyThursday','WeeklySaturday','WeeklySunday','Monthly','BiMonthly','Quarterly','SixMonthly','SixMonthlyApril','Yearly','FinancialApril','FinancialJuly','FinancialOct','FinancialNov'].includes(metadata.periodType) && (
                    <NoticeBox warning title="Unsupported Period Type">
                        Auto-generation is not implemented for <strong>{metadata.periodType}</strong>. Please export a shorter range or use the aggregate import instead.
                    </NoticeBox>
                )}
            </div>

            <ButtonStrip style={{ marginTop: 24 }}>
                <Button secondary onClick={onBack}>Back</Button>
                <Button primary onClick={handleExport} disabled={!canExport}>
                    Export to Excel
                </Button>
            </ButtonStrip>
        </div>
    )
}
