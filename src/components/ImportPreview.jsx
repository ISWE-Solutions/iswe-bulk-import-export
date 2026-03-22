import React, { useMemo, useState } from 'react'
import {
    Button,
    ButtonStrip,
    DataTable,
    DataTableHead,
    DataTableBody,
    DataTableRow,
    DataTableCell,
    DataTableColumnHeader,
    NoticeBox,
    Tag,
} from '@dhis2/ui'
import { buildTrackerPayload } from '../lib/payloadBuilder'
import { validateParsedData } from '../lib/validator'

export const ImportPreview = ({ parsedData, metadata, onConfirm, onBack }) => {
    const [validating, setValidating] = useState(false)

    const validationResult = useMemo(
        () => validateParsedData(parsedData, metadata),
        [parsedData, metadata]
    )

    const summary = useMemo(() => {
        const teiCount = parsedData.trackedEntities?.length ?? 0
        const eventCounts = {}
        for (const stage of metadata.programStages) {
            const stageData = parsedData.stageData?.[stage.id]
            eventCounts[stage.displayName] = stageData?.length ?? 0
        }
        return { teiCount, eventCounts }
    }, [parsedData, metadata])

    const handleConfirm = () => {
        const payload = buildTrackerPayload(parsedData, metadata)
        onConfirm(payload)
    }

    return (
        <div>
            <h2>Step 4: Preview & Validate</h2>

            <h3>Summary</h3>
            <DataTable>
                <DataTableHead>
                    <DataTableRow>
                        <DataTableColumnHeader>Item</DataTableColumnHeader>
                        <DataTableColumnHeader>Count</DataTableColumnHeader>
                    </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                    <DataTableRow>
                        <DataTableCell>Tracked Entities</DataTableCell>
                        <DataTableCell>{summary.teiCount}</DataTableCell>
                    </DataTableRow>
                    {Object.entries(summary.eventCounts).map(([name, count]) => (
                        <DataTableRow key={name}>
                            <DataTableCell>Events: {name}</DataTableCell>
                            <DataTableCell>{count}</DataTableCell>
                        </DataTableRow>
                    ))}
                </DataTableBody>
            </DataTable>

            {validationResult.errors.length > 0 && (
                <NoticeBox error title={`${validationResult.errors.length} Validation Errors`}>
                    <ul>
                        {validationResult.errors.slice(0, 20).map((e, i) => (
                            <li key={i}>{e}</li>
                        ))}
                        {validationResult.errors.length > 20 && (
                            <li>...and {validationResult.errors.length - 20} more</li>
                        )}
                    </ul>
                </NoticeBox>
            )}

            {validationResult.warnings.length > 0 && (
                <NoticeBox warning title={`${validationResult.warnings.length} Warnings`}>
                    <ul>
                        {validationResult.warnings.slice(0, 10).map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </NoticeBox>
            )}

            {validationResult.errors.length === 0 && (
                <NoticeBox title="Validation Passed">
                    All rows passed validation. Ready to import.
                </NoticeBox>
            )}

            <ButtonStrip style={{ marginTop: 16 }}>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                <Button
                    onClick={handleConfirm}
                    primary
                    disabled={validationResult.errors.length > 0}
                >
                    Start Import
                </Button>
            </ButtonStrip>
        </div>
    )
}
