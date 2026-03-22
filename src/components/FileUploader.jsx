import React, { useCallback, useState } from 'react'
import { Button, ButtonStrip, FileInput, NoticeBox } from '@dhis2/ui'
import { parseUploadedFile } from '../lib/fileParser'

export const FileUploader = ({ metadata, onFileUploaded, onBack }) => {
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
            const parsed = await parseUploadedFile(file, metadata)
            onFileUploaded(parsed)
        } catch (e) {
            setError(e.message)
        } finally {
            setParsing(false)
        }
    }, [file, metadata, onFileUploaded])

    return (
        <div>
            <h2>Step 3: Upload Data File</h2>
            <p>Upload your filled-in Excel template (.xlsx).</p>

            <FileInput
                accept=".xlsx,.xls,.csv"
                label="Select file"
                name="importFile"
                onChange={handleFileChange}
            />

            {file && (
                <p style={{ marginTop: 8 }}>
                    Selected: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)
                </p>
            )}

            {error && (
                <NoticeBox error title="Parse Error">
                    {error}
                </NoticeBox>
            )}

            <ButtonStrip style={{ marginTop: 16 }}>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                <Button onClick={handleParse} primary disabled={!file || parsing}>
                    {parsing ? 'Parsing...' : 'Parse & Preview'}
                </Button>
            </ButtonStrip>
        </div>
    )
}
