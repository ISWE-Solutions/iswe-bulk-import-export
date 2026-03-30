import React from 'react'
import { Button, SingleSelectField, SingleSelectOption, CircularLoader } from '@dhis2/ui'
import { useDataSetList } from '../hooks/useDataSetList'
import { useDataSetMetadata } from '../hooks/useDataSetMetadata'

export const DataSetSelector = ({ onSelect, onBack, mode }) => {
    const isExport = mode === 'export'
    const { dataSets, loading: listLoading, error: listError } = useDataSetList()
    const [selectedId, setSelectedId] = React.useState(null)
    const { metadata, loading: metaLoading } = useDataSetMetadata(selectedId)

    React.useEffect(() => {
        if (metadata && selectedId) {
            const ds = dataSets.find((d) => d.id === selectedId)
            onSelect(ds, metadata)
        }
    }, [metadata, selectedId, dataSets, onSelect])

    if (listLoading) return <CircularLoader />
    if (listError) return <p>Failed to load data sets: {listError.message}</p>

    if (dataSets.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <p style={{ color: '#4a5568', fontSize: 15 }}>
                    No data sets found. Make sure you have access to at least one data set.
                </p>
            </div>
        )
    }

    return (
        <div>
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
                <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #43A047, #2E7D32)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 12, boxShadow: '0 4px 12px rgba(46,125,50,0.25)',
                }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <rect x="2" y="2" width="24" height="24" rx="3" fill="#C8E6C9" />
                        <line x1="2" y1="9" x2="26" y2="9" stroke="#2E7D32" strokeWidth="1.2" />
                        <line x1="2" y1="16" x2="26" y2="16" stroke="#2E7D32" strokeWidth="1.2" />
                        <line x1="2" y1="23" x2="26" y2="23" stroke="#2E7D32" strokeWidth="1.2" />
                        <line x1="10" y1="2" x2="10" y2="26" stroke="#2E7D32" strokeWidth="1.2" />
                        <line x1="18" y1="2" x2="18" y2="26" stroke="#2E7D32" strokeWidth="1.2" />
                    </svg>
                </div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a202c' }}>
                    {isExport ? 'Data Entry Export' : 'Data Entry Import'}
                </h2>
                <p style={{
                    color: '#4a5568', margin: '0 0 8px', fontSize: 15,
                    maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
                }}>
                    {isExport
                        ? 'Select a data set, configure filters, and export aggregate data to Excel.'
                        : 'Select a data set, download a template, and import aggregate data values.'}
                </p>
            </div>

            <div style={{ borderTop: '1px solid #e0e5ec', margin: '0 0 20px' }} />

            <div style={{ maxWidth: 420, margin: '0 auto' }}>
                <SingleSelectField
                    label="Data Set"
                    selected={selectedId}
                    onChange={({ selected }) => setSelectedId(selected)}
                    loading={metaLoading}
                    placeholder="Choose a data set..."
                    helpText={`${dataSets.length} data set${dataSets.length !== 1 ? 's' : ''} available`}
                >
                    {dataSets.map((ds) => (
                        <SingleSelectOption
                            key={ds.id}
                            value={ds.id}
                            label={`${ds.displayName} (${ds.periodType})`}
                        />
                    ))}
                </SingleSelectField>
                {metaLoading && (
                    <p style={{ fontSize: 13, color: '#4a5568', marginTop: 8 }}>Loading data set metadata...</p>
                )}
                {onBack && (
                    <div style={{ marginTop: 16 }}>
                        <Button secondary small onClick={onBack}>
                            ← Back
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
