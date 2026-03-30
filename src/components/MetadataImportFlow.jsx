import React, { useCallback, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, ButtonStrip, CircularLoader, NoticeBox } from '@dhis2/ui'
import * as XLSX from 'xlsx'
import {
    buildMetadataWorkbook,
    buildAllMetadataWorkbook,
    downloadMetadataWorkbook,
    parseMetadataFile,
    parseAllMetadataFile,
} from '../lib/metadataExporter'
import { METADATA_TYPES } from './MetadataTypeSelector'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// Import order: dependencies first (option sets, then org units by level, then everything else)
const IMPORT_ORDER = [
    'categoryOptions', 'categories', 'categoryCombos',
    'optionSets',
    'trackedEntityTypes', 'trackedEntityAttributes',
    'organisationUnits', 'organisationUnitGroups', 'organisationUnitGroupSets',
    'dataElements', 'dataElementGroups', 'dataElementGroupSets',
    'indicatorTypes', 'indicators', 'indicatorGroups',
]

// Build labels/colors from METADATA_TYPES dynamically
const TYPE_LABELS = {}
const TYPE_COLORS = {}
for (const mt of METADATA_TYPES) {
    if (mt.resource) { TYPE_LABELS[mt.key] = mt.label; TYPE_COLORS[mt.key] = mt.color }
}

/**
 * Accumulate import stats from a DHIS2 metadata response into a combined result.
 */
function accumulateStats(target, response) {
    const s = response?.stats ?? response?.response?.stats ?? {}
    target.stats.created += s.created ?? 0
    target.stats.updated += s.updated ?? 0
    target.stats.deleted += s.deleted ?? 0
    target.stats.ignored += s.ignored ?? 0
    target.stats.total += s.total ?? 0
    const trs = response?.typeReports ?? response?.response?.typeReports ?? []
    target.typeReports.push(...trs)
}

/**
 * Compute org unit level by walking up the parent chain within the batch.
 */
function computeOULevel(ou, allOUs) {
    const idMap = {}
    for (const o of allOUs) { if (o.id) idMap[o.id] = o }
    let depth = 1
    let current = ou
    const seen = new Set()
    while (current.parent?.id) {
        if (seen.has(current.parent.id)) break
        seen.add(current.parent.id)
        const parent = idMap[current.parent.id]
        if (parent) { depth++; current = parent }
        else { depth++; break }
    }
    return depth
}

/**
 * Metadata import flow: Template → Upload → Preview → Import.
 * Rendered inline; tracks its own sub-step.
 *
 * Props:
 *  - metadataType: type definition from METADATA_TYPES
 *  - onReset: () => void
 *  - onBack: () => void
 */
