import React, { useState } from 'react'
import { Button, ButtonStrip, Checkbox, InputField, NoticeBox } from '@dhis2/ui'
import { generateDataEntryTemplate, populateDataEntryWorkbook, writeTemplateFile } from '../lib/templateGenerator'
import { useDataEntrySampleData } from '../hooks/useSampleData'

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

export const DataEntryTemplateDownloader = ({ dataSet, metadata, onContinue, onBack }) => {
    const [downloaded, setDownloaded] = useState(false)
    const [includeSample, setIncludeSample] = useState(false)
    const [period, setPeriod] = useState(defaultPeriod)
    const { fetchDataEntrySample, loading: sampleLoading, error: sampleError } =
        useDataEntrySampleData(metadata.id)

    const deCount = metadata.dataSetElements?.length ?? 0
    const ouCount = metadata.organisationUnits?.length ?? 0

    const handleDownload = async () => {
        let workbook = generateDataEntryTemplate(metadata)

        if (includeSample) {
            const orgUnitIds = (metadata.organisationUnits ?? []).map((ou) => ou.id)
            const dataValues = await fetchDataEntrySample({
                startDate: period.startDate,
                endDate: period.endDate,
                orgUnits: orgUnitIds,
            })
            if (dataValues?.length > 0) {
                workbook = populateDataEntryWorkbook(workbook, metadata, dataValues)
            }
        }

        writeTemplateFile(workbook, `${metadata.displayName}_data_entry_template.xlsx`)
        setDownloaded(true)
    }

    return (
        <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 700, color: '#1a202c' }}>
                Download Data Entry Template
            </h2>
            <p style={{ color: '#4a5568', margin: '0 0 20px', fontSize: 14, lineHeight: 1.5 }}>
                Download an Excel template pre-configured for <strong>{metadata.displayName}</strong>.
                Each row represents one organisation unit + period combination.
            </p>

            {/* Data set summary */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                <span style={{
                    padding: '4px 12px', background: '#E8F5E9', borderRadius: 12,
                    fontSize: 12, color: '#2E7D32', fontWeight: 600,
                }}>
                    {deCount} data element{deCount !== 1 ? 's' : ''}
                </span>
                <span style={{
                    padding: '4px 12px', background: '#f4f6f8', borderRadius: 12,
                    fontSize: 12, color: '#4a5568', fontWeight: 600,
                }}>
                    {metadata.periodType}
                </span>
                <span style={{
                    padding: '4px 12px', background: '#f4f6f8', borderRadius: 12,
                    fontSize: 12, color: '#4a5568', fontWeight: 600,
                }}>
                    {ouCount} org unit{ouCount !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Sample data toggle */}
            <div style={{ marginBottom: 20 }}>
                <Checkbox
                    label="Pre-fill template with existing data from the system"
                    checked={includeSample}
                    onChange={({ checked }) => setIncludeSample(checked)}
                />
                {includeSample && (
                    <div style={{ marginTop: 8, marginLeft: 8, paddingLeft: 12, borderLeft: '2px solid #e0e5ec' }}>
                        <p style={{ marginBottom: 8, fontSize: 13, color: '#4a5568' }}>
                            Fetch existing data values in this date range:
                        </p>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                            <InputField
                                label="Start date"
                                type="date"
                                value={period.startDate}
                                onChange={({ value }) => setPeriod((p) => ({ ...p, startDate: value }))}
                            />
                            <InputField
                                label="End date"
                                type="date"
                                value={period.endDate}
                                onChange={({ value }) => setPeriod((p) => ({ ...p, endDate: value }))}
                            />
                        </div>
                        {sampleError && (
                            <NoticeBox error title="Failed to fetch sample data">
                                {sampleError}
                            </NoticeBox>
                        )}
                    </div>
                )}
            </div>

            {/* Download action */}
            <div style={{
                padding: 16, background: '#f4f6f8', borderRadius: 8,
                border: '1px solid #e0e5ec', marginBottom: 20,
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
                }}>
                    <div style={{ fontSize: 13, color: '#4a5568' }}>
                        Data entry template &middot; {deCount} data elements &middot; {ouCount} org units
                    </div>
                    <Button onClick={handleDownload} primary disabled={sampleLoading}>
                        {sampleLoading ? 'Fetching data...' : 'Download Template'}
                    </Button>
                </div>
                {downloaded && (
                    <div style={{
                        marginTop: 12, padding: '8px 12px',
                        background: '#e8f5e9', borderRadius: 6,
                        fontSize: 13, color: '#2E7D32',
                    }}>
                        Template downloaded. Fill it in with your data, then continue to upload.
                    </div>
                )}
            </div>

            <ButtonStrip>
                <Button onClick={onBack} secondary>Back</Button>
                <Button onClick={onContinue} primary disabled={!downloaded}>
                    Continue to Upload
                </Button>
            </ButtonStrip>
        </div>
    )
}
