import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, ButtonStrip, Checkbox, CircularLoader, NoticeBox, Radio } from '@dhis2/ui'
import { buildMetadataWorkbook, buildAllMetadataWorkbook, downloadMetadataWorkbook } from '../lib/metadataExporter'
import { METADATA_TYPES } from './MetadataTypeSelector'

const PAGE_SIZE = 500

/** Fields DHIS2 treats as audit/ownership metadata — stripped when "Strip audit fields" is on. */
const AUDIT_FIELDS = [
    'created', 'lastUpdated', 'createdBy', 'lastUpdatedBy',
    'user', 'href', 'access', 'favorites',
]

/** Fields related to object sharing — stripped when "Skip sharing" is on. */
const SHARING_FIELDS = [
    'sharing', 'publicAccess', 'externalAccess',
    'userAccesses', 'userGroupAccesses',
]

/**
 * Recursively strip a list of field names from an object or array.
 * Mutates a deep clone; original input untouched.
 */
function stripFields(input, fields) {
    const seen = new WeakSet()
    const walk = (v) => {
        if (v == null || typeof v !== 'object') return v
        if (seen.has(v)) return v
        seen.add(v)
        if (Array.isArray(v)) { v.forEach(walk); return v }
        for (const f of fields) if (f in v) delete v[f]
        for (const k of Object.keys(v)) walk(v[k])
        return v
    }
    // Deep-clone via JSON to avoid mutating caller's data (and any DHIS2 proxy refs).
    return walk(JSON.parse(JSON.stringify(input)))
}

/** Drop items whose name OR code equals 'default' (case-insensitive). */
function dropDefaults(payload) {
    const out = {}
    for (const [k, v] of Object.entries(payload)) {
        if (!Array.isArray(v)) { out[k] = v; continue }
        out[k] = v.filter((item) => {
            const name = String(item?.name ?? '').toLowerCase()
            const code = String(item?.code ?? '').toLowerCase()
            return name !== 'default' && code !== 'default'
        })
    }
    return out
}

/**
 * Apply export-option post-processing (skipSharing / stripAudit / excludeDefaults)
 * to a native DHIS2 metadata payload and wrap it for download.
 */
function buildJsonResult(payload, keyPrefix, { skipSharing, stripAudit, excludeDefaults }) {
    const drop = []
    if (skipSharing) drop.push(...SHARING_FIELDS)
    if (stripAudit) drop.push(...AUDIT_FIELDS)
    let processed = drop.length > 0 ? stripFields(payload, drop) : payload
    if (excludeDefaults) processed = dropDefaults(processed)
    const stamp = new Date().toISOString().slice(0, 10)
    return {
        kind: 'json',
        filename: `${keyPrefix}_${stamp}.json`,
        content: JSON.stringify(processed, null, 2),
    }
}

/**
 * Fetches metadata from DHIS2, builds Excel or JSON, and offers download.
 *
 * Props:
 *  - metadataType: type definition from METADATA_TYPES
 *  - onReset: () => void
 *  - onBack: () => void
 */
