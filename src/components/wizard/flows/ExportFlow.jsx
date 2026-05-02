import React from 'react'
import { ProgramSelector } from '../../ProgramSelector'
import { DataSetSelector } from '../../DataSetSelector'
import { ExportConfigurator } from '../../ExportConfigurator'
import { ExportProgress } from '../../ExportProgress'

/**
 * Tracker / Event / Data Entry export flow.
 * Steps: 0=Select, 1=Configure, 2=Export.
 */
export const ExportFlow = ({
    step,
    setStep,
    importType,
    isDataEntry,
    activeMetadata,
    exportConfig,
    onProgramSelected,
    onDataSetSelected,
    onExportConfigured,
    onReset,
    onBack,
}) => (
    <>
        {!isDataEntry && step === 0 && (
            <ProgramSelector
                onSelect={onProgramSelected}
                filterType={importType === 'tracker' ? 'WITH_REGISTRATION' : 'WITHOUT_REGISTRATION'}
                onBack={onBack}
                mode="export"
            />
        )}
        {isDataEntry && step === 0 && (
            <DataSetSelector onSelect={onDataSetSelected} onBack={onBack} mode="export" />
        )}
        {step === 1 && activeMetadata && (
            <ExportConfigurator
                metadata={activeMetadata}
                isDataEntry={isDataEntry}
                importType={importType}
                onExport={onExportConfigured}
                onBack={onBack}
            />
        )}
        {step === 2 && exportConfig && (
            <ExportProgress
                metadata={activeMetadata}
                exportConfig={exportConfig}
                importType={importType}
                onReset={onReset}
                onBack={() => setStep(1)}
            />
        )}
    </>
)
