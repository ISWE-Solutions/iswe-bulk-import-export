import React from 'react'
import { DataSetSelector } from '../../DataSetSelector'
import { DataEntryTemplateDownloader } from '../../DataEntryTemplateDownloader'
import { DataEntryFileUploader } from '../../DataEntryFileUploader'
import { ImportPreview } from '../../ImportPreview'
import { ImportProgress } from '../../ImportProgress'

/**
 * Data Entry (aggregate) import flow.
 * Steps: 0=Select, 1=Template, 2=Upload, 3=Preview, 4=Import.
 */
export const DataEntryImportFlow = ({
    step,
    setStep,
    dataSet,
    dataSetMetadata,
    parsedData,
    importPayload,
    importRowMap,
    skippedRows,
    onDataSetSelected,
    onFileUploaded,
    onJsonPayloadReady,
    onPreviewConfirmed,
    onReset,
    onBack,
}) => (
    <>
        {step === 0 && (
            <DataSetSelector onSelect={onDataSetSelected} onBack={onBack} />
        )}
        {step === 1 && (
            <DataEntryTemplateDownloader
                dataSet={dataSet}
                metadata={dataSetMetadata}
                onContinue={() => setStep(2)}
                onBack={onBack}
            />
        )}
        {step === 2 && (
            <DataEntryFileUploader
                metadata={dataSetMetadata}
                onFileUploaded={onFileUploaded}
                onPayloadReady={onJsonPayloadReady}
                onBack={() => setStep(1)}
            />
        )}
        {step === 3 && (
            <ImportPreview
                parsedData={parsedData}
                metadata={dataSetMetadata}
                onConfirm={onPreviewConfirmed}
                onBack={() => setStep(2)}
            />
        )}
        {step === 4 && (
            <ImportProgress
                payload={importPayload}
                rowMap={importRowMap}
                metadata={dataSetMetadata}
                skippedRows={skippedRows}
                onReset={onReset}
            />
        )}
    </>
)
