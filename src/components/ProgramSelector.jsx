import React from 'react'
import { Button, SingleSelectField, SingleSelectOption, CircularLoader } from '@dhis2/ui'
import { useProgramList } from '../hooks/useProgramList'
import { useProgramMetadata } from '../hooks/useProgramMetadata'

export const ProgramSelector = ({ onSelect, filterType, onBack, mode }) => {
    const isExport = mode === 'export'
    const { programs: allPrograms, loading: listLoading, error: listError } = useProgramList()
    const [selectedId, setSelectedId] = React.useState(null)
    const { metadata, loading: metaLoading } = useProgramMetadata(selectedId)

    // Filter programs by type if specified
    const programs = filterType
        ? allPrograms.filter((p) => p.programType === filterType)
        : allPrograms

    React.useEffect(() => {
        if (metadata && selectedId) {
            const prog = programs.find((p) => p.id === selectedId)
            onSelect(prog, metadata)
        }
    }, [metadata, selectedId, programs, onSelect])

    if (listLoading) return <CircularLoader />
    if (listError) return <p>Failed to load programs: {listError.message}</p>

    return (
        <div>
            {/* Welcome hero */}
            <div style={{ textAlign: 'center', padding: '16px 0 28px' }}>
                <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #1E88E5, #0D47A1)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 12, boxShadow: '0 4px 12px rgba(13,71,161,0.25)',
                }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <rect x="2" y="2" width="16" height="18" rx="2" fill="#BBDEFB" opacity="0.9" />
                        <line x1="2" y1="7" x2="18" y2="7" stroke="#1565C0" strokeWidth="0.8" />
                        <line x1="2" y1="12" x2="18" y2="12" stroke="#1565C0" strokeWidth="0.8" />
                        <line x1="2" y1="17" x2="18" y2="17" stroke="#1565C0" strokeWidth="0.8" />
                        <line x1="9" y1="2" x2="9" y2="20" stroke="#1565C0" strokeWidth="0.8" />
                        <path d="M21 10L21 24M17.5 21L21 25L24.5 21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a202c' }}>
                    {filterType === 'WITHOUT_REGISTRATION'
                        ? (isExport ? 'Event Export' : 'Event Import')
                        : filterType === 'WITH_REGISTRATION'
                            ? (isExport ? 'Tracker Export' : 'Tracker Import')
                            : (isExport ? 'Export Data' : 'Import Data')}
                </h2>
                <p style={{ color: '#4a5768', margin: '0 0 28px', fontSize: 15, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                    {isExport
                        ? 'Select a program, configure filters, and export your data to Excel.'
                        : 'Select a program, download a pre-formatted template, and import your data.'}
                </p>

                {/* How it works — 3 steps with icons */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 24,
                    marginBottom: 28,
                    flexWrap: 'wrap',
                }}>
                    {(isExport ? [
                        {
                            num: '1', title: 'Select program', desc: 'Choose what to export',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                                    <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            ),
                        },
                        {
                            num: '2', title: 'Configure filters', desc: 'Org units and date range',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M3 4h14M5 8h10M7 12h6M9 16h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            ),
                        },
                        {
                            num: '3', title: 'Download Excel', desc: 'Export structured data',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            ),
                        },
                    ] : [
                        {
                            num: '1', title: 'Download template', desc: 'Pre-formatted Excel file',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <path d="M3 14v2a1 1 0 001 1h12a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            ),
                        },
                        {
                            num: '2', title: 'Fill in your data', desc: 'Add rows in Excel, then upload',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                                    <line x1="3" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1.5" />
                                    <line x1="3" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.5" />
                                    <line x1="8" y1="3" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" />
                                </svg>
                            ),
                        },
                        {
                            num: '3', title: 'Import to DHIS2', desc: 'Validate and submit',
                            icon: (
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <path d="M10 17V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M6 11l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
                                </svg>
                            ),
                        },
                    ]).map((s) => (
                        <div key={s.num} style={{
                            textAlign: 'center', maxWidth: 150, padding: '16px 12px',
                            background: '#f8fafc', borderRadius: 10, border: '1px solid #e8ecf1',
                        }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: '50%',
                                background: '#e3f2fd', color: '#1565C0',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: 8,
                            }}>
                                {s.icon}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a202c', marginBottom: 3 }}>{s.title}</div>
                            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{s.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #e0e5ec', margin: '0 0 20px' }} />

            <div style={{ maxWidth: 420, margin: '0 auto' }}>
                <SingleSelectField
                    label="Program"
                    selected={selectedId}
                    onChange={({ selected }) => setSelectedId(selected)}
                    loading={metaLoading}
                    placeholder="Choose a program..."
                    helpText={`${programs.length} program${programs.length !== 1 ? 's' : ''} available`}
                >
                    {programs.map((p) => (
                        <SingleSelectOption
                            key={p.id}
                            value={p.id}
                            label={`${p.displayName} ${p.programType === 'WITHOUT_REGISTRATION' ? '(Event)' : '(Tracker)'}`}
                        />
                    ))}
                </SingleSelectField>
                {metaLoading && (
                    <p style={{ fontSize: 13, color: '#4a5568', marginTop: 8 }}>Loading program metadata...</p>
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
