import React, { useState } from 'react'
import { Card } from '@dhis2/ui'
import { ImportTypeSelector } from './ImportTypeSelector'
import { ProgramSelector } from './ProgramSelector'
import { DataSetSelector } from './DataSetSelector'
import { TemplateDownloader } from './TemplateDownloader'
import { DataEntryTemplateDownloader } from './DataEntryTemplateDownloader'
import { FileUploader } from './FileUploader'
import { DataEntryFileUploader } from './DataEntryFileUploader'
import { ColumnMapper } from './ColumnMapper'
import { ImportPreview } from './ImportPreview'
import { ImportProgress } from './ImportProgress'
import { ExportConfigurator } from './ExportConfigurator'
import { ExportProgress } from './ExportProgress'
import { MetadataTypeSelector } from './MetadataTypeSelector'
import { MetadataExportProgress } from './MetadataExportProgress'
import { MetadataImportFlow } from './MetadataImportFlow'
import { GeoImportFlow } from './GeoImportFlow'

/**
 * Shared font stack and color tokens for consistent typography.
 */
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const COLORS = {
    primary: '#1565C0',
    primaryLight: '#e3f2fd',
    success: '#2E7D32',
    muted: '#4a5568',
    mutedLight: '#6b7280',
    border: '#e0e5ec',
    bg: '#f4f6f8',
    text: '#1a202c',
}

/**
 * Step definitions per import type.
 * Tracker/Event: Select → Template → Upload → Map → Preview → Import
 * Data Entry: Select → Template → Upload → Preview → Import
 */
const TRACKER_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'TEMPLATE', label: 'Template' },
    { key: 'UPLOAD', label: 'Upload' },
    { key: 'MAP', label: 'Map Columns' },
    { key: 'PREVIEW', label: 'Preview' },
    { key: 'IMPORT', label: 'Import' },
]

const DATA_ENTRY_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'TEMPLATE', label: 'Template' },
    { key: 'UPLOAD', label: 'Upload' },
    { key: 'PREVIEW', label: 'Preview' },
    { key: 'IMPORT', label: 'Import' },
]

const EXPORT_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'CONFIGURE', label: 'Configure' },
    { key: 'EXPORT', label: 'Export' },
]

const METADATA_IMPORT_STEPS = [
    { key: 'SELECT', label: 'Select Type' },
    { key: 'IMPORT', label: 'Import' },
]

const METADATA_EXPORT_STEPS = [
    { key: 'SELECT', label: 'Select Type' },
    { key: 'EXPORT', label: 'Export' },
]

/** App icon shown in the wizard header — ISWE Solution logo. */
const AppIcon = () => (
    <img
        src="./iswe-logo.png"
        alt="ISWE Bulk Import/Export"
        width={38}
        height={38}
        style={{ borderRadius: 8 }}
    />
)

/** Stepper with numbered circles and connecting lines */
const Stepper = ({ steps, currentStep }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            margin: '0 0 20px',
            padding: '14px 20px',
            background: COLORS.bg,
            borderRadius: 8,
            fontFamily: FONT,
        }}
    >
        {steps.map((s, i) => {
            const isActive = i === currentStep
            const isDone = i < currentStep
            const bg = isActive ? COLORS.primary : isDone ? COLORS.success : '#d1d5db'
            const fg = isActive || isDone ? '#fff' : '#6b7280'
            return (
                <React.Fragment key={s.key}>
                    {i > 0 && (
                        <div
                            style={{
                                flex: 1,
                                height: 2,
                                background: isDone ? COLORS.success : '#d1d5db',
                                margin: '0 4px',
                            }}
                        />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
                        <div
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: bg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: fg,
                                fontSize: 12,
                                fontWeight: 700,
                                fontFamily: FONT,
                                boxShadow: isActive ? '0 0 0 3px rgba(21,101,192,0.2)' : 'none',
                                transition: 'all 0.2s',
                            }}
                        >
                            {isDone ? '\u2713' : i + 1}
                        </div>
                        <span
                            style={{
                                fontSize: 10,
                                marginTop: 4,
                                color: isActive ? COLORS.primary : isDone ? COLORS.success : '#6b7280',
                                fontWeight: isActive ? 600 : 400,
                                whiteSpace: 'nowrap',
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                                fontFamily: FONT,
                            }}
                        >
                            {s.label}
                        </span>
                    </div>
                </React.Fragment>
            )
        })}
    </div>
)

