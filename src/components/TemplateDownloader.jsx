import React, { useState, useMemo } from 'react'
import { Button, ButtonStrip, Radio, Checkbox, InputField, NoticeBox, CircularLoader } from '@dhis2/ui'
import {
    generateTemplate,
    generateFlatTemplate,
    generateEventTemplate,
    writeTemplateFile,
    populateFlatWorkbook,
    populateMultiSheetWorkbook,
    populateEventWorkbook,
} from '../lib/templateGenerator'
import { useSampleData, useEventSampleData } from '../hooks/useSampleData'
import { getTrackerAttributes } from '../lib/trackerAttributes'

/** Default period: last 12 months. */
function defaultPeriod() {
    const end = new Date()
    const start = new Date()
    start.setFullYear(start.getFullYear() - 1)
    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
    }
}

export const TemplateDownloader = ({ program, metadata, onContinue, onBack }) => {
    const [format, setFormat] = useState('flat')
    const [includeSample, setIncludeSample] = useState(false)
    const [period, setPeriod] = useState(defaultPeriod)
    const [maxRows, setMaxRows] = useState('50')
    const [downloaded, setDownloaded] = useState(false)

    // Stage selection — all stages selected by default
    const allStageIds = useMemo(
        () => (metadata.programStages ?? []).map((s) => s.id),
        [metadata.programStages]
    )
    const [selectedStageIds, setSelectedStageIds] = useState(() => new Set(allStageIds))

    const toggleStage = (stageId) => {
        setSelectedStageIds((prev) => {
            const next = new Set(prev)
            if (next.has(stageId)) next.delete(stageId)
            else next.add(stageId)
            return next
        })
    }

    const { fetchSampleData, loading: sampleLoading, error: sampleError } = useSampleData(program.id)
    const { fetchEventSample, loading: eventSampleLoading, error: eventSampleError } = useEventSampleData(program.id)

    const handleDownload = async () => {
        // Filter metadata to only include selected stages
        const filteredMetadata = {
            ...metadata,
            programStages: metadata.programStages.filter((s) => selectedStageIds.has(s.id)),
        }

        const isEventProgram = metadata.programType === 'WITHOUT_REGISTRATION'

        if (isEventProgram) {
            // Event program — template with stage sheets only, optionally pre-filled.
            let workbook = generateEventTemplate(program, filteredMetadata)
            if (includeSample) {
                const events = await fetchEventSample({
                    startDate: period.startDate,
                    endDate: period.endDate,
                    maxEvents: parseInt(maxRows, 10) || 100,
                })
                if (events?.length > 0) {
                    workbook = populateEventWorkbook(workbook, filteredMetadata, events)
                }
            }
            const suffix = '_event'
            writeTemplateFile(workbook, `${program.displayName}${suffix}_import_template.xlsx`)
            setDownloaded(true)
            return
        }

        // Tracker program — existing logic
        const repeatableStageIds = new Set(
            filteredMetadata.programStages.filter((s) => s.repeatable).map((s) => s.id)
        )

        let sampleData = null
        if (includeSample) {
            sampleData = await fetchSampleData({
                startDate: period.startDate,
                endDate: period.endDate,
                maxTeis: parseInt(maxRows, 10) || 50,
            })
        }

        // Auto-detect per-stage repeat counts from sample data.
        const repeatCounts = {}
        if (sampleData?.length > 0) {
            for (const tei of sampleData) {
                const counts = {}
                for (const evt of tei.enrollments?.[0]?.events ?? []) {
                    if (repeatableStageIds.has(evt.programStage)) {
                        counts[evt.programStage] = (counts[evt.programStage] || 0) + 1
                    }
                }
                for (const [stageId, c] of Object.entries(counts)) {
                    if (!repeatCounts[stageId] || c > repeatCounts[stageId]) {
                        repeatCounts[stageId] = c
                    }
                }
            }
        }
        for (const sid of repeatableStageIds) {
            if (!repeatCounts[sid]) {
                repeatCounts[sid] = sampleData?.length > 0 ? 1 : 3
            }
        }

        let workbook =
            format === 'flat'
                ? generateFlatTemplate(program, filteredMetadata, { repeatCounts })
                : generateTemplate(program, filteredMetadata)

        if (sampleData?.length > 0) {
            workbook =
                format === 'flat'
                    ? populateFlatWorkbook(workbook, filteredMetadata, sampleData, { repeatCounts })
                    : populateMultiSheetWorkbook(workbook, filteredMetadata, sampleData)
        }

        const suffix = format === 'flat' ? '_flat' : ''
        writeTemplateFile(workbook, `${program.displayName}${suffix}_import_template.xlsx`)
        setDownloaded(true)
    }

    const attrCount = getTrackerAttributes(metadata).length
    const stageCount = metadata.programStages.length
    const repeatableStages = metadata.programStages.filter((s) => s.repeatable)
    const isEventProgram = metadata.programType === 'WITHOUT_REGISTRATION'

    const selectedStageCount = selectedStageIds.size
    const allSelected = selectedStageCount === allStageIds.length

    const toggleAll = () => {
        setSelectedStageIds(allSelected ? new Set() : new Set(allStageIds))
    }

    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>
                Download Import Template
            </h2>
            <p style={{ color: '#4a5568', margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                Download an Excel template pre-configured for <strong>{program.displayName}</strong>.
                Fill it in offline, then come back to upload.
            </p>

            {/* --- Program summary (read-only) --- */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                <span style={{
                    padding: '4px 12px', background: isEventProgram ? '#FFF8E1' : '#e3f2fd', borderRadius: 12,
                    fontSize: 12, color: isEventProgram ? '#E65100' : '#1565C0', fontWeight: 600,
                }}>
                    {isEventProgram ? 'Event Program' : `${attrCount} attributes`}
                </span>
                <span style={{
                    padding: '4px 12px', background: '#f4f6f8', borderRadius: 12,
                    fontSize: 12, color: '#4a5568', fontWeight: 600,
                }}>
                    {stageCount} stage{stageCount !== 1 ? 's' : ''}
                </span>
                {repeatableStages.length > 0 && (
                    <span style={{
                        padding: '4px 12px', background: '#FFF8E1', borderRadius: 12,
                        fontSize: 12, color: '#E65100', fontWeight: 600,
                    }}>
                        {repeatableStages.length} repeatable
                    </span>
                )}
            </div>

            {/* --- Stage selection (checkboxes) --- */}
            {allStageIds.length > 1 && (
                <div style={{
                    marginBottom: 20, padding: 16,
                    background: '#fafbfc', borderRadius: 8,
                    border: '1px solid #e0e5ec',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', marginBottom: 12,
                    }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c' }}>
                            Stages to include
                        </div>
                        <button
                            onClick={toggleAll}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 12, color: '#1565C0', fontWeight: 500, padding: 0,
                            }}
                        >
                            {allSelected ? 'Deselect all' : 'Select all'}
                        </button>
                    </div>
                    {metadata.programStages.map((s) => (
                        <div key={s.id} style={{ marginBottom: 4 }}>
                            <Checkbox
                                checked={selectedStageIds.has(s.id)}
                                onChange={() => toggleStage(s.id)}
                                label={
                                    s.displayName +
                                    ' (' + (s.programStageDataElements?.length ?? 0) + ' fields' +
                                    (s.repeatable ? ', repeatable' : '') + ')'
                                }
                            />
                        </div>
                    ))}
                </div>
            )}
            {selectedStageCount === 0 && (
                <NoticeBox warning title="No stages selected">
                    The template will only contain enrollment attributes. Select at least one stage to include event data.
                </NoticeBox>
            )}

            {/* --- Template format (tracker programs only) --- */}
            {!isEventProgram && (
            <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a202c', marginBottom: 6 }}>
                    Template format
                </div>
                <Radio
                    label="Single sheet (flat) — one row per entity"
                    checked={format === 'flat'}
                    onChange={() => setFormat('flat')}
                    name="format"
                    value="flat"
                />
                <Radio
                    label="Multi-sheet — separate sheet per program stage"
                    checked={format === 'multi'}
                    onChange={() => setFormat('multi')}
                    name="format"
                    value="multi"
                />
            </div>
            )}

            {/* --- Sample data (tracker + event programs) --- */}
            <div style={{ marginBottom: 20 }}>
                <Checkbox
                    label="Pre-fill template with existing data from the system"
                    checked={includeSample}
                    onChange={({ checked }) => setIncludeSample(checked)}
                />
                {includeSample && (
                    <div style={{ marginTop: 8, marginLeft: 8, paddingLeft: 12, borderLeft: '2px solid #e0e5ec' }}>
                        <p style={{ marginBottom: 8, fontSize: 13, color: '#4a5568' }}>
                            {isEventProgram
                                ? 'Fetch existing events in this period:'
                                : 'Fetch tracked entities enrolled in this period:'}
                        </p>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                            <InputField
                                label="Start date"
                                type="date"
                                value={period.startDate}
                                onChange={({ value }) =>
                                    setPeriod((prev) => ({ ...prev, startDate: value }))
                                }
                            />
                            <InputField
                                label="End date"
                                type="date"
                                value={period.endDate}
                                onChange={({ value }) =>
                                    setPeriod((prev) => ({ ...prev, endDate: value }))
                                }
                            />
                            <InputField
                                label="Max rows"
                                type="number"
                                value={maxRows}
                                onChange={({ value }) => setMaxRows(value)}
                                helpText={isEventProgram ? 'Maximum events' : 'Maximum tracked entities'}
                            />
                        </div>
                        {(sampleError || eventSampleError) && (
                            <NoticeBox error title="Failed to fetch sample data">
                                {sampleError || eventSampleError}
                            </NoticeBox>
                        )}
                    </div>
                )}
            </div>

            {/* --- Download action (below all options) --- */}
            <div style={{
                padding: 16, background: '#f4f6f8', borderRadius: 8,
                border: '1px solid #e0e5ec', marginBottom: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ fontSize: 13, color: '#4a5568' }}>
                        {isEventProgram ? 'Event template' : (format === 'flat' ? 'Single-sheet' : 'Multi-sheet')} &middot; {isEventProgram ? '' : `${attrCount} attributes \u00b7 `}{selectedStageCount}/{stageCount} stages
                    </div>
                    <Button onClick={handleDownload} primary disabled={sampleLoading || eventSampleLoading}>
                        {(sampleLoading || eventSampleLoading) ? 'Fetching data...' : 'Download Template'}
                    </Button>
                </div>
                {downloaded && (
                    <div style={{
                        marginTop: 12, padding: '8px 12px',
                        background: '#e8f5e9', borderRadius: 6,
                        fontSize: 13, color: '#2E7D32',
                    }}>
                        <strong>Template downloaded.</strong> Fill it in, then continue to upload.
                    </div>
                )}
            </div>

            {/* --- Navigation --- */}
            <div style={{ borderTop: '1px solid #e0e5ec', paddingTop: 16 }}>
                <ButtonStrip>
                    <Button onClick={onBack} secondary>
                        Back
                    </Button>
                    <Button onClick={onContinue} primary={downloaded} secondary={!downloaded}>
                        {downloaded ? 'Continue to Upload' : 'Skip to Upload'}
                    </Button>
                </ButtonStrip>
                {!downloaded && (
                    <p style={{ fontSize: 12, color: '#6b7280', marginTop: 6, marginBottom: 0 }}>
                        Already have a filled-in template? Skip ahead.
                    </p>
                )}
            </div>
        </div>
    )
}
