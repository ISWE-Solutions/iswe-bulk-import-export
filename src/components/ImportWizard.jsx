import React, { useState } from 'react'
import { Card } from '@dhis2/ui'
import { ImportTypeSelector } from './ImportTypeSelector'
import {
    FONT,
    TRACKER_STEPS,
    DATA_ENTRY_STEPS,
    EXPORT_STEPS,
    METADATA_IMPORT_STEPS,
    METADATA_EXPORT_STEPS,
} from './wizard/constants'
import { Stepper } from './wizard/Stepper'
import { WizardHeader } from './wizard/WizardHeader'
import { WizardFooter } from './wizard/WizardFooter'
import { ExportFlow } from './wizard/flows/ExportFlow'
import { MetadataFlow } from './wizard/flows/MetadataFlow'
import { TrackerImportFlow } from './wizard/flows/TrackerImportFlow'
import { DataEntryImportFlow } from './wizard/flows/DataEntryImportFlow'

const APP_VERSION = '1.2.7'

/**
 * ImportWizard — top-level orchestrator.
 *
 * Owns the wizard's mode/step/selection state and delegates rendering of each
 * flow (tracker import, data-entry import, metadata, export) to a dedicated
 * sub-component under `./wizard/flows/`. Layout chrome (header, stepper,
 * footer) lives under `./wizard/`.
 */
export const ImportWizard = () => {
    // mode: 'import' | 'export' (set when a type is selected)
    const [mode, setMode] = useState(null)
    // importType: null | 'tracker' | 'event' | 'dataEntry' | 'metadata'
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
    const [skippedRows, setSkippedRows] = useState(null)

    // Export-specific state
    const [exportConfig, setExportConfig] = useState(null)

    // Metadata-specific state
    const [metadataType, setMetadataType] = useState(null)

    const isExport = mode === 'export'
    const isDataEntry = importType === 'dataEntry'
    const isMetadata = importType === 'metadata'
    const steps = isMetadata
        ? isExport
            ? METADATA_EXPORT_STEPS
            : METADATA_IMPORT_STEPS
        : isExport
        ? EXPORT_STEPS
        : isDataEntry
        ? DATA_ENTRY_STEPS
        : TRACKER_STEPS

    // Active metadata (program for tracker/event, data set for data entry)
    const activeMetadata = isDataEntry ? dataSetMetadata : programMetadata
    const activeName = isMetadata
        ? metadataType?.label
        : isDataEntry
        ? dataSet?.displayName
        : program?.displayName

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

    const handleMetadataTypeReset = () => {
        setMetadataType(null)
        setStep(0)
    }

    return (
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 24px', fontFamily: FONT }}>
            <WizardHeader
                importType={importType}
                isExport={isExport}
                isMetadata={isMetadata}
                activeName={activeName}
            />

            {importType && <Stepper steps={steps} currentStep={step} />}

            <Card style={{ padding: 24 }}>
                <div style={{ fontFamily: FONT }}>
                    {/* Type Selection (landing page) */}
                    {!importType && <ImportTypeSelector onSelect={handleImportTypeSelected} />}

                    {/* === EXPORT FLOW (tracker / event / data entry) === */}
                    {isExport && !isMetadata && (
                        <ExportFlow
                            step={step}
                            setStep={setStep}
                            importType={importType}
                            isDataEntry={isDataEntry}
                            activeMetadata={activeMetadata}
                            exportConfig={exportConfig}
                            onProgramSelected={handleProgramSelected}
                            onDataSetSelected={handleDataSetSelected}
                            onExportConfigured={handleExportConfigured}
                            onReset={handleReset}
                            onBack={handleBackToTypeSelect}
                        />
                    )}

                    {/* === METADATA FLOW (import + export) === */}
                    {isMetadata && (
                        <MetadataFlow
                            step={step}
                            isExport={isExport}
                            metadataType={metadataType}
                            onTypeSelected={handleMetadataTypeSelected}
                            onTypeReset={handleMetadataTypeReset}
                            onReset={handleReset}
                            onBack={handleBackToTypeSelect}
                        />
                    )}

                    {/* === TRACKER / EVENT IMPORT FLOW === */}
                    {!isExport && importType && !isDataEntry && !isMetadata && (
                        <TrackerImportFlow
                            step={step}
                            setStep={setStep}
                            importType={importType}
                            program={program}
                            programMetadata={programMetadata}
                            workbookInfo={workbookInfo}
                            parsedData={parsedData}
                            importPayload={importPayload}
                            importRowMap={importRowMap}
                            skippedRows={skippedRows}
                            onProgramSelected={handleProgramSelected}
                            onFileUploaded={handleFileUploaded}
                            onFileParsedForMapping={handleFileParsedForMapping}
                            onJsonPayloadReady={handleJsonPayloadReady}
                            onMappingComplete={handleMappingComplete}
                            onPreviewConfirmed={handlePreviewConfirmed}
                            onReset={handleReset}
                            onBack={handleBackToTypeSelect}
                        />
                    )}

                    {/* === DATA ENTRY IMPORT FLOW === */}
                    {!isExport && isDataEntry && (
                        <DataEntryImportFlow
                            step={step}
                            setStep={setStep}
                            dataSet={dataSet}
                            dataSetMetadata={dataSetMetadata}
                            parsedData={parsedData}
                            importPayload={importPayload}
                            importRowMap={importRowMap}
                            skippedRows={skippedRows}
                            onDataSetSelected={handleDataSetSelected}
                            onFileUploaded={handleFileUploaded}
                            onJsonPayloadReady={handleJsonPayloadReady}
                            onPreviewConfirmed={handlePreviewConfirmed}
                            onReset={handleReset}
                            onBack={handleBackToTypeSelect}
                        />
                    )}
                </div>
            </Card>

            <WizardFooter version={APP_VERSION} />
        </div>
    )
}
