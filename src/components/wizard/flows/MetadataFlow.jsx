import React from 'react'
import { MetadataTypeSelector } from '../../MetadataTypeSelector'
import { MetadataExportProgress } from '../../MetadataExportProgress'
import { MetadataImportFlow } from '../../MetadataImportFlow'
import { GeoImportFlow } from '../../GeoImportFlow'

/**
 * Metadata import + export flow.
 * Steps: 0=Select Type, 1=Import or Export.
 */
export const MetadataFlow = ({
    step,
    isExport,
    metadataType,
    onTypeSelected,
    onTypeReset,
    onReset,
    onBack,
}) => (
    <>
        {step === 0 && (
            <MetadataTypeSelector
                mode={isExport ? 'export' : 'import'}
                onSelect={onTypeSelected}
                onBack={onBack}
            />
        )}
        {isExport && step === 1 && metadataType && (
            <MetadataExportProgress
                metadataType={metadataType}
                onReset={onReset}
                onBack={onTypeReset}
            />
        )}
        {!isExport && step === 1 && metadataType && metadataType.key !== 'geoJson' && (
            <MetadataImportFlow
                metadataType={metadataType}
                onReset={onReset}
                onBack={onTypeReset}
            />
        )}
        {!isExport && step === 1 && metadataType && metadataType.key === 'geoJson' && (
            <GeoImportFlow onReset={onReset} onBack={onTypeReset} />
        )}
    </>
)