export const MetadataExportProgress = ({ metadataType, onReset, onBack }) => {
    const engine = useDataEngine()
    // configure | fetching | building | complete | empty | error
    const [status, setStatus] = useState('configure')
    const [error, setError] = useState(null)
    const [fetched, setFetched] = useState(0)
    const [statusMsg, setStatusMsg] = useState('')
    const resultRef = useRef(null)

    // Export options (shown on the configure screen)
    const [fileFormat, setFileFormat] = useState('excel') // 'excel' | 'json'
    const [skipSharing, setSkipSharing] = useState(true)
    const [excludeDefaults, setExcludeDefaults] = useState(true)
    const [stripAudit, setStripAudit] = useState(true)
    const [fieldPreset, setFieldPreset] = useState('owner') // 'owner' | 'display'

    const fetchMetadata = useCallback(async (mt, fieldsOverride) => {
        const allItems = []
        let page = 1
        // eslint-disable-next-line no-constant-condition
        while (true) {
            setStatusMsg(`Fetching ${mt.label} (page ${page})...`)
            const result = await engine.query({
                data: {
                    resource: mt.resource,
                    params: {
                        fields: fieldsOverride || mt.fields,
                        page,
                        pageSize: PAGE_SIZE,
                        paging: true,
                    },
                },
            })
            const items = result?.data?.[mt.resource] ?? []
            allItems.push(...items)
            setFetched((prev) => prev + items.length)
            if (items.length < PAGE_SIZE) break
            page++
        }
        return allItems
    }, [engine])

    const startExport = () => {
        setStatus('fetching')
        setFetched(0)
        setError(null)
    }

    useEffect(() => {
        if (status !== 'fetching') return
        const run = async () => {
            try {
                // For JSON exports, use :owner (round-trippable) unless user picked display.
                const jsonFields = fieldPreset === 'owner' ? ':owner' : null

                if (metadataType.key === 'allMetadata') {
                    const realTypes = METADATA_TYPES.filter((t) => t.resource)
                    const dataByType = {}
                    for (const mt of realTypes) {
                        const fieldsOverride = fileFormat === 'json' ? jsonFields : null
                        const items = await fetchMetadata(mt, fieldsOverride)
                        dataByType[mt.key] = items
                    }
                    const total = Object.values(dataByType).reduce((n, arr) => n + arr.length, 0)
                    if (total === 0) { setStatus('empty'); return }

                    setStatus('building')
                    if (fileFormat === 'json') {
                        setStatusMsg('Building combined metadata.json...')
                        const payload = {}
                        for (const mt of realTypes) {
                            if (dataByType[mt.key]?.length > 0) payload[mt.resource] = dataByType[mt.key]
                        }
                        resultRef.current = buildJsonResult(payload, 'all_metadata', {
                            skipSharing, stripAudit, excludeDefaults,
                        })
                    } else {
                        setStatusMsg('Building combined workbook...')
                        resultRef.current = buildAllMetadataWorkbook(realTypes, dataByType)
                    }
                    setStatus('complete')
                } else {
                    const fieldsOverride = fileFormat === 'json' ? jsonFields : null
                    const data = await fetchMetadata(metadataType, fieldsOverride)
                    if (data.length === 0) { setStatus('empty'); return }

                    setStatus('building')
                    if (fileFormat === 'json') {
                        setStatusMsg('Building JSON payload...')
                        const payload = { [metadataType.resource]: data }
                        resultRef.current = buildJsonResult(payload, metadataType.key, {
                            skipSharing, stripAudit, excludeDefaults,
                        })
                    } else {
                        setStatusMsg('Building Excel workbook...')
                        resultRef.current = buildMetadataWorkbook(metadataType, data)
                    }
                    setStatus('complete')
                }
            } catch (e) {
                setError(e.message || 'Export failed')
                setStatus('error')
            }
        }
        run()
    // eslint-disable-next-line
    }, [status])

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
        downloadMetadataWorkbook(wb, filename, sheetColors)
    }

    if (status === 'configure') {
        return (
            <div>
                <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a202c' }}>
                    Export {metadataType.label}
                </h2>
                <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 20 }}>
                    Choose the file format and the DHIS2 export options to apply.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c', marginBottom: 6 }}>
                            File Format
                        </div>
                        <Radio
                            name="mdFormat" value="excel" label="Excel workbook (.xlsx) — human-editable"
                            checked={fileFormat === 'excel'} onChange={() => setFileFormat('excel')}
                        />
                        <Radio
                            name="mdFormat" value="json" label="JSON (.json) — native DHIS2 payload, directly re-importable"
                            checked={fileFormat === 'json'} onChange={() => setFileFormat('json')}
                        />
                    </div>

                    {fileFormat === 'json' && (
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c', marginBottom: 6 }}>
                                Field preset
                            </div>
                            <Radio
                                name="mdFields" value="owner"
                                label=":owner — full round-trip payload (matches /api/metadata export)"
                                checked={fieldPreset === 'owner'} onChange={() => setFieldPreset('owner')}
                            />
                            <Radio
                                name="mdFields" value="display"
                                label="Display fields only — smaller payload, easier to read"
                                checked={fieldPreset === 'display'} onChange={() => setFieldPreset('display')}
                            />
                        </div>
                    )}

                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c', marginBottom: 6 }}>
                            Export options
                        </div>
                        <Checkbox
                            checked={skipSharing} onChange={({ checked }) => setSkipSharing(checked)}
                            label="Skip sharing — strip sharing / publicAccess / user access fields"
                        />
                        <Checkbox
                            checked={stripAudit} onChange={({ checked }) => setStripAudit(checked)}
                            label="Strip audit fields — remove created/lastUpdated/createdBy/href"
                        />
                        <Checkbox
                            checked={excludeDefaults} onChange={({ checked }) => setExcludeDefaults(checked)}
                            label="Exclude default objects — drop items whose name/code is 'default'"
                        />
                    </div>
                </div>
                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button primary onClick={startExport}>Start Export</Button>
                </ButtonStrip>
            </div>
        )
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
        return (
            <div>
                <NoticeBox warning title="No Data Found">
                    No {metadataType.label.toLowerCase()} found in the system.
                </NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div>
                <NoticeBox error title="Export Failed">{error}</NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
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
                Export Ready
            </h2>
            <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 4 }}>
                {fetched} {metadataType.label.toLowerCase()} exported.
            </p>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
                {resultRef.current?.filename}
            </p>
            <ButtonStrip style={{ justifyContent: 'center' }}>
                <Button primary onClick={handleDownload}>
                    {fileFormat === 'json' ? 'Download JSON' : 'Download Excel'}
                </Button>
                <Button onClick={onReset}>Start Over</Button>
            </ButtonStrip>
        </div>
    )
}
