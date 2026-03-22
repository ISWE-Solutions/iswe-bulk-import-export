import React from 'react'
import { Button, ButtonStrip } from '@dhis2/ui'
import { generateTemplate } from '../lib/templateGenerator'

export const TemplateDownloader = ({ program, metadata, onContinue, onBack }) => {
    const handleDownload = () => {
        const workbook = generateTemplate(program, metadata)
        // xlsx library writes to file
        const XLSX = require('xlsx')
        XLSX.writeFile(workbook, `${program.displayName}_import_template.xlsx`)
    }

    const repeatableStages = metadata.programStages.filter((s) => s.repeatable)
    const nonRepeatableStages = metadata.programStages.filter((s) => !s.repeatable)

    return (
        <div>
            <h2>Step 2: Download Template</h2>
            <p>
                Download the Excel template for <strong>{program.displayName}</strong>.
                Fill it in with your data and upload it in the next step.
            </p>

            <h3>Program Structure</h3>
            <ul>
                <li>
                    <strong>Tracked Entity Attributes:</strong>{' '}
                    {metadata.trackedEntityType?.trackedEntityTypeAttributes?.length ?? 0}
                </li>
                {nonRepeatableStages.map((s) => (
                    <li key={s.id}>
                        Stage: <strong>{s.displayName}</strong> (single event)
                        {' — '}{s.programStageDataElements?.length ?? 0} data elements
                    </li>
                ))}
                {repeatableStages.map((s) => (
                    <li key={s.id}>
                        Stage: <strong>{s.displayName}</strong> (repeatable)
                        {' — '}{s.programStageDataElements?.length ?? 0} data elements
                    </li>
                ))}
            </ul>

            <h3>Template Sheets</h3>
            <p>The template will contain:</p>
            <ul>
                <li><strong>Instructions</strong> — how to fill in the template</li>
                <li><strong>TEI + Enrollment</strong> — one row per tracked entity</li>
                {nonRepeatableStages.map((s) => (
                    <li key={s.id}>
                        <strong>{s.displayName}</strong> — one row per tracked entity
                    </li>
                ))}
                {repeatableStages.map((s) => (
                    <li key={s.id}>
                        <strong>{s.displayName}</strong> — multiple rows per tracked entity (grouped by TEI ID)
                    </li>
                ))}
                <li><strong>Validation</strong> — option set values for dropdowns</li>
            </ul>

            <ButtonStrip>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                <Button onClick={handleDownload} primary>
                    Download Template
                </Button>
                <Button onClick={onContinue}>
                    Continue to Upload
                </Button>
            </ButtonStrip>
        </div>
    )
}
