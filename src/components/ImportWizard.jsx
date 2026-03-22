import React, { useState } from 'react'
import { CenteredContent, Card, LinearLoader } from '@dhis2/ui'
import { ProgramSelector } from './ProgramSelector'
import { TemplateDownloader } from './TemplateDownloader'
import { FileUploader } from './FileUploader'
import { ImportPreview } from './ImportPreview'
import { ImportProgress } from './ImportProgress'

const STEPS = {
    SELECT_PROGRAM: 0,
    DOWNLOAD_TEMPLATE: 1,
    UPLOAD_FILE: 2,
    PREVIEW: 3,
    IMPORT: 4,
}

export const ImportWizard = () => {
    const [step, setStep] = useState(STEPS.SELECT_PROGRAM)
    const [program, setProgram] = useState(null)
    const [programMetadata, setProgramMetadata] = useState(null)
    const [parsedData, setParsedData] = useState(null)
    const [importPayload, setImportPayload] = useState(null)

    const progress = ((step + 1) / Object.keys(STEPS).length) * 100

    const handleProgramSelected = (prog, metadata) => {
        setProgram(prog)
        setProgramMetadata(metadata)
        setStep(STEPS.DOWNLOAD_TEMPLATE)
    }

    const handleFileUploaded = (data) => {
        setParsedData(data)
        setStep(STEPS.PREVIEW)
    }

    const handlePreviewConfirmed = (payload) => {
        setImportPayload(payload)
        setStep(STEPS.IMPORT)
    }

    const handleReset = () => {
        setStep(STEPS.SELECT_PROGRAM)
        setProgram(null)
        setProgramMetadata(null)
        setParsedData(null)
        setImportPayload(null)
    }

    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
            <h1>Tracker Bulk Import</h1>
            <LinearLoader amount={progress} />

            <Card style={{ padding: 24, marginTop: 16 }}>
                {step === STEPS.SELECT_PROGRAM && (
                    <ProgramSelector onSelect={handleProgramSelected} />
                )}
                {step === STEPS.DOWNLOAD_TEMPLATE && (
                    <TemplateDownloader
                        program={program}
                        metadata={programMetadata}
                        onContinue={() => setStep(STEPS.UPLOAD_FILE)}
                        onBack={() => setStep(STEPS.SELECT_PROGRAM)}
                    />
                )}
                {step === STEPS.UPLOAD_FILE && (
                    <FileUploader
                        metadata={programMetadata}
                        onFileUploaded={handleFileUploaded}
                        onBack={() => setStep(STEPS.DOWNLOAD_TEMPLATE)}
                    />
                )}
                {step === STEPS.PREVIEW && (
                    <ImportPreview
                        parsedData={parsedData}
                        metadata={programMetadata}
                        onConfirm={handlePreviewConfirmed}
                        onBack={() => setStep(STEPS.UPLOAD_FILE)}
                    />
                )}
                {step === STEPS.IMPORT && (
                    <ImportProgress
                        payload={importPayload}
                        onReset={handleReset}
                    />
                )}
            </Card>
        </div>
    )
}
