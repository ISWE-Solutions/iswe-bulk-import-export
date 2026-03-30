import React, { useCallback, useState, useMemo } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, ButtonStrip, CircularLoader, NoticeBox, SingleSelectField, SingleSelectOption } from '@dhis2/ui'
import { parseGeoJsonFile, matchGeoJsonToOrgUnits } from '../lib/metadataExporter'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const GEO_COLOR = '#00695C'
const GEO_BG = '#E0F2F1'

const PAGE_SIZE = 500
const BATCH_SIZE = 200

/** Match-level colors and labels */
const MATCH_LEVEL = {
    exact: { color: '#2E7D32', bg: '#E8F5E9', label: 'Exact' },
    normalized: { color: '#E65100', bg: '#FFF3E0', label: 'Normalized' },
    fuzzy: { color: '#1565C0', bg: '#E3F2FD', label: 'Fuzzy' },
    'fuzzy-ambiguous': { color: '#C62828', bg: '#FFEBEE', label: 'Fuzzy (ambiguous)' },
}

/**
 * GeoJSON/GIS import flow for org unit boundaries.
 *
 * Steps: upload → configure matching → preview → import → done
 *
 * Intelligence:
 * - 3-level matching (exact → normalized → fuzzy/contains)
 * - Coordinate validation (WGS84 bounds)
 * - Geometry complexity warnings
 * - CRS detection + warning
 * - Duplicate detection (multiple features → same org unit)
 * - Match quality badges per row
 * - Batched import (200 org units per batch)
 * - Download unmatched features as GeoJSON
 */
