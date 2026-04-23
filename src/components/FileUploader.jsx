import React, { useCallback, useState } from 'react'
import { Button, ButtonStrip, FileInput, NoticeBox, Tag } from '@dhis2/ui'
import {
    readWorkbook,
    isAppTemplate,
    isEventTemplate,
    parseUploadedFile,
    buildAutoMapping,
    buildEventAutoMapping,
    parseNativeJsonPayload,
} from '../lib/fileParser'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/**
 * File upload step for tracker and event imports.
 *
 * Supports two source modes:
 *   - Excel (default): template-based, auto-detects app templates or hands off to
 *     the Column Mapper for external workbooks.
 *   - JSON (advanced): accepts a native DHIS2 `/api/tracker` payload directly; skips
 *     Template and Map Columns steps. `onPayloadReady` is called with the ready payload
 *     and the wizard jumps straight to Import.
 *
 * Props:
 *  - metadata: program metadata
 *  - onFileUploaded(parsedIntermediateData): Excel app-template parsed result
 *  - onFileParsedForMapping(info): external Excel, needs mapping
 *  - onPayloadReady({ payload, summary }): native JSON payload, skip to Import
 *  - onBack(): go back a step
 */
export const FileUploader = ({ metadata, onFileUploaded, onFileParsedForMapping, onPayloadReady, onBack }) => {
    const [sourceKind, setSourceKind] = useState('excel') // 'excel' | 'json'
    const [file, setFile] = useState(null)
    const [error, setError] = useState(null)
    const [parsing, setParsing] = useState(false)
    const [jsonPreview, setJsonPreview] = useState(null)

    const isEvent = metadata.programType === 'WITHOUT_REGISTRATION'

    const handleFileChange = useCallback(({ files }) => {
        const f = files[0] ?? null
        setFile(f)
        setError(null)
        setJsonPreview(null)
    }, [])

    const switchSource = (kind) => {
        setSourceKind(kind)
        setFile(null)
        setError(null)
        setJsonPreview(null)
    }

    const handleParseExcel = useCallback(async () => {
        setParsing(true)
        setError(null)
        try {
            const { workbook, sheets, sheetNames } = await readWorkbook(file)
            if (isEvent && isEventTemplate(sheets, metadata)) {
                const parsed = await parseUploadedFile(file, metadata)
                onFileUploaded(parsed)
            } else if (!isEvent && isAppTemplate(sheets)) {
                const parsed = await parseUploadedFile(file, metadata)
                onFileUploaded(parsed)
            } else if (isEvent) {
                const autoMapping = buildEventAutoMapping(sheets, metadata, workbook)
                onFileParsedForMapping({ workbook, sheets, sheetNames, mapping: autoMapping })
            } else {
                const autoMapping = buildAutoMapping(sheets, metadata, workbook)
                onFileParsedForMapping({ workbook, sheets, sheetNames, mapping: autoMapping })
            }
        } catch (e) {
            setError(e.message)
        } finally {
            setParsing(false)
        }
    }, [file, metadata, isEvent, onFileUploaded, onFileParsedForMapping])

    const handleParseJson = useCallback(async () => {
        setParsing(true)
        setError(null)
        try {
            const text = await file.text()
            const result = parseNativeJsonPayload(text, isEvent ? 'event' : 'tracker')
            setJsonPreview(result)
        } catch (e) {
            setError(e.message)
            setJsonPreview(null)
        } finally {
            setParsing(false)
        }
    }, [file, isEvent])

    const handleAction = () => {
        if (!file) return
        if (sourceKind === 'json') {
            if (jsonPreview) onPayloadReady?.(jsonPreview)
            else handleParseJson()
        } else {
            handleParseExcel()
        }
    }

    const actionLabel = parsing
        ? 'Processing...'
        : sourceKind === 'json'
            ? (jsonPreview ? 'Start Import' : 'Preview JSON')
            : 'Upload & Continue'

    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Upload Your Data</h2>
            <p style={{ color: '#4a5568', margin: '0 0 16px', fontSize: 14, lineHeight: 1.5 }}>
                Choose your data source. Excel is the standard template-based flow. JSON accepts a native DHIS2 payload directly and skips template + column mapping.
            </p>

            <SourceToggle value={sourceKind} onChange={switchSource} />

            <div
                style={{
                    border: file ? '2px solid #2E7D32' : '2px dashed #c4cdd5',
                    borderRadius: 8,
                    padding: '28px 24px',
                    textAlign: 'center',
                    background: file ? '#f0faf0' : '#fafbfc',
                    marginTop: 16,
                    marginBottom: 16,
                    transition: 'all 0.2s',
                }}
            >
                {!file && (
                    <div style={{ marginBottom: 12 }}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="4" y="4" width="32" height="32" rx="6" fill="#e3f2fd" />
                            <path d="M20 12L20 24M15 17L20 12L25 17" stroke="#1565C0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 26H28" stroke="#1565C0" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </div>
                )}
                <FileInput
                    accept={sourceKind === 'json' ? '.json' : '.xlsx,.xls,.csv'}
                    label={file ? 'Change file' : (sourceKind === 'json' ? 'Choose JSON file' : 'Choose Excel file')}
                    name="importFile"
                    onChange={handleFileChange}
                    buttonLabel={file ? 'Change file' : 'Browse files'}
                />
                {file ? (
                    <p style={{ marginTop: 10, marginBottom: 0, color: '#2E7D32', fontWeight: 600, fontSize: 14 }}>
                        {file.name}
                        <span style={{ fontWeight: 400, color: '#4a5568', marginLeft: 6 }}>
                            ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                    </p>
                ) : (
                    <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: '#6b7280' }}>
                        {sourceKind === 'json' ? '.json' : '.xlsx, .xls, or .csv'}
                    </p>
                )}
            </div>

            {sourceKind === 'json' && jsonPreview && (
                <div style={{
                    border: '1px solid #BBDEFB',
                    background: '#E3F2FD',
                    padding: '12px 16px',
                    borderRadius: 8,
                    marginBottom: 16,
                    fontFamily: FONT,
                }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0D47A1', marginBottom: 6 }}>
                        JSON looks valid. Ready to import:
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(jsonPreview.summary).map(([label, count]) => (
                            <Tag key={label} neutral>{label}: {count}</Tag>
                        ))}
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: 12, color: '#4a5568' }}>
                        Client-side validation is skipped for JSON uploads. DHIS2 will still validate the payload on submission.
                    </p>
                </div>
            )}

            {error && (
                <NoticeBox error title={sourceKind === 'json' ? 'JSON Parse Error' : 'Parse Error'}>
                    {error}
                </NoticeBox>
            )}

            <ButtonStrip style={{ marginTop: 4 }}>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                <Button onClick={handleAction} primary disabled={!file || parsing}>
                    {actionLabel}
                </Button>
            </ButtonStrip>
        </div>
    )
}

/** Pill-style toggle to pick Excel vs JSON source. */
const SourceToggle = ({ value, onChange }) => (
    <div style={{
        display: 'inline-flex', borderRadius: 20, background: '#f4f6f8',
        padding: 3, border: '1px solid #e0e5ec',
    }}>
        {[
            { key: 'excel', label: 'Excel', desc: 'Template-based (recommended)' },
            { key: 'json', label: 'JSON', desc: 'Native DHIS2 payload (advanced)' },
        ].map((opt) => (
            <button
                key={opt.key}
                onClick={() => onChange(opt.key)}
                title={opt.desc}
                style={{
                    padding: '7px 18px',
                    borderRadius: 17,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: FONT,
                    background: value === opt.key ? '#1565C0' : 'transparent',
                    color: value === opt.key ? '#fff' : '#4a5568',
                    transition: 'all 0.15s ease',
                }}
            >
                {opt.label}
            </button>
        ))}
    </div>
)