/** Color + label for import type badges */
const IMPORT_TYPE_STYLE = {
    tracker: { bg: '#e8f5e9', color: '#2E7D32', label: 'Tracker' },
    event: { bg: '#FFF8E1', color: '#E65100', label: 'Event' },
    dataEntry: { bg: '#E8F5E9', color: '#2E7D32', label: 'Data Entry' },
    metadata: { bg: '#F3E5F5', color: '#6A1B9A', label: 'Metadata' },
}

export const ImportWizard = () => {
    // mode: 'import' | 'export' (set when a type is selected)
    const [mode, setMode] = useState(null)
    // importType: null | 'tracker' | 'event' | 'dataEntry'
    const [importType, setImportType] = useState(null)
    const [step, setStep] = useState(0)

    // Program/DataSet state
    const [program, setProgram] = useState(null)
    const [programMetadata, setProgramMetadata] = useState(null)
    const [dataSet, setDataSet] = useState(null)
    const [dataSetMetadata, setDataSetMetadata] = useState(null)

    // Import-specific state
    const [parsedData, setParsedData] = useState(null)
    const [importPayload, setImportPayload] = useState(null)
    const [importRowMap, setImportRowMap] = useState(null)
    const [workbookInfo, setWorkbookInfo] = useState(null)

    // Export-specific state
    const [exportConfig, setExportConfig] = useState(null)

    // Metadata-specific state
    const [metadataType, setMetadataType] = useState(null)

    const isExport = mode === 'export'
    const isDataEntry = importType === 'dataEntry'
    const isMetadata = importType === 'metadata'
    const steps = isMetadata
        ? (isExport ? METADATA_EXPORT_STEPS : METADATA_IMPORT_STEPS)
        : isExport ? EXPORT_STEPS : isDataEntry ? DATA_ENTRY_STEPS : TRACKER_STEPS

    // Active metadata (program for tracker/event, data set for data entry)
    const activeMetadata = isDataEntry ? dataSetMetadata : programMetadata
    const activeName = isMetadata
        ? metadataType?.label
        : isDataEntry ? dataSet?.displayName : program?.displayName

    const handleImportTypeSelected = (type) => {
        // Detect export_ prefix from ImportTypeSelector
        const exporting = type.startsWith('export_')
        const baseType = exporting ? type.replace('export_', '') : type
        setMode(exporting ? 'export' : 'import')
        setImportType(baseType)
        setStep(0)
    }

    const handleMetadataTypeSelected = (mt) => {
        setMetadataType(mt)
        setStep(1)
    }

    const handleProgramSelected = (prog, metadata) => {
        setProgram(prog)
        setProgramMetadata(metadata)
        // Override import type based on actual program type (only for import)
        if (!isExport) {
            setImportType(prog.programType === 'WITHOUT_REGISTRATION' ? 'event' : 'tracker')
        }
        setStep(1)
    }

    const handleDataSetSelected = (ds, metadata) => {
        setDataSet(ds)
        setDataSetMetadata(metadata)
        setStep(1)
    }

    const handleExportConfigured = (config) => {
        setExportConfig(config)
        setStep(2)
    }

    const handleFileUploaded = (data) => {
        setParsedData(data)
        setWorkbookInfo(null)
        if (isDataEntry) {
            setStep(3) // Preview (data entry has no column mapping)
        } else {
            setStep(4) // Preview (tracker/event)
        }
    }

    const handleFileParsedForMapping = (info) => {
        setWorkbookInfo(info)
        setStep(3) // Column mapping (tracker/event only)
    }

    const handleMappingComplete = (data) => {
        setParsedData(data)
        setStep(4) // Preview
    }

    /**
     * JSON-payload path: a native DHIS2 payload was parsed and the user confirmed.
     * Skip Preview/Map/Template steps entirely and go straight to Import.
     * `result.payload` is the ready-to-submit object (e.g. { trackedEntities: [...] }).
     */
    const handleJsonPayloadReady = (result) => {
        setImportPayload(result.payload)
        setImportRowMap({}) // no row mapping for JSON uploads
        setSkippedRows(null)
        if (isDataEntry) setStep(4) // Import
        else setStep(5) // Import
    }

    const [skippedRows, setSkippedRows] = useState(null)

    const handlePreviewConfirmed = (payload, rowMap, skipped) => {
        setImportPayload(payload)
        setImportRowMap(rowMap)
        setSkippedRows(skipped || null)
        if (isDataEntry) {
            setStep(4) // Import
        } else {
            setStep(5) // Import
        }
    }

    const handleReset = () => {
        setMode(null)
        setImportType(null)
        setStep(0)
        setProgram(null)
        setProgramMetadata(null)
        setDataSet(null)
        setDataSetMetadata(null)
        setParsedData(null)
        setImportPayload(null)
        setImportRowMap(null)
        setSkippedRows(null)
        setWorkbookInfo(null)
        setExportConfig(null)
        setMetadataType(null)
    }

    /** Go back to import type selection */
    const handleBackToTypeSelect = () => {
        setMode(null)
        setImportType(null)
        setStep(0)
        setProgram(null)
        setProgramMetadata(null)
        setDataSet(null)
        setDataSetMetadata(null)
        setExportConfig(null)
        setMetadataType(null)
    }

    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 24px', fontFamily: FONT }}>
            {/* App header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 16,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${COLORS.border}`,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <AppIcon />
                    <div>
                        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: COLORS.text, fontFamily: FONT, letterSpacing: -0.2 }}>
                            ISWE Bulk Import/Export
                        </h1>
                        <p style={{ margin: 0, fontSize: 12, color: COLORS.muted, fontFamily: FONT }}>
                            Bulk import &amp; export for tracker, repeatable events, aggregate and metadata
                        </p>
                    </div>
                </div>
                {importType && (activeName || isMetadata) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {activeName && (
                            <div
                                style={{
                                    background: COLORS.primaryLight,
                                    padding: '5px 14px',
                                    borderRadius: 14,
                                    fontSize: 12,
                                    color: COLORS.primary,
                                    fontWeight: 600,
                                    fontFamily: FONT,
                                }}
                            >
                                {activeName}
                            </div>
                        )}
                        <div
                            style={{
                                background: IMPORT_TYPE_STYLE[importType].bg,
                                padding: '3px 10px',
                                borderRadius: 10,
                                fontSize: 11,
                                color: IMPORT_TYPE_STYLE[importType].color,
                                fontWeight: 600,
                                fontFamily: FONT,
                            }}
                        >
                            {IMPORT_TYPE_STYLE[importType].label}
                        </div>
                        {isExport && (
                            <div
                                style={{
                                    background: '#F3E5F5',
                                    padding: '3px 10px',
                                    borderRadius: 10,
                                    fontSize: 11,
                                    color: '#7B1FA2',
                                    fontWeight: 600,
                                    fontFamily: FONT,
                                }}
                            >
                                Export
                            </div>
                        )}
                    </div>
                )}
            </div>

            {importType && <Stepper steps={steps} currentStep={step} />}

            <Card style={{ padding: 24 }}>
                <div style={{ fontFamily: FONT }}>
                    {/* Type Selection (landing page) */}
                    {!importType && (
                        <ImportTypeSelector onSelect={handleImportTypeSelected} />
                    )}

                    {/* === EXPORT FLOW (tracker/event) === */}
                    {isExport && !isDataEntry && !isMetadata && step === 0 && (
                        <ProgramSelector
                            onSelect={handleProgramSelected}
                            filterType={importType === 'tracker' ? 'WITH_REGISTRATION' : 'WITHOUT_REGISTRATION'}
                            onBack={handleBackToTypeSelect}
                            mode="export"
                        />
                    )}
                    {isExport && isDataEntry && step === 0 && (
                        <DataSetSelector onSelect={handleDataSetSelected} onBack={handleBackToTypeSelect} mode="export" />
                    )}
                    {isExport && !isMetadata && step === 1 && activeMetadata && (
                        <ExportConfigurator
                            metadata={activeMetadata}
                            isDataEntry={isDataEntry}
                            importType={importType}
                            onExport={handleExportConfigured}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {isExport && !isMetadata && step === 2 && exportConfig && (
                        <ExportProgress
                            metadata={activeMetadata}
                            exportConfig={exportConfig}
                            importType={importType}
                            onReset={handleReset}
                            onBack={() => setStep(1)}
                        />
                    )}

                    {/* === METADATA EXPORT FLOW === */}
                    {isExport && isMetadata && step === 0 && (
                        <MetadataTypeSelector
                            mode="export"
                            onSelect={handleMetadataTypeSelected}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {isExport && isMetadata && step === 1 && metadataType && (
                        <MetadataExportProgress
                            metadataType={metadataType}
                            onReset={handleReset}
                            onBack={() => { setMetadataType(null); setStep(0) }}
                        />
                    )}

                    {/* === METADATA IMPORT FLOW === */}
                    {!isExport && isMetadata && step === 0 && (
                        <MetadataTypeSelector
                            mode="import"
                            onSelect={handleMetadataTypeSelected}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {!isExport && isMetadata && step === 1 && metadataType && metadataType.key !== 'geoJson' && (
                        <MetadataImportFlow
                            metadataType={metadataType}
                            onReset={handleReset}
                            onBack={() => { setMetadataType(null); setStep(0) }}
                        />
                    )}
                    {!isExport && isMetadata && step === 1 && metadataType && metadataType.key === 'geoJson' && (
                        <GeoImportFlow
                            onReset={handleReset}
                            onBack={() => { setMetadataType(null); setStep(0) }}
                        />
                    )}

                    {/* === TRACKER / EVENT IMPORT FLOW === */}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 0 && (
                        <ProgramSelector
                            onSelect={handleProgramSelected}
                            filterType={importType === 'tracker' ? 'WITH_REGISTRATION' : 'WITHOUT_REGISTRATION'}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 1 && (
                        <TemplateDownloader
                            program={program}
                            metadata={programMetadata}
                            onContinue={() => setStep(2)}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 2 && (
                        <FileUploader
                            metadata={programMetadata}
                            onFileUploaded={handleFileUploaded}
                            onFileParsedForMapping={handleFileParsedForMapping}
                            onPayloadReady={handleJsonPayloadReady}
                            onBack={() => setStep(1)}
                        />
                    )}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 3 && workbookInfo && (
                        <ColumnMapper
                            workbook={workbookInfo.workbook}
                            sheetsInfo={workbookInfo.sheets}
                            mapping={workbookInfo.mapping}
                            metadata={programMetadata}
                            onMapped={handleMappingComplete}
                            onBack={() => setStep(2)}
                        />
                    )}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 4 && (
                        <ImportPreview
                            parsedData={parsedData}
                            metadata={programMetadata}
                            onConfirm={handlePreviewConfirmed}
                            onBack={() =>
                                workbookInfo ? setStep(3) : setStep(2)
                            }
                        />
                    )}
                    {!isExport && importType && !isDataEntry && !isMetadata && step === 5 && (
                        <ImportProgress
                            payload={importPayload}
                            rowMap={importRowMap}
                            metadata={programMetadata}
                            skippedRows={skippedRows}
                            onReset={handleReset}
                        />
                    )}

                    {/* === DATA ENTRY IMPORT FLOW === */}
                    {!isExport && isDataEntry && step === 0 && (
                        <DataSetSelector onSelect={handleDataSetSelected} onBack={handleBackToTypeSelect} />
                    )}
                    {!isExport && isDataEntry && step === 1 && (
                        <DataEntryTemplateDownloader
                            dataSet={dataSet}
                            metadata={dataSetMetadata}
                            onContinue={() => setStep(2)}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                    {!isExport && isDataEntry && step === 2 && (
                        <DataEntryFileUploader
                            metadata={dataSetMetadata}
                            onFileUploaded={handleFileUploaded}
                            onPayloadReady={handleJsonPayloadReady}
                            onBack={() => setStep(1)}
                        />
                    )}
                    {!isExport && isDataEntry && step === 3 && (
                        <ImportPreview
                            parsedData={parsedData}
                            metadata={dataSetMetadata}
                            onConfirm={handlePreviewConfirmed}
                            onBack={() => setStep(2)}
                        />
                    )}
                    {!isExport && isDataEntry && step === 4 && (
                        <ImportProgress
                            payload={importPayload}
                            rowMap={importRowMap}
                            metadata={dataSetMetadata}
                            skippedRows={skippedRows}
                            onReset={handleReset}
                        />
                    )}
                </div>
            </Card>

            <footer
                style={{
                    textAlign: 'center',
                    fontSize: 12,
                    color: COLORS.mutedLight,
                    marginTop: 20,
                    paddingTop: 12,
                    borderTop: `1px solid ${COLORS.border}`,
                    fontFamily: FONT,
                    lineHeight: 1.6,
                }}
            >
                <div>
                    Built by{' '}
                    <a
                        href="https://iswesolutions.com"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: COLORS.primary, textDecoration: 'none', fontWeight: 500 }}
                    >
                        ISWE Solutions
                    </a>{' '}
                    &middot; Bulk Import/Export v1.2.6 &middot; Compatible with DHIS2 2.40+
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>
                    Open-source (BSD-3-Clause) &middot;{' '}
                    <a
                        href="https://github.com/ISWE-Solutions/iswe-bulk-import-export"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: COLORS.mutedLight, textDecoration: 'underline' }}
                    >
                        Source code
                    </a>{' '}
                    &middot;{' '}
                    <a
                        href="https://github.com/ISWE-Solutions/iswe-bulk-import-export/issues"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: COLORS.mutedLight, textDecoration: 'underline' }}
                    >
                        Report an issue
                    </a>
                </div>
            </footer>
        </div>
    )
}