export const GeoImportFlow = ({ onReset, onBack }) => {
    const engine = useDataEngine()
    const [subStep, setSubStep] = useState('upload')
    const [geoData, setGeoData] = useState(null)        // { features, propertyKeys, warnings, stats }
    const [matchProperty, setMatchProperty] = useState('')
    const [matchField, setMatchField] = useState('name')
    const [orgUnits, setOrgUnits] = useState(null)
    const [matchResult, setMatchResult] = useState(null)
    const [importResult, setImportResult] = useState(null)
    const [error, setError] = useState(null)
    const [statusMsg, setStatusMsg] = useState('')
    const [dragOver, setDragOver] = useState(false)
    const [batchProgress, setBatchProgress] = useState(null) // { done, total }

    // Parse uploaded GeoJSON file
    const handleFileContent = useCallback((content) => {
        try {
            const result = parseGeoJsonFile(content)
            setGeoData(result)
            setError(null)

            const keys = result.propertyKeys
            const preferred = ['name', 'Name', 'NAME', 'id', 'ID', 'code', 'Code']
            const autoKey = preferred.find((k) => keys.includes(k)) || keys[0] || ''
            setMatchProperty(autoKey)

            setSubStep('configure')
        } catch (err) {
            setError(err.message || 'Failed to parse GeoJSON')
        }
    }, [])

    const handleDrop = useCallback((e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer?.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onload = (ev) => handleFileContent(ev.target.result)
            reader.readAsText(file)
        }
    }, [handleFileContent])

    const handleFilePick = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.geojson,.json'
        input.onchange = (e) => {
            const file = e.target.files?.[0]
            if (file) {
                const reader = new FileReader()
                reader.onload = (ev) => handleFileContent(ev.target.result)
                reader.readAsText(file)
            }
        }
        input.click()
    }, [handleFileContent])

    // Fetch all org units from DHIS2 and run matching
    const handleMatch = useCallback(async () => {
        setSubStep('matching')
        setStatusMsg('Fetching org units from DHIS2...')
        try {
            let allOUs = []
            let page = 1
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const result = await engine.query({
                    data: {
                        resource: 'organisationUnits',
                        params: {
                            fields: 'id,name,shortName,code,openingDate',
                            page,
                            pageSize: PAGE_SIZE,
                            paging: true,
                        },
                    },
                })
                const items = result?.data?.organisationUnits ?? []
                allOUs.push(...items)
                setStatusMsg(`Fetched ${allOUs.length} org units...`)
                if (items.length < PAGE_SIZE) break
                page++
            }

            setOrgUnits(allOUs)
            setStatusMsg(`Matching ${geoData.features.length} features against ${allOUs.length} org units...`)

            const result = matchGeoJsonToOrgUnits(
                geoData.features,
                matchProperty,
                allOUs,
                matchField
            )
            setMatchResult(result)
            setSubStep('preview')
        } catch (e) {
            setError(e.message || 'Failed to fetch org units')
            setSubStep('configure')
        }
    }, [engine, geoData, matchProperty, matchField])

    // Import matched geometries — batched for reliability
    const handleImport = useCallback(async () => {
        setSubStep('importing')
        const ous = matchResult.payload.organisationUnits
        const totalBatches = Math.ceil(ous.length / BATCH_SIZE)
        const allStats = { updated: 0, created: 0, ignored: 0, total: 0 }
        const allErrors = []

        for (let i = 0; i < totalBatches; i++) {
            const batch = ous.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
            setBatchProgress({ done: i, total: totalBatches })
            setStatusMsg(`Importing batch ${i + 1} of ${totalBatches} (${batch.length} org units)...`)

            try {
                const response = await engine.mutate({
                    resource: 'metadata',
                    type: 'create',
                    params: { importStrategy: 'CREATE_AND_UPDATE', atomicMode: 'NONE' },
                    data: { organisationUnits: batch },
                })
                const s = response?.stats ?? response?.response?.stats ?? {}
                allStats.updated += s.updated ?? 0
                allStats.created += s.created ?? 0
                allStats.ignored += s.ignored ?? 0
                allStats.total += s.total ?? 0

                // Collect errors
                const trs = response?.typeReports ?? response?.response?.typeReports ?? []
                for (const tr of trs) {
                    for (const or of (tr.objectReports ?? [])) {
                        for (const er of (or.errorReports ?? [])) {
                            allErrors.push(er.message || er.errorCode)
                        }
                    }
                }
            } catch (e) {
                allErrors.push(`Batch ${i + 1} failed: ${e.message}`)
            }
        }

        setBatchProgress({ done: totalBatches, total: totalBatches })
        setImportResult({ stats: allStats, errors: allErrors })
        setSubStep('done')
    }, [engine, matchResult])

    // Export unmatched features as GeoJSON file
    const handleExportUnmatched = useCallback(() => {
        if (!matchResult?.unmatched?.length) return
        const fc = {
            type: 'FeatureCollection',
            features: matchResult.unmatched.map((u) => u.feature),
        }
        const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/geo+json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'unmatched-features.geojson'
        a.click()
        URL.revokeObjectURL(url)
    }, [matchResult])

    // Geometry type breakdown
    const geoBreakdown = useMemo(() => {
        if (!geoData) return {}
        const counts = {}
        for (const f of geoData.features) {
            const t = f.geometry?.type || 'Unknown'
            counts[t] = (counts[t] || 0) + 1
        }
        return counts
    }, [geoData])

    // --- Upload ---
    if (subStep === 'upload') {
        return (
            <div>
                <Header title="GeoJSON Import" subtitle="Import org unit boundaries and coordinates from a GeoJSON file." />

                <div
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onClick={handleFilePick}
                    style={{
                        maxWidth: 520, margin: '0 auto', padding: 40,
                        border: `2px dashed ${dragOver ? GEO_COLOR : '#d1d5db'}`,
                        borderRadius: 12, textAlign: 'center',
                        background: dragOver ? GEO_BG : '#fafbfc',
                        transition: 'all 0.15s ease', cursor: 'pointer',
                    }}
                >
                    <GlobeIcon />
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#1a202c', margin: '12px 0 4px', fontFamily: FONT }}>
                        Drop your GeoJSON file here
                    </p>
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0, fontFamily: FONT }}>
                        or click to browse (.geojson, .json)
                    </p>
                </div>

                <div style={{ maxWidth: 520, margin: '16px auto 0', fontSize: 13, color: '#6b7280', lineHeight: 1.6, fontFamily: FONT }}>
                    <strong>Supported formats:</strong> FeatureCollection, single Feature, or raw Geometry.
                    Geometry types: Point, Polygon, MultiPolygon.
                    Each feature should have properties (name, code, or ID) to match against DHIS2 org units.
                </div>

                <div style={{ maxWidth: 520, margin: '12px auto 0' }}>
                    <IntelligenceBadges />
                </div>

                {error && (
                    <div style={{ maxWidth: 520, margin: '12px auto 0' }}>
                        <NoticeBox error title="Parse Error">{error}</NoticeBox>
                    </div>
                )}

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Configure matching ---
    if (subStep === 'configure') {
        return (
            <div>
                <Header title="Configure Matching" subtitle="Map GeoJSON properties to DHIS2 org unit fields." />

                <div style={{ maxWidth: 520, margin: '0 auto' }}>
                    {/* Summary badges */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20,
                    }}>
                        <StatCard label="Features" value={geoData.stats.validFeatures} color={GEO_COLOR} />
                        <StatCard label="Properties" value={geoData.propertyKeys.length} color={GEO_COLOR} />
                        <StatCard label="Coord Points" value={geoData.stats.totalPoints.toLocaleString()} color="#4a5568" />
                    </div>

                    {/* Parse warnings */}
                    {geoData.warnings.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <NoticeBox warning title={`${geoData.warnings.length} warning(s)`}>
                                <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>
                                    {geoData.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </NoticeBox>
                        </div>
                    )}

                    {/* Geometry type breakdown */}
                    <div style={{
                        border: '1px solid #e0e5ec', borderRadius: 8, padding: 12, marginBottom: 16,
                        fontSize: 13, fontFamily: FONT,
                    }}>
                        <div style={{ fontWeight: 600, marginBottom: 6, color: '#1a202c' }}>Geometry Types</div>
                        {Object.entries(geoBreakdown).map(([type, count]) => (
                            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                <span style={{ color: '#4a5568' }}>
                                    <span style={{
                                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                        background: type === 'Point' ? '#1565C0' : type === 'Polygon' ? '#2E7D32' : '#E65100',
                                        marginRight: 6, verticalAlign: 'middle',
                                    }} />
                                    {type}
                                </span>
                                <span style={{ fontWeight: 600 }}>{count}</span>
                            </div>
                        ))}
                    </div>

                    {/* Match property selector */}
                    <SingleSelectField
                        label="GeoJSON property to match"
                        selected={matchProperty}
                        onChange={({ selected }) => setMatchProperty(selected)}
                        helpText="Which property in each GeoJSON feature identifies the org unit?"
                    >
                        {geoData.propertyKeys.map((k) => (
                            <SingleSelectOption key={k} label={k} value={k} />
                        ))}
                    </SingleSelectField>

                    <div style={{ height: 12 }} />

                    {/* Match field selector */}
                    <SingleSelectField
                        label="Match against DHIS2 field"
                        selected={matchField}
                        onChange={({ selected }) => setMatchField(selected)}
                        helpText="Which DHIS2 org unit field should be compared? Matching uses 3 levels: exact → normalized (strips suffixes like District, Province) → fuzzy (contains)."
                    >
                        <SingleSelectOption label="Name" value="name" />
                        <SingleSelectOption label="Code" value="code" />
                        <SingleSelectOption label="ID (UID)" value="id" />
                    </SingleSelectField>

                    {/* Property value preview */}
                    {matchProperty && (
                        <div style={{
                            border: '1px solid #e0e5ec', borderRadius: 8, padding: 12, marginTop: 16,
                            fontSize: 12, fontFamily: FONT, maxHeight: 120, overflowY: 'auto',
                        }}>
                            <div style={{ fontWeight: 600, marginBottom: 4, color: '#1a202c' }}>
                                Sample values for &quot;{matchProperty}&quot;:
                            </div>
                            {geoData.features.slice(0, 8).map((f, i) => (
                                <div key={i} style={{ color: '#4a5568', padding: '1px 0' }}>
                                    {String(f.properties?.[matchProperty] ?? '(empty)')}
                                </div>
                            ))}
                            {geoData.features.length > 8 && (
                                <div style={{ color: '#9ca3af' }}>...and {geoData.features.length - 8} more</div>
                            )}
                        </div>
                    )}
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => { setGeoData(null); setSubStep('upload') }}>Back</Button>
                    <Button primary onClick={handleMatch} disabled={!matchProperty}>
                        Match &amp; Preview
                    </Button>
                </ButtonStrip>
            </div>
        )
    }

    // --- Matching in progress ---
    if (subStep === 'matching') {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CircularLoader />
                <p style={{ color: '#4a5568', fontSize: 14, marginTop: 16, fontFamily: FONT }}>{statusMsg}</p>
            </div>
        )
    }

    // --- Preview ---
    if (subStep === 'preview') {
        const { matched, unmatched, duplicates, warnings } = matchResult
        const total = geoData.features.length
        const matchRate = total > 0 ? Math.round((matched.length / total) * 100) : 0

        // Match quality breakdown
        const levels = { exact: 0, normalized: 0, fuzzy: 0, 'fuzzy-ambiguous': 0 }
        for (const m of matched) levels[m.matchLevel] = (levels[m.matchLevel] || 0) + 1

        return (
            <div>
                <Header title="Match Results" subtitle="Review how GeoJSON features matched to org units." />

                <div style={{ maxWidth: 600, margin: '0 auto' }}>
                    {/* Top stats */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 16,
                    }}>
                        <StatCard label="Matched" value={matched.length} color="#2E7D32" />
                        <StatCard label="Unmatched" value={unmatched.length} color="#E65100" />
                        <StatCard label="Duplicates" value={duplicates.length} color="#C62828" />
                        <StatCard label="Match Rate" value={`${matchRate}%`} color={matchRate >= 80 ? '#2E7D32' : matchRate >= 50 ? '#E65100' : '#C62828'} />
                    </div>

                    {/* Match quality breakdown */}
                    {matched.length > 0 && (
                        <div style={{
                            display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
                        }}>
                            {Object.entries(levels).filter(([, v]) => v > 0).map(([level, count]) => {
                                const ml = MATCH_LEVEL[level]
                                return (
                                    <span key={level} style={{
                                        background: ml.bg, color: ml.color, padding: '3px 10px',
                                        borderRadius: 12, fontSize: 12, fontWeight: 600, fontFamily: FONT,
                                    }}>
                                        {ml.label}: {count}
                                    </span>
                                )
                            })}
                        </div>
                    )}

                    {/* Warnings from matching */}
                    {warnings.length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <NoticeBox warning title="Match Quality Notes">
                                <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>
                                    {warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </NoticeBox>
                        </div>
                    )}

                    {matched.length === 0 && (
                        <NoticeBox error title="No Matches">
                            No GeoJSON features matched any org unit. Check your matching property and field.
                        </NoticeBox>
                    )}

                    {/* Matched table with match quality badges */}
                    {matched.length > 0 && (
                        <div style={{
                            border: '1px solid #e0e5ec', borderRadius: 8, overflow: 'hidden', marginBottom: 16,
                        }}>
                            <div style={{
                                background: '#f7f8fa', padding: '8px 12px',
                                fontWeight: 600, fontSize: 13, color: '#1a202c', fontFamily: FONT,
                            }}>
                                Matched ({matched.length})
                            </div>
                            <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT }}>
                                    <thead>
                                        <tr style={{ background: '#fafbfc' }}>
                                            <th style={{ textAlign: 'left', padding: '6px 12px' }}>GeoJSON Value</th>
                                            <th style={{ textAlign: 'left', padding: '6px 12px' }}>Org Unit</th>
                                            <th style={{ textAlign: 'left', padding: '6px 12px' }}>Type</th>
                                            <th style={{ textAlign: 'left', padding: '6px 12px' }}>Match</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matched.slice(0, 50).map((m, i) => {
                                            const ml = MATCH_LEVEL[m.matchLevel] || MATCH_LEVEL.exact
                                            return (
                                                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                                                    <td style={{ padding: '4px 12px', color: '#4a5568' }}>
                                                        {String(m.feature.properties?.[matchProperty] || '')}
                                                    </td>
                                                    <td style={{ padding: '4px 12px', color: '#1a202c' }}>
                                                        {m.orgUnit.name}
                                                        <span style={{ color: '#9ca3af', marginLeft: 6, fontSize: 11 }}>{m.orgUnit.id}</span>
                                                    </td>
                                                    <td style={{ padding: '4px 12px', color: '#4a5568' }}>
                                                        {m.geometry.type}
                                                    </td>
                                                    <td style={{ padding: '4px 12px' }}>
                                                        <span style={{
                                                            background: ml.bg, color: ml.color, padding: '1px 6px',
                                                            borderRadius: 8, fontSize: 10, fontWeight: 600,
                                                        }}>
                                                            {ml.label}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                        {matched.length > 50 && (
                                            <tr><td colSpan={4} style={{ padding: '4px 12px', color: '#9ca3af', fontSize: 11 }}>
                                                ...and {matched.length - 50} more
                                            </td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Duplicates */}
                    {duplicates.length > 0 && (
                        <div style={{
                            border: '1px solid #fed7aa', borderRadius: 8, overflow: 'hidden', marginBottom: 16,
                        }}>
                            <div style={{
                                background: '#fff7ed', padding: '8px 12px',
                                fontWeight: 600, fontSize: 13, color: '#9a3412', fontFamily: FONT,
                            }}>
                                Duplicates — skipped ({duplicates.length})
                            </div>
                            <div style={{ maxHeight: 100, overflowY: 'auto' }}>
                                {duplicates.slice(0, 10).map((d, i) => (
                                    <div key={i} style={{
                                        padding: '4px 12px', fontSize: 12, color: '#4a5568',
                                        borderTop: i > 0 ? '1px solid #fff7ed' : 'none', fontFamily: FONT,
                                    }}>
                                        <span style={{ fontWeight: 500 }}>{d.orgUnit.name}</span>
                                        <span style={{ color: '#9ca3af', marginLeft: 6 }}>— multiple features match same org unit</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Unmatched */}
                    {unmatched.length > 0 && (
                        <div style={{
                            border: '1px solid #fecaca', borderRadius: 8, overflow: 'hidden',
                        }}>
                            <div style={{
                                background: '#fef2f2', padding: '8px 12px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: '#C62828', fontFamily: FONT }}>
                                    Unmatched ({unmatched.length})
                                </span>
                                <button
                                    onClick={handleExportUnmatched}
                                    style={{
                                        background: 'none', border: '1px solid #C62828', color: '#C62828',
                                        borderRadius: 6, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
                                        fontFamily: FONT, fontWeight: 600,
                                    }}
                                >
                                    Download .geojson
                                </button>
                            </div>
                            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                                {unmatched.slice(0, 20).map((u, i) => (
                                    <div key={i} style={{
                                        padding: '4px 12px', fontSize: 12, color: '#4a5568',
                                        borderTop: i > 0 ? '1px solid #fef2f2' : 'none', fontFamily: FONT,
                                    }}>
                                        <span style={{ fontWeight: 500 }}>
                                            {u.feature.properties?.[matchProperty] || '(no value)'}
                                        </span>
                                        <span style={{ color: '#9ca3af', marginLeft: 8 }}>{u.reason}</span>
                                    </div>
                                ))}
                                {unmatched.length > 20 && (
                                    <div style={{ padding: '4px 12px', color: '#9ca3af', fontSize: 11 }}>
                                        ...and {unmatched.length - 20} more
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <ButtonStrip style={{ marginTop: 24 }}>
                    <Button secondary onClick={() => setSubStep('configure')}>Back</Button>
                    {matched.length > 0 && (
                        <Button primary onClick={handleImport}>
                            Import {matched.length} Geometries
                        </Button>
                    )}
                </ButtonStrip>
            </div>
        )
    }

    // --- Importing ---
    if (subStep === 'importing') {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CircularLoader />
                <p style={{ color: '#4a5568', fontSize: 14, marginTop: 16, fontFamily: FONT }}>{statusMsg}</p>
                {batchProgress && (
                    <div style={{ maxWidth: 300, margin: '12px auto 0' }}>
                        <div style={{ height: 6, background: '#e0e5ec', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: 3, background: GEO_COLOR,
                                width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%`,
                                transition: 'width 0.3s ease',
                            }} />
                        </div>
                        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6, fontFamily: FONT }}>
                            Batch {batchProgress.done} of {batchProgress.total}
                        </p>
                    </div>
                )}
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
    const stats = importResult?.stats ?? {}
    const importErrors = importResult?.errors ?? []

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
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a202c', fontFamily: FONT }}>
                GeoJSON Import Complete
            </h2>

            <div style={{
                display: 'inline-grid', gridTemplateColumns: 'repeat(4, auto)', gap: '0 20px',
                textAlign: 'center', marginBottom: 16,
            }}>
                <StatInline label="Updated" value={stats.updated ?? 0} color="#1565C0" />
                <StatInline label="Created" value={stats.created ?? 0} color="#2E7D32" />
                <StatInline label="Ignored" value={stats.ignored ?? 0} color="#6b7280" />
                <StatInline label="Errors" value={importErrors.length} color="#C62828" />
            </div>

            {importErrors.length > 0 && (
                <div style={{ maxWidth: 520, margin: '0 auto 16px', textAlign: 'left' }}>
                    <NoticeBox warning title={`${importErrors.length} error(s)`}>
                        <ul style={{ margin: '4px 0', paddingLeft: 20, fontSize: 13 }}>
                            {importErrors.slice(0, 20).map((msg, i) => <li key={i}>{msg}</li>)}
                            {importErrors.length > 20 && <li>...and {importErrors.length - 20} more</li>}
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

// --- Shared UI ---

const Header = ({ title, subtitle }) => (
    <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
        <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `linear-gradient(135deg, ${GEO_COLOR}88, ${GEO_COLOR})`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12, boxShadow: `0 4px 12px ${GEO_COLOR}40`,
        }}>
            <GlobeIcon color="#fff" size={28} />
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

const GlobeIcon = ({ color = '#00695C', size = 48 }) => (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: 'block', margin: '0 auto' }}>
        <circle cx="24" cy="24" r="18" stroke={color} strokeWidth="2" fill="none" />
        <ellipse cx="24" cy="24" rx="10" ry="18" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M6 24h36M8 15h32M8 33h32" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
)

/** Shows built-in intelligence features on the upload screen */
const IntelligenceBadges = () => {
    const features = [
        { icon: '1-2-3', label: '3-level matching', desc: 'Exact → Normalized → Fuzzy' },
        { icon: 'ABC', label: 'Name normalization', desc: 'Strips District, Province, etc.' },
        { icon: 'WGS', label: 'Coordinate validation', desc: 'WGS84 bounds check' },
        { icon: '2x', label: 'Duplicate detection', desc: 'Prevents double-match' },
        { icon: 'DL', label: 'Export unmatched', desc: 'Download failures as GeoJSON' },
        { icon: '200', label: 'Batched import', desc: '200 per batch for reliability' },
    ]
    return (
        <div style={{
            border: '1px solid #e0e5ec', borderRadius: 8, padding: 12,
            fontSize: 12, fontFamily: FONT,
        }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#1a202c' }}>Built-in Intelligence</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {features.map((f) => (
                    <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                            background: GEO_BG, color: GEO_COLOR, padding: '1px 5px',
                            borderRadius: 4, fontSize: 9, fontWeight: 700, minWidth: 28, textAlign: 'center',
                        }}>
                            {f.icon}
                        </span>
                        <span style={{ color: '#4a5568' }}>
                            <strong>{f.label}</strong> — {f.desc}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
