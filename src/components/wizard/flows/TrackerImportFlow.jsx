import React from 'react'
import { ProgramSelector } from '../../ProgramSelector'
import { TemplateDownloader } from '../../TemplateDownloader'
import { FileUploader } from '../../FileUploader'
import { ColumnMapper } from '../../ColumnMapper'
import { ImportPreview } from '../../ImportPreview'
import { ImportProgress } from '../../ImportProgress'

/**
 * Tracker / Event import flow.
 * Steps: 0=Select, 1=Template, 2=Upload, 3=Map, 4=Preview, 5=Import.
 */
export const TrackerImportFlow = ({
    step,
    setStep,
    importType,
    program,
    programMetadata,
    workbookInfo,
    parsedData,
    importPayload,
    importRowMap,
    skippedRows,
    onProgramSelected,
    onFileUploaded,
    onFileParsedForMapping,
    onJsonPayloadReady,
    onMappingComplete,
    onPreviewConfirmed,
    onReset,
    onBack,
}) => (
    <>
        {step === 0 && (
            <ProgramSelector
                onSelect={onProgramSelected}
                filterType={importType === 'tracker' ? 'WITH_REGISTRATION' : 'WITHOUT_REGISTRATION'}
                onBack={onBack}
            />
        )}
        {step === 1 && (
            <TemplateDownloader
                program={program}
                metadata={programMetadata}
                onContinue={() => setStep(2)}
                onBack={onBack}
            />
        )}
        {step === 2 && (
            <FileUploader
                metadata={programMetadata}
                onFileUploaded={onFileUploaded}
                onFileParsedForMapping={onFileParsedForMapping}
                onPayloadReady={onJsonPayloadReady}
                onBack={() => setStep(1)}
            />
        )}
        {step === 3 && workbookInfo && (
            <ColumnMapper
                workbook={workbookInfo.workbook}
                sheetsInfo={workbookInfo.sheets}
                mapping={workbookInfo.mapping}
                metadata={programMetadata}
                onMapped={onMappingComplete}
                onBack={() => setStep(2)}
            />
        )}
        {step === 4 && (
            <ImportPreview
                parsedData={parsedData}
                metadata={programMetadata}
                onConfirm={onPreviewConfirmed}
                onBack={() => (workbookInfo ? setStep(3) : setStep(2))}
            />
        )}
        {step === 5 && (
            <ImportProgress
                payload={importPayload}
                rowMap={importRowMap}
                metadata={programMetadata}
                skippedRows={skippedRows}
                onReset={onReset}
            />
        )}
    </>
)
