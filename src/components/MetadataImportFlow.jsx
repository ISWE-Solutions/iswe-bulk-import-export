import React, { useCallback, useState } from 'react'
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
} from '@dhis2/ui'
import * as XLSX from 'xlsx'
import {
    buildMetadataWorkbook,
    buildAllMetadataWorkbook,
    downloadMetadataWorkbook,
    parseMetadataFile,
    parseAllMetadataFile,
} from '../lib/metadataExporter'
import { parseNativeJsonPayload } from '../lib/fileParser'
import { METADATA_TYPES } from './MetadataTypeSelector'
import { extractMetadataErrors, toCsv, downloadTextFile, groupErrorCodes, formatApiException } from '../lib/errorFormatter'
import { buildMetadataParams as buildMetadataParamsPure } from '../lib/metadataImportParams'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// Comprehensive dependency-aware import order for native DHIS2 metadata exports.
// Ensures each resource type is imported after its dependencies exist on the server.
// Any bucket NOT in this list is appended at the end in document order.
const IMPORT_ORDER = [
    // Category model (no external deps)
    'categoryOptions',
    'categories',
    'categoryCombos',
    'categoryOptionCombos',
    'categoryOptionGroups',
    'categoryOptionGroupSets',
    // Option sets + options (options reference optionSets)
    'optionSets',
    'options',
    // Legend sets (standalone)
    'legendSets',
    // Attributes (standalone)
    'attributes',
    // Tracked entity model
    'trackedEntityTypes',
    'trackedEntityAttributes',
    'relationshipTypes',
    // Org unit hierarchy (special: submitted by level)
    'organisationUnitLevels',
    'organisationUnits',
    'organisationUnitGroups',
    'organisationUnitGroupSets',
    // Data approval
    'dataApprovalLevels',
    'dataApprovalWorkflows',
    // Indicator model (indicatorTypes before indicators)
    'indicatorTypes',
    'indicators',
    'indicatorGroups',
    'indicatorGroupSets',
    // Data elements (after categoryCombos)
    'dataElements',
    'dataElementGroups',
    'dataElementGroupSets',
    // Data sets (after dataElements + categoryCombos)
    'dataSets',
    // Tracker/event programs (after trackedEntityTypes, dataElements, categoryCombos)
    'programs',
    'programStages',
    'programSections',
    'programStageSections',
    'programIndicators',
    'programIndicatorGroups',
    // Program rules (after programs, dataElements, trackedEntityAttributes)
    'programRules',
    'programRuleVariables',
    'programRuleActions',
    // Validation rules (after dataElements)
    'validationRules',
    'validationRuleGroups',
    // User model
    'userRoles',
    'userGroups',
    'users',
    // Analytics / visualizations (after all dimension objects)
    'predictors',
    'visualizations',
    'eventVisualizations',
    'eventFilters',
    'maps',
    'mapViews',
    'externalMapLayers',
    'dashboards',
    // Misc
    'aggregateDataExchanges',
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
 * Group org units by their computed depth within the batch so we can import
 * parents before children (DHIS2 rejects children whose parent UID is unknown).
 */
function groupOUsByLevel(ous) {
    const levels = new Map()
    for (const ou of ous) {
        const level = computeOULevel(ou, ous)
        if (!levels.has(level)) levels.set(level, [])
        levels.get(level).push(ou)
    }
    return [...levels.entries()].sort(([a], [b]) => a - b)
}

/**
 * Chunk an array into slices of at most `size` items.
 */
function chunk(arr, size) {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

/**
 * Submit a native DHIS2 metadata JSON payload by splitting it into manageable
 * chunks so very large exports (e.g. full org-unit hierarchy) do not hit the
 * server's request timeout (commonly a 504 at the reverse-proxy level).
 *
 *  - Org units: grouped by depth so parents exist before children, and each
 *    level is further split into batches of `CHUNK_SIZE`.
 *  - Every other bucket: split into batches of `CHUNK_SIZE` and submitted in
 *    declaration order.
 *
 * Accumulates DHIS2 import stats across all requests into a single summary.
 */
const CHUNK_SIZE = 500
/**
 * Wrapper around engine.mutate for the /api/metadata endpoint.
 * DHIS2 returns HTTP 409 when import status is ERROR even with atomicMode=NONE.
 * app-runtime throws on non-2xx, so we intercept 409s and extract the
 * response body (which contains typeReports + stats) to treat as a result.
 */
async function mutateMetadata(engine, params, data) {
    try {
        return await engine.mutate({ resource: 'metadata', type: 'create', params, data })
    } catch (e) {
        const body = e?.details ?? e?.response ?? {}
        const report =
            (body?.typeReports || body?.stats) ? body
                : (body?.response?.typeReports || body?.response?.stats) ? body.response
                    : (e?.details?.response?.typeReports || e?.details?.response?.stats) ? e.details.response
                        : null
        if (report) return report
        throw e
    }
}

/**
 * Synthesize an error-shaped "typeReport" so a fatal server crash in one batch
 * (e.g. a Hibernate ConstraintViolationException returned as 409) is surfaced
 * in the final import report without aborting remaining buckets.
 */
function buildBatchErrorReport(key, itemCount, err) {
    const body = err?.details ?? err?.response ?? {}
    const http = body?.httpStatusCode || err?.httpStatusCode || ''
    const msg = body?.message || err?.message || 'Unknown server error'
    return {
        klass: `org.hisp.dhis.${key}`,
        stats: { created: 0, updated: 0, deleted: 0, ignored: itemCount, total: itemCount },
        objectReports: [{
            klass: `org.hisp.dhis.${key}`,
            errorReports: [{
                message: `Batch of ${itemCount} ${key} failed${http ? ` (HTTP ${http})` : ''}: ${msg}`,
                mainKlass: `org.hisp.dhis.${key}`,
                errorCode: body?.errorCode || 'SERVER_ERROR',
            }],
        }],
    }
}

/**
 * Detect transient DHIS2 server errors that are typically recoverable by
 * retrying with a smaller batch. The most common offender is the Hibernate
 * "could not initialize proxy ... no Session" error caused by lazy-loaded
 * OptionSet references inside a large dataElements batch.
 */
function isRecoverableServerError(err) {
    const body = err?.details ?? err?.response ?? {}
    const http = Number(body?.httpStatusCode || err?.httpStatusCode || 0)
    const msg = String(body?.message || err?.message || '')
    if (http !== 500 && http !== 502 && http !== 503 && http !== 504) return false
    return (
        /could not initialize proxy/i.test(msg) ||
        /no Session/i.test(msg) ||
        /afterTransactionCompletion/i.test(msg) ||
        /LazyInitializationException/i.test(msg) ||
        /Gateway Time-?out/i.test(msg) ||
        http === 502 || http === 503 || http === 504
    )
}

/**
 * Submit a single metadata batch, retrying transient server errors by
 * halving the batch size until items go through or a single item still fails.
 * Accumulates stats into `combined` and reports per-sub-batch progress.
 */
async function submitBatchWithRetry({ engine, key, items, params, combined, onProgress, label, depth = 0 }) {
    try {
        const resp = await mutateMetadata(engine, params, { [key]: items })
        accumulateStats(combined, resp)
        return
    } catch (err) {
        if (items.length > 1 && isRecoverableServerError(err) && depth < 6) {
            const mid = Math.ceil(items.length / 2)
            onProgress?.(`${label}: transient server error, splitting batch of ${items.length} into ${mid} + ${items.length - mid}`)
            await submitBatchWithRetry({
                engine, key, items: items.slice(0, mid), params, combined, onProgress,
                label: `${label} (a)`, depth: depth + 1,
            })
            await submitBatchWithRetry({
                engine, key, items: items.slice(mid), params, combined, onProgress,
                label: `${label} (b)`, depth: depth + 1,
            })
            return
        }
        combined.stats.ignored += items.length
        combined.stats.total += items.length
        combined.typeReports.push(buildBatchErrorReport(key, items.length, err))
    }
}

async function submitNativeMetadata({ engine, payload, params, onProgress }) {
    const combined = { stats: { created: 0, updated: 0, deleted: 0, ignored: 0, total: 0 }, typeReports: [] }

    const buckets = Object.entries(payload).filter(([, v]) => Array.isArray(v) && v.length > 0)

    // Sort buckets by dependency-aware import order so each resource type
    // is submitted after its dependencies (e.g. options after optionSets,
    // indicators after indicatorTypes, dataSets after dataElements).
    // Buckets not listed in IMPORT_ORDER are appended at the end.
    const orderIndex = (k) => { const i = IMPORT_ORDER.indexOf(k); return i === -1 ? IMPORT_ORDER.length : i }
    buckets.sort(([a], [b]) => orderIndex(a) - orderIndex(b))

    for (const [key, items] of buckets) {
        if (key === 'organisationUnits') {
            const levels = groupOUsByLevel(items)
            let done = 0
            for (const [level, batch] of levels) {
                const slices = chunk(batch, CHUNK_SIZE)
                for (let i = 0; i < slices.length; i++) {
                    const label = `Org units L${level} batch ${i + 1}/${slices.length}`
                    onProgress?.(`Importing ${label} (${slices[i].length})`)
                    await submitBatchWithRetry({
                        engine, key: 'organisationUnits', items: slices[i],
                        params, combined, onProgress, label,
                    })
                    done += slices[i].length
                }
                onProgress?.(`Org units L${level} done (${done}/${items.length})`)
            }
            continue
        }

        const slices = chunk(items, CHUNK_SIZE)
        for (let i = 0; i < slices.length; i++) {
            const label = `${key} batch ${i + 1}/${slices.length}`
            onProgress?.(`Importing ${label} (${slices[i].length})`)
            await submitBatchWithRetry({
                engine, key, items: slices[i],
                params, combined, onProgress, label,
            })
        }
    }
    return combined
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
    const [uploadSource, setUploadSource] = useState('excel') // 'excel' | 'json'

    // Import options — exposed on the preview step so the user can control
    // exactly how DHIS2 treats existing UIDs. Defaults match what works best
    // for typical full-metadata-export re-imports.
    const [importOptions, setImportOptions] = useState({
        importStrategy: 'CREATE_AND_UPDATE', // CREATE_AND_UPDATE | CREATE | UPDATE
        mergeMode: 'MERGE',                   // MERGE | REPLACE
        identifier: 'AUTO',                   // AUTO (UID then code) | UID | CODE
        skipSharing: true,                    // true avoids sharing-permission errors on full exports
        dryRun: false,                        // importMode=VALIDATE when true
    })

    /**
     * Build the query-string params sent to /api/metadata. Shared by every
     * mutate call in this flow so options apply uniformly.
     */
    const buildMetadataParams = useCallback(
        () => buildMetadataParamsPure(importOptions),
        [importOptions],
    )

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
                if (uploadSource === 'json') {
                    // Native DHIS2 metadata JSON: submit directly, no template needed.
                    const text = typeof e.target.result === 'string'
                        ? e.target.result
                        : new TextDecoder().decode(e.target.result)
                    const { payload, summary } = parseNativeJsonPayload(text, 'metadata')
                    setParsedResult({
                        isJson: true,
                        payload,
                        summary: { total: Object.values(summary).reduce((a, b) => a + b, 0), byType: summary },
                    })
                } else if (metadataType.key === 'allMetadata') {
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
        if (uploadSource === 'json') reader.readAsText(file)
        else reader.readAsArrayBuffer(file)
    }, [metadataType, uploadSource])

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
            if (parsedResult?.isJson) {
                // Native DHIS2 JSON payload: batch-submit so large full exports
                // (thousands of org units) don't hit the reverse-proxy 504.
                const response = await submitNativeMetadata({
                    engine,
                    payload: parsedResult.payload,
                    params: buildMetadataParams(),
                    onProgress: (m) => setStatusMsg(m),
                })
                setImportResult(response)
                setSubStep('done')
                return
            }
            if (parsedResult?.isAllMetadata) {
                // Combined import — respects IMPORT_ORDER so dependencies are
                // loaded before dependents. Each type goes through the shared
                // batched submitter so large all-metadata exports don't 504.
                let combined = { stats: { created: 0, updated: 0, deleted: 0, ignored: 0, total: 0 }, typeReports: [] }
                const params = buildMetadataParams()

                // Sort parsed types by IMPORT_ORDER dependency priority; unknown
                // types fall to the end so they are never silently dropped.
                const orderIndex = (k) => { const i = IMPORT_ORDER.indexOf(k); return i === -1 ? IMPORT_ORDER.length : i }
                const sortedKeys = Object.keys(parsedResult.types).sort((a, b) => orderIndex(a) - orderIndex(b))
                for (const key of sortedKeys) {
                    const tr = parsedResult.types[key]
                    if (!tr || tr.error || !tr.summary || tr.summary.total === 0) continue

                    setStatusMsg(`Importing ${TYPE_LABELS[key]}...`)
                    const resp = await submitNativeMetadata({
                        engine,
                        payload: tr.payload,
                        params,
                        onProgress: (m) => setStatusMsg(`${TYPE_LABELS[key]}: ${m}`),
                    })
                    combined.stats.created += resp.stats.created
                    combined.stats.updated += resp.stats.updated
                    combined.stats.deleted += resp.stats.deleted
                    combined.stats.ignored += resp.stats.ignored
                    combined.stats.total += resp.stats.total
                    combined.typeReports.push(...resp.typeReports)
                }
                setImportResult(combined)
            } else if (metadataType.key === 'organisationUnits' && parsedResult.summary.levelCounts) {
                // Excel-sourced org-unit import: let the batched submitter handle
                // level-ordering + chunking so >500 OUs don't hit a 504.
                const response = await submitNativeMetadata({
                    engine,
                    payload: parsedResult.payload,
                    params: buildMetadataParams(),
                    onProgress: (m) => setStatusMsg(m),
                })
                setImportResult(response)
            } else {
                // Single-type Excel import: still route through the batched
                // submitter so large single-sheet imports stay under the
                // request timeout window.
                const response = await submitNativeMetadata({
                    engine,
                    payload: parsedResult.payload,
                    params: buildMetadataParams(),
                    onProgress: (m) => setStatusMsg(m),
                })
                setImportResult(response)
            }
            setSubStep('done')
        } catch (e) {
            setError(formatApiException(e, 'Submitting metadata to DHIS2'))
            setSubStep('error')
        }
    }, [engine, parsedResult, metadataType, buildMetadataParams])

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
        const acceptExt = uploadSource === 'json' ? '.json' : '.xlsx,.xls'
        return (
            <div>
                <Header
                    title="Upload File"
                    subtitle={`Upload your filled-in ${metadataType.label.toLowerCase()} file.`}
                    color={metadataType.color}
                    icon={metadataType.icon}
                />

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                    <div style={{
                        display: 'inline-flex', borderRadius: 20, background: '#f4f6f8',
                        padding: 3, border: '1px solid #e0e5ec',
                    }}>
                        {[
                            { key: 'excel', label: 'Excel', desc: 'Template-based (recommended)' },
                            { key: 'json', label: 'JSON', desc: 'Native DHIS2 metadata payload (advanced)' },
                        ].map((opt) => (
                            <button
                                key={opt.key}
                                onClick={() => { setUploadSource(opt.key); setError(null) }}
                                title={opt.desc}
                                style={{
                                    padding: '7px 18px', borderRadius: 17, border: 'none', cursor: 'pointer',
                                    fontSize: 13, fontWeight: 600, fontFamily: FONT,
                                    background: uploadSource === opt.key ? metadataType.color : 'transparent',
                                    color: uploadSource === opt.key ? '#fff' : '#4a5568',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

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
                        input.accept = acceptExt
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
                        Drop your {uploadSource === 'json' ? 'JSON' : 'Excel'} file here
                    </p>
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0, fontFamily: FONT }}>
                        or click to browse ({acceptExt})
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
    const optionsPanel = (
        <div style={{
            border: '1px solid #e0e5ec', borderRadius: 8, padding: 14, marginTop: 16,
            fontFamily: FONT, background: '#fafbfc',
        }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1a202c', marginBottom: 10 }}>
                Import options
            </div>

            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#4a5568', marginBottom: 4 }}>
                    When a UID already exists in DHIS2
                </div>
                <select
                    value={importOptions.importStrategy}
                    onChange={(e) => setImportOptions({ ...importOptions, importStrategy: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid #cbd5e0' }}
                >
                    <option value="CREATE_AND_UPDATE">Create new and update existing (default)</option>
                    <option value="UPDATE">Update existing only (skip new)</option>
                    <option value="CREATE">Create new only (fail if UID exists)</option>
                </select>
            </div>

            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#4a5568', marginBottom: 4 }}>
                    Update mode
                </div>
                <select
                    value={importOptions.mergeMode}
                    onChange={(e) => setImportOptions({ ...importOptions, mergeMode: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid #cbd5e0' }}
                >
                    <option value="MERGE">Merge — only fields in the payload are changed</option>
                    <option value="REPLACE">Replace — overwrite all fields (missing ones cleared)</option>
                </select>
            </div>

            <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, color: '#4a5568', marginBottom: 4 }}>
                    Match existing records by
                </div>
                <select
                    value={importOptions.identifier}
                    onChange={(e) => setImportOptions({ ...importOptions, identifier: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 13, borderRadius: 4, border: '1px solid #cbd5e0' }}
                >
                    <option value="AUTO">Auto — UID first, then code (recommended)</option>
                    <option value="UID">UID only</option>
                    <option value="CODE">Code only</option>
                </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#2d3748', marginBottom: 6 }}>
                <input
                    type="checkbox"
                    checked={importOptions.skipSharing}
                    onChange={(e) => setImportOptions({ ...importOptions, skipSharing: e.target.checked })}
                />
                Skip sharing settings (recommended for full-metadata re-imports)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#2d3748' }}>
                <input
                    type="checkbox"
                    checked={importOptions.dryRun}
                    onChange={(e) => setImportOptions({ ...importOptions, dryRun: e.target.checked })}
                />
                Dry run — validate only, do not commit
            </label>
        </div>
    )

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

                    {optionsPanel}
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('upload')}>Back</Button>
                    {detected.length > 0 && (
                        <Button primary onClick={handleImport}>
                            {importOptions.dryRun ? 'Validate' : 'Import'} {totalRecords} Records
                        </Button>
                    )}
                </ButtonStrip>
            </div>
        )
    }

    if (subStep === 'preview' && parsedResult?.isJson) {
        const { summary } = parsedResult
        const entries = Object.entries(summary.byType)
        return (
            <div>
                <Header
                    title="JSON Import Preview"
                    subtitle="Review the native DHIS2 metadata payload before importing."
                    color={metadataType.color}
                    icon={metadataType.icon}
                />
                <div style={{ maxWidth: 520, margin: '0 auto' }}>
                    <div style={{
                        border: '1px solid #e0e5ec', borderRadius: 8, padding: 16, marginBottom: 16,
                        fontFamily: FONT,
                    }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#1a202c', marginBottom: 8 }}>
                            Payload contents ({summary.total} total object{summary.total === 1 ? '' : 's'})
                        </div>
                        {entries.map(([type, count]) => (
                            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                                <span style={{ color: '#4a5568' }}>{type}</span>
                                <span style={{ fontWeight: 600 }}>{count}</span>
                            </div>
                        ))}
                    </div>
                    <NoticeBox title="JSON Upload">
                        Client-side validation and ordering are skipped for JSON metadata uploads.
                        DHIS2 will validate the payload on submission using the same rules as the metadata import endpoint.
                    </NoticeBox>

                    {optionsPanel}
                </div>
                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('upload')}>Back</Button>
                    <Button primary onClick={handleImport}>
                        {importOptions.dryRun ? 'Validate' : 'Import'} {summary.total} Object{summary.total === 1 ? '' : 's'}
                    </Button>
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

                    {optionsPanel}
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('upload')}>Back</Button>
                    <Button primary onClick={handleImport}>
                        {importOptions.dryRun ? 'Validate' : 'Import'} {summary.total} {metadataType.label}
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
        const errInfo = typeof error === 'object' && error !== null && error.title
            ? error
            : { title: 'Import Failed', message: String(error || 'Import failed'), errorCode: '', httpStatus: '', context: '' }
        return (
            <div>
                <NoticeBox error title={errInfo.title}>
                    {errInfo.context && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{errInfo.context}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {errInfo.httpStatus && <Tag negative>HTTP {errInfo.httpStatus}</Tag>}
                        {errInfo.errorCode && <Tag negative>{errInfo.errorCode}</Tag>}
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {errInfo.message}
                    </div>
                </NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={() => { setError(null); setSubStep('preview') }}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Done ---
    const stats = importResult?.stats ?? importResult?.response?.stats ?? {}
    const structuredErrors = extractMetadataErrors(importResult)
    const errorGroups = groupErrorCodes(structuredErrors)

    const downloadErrors = () => {
        const cols = [
            { key: 'errorCode', label: 'Error Code' },
            { key: 'objectType', label: 'Object Type' },
            { key: 'objectId', label: 'Object UID' },
            { key: 'objectName', label: 'Object Name' },
            { key: 'property', label: 'Property' },
            { key: 'value', label: 'Value' },
            { key: 'message', label: 'Message' },
        ]
        downloadTextFile(toCsv(cols, structuredErrors), 'metadata-import-errors.csv')
    }

    return (
        <div style={{ padding: '24px 0' }}>
            <div style={{ textAlign: 'center' }}>
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
            </div>

            {structuredErrors.length > 0 && (
                <div style={{ margin: '0 auto 16px', maxWidth: 960, textAlign: 'left' }}>
                    <NoticeBox warning title={`${structuredErrors.length} error(s) \u2014 some objects were not imported`} style={{ marginBottom: 12 }}>
                        Review the details below. Fix your Excel file and re-import the affected rows.
                    </NoticeBox>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                        {errorGroups.slice(0, 12).map((g) => (
                            <Tag key={g.code} negative={g.code !== 'ALL'} neutral={g.code === 'ALL'}>
                                {g.code} ({g.count})
                            </Tag>
                        ))}
                    </div>
                    <div style={{ marginBottom: 10 }}>
                        <Button small onClick={downloadErrors}>Download All Errors as CSV</Button>
                    </div>
                    <DataTable>
                        <DataTableHead>
                            <DataTableRow>
                                <DataTableColumnHeader>Error Code</DataTableColumnHeader>
                                <DataTableColumnHeader>Type</DataTableColumnHeader>
                                <DataTableColumnHeader>Object</DataTableColumnHeader>
                                <DataTableColumnHeader>UID</DataTableColumnHeader>
                                <DataTableColumnHeader>Property</DataTableColumnHeader>
                                <DataTableColumnHeader>Message</DataTableColumnHeader>
                            </DataTableRow>
                        </DataTableHead>
                        <DataTableBody>
                            {structuredErrors.slice(0, 50).map((e, i) => (
                                <DataTableRow key={i}>
                                    <DataTableCell>
                                        <Tag negative>{e.errorCode || 'ERROR'}</Tag>
                                    </DataTableCell>
                                    <DataTableCell>{e.objectType || '-'}</DataTableCell>
                                    <DataTableCell>{e.objectName || '-'}</DataTableCell>
                                    <DataTableCell>
                                        {e.objectId
                                            ? <code style={{ fontSize: 11 }}>{e.objectId}</code>
                                            : '-'}
                                    </DataTableCell>
                                    <DataTableCell>{e.property || '-'}</DataTableCell>
                                    <DataTableCell>{e.message}</DataTableCell>
                                </DataTableRow>
                            ))}
                        </DataTableBody>
                    </DataTable>
                    {structuredErrors.length > 50 && (
                        <p style={{ marginTop: 8, color: '#4a5568', fontSize: 13 }}>
                            Showing first 50 of {structuredErrors.length} errors. Download CSV for full list.
                        </p>
                    )}
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
