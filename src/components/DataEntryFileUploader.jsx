import React, { useCallback, useState } from 'react'
import { Button, ButtonStrip, FileInput, NoticeBox } from '@dhis2/ui'
import { readWorkbook, isDataEntryTemplate, parseDataEntryTemplate } from '../lib/fileParser'

export const DataEntryFileUploader = ({ metadata, onFileUploaded, onBack }) => {
    const [file, setFile] = useState(null)
    const [error, setError] = useState(null)
    const [parsing, setParsing] = useState(false)

    const handleFileChange = useCallback(({ files }) => {
        setFile(files[0] ?? null)
        setError(null)
    }, [])

    const handleParse = useCallback(async () => {
        if (!file) return
        setParsing(true)
        setError(null)
        try {
            const { workbook, sheets } = await readWorkbook(file)

            if (!isDataEntryTemplate(sheets)) {
                throw new Error(
                    'This file does not match the data entry template format. ' +
                    'Expected a "Data Entry" sheet with ORG_UNIT_ID, PERIOD, and data element columns with [UID] headers.'
                )
            }

            const parsed = parseDataEntryTemplate(workbook, metadata)
            if (!parsed.dataValues || parsed.dataValues.length === 0) {
                throw new Error('No data values found in the file. Make sure you have filled in at least one row.')
            }

            onFileUploaded(parsed)
        } catch (e) {
            setError(e.message)
        } finally {
            setParsing(false)
        }
    }, [file, metadata, onFileUploaded])

    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>Upload Data Entry File</h2>
            <p style={{ color: '#4a5568', margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                Upload the filled-in data entry template. The app will parse org units, periods, and data values.
            </p>

            <div
                style={{
                    border: file ? '2px solid #2E7D32' : '2px dashed #c4cdd5',
                    borderRadius: 8,
                    padding: '28px 24px',
                    textAlign: 'center',
                    background: file ? '#f0faf0' : '#fafbfc',
                    marginBottom: 20,
                    transition: 'all 0.2s',
                }}
            >
                {!file && (
                    <div style={{ marginBottom: 12 }}>
                        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="4" y="4" width="32" height="32" rx="6" fill="#E8F5E9" />
                            <path d="M20 12L20 24M15 17L20 12L25 17" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 26H28" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    </div>
                )}
                <FileInput
                    accept=".xlsx,.xls"
                    label={file ? 'Change file' : 'Choose Excel file'}
                    name="dataEntryFile"
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
                        .xlsx or .xls
                    </p>
                )}
            </div>

            {error && (
                <NoticeBox error title="Parse Error">
                    {error}
                </NoticeBox>
            )}

            <ButtonStrip>
                <Button onClick={onBack} secondary>Back</Button>
                <Button onClick={handleParse} primary disabled={!file || parsing}>
                    {parsing ? 'Parsing...' : 'Parse & Continue'}
                </Button>
            </ButtonStrip>
        </div>
    )
}