export const MetadataImportFlow = ({ metadataType, onReset, onBack }) => {
    const engine = useDataEngine()
    // sub-steps: template | upload | preview | importing | done | error
    const [subStep, setSubStep] = useState('template')
    const [parsedResult, setParsedResult] = useState(null)
    const [importResult, setImportResult] = useState(null)
    const [error, setError] = useState(null)
    const [statusMsg, setStatusMsg] = useState('')
    const [dragOver, setDragOver] = useState(false)

    const handleDownloadTemplate = useCallback(() => {
        if (metadataType.key === 'allMetadata') {
            const realTypes = METADATA_TYPES.filter((t) => t.resource)
            const { wb, filename, sheetColors } = buildAllMetadataWorkbook(realTypes, {})
            downloadMetadataWorkbook(wb, filename, sheetColors)
        } else {
            const { wb, filename, sheetColors } = buildMetadataWorkbook(metadataType, null)
            downloadMetadataWorkbook(wb, filename, sheetColors)
        }
    }, [metadataType])

    const handleDownloadWithData = useCallback(async () => {
        setStatusMsg('Fetching existing data for template...')
        try {
            if (metadataType.key === 'allMetadata') {
                const realTypes = METADATA_TYPES.filter((t) => t.resource)
                const dataByType = {}
                for (const mt of realTypes) {
                    setStatusMsg(`Fetching ${mt.label}...`)
                    const result = await engine.query({
                        data: { resource: mt.resource, params: { fields: mt.fields, paging: false } },
                    })
                    dataByType[mt.key] = result?.data?.[mt.resource] ?? []
                }
                const { wb, filename, sheetColors } = buildAllMetadataWorkbook(realTypes, dataByType)
                downloadMetadataWorkbook(wb, filename, sheetColors)
            } else {
                const result = await engine.query({
                    data: {
                        resource: metadataType.resource,
                        params: { fields: metadataType.fields, paging: false },
                    },
                })
                const data = result?.data?.[metadataType.resource] ?? []
                const { wb, filename, sheetColors } = buildMetadataWorkbook(metadataType, data)
                downloadMetadataWorkbook(wb, filename, sheetColors)
            }
            setStatusMsg('')
        } catch (e) {
            setStatusMsg('')
            setError(e.message)
        }
    }, [engine, metadataType])

    const handleFileSelected = useCallback((file) => {
        const reader = new FileReader()
        reader.onload = (e) => {
            try {
                if (metadataType.key === 'allMetadata') {
                    const realTypes = METADATA_TYPES.filter((t) => t.resource)
                    const typeResults = parseAllMetadataFile(e.target.result, realTypes)
                    setParsedResult({ isAllMetadata: true, types: typeResults })
                } else {
                    const result = parseMetadataFile(e.target.result, metadataType)
                    setParsedResult(result)
                }
                setSubStep('preview')
            } catch (err) {
                setError(err.message || 'Failed to parse file')
                setSubStep('error')
            }
        }
        reader.readAsArrayBuffer(file)
    }, [metadataType])

    const handleDrop = useCallback((e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer?.files?.[0]
        if (file) handleFileSelected(file)
    }, [handleFileSelected])

    const handleImport = useCallback(async () => {
        setSubStep('importing')
        setStatusMsg('Importing metadata...')
        try {
            if (parsedResult?.isAllMetadata) {
                // Combined import — option sets → org units (by level) → data elements → indicators
                let combined = { stats: { created: 0, updated: 0, deleted: 0, ignored: 0, total: 0 }, typeReports: [] }

                for (const key of IMPORT_ORDER) {
                    const tr = parsedResult.types[key]
                    if (!tr || tr.error || !tr.summary || tr.summary.total === 0) continue

                    setStatusMsg(`Importing ${TYPE_LABELS[key]}...`)

                    if (key === 'organisationUnits' && tr.summary.levelCounts) {
                        const allOUs = tr.payload.organisationUnits
                        const levels = new Map()
                        for (const ou of allOUs) {
                            const level = computeOULevel(ou, allOUs)
                            if (!levels.has(level)) levels.set(level, [])
                            levels.get(level).push(ou)
                        }
                        for (const level of [...levels.keys()].sort((a, b) => a - b)) {
                            const batch = levels.get(level)
                            setStatusMsg(`Importing org units level ${level} (${batch.length})...`)
                            const resp = await engine.mutate({
                                resource: 'metadata', type: 'create',
                                params: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'NONE' },
                                data: { organisationUnits: batch },
                            })
                            accumulateStats(combined, resp)
                        }
                    } else {
                        const resp = await engine.mutate({
                            resource: 'metadata', type: 'create',
                            params: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'NONE' },
                            data: tr.payload,
                        })
                        accumulateStats(combined, resp)
                    }
                }
                setImportResult(combined)
            } else if (metadataType.key === 'organisationUnits' && parsedResult.summary.levelCounts) {
                // Org units: import level-by-level so parents exist before children
                const allOUs = parsedResult.payload.organisationUnits
                const levels = new Map()
                for (const ou of allOUs) {
                    const level = computeOULevel(ou, allOUs)
                    if (!levels.has(level)) levels.set(level, [])
                    levels.get(level).push(ou)
                }
                const sortedLevels = [...levels.keys()].sort((a, b) => a - b)
                let combinedResponse = { stats: { created: 0, updated: 0, deleted: 0, ignored: 0, total: 0 }, typeReports: [] }

                for (const level of sortedLevels) {
                    const batch = levels.get(level)
                    setStatusMsg(`Importing level ${level} (${batch.length} org units)...`)
                    const response = await engine.mutate({
                        resource: 'metadata',
                        type: 'create',
                        params: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'NONE' },
                        data: { organisationUnits: batch },
                    })
                    accumulateStats(combinedResponse, response)
                }
                setImportResult(combinedResponse)
            } else {
                const response = await engine.mutate({
                    resource: 'metadata',
                    type: 'create',
                    params: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'NONE' },
                    data: parsedResult.payload,
                })
                setImportResult(response)
            }
            setSubStep('done')
        } catch (e) {
            setError(e.message || 'Import failed')
            setSubStep('error')
        }
    }, [engine, parsedResult, metadataType])

    // --- Template sub-step ---
    if (subStep === 'template') {
        return (
            <div>
                <Header
                    title={`${metadataType.label} Import`}
                    subtitle="Download a template, fill in your data, then upload."
                    color={metadataType.color}
                    icon={metadataType.icon}
                />

                <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{
                        border: '1px solid #e0e5ec', borderRadius: 8, padding: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a202c', fontFamily: FONT }}>
                                Empty Template
                            </div>
                            <div style={{ fontSize: 13, color: '#4a5568', fontFamily: FONT }}>
                                Blank template with headers only
                            </div>
                        </div>
                        <Button small onClick={handleDownloadTemplate}>Download</Button>
                    </div>

                    <div style={{
                        border: '1px solid #e0e5ec', borderRadius: 8, padding: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a202c', fontFamily: FONT }}>
                                Template with Existing Data
                            </div>
                            <div style={{ fontSize: 13, color: '#4a5568', fontFamily: FONT }}>
                                Pre-filled with current {metadataType.label.toLowerCase()} for editing
                            </div>
                        </div>
                        <Button small onClick={handleDownloadWithData} loading={!!statusMsg}>
                            Download
                        </Button>
                    </div>

                    {error && (
                        <NoticeBox error title="Error">{error}</NoticeBox>
                    )}

                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                        <p style={{ fontSize: 13, color: '#6b7280', fontFamily: FONT }}>
                            Columns marked with * are required.
                            {metadataType.key === 'organisationUnits' && ' Use Parent ID (UID) or Parent Name to set the parent. Download with existing data to get the reference sheet for parent lookup.'}
                            {metadataType.key === 'optionSets' && ' Fill both sheets: Option Sets and Options.'}
                            {metadataType.key === 'allMetadata' && ' Each metadata type has its own sheet. Fill only the sheets you need — empty sheets are skipped.'}
                        </p>
                    </div>
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button primary onClick={() => { setError(null); setSubStep('upload') }}>
                        Continue to Upload
                    </Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Upload sub-step ---
    if (subStep === 'upload') {
        return (
            <div>
                <Header
                    title="Upload File"
                    subtitle={`Upload your filled-in ${metadataType.label.toLowerCase()} Excel file.`}
                    color={metadataType.color}
                    icon={metadataType.icon}
                />

                <div
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    style={{
                        maxWidth: 520, margin: '0 auto', padding: 40,
                        border: `2px dashed ${dragOver ? metadataType.color : '#d1d5db'}`,
                        borderRadius: 12, textAlign: 'center',
                        background: dragOver ? metadataType.bg : '#fafbfc',
                        transition: 'all 0.15s ease',
                        cursor: 'pointer',
                    }}
                    onClick={() => {
                        const input = document.createElement('input')
                        input.type = 'file'
                        input.accept = '.xlsx,.xls'
                        input.onchange = (e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileSelected(file)
                        }
                        input.click()
                    }}
                >
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ margin: '0 auto 12px' }}>
                        <rect x="6" y="6" width="36" height="36" rx="8" stroke={metadataType.color} strokeWidth="2" fill="none" />
                        <path d="M24 30V18M20 22l4-4 4 4" stroke={metadataType.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#1a202c', margin: '0 0 4px', fontFamily: FONT }}>
                        Drop your Excel file here
                    </p>
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0, fontFamily: FONT }}>
                        or click to browse
                    </p>
                </div>

                {error && (
                    <NoticeBox error title="Parse Error" style={{ marginTop: 16 }}>{error}</NoticeBox>
                )}

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => { setError(null); setSubStep('template') }}>Back</Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Preview sub-step ---
    if (subStep === 'preview' && parsedResult?.isAllMetadata) {
        const detected = IMPORT_ORDER.filter((key) => {
            const tr = parsedResult.types[key]
            return tr && !tr.error && tr.summary?.total > 0
        })
        const totalRecords = detected.reduce((sum, key) => sum + parsedResult.types[key].summary.total, 0)

        return (
            <div>
                <Header
                    title="All Metadata Import"
                    subtitle="Review detected metadata types before importing."
                    color={metadataType.color}
                    icon={metadataType.icon}
                />

                <div style={{ maxWidth: 520, margin: '0 auto' }}>
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20,
                    }}>
                        <StatCard label="Types Detected" value={detected.length} color="#37474F" />
                        <StatCard label="Total Records" value={totalRecords} color="#37474F" />
                    </div>

                    {detected.length > 0 ? (
                        <div style={{ border: '1px solid #e0e5ec', borderRadius: 8, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, fontFamily: FONT }}>
                                <thead>
                                    <tr style={{ background: '#f7f8fa' }}>
                                        <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Type</th>
                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Total</th>
                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Update</th>
                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>New</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detected.map((key) => {
                                        const { summary } = parsedResult.types[key]
                                        return (
                                            <tr key={key} style={{ borderTop: '1px solid #f0f0f0' }}>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <span style={{
                                                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                                        background: TYPE_COLORS[key] || '#666', marginRight: 8, verticalAlign: 'middle',
                                                    }} />
                                                    {TYPE_LABELS[key]}
                                                </td>
                                                <td style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600 }}>{summary.total}</td>
                                                <td style={{ textAlign: 'right', padding: '8px 12px', color: '#E65100' }}>{summary.withId}</td>
                                                <td style={{ textAlign: 'right', padding: '8px 12px', color: '#2E7D32' }}>{summary.new}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <NoticeBox warning title="No Data Detected">
                            No recognizable metadata found in the uploaded file. Ensure sheets are named correctly
                            (e.g. &quot;Organisation Units&quot;, &quot;Data Elements&quot;, &quot;Option Sets&quot;, &quot;Indicators&quot;).
                        </NoticeBox>
                    )}

                    <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280', fontFamily: FONT }}>
                        Import order: Option Sets → Org Units (by level) → Data Elements → Indicators
                    </div>
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('upload')}>Back</Button>
                    {detected.length > 0 && (
                        <Button primary onClick={handleImport}>
                            Import {totalRecords} Records
                        </Button>
                    )}
                </ButtonStrip>
            </div>
        )
    }

    if (subStep === 'preview') {
        const { summary } = parsedResult
        return (
            <div>
                <Header
                    title="Import Preview"
                    subtitle={`Review ${metadataType.label.toLowerCase()} before importing.`}
                    color={metadataType.color}
                    icon={metadataType.icon}
                />

                <div style={{ maxWidth: 520, margin: '0 auto' }}>
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20,
                    }}>
                        <StatCard label="Total" value={summary.total} color="#1565C0" />
                        <StatCard label="Updates (have ID)" value={summary.withId} color="#E65100" />
                        <StatCard label="New (no ID)" value={summary.new} color="#2E7D32" />
                    </div>

                    {metadataType.key === 'optionSets' && (
                        <NoticeBox title="Option Sets">
                            {summary.total} option set(s) with their options will be imported.
                            Options are grouped by Option Set ID.
                        </NoticeBox>
                    )}

                    {metadataType.key === 'organisationUnits' && summary.new > 0 && (
                        <NoticeBox warning title="New Organisation Units">
                            {summary.new} new org unit(s) will be created.
                            {summary.levelCounts && (
                                <span> Import order by level: {Object.entries(summary.levelCounts)
                                    .sort(([a], [b]) => a - b)
                                    .map(([level, count]) => `L${level}: ${count}`)
                                    .join(' → ')}
                                </span>
                            )}
                        </NoticeBox>
                    )}

                    {metadataType.key === 'organisationUnits' && summary.levelCounts && (
                        <div style={{
                            border: '1px solid #e0e5ec', borderRadius: 8, padding: 12, marginTop: 8,
                            fontSize: 13, color: '#1a202c', fontFamily: FONT,
                        }}>
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>Hierarchy Levels</div>
                            {Object.entries(summary.levelCounts)
                                .sort(([a], [b]) => a - b)
                                .map(([level, count]) => (
                                    <div key={level} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                        <span>Level {level}</span>
                                        <span style={{ fontWeight: 600 }}>{count} org unit{count > 1 ? 's' : ''}</span>
                                    </div>
                                ))}
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                                Imported level-by-level so parents exist before children.
                            </div>
                        </div>
                    )}
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('upload')}>Back</Button>
                    <Button primary onClick={handleImport}>
                        Import {summary.total} {metadataType.label}
                    </Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Importing ---
    if (subStep === 'importing') {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CircularLoader />
                <p style={{ color: '#4a5568', fontSize: 14, marginTop: 16 }}>{statusMsg}</p>
            </div>
        )
    }

    // --- Error ---
    if (subStep === 'error') {
        return (
            <div>
                <NoticeBox error title="Import Failed">{error}</NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={() => { setError(null); setSubStep('preview') }}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Done ---
    const stats = importResult?.stats ?? importResult?.response?.stats ?? {}
    const typeReports = importResult?.typeReports ?? importResult?.response?.typeReports ?? []
    const objectErrors = []
    for (const tr of typeReports) {
        for (const or of (tr.objectReports ?? [])) {
            for (const er of (or.errorReports ?? [])) {
                objectErrors.push(er.message || er.errorCode)
            }
        }
    }

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
                Import Complete
            </h2>

            <div style={{
                display: 'inline-grid', gridTemplateColumns: 'repeat(4, auto)', gap: '0 20px',
                textAlign: 'center', marginBottom: 16,
            }}>
                <StatInline label="Created" value={stats.created ?? 0} color="#2E7D32" />
                <StatInline label="Updated" value={stats.updated ?? 0} color="#1565C0" />
                <StatInline label="Deleted" value={stats.deleted ?? 0} color="#E65100" />
                <StatInline label="Ignored" value={stats.ignored ?? 0} color="#6b7280" />
            </div>

            {objectErrors.length > 0 && (
                <div style={{ maxWidth: 520, margin: '0 auto 16px', textAlign: 'left' }}>
                    <NoticeBox warning title={`${objectErrors.length} error(s)`}>
                        <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>
                            {objectErrors.slice(0, 20).map((msg, i) => <li key={i}>{msg}</li>)}
                            {objectErrors.length > 20 && <li>...and {objectErrors.length - 20} more</li>}
                        </ul>
                    </NoticeBox>
                </div>
            )}

            <ButtonStrip style={{ justifyContent: 'center' }}>
                <Button primary onClick={onReset}>Start Over</Button>
            </ButtonStrip>
        </div>
    )
}

// --- Shared UI components ---

const Header = ({ title, subtitle, color, icon }) => (
    <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
        <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `linear-gradient(135deg, ${color}88, ${color})`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12, boxShadow: `0 4px 12px ${color}40`,
        }}>
            {icon}
        </div>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a202c', fontFamily: FONT }}>
            {title}
        </h2>
        <p style={{
            color: '#4a5568', margin: '0 0 8px', fontSize: 15,
            maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6, fontFamily: FONT,
        }}>
            {subtitle}
        </p>
        <div style={{ borderTop: '1px solid #e0e5ec', margin: '16px 0 0' }} />
    </div>
)

const StatCard = ({ label, value, color }) => (
    <div style={{
        border: '1px solid #e0e5ec', borderRadius: 8, padding: '12px 16px', textAlign: 'center',
    }}>
        <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: FONT }}>{value}</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: FONT }}>{label}</div>
    </div>
)

const StatInline = ({ label, value, color }) => (
    <div>
        <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: FONT }}>{value}</div>
        <div style={{ fontSize: 11, color: '#6b7280', fontFamily: FONT }}>{label}</div>
    </div>
)
