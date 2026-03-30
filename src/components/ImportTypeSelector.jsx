import React from 'react'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const TYPES = [
    {
        key: 'tracker',
        importTitle: 'Tracker Import',
        exportTitle: 'Tracker Export',
        importDesc: 'Import tracked entities with enrollments and events into a Tracker program.',
        exportDesc: 'Export tracked entities with enrollments and events to a structured Excel file.',
        tags: ['Tracked Entities', 'Enrollments', 'Events'],
        color: '#1565C0',
        bg: '#e3f2fd',
        icon: (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="10" r="5" stroke="#1565C0" strokeWidth="2" fill="#BBDEFB" />
                <path d="M6 28c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="#1565C0" strokeWidth="2" fill="none" />
                <path d="M22 18l4-4M22 14l4 4" stroke="#1565C0" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        key: 'event',
        importTitle: 'Event Import',
        exportTitle: 'Event Export',
        importDesc: 'Import anonymous events into an Event program (no tracked entities).',
        exportDesc: 'Export event data from an Event program to a structured Excel file.',
        tags: ['Events', 'Anonymous', 'No Registration'],
        color: '#E65100',
        bg: '#FFF3E0',
        icon: (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="6" width="24" height="20" rx="3" stroke="#E65100" strokeWidth="2" fill="#FFE0B2" />
                <path d="M4 12h24" stroke="#E65100" strokeWidth="2" />
                <circle cx="10" cy="18" r="2" fill="#E65100" />
                <circle cx="16" cy="18" r="2" fill="#E65100" />
                <circle cx="22" cy="18" r="2" fill="#E65100" />
                <circle cx="10" cy="23" r="2" fill="#E65100" opacity="0.4" />
            </svg>
        ),
    },
    {
        key: 'dataEntry',
        importTitle: 'Data Entry Import',
        exportTitle: 'Data Entry Export',
        importDesc: 'Import aggregate data values into a Data Set — period-based reporting data.',
        exportDesc: 'Export aggregate data values from a Data Set to a structured Excel file.',
        tags: ['Data Values', 'Aggregate', 'Periods'],
        color: '#2E7D32',
        bg: '#E8F5E9',
        icon: (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="4" width="24" height="24" rx="3" stroke="#2E7D32" strokeWidth="2" fill="#C8E6C9" />
                <line x1="4" y1="11" x2="28" y2="11" stroke="#2E7D32" strokeWidth="1.5" />
                <line x1="4" y1="18" x2="28" y2="18" stroke="#2E7D32" strokeWidth="1.5" />
                <line x1="4" y1="25" x2="28" y2="25" stroke="#2E7D32" strokeWidth="1.5" />
                <line x1="12" y1="4" x2="12" y2="28" stroke="#2E7D32" strokeWidth="1.5" />
                <line x1="20" y1="4" x2="20" y2="28" stroke="#2E7D32" strokeWidth="1.5" />
            </svg>
        ),
    },
    {
        key: 'metadata',
        importTitle: 'Metadata Import',
        exportTitle: 'Metadata Export',
        importDesc: 'Import metadata — organisation units, data elements, option sets, indicators.',
        exportDesc: 'Export metadata to a structured Excel file for review or bulk editing.',
        tags: ['Org Units', 'Data Elements', 'Option Sets'],
        color: '#6A1B9A',
        bg: '#F3E5F5',
        icon: (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="2" width="24" height="28" rx="3" stroke="#6A1B9A" strokeWidth="2" fill="#E1BEE7" />
                <path d="M10 10h12M10 15h12M10 20h8" stroke="#6A1B9A" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="24" cy="24" r="5" fill="#6A1B9A" />
                <path d="M22 24h4M24 22v4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
    },
]

/**
 * Mode toggle pill — Import / Export
 */
const ModeToggle = ({ mode, onChange }) => (
    <div style={{
        display: 'inline-flex', borderRadius: 20, background: '#f4f6f8',
        padding: 3, marginBottom: 20, border: '1px solid #e0e5ec',
    }}>
        {['import', 'export'].map((m) => (
            <button
                key={m}
                onClick={() => onChange(m)}
                style={{
                    padding: '7px 22px',
                    borderRadius: 17,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: FONT,
                    background: mode === m ? '#1565C0' : 'transparent',
                    color: mode === m ? '#fff' : '#4a5568',
                    transition: 'all 0.15s ease',
                }}
            >
                {m === 'import' ? 'Import' : 'Export'}
            </button>
        ))}
    </div>
)

export const ImportTypeSelector = ({ onSelect }) => {
    const [mode, setMode] = React.useState('import')
    const isExport = mode === 'export'

    return (
        <div>
            {/* Hero */}
            <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
                <h2 style={{
                    margin: '0 0 6px', fontSize: 22, fontWeight: 700,
                    color: '#1a202c', fontFamily: FONT,
                }}>
                    {isExport ? 'What would you like to export?' : 'What would you like to import?'}
                </h2>
                <p style={{
                    color: '#4a5568', margin: '0 0 16px', fontSize: 15,
                    maxWidth: 520, marginLeft: 'auto', marginRight: 'auto',
                    lineHeight: 1.6, fontFamily: FONT,
                }}>
                    {isExport
                        ? 'Export data from DHIS2 into a well-structured Excel file.'
                        : 'Download a template, fill in your data, and import into DHIS2.'}
                </p>
                <ModeToggle mode={mode} onChange={setMode} />
            </div>

            {/* Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 16,
                marginBottom: 24,
            }}>
                {TYPES.map((t) => (
                    <TypeCard key={t.key} type={t} isExport={isExport} onSelect={onSelect} />
                ))}
            </div>

            {/* How it works */}
            <div style={{
                borderTop: '1px solid #e0e5ec',
                paddingTop: 20,
                marginTop: 8,
            }}>
                <div style={{
                    textAlign: 'center', fontSize: 13, fontWeight: 600,
                    color: '#6b7280', textTransform: 'uppercase',
                    letterSpacing: 0.8, marginBottom: 16, fontFamily: FONT,
                }}>
                    How it works
                </div>
                <div style={{
                    display: 'flex', justifyContent: 'center',
                    gap: 32, flexWrap: 'wrap',
                }}>
                    {(isExport
                        ? [
                            { num: '1', label: 'Select program or data set' },
                            { num: '2', label: 'Choose org unit & date range' },
                            { num: '3', label: 'Download structured Excel' },
                        ]
                        : [
                            { num: '1', label: 'Select & download template' },
                            { num: '2', label: 'Fill data in Excel' },
                            { num: '3', label: 'Upload & import to DHIS2' },
                        ]
                    ).map((s) => (
                        <div key={s.num} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: '#f4f6f8', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                fontSize: 13, fontWeight: 700, color: '#4a5568',
                                fontFamily: FONT,
                            }}>
                                {s.num}
                            </div>
                            <span style={{
                                fontSize: 13, color: '#4a5568', fontFamily: FONT,
                            }}>
                                {s.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

const TypeCard = ({ type, isExport, onSelect }) => {
    const [hovered, setHovered] = React.useState(false)
    const selectKey = isExport ? `export_${type.key}` : type.key

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(selectKey)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(selectKey)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                padding: '20px 18px',
                borderRadius: 12,
                border: `2px solid ${hovered ? type.color : '#e0e5ec'}`,
                background: hovered ? type.bg : '#fff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                transform: hovered ? 'translateY(-2px)' : 'none',
                boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.04)',
                outline: 'none',
            }}
        >
            <div style={{ marginBottom: 12 }}>{type.icon}</div>
            <div style={{
                fontSize: 16, fontWeight: 700, color: '#1a202c',
                marginBottom: 6, fontFamily: FONT,
            }}>
                {isExport ? type.exportTitle : type.importTitle}
            </div>
            <div style={{
                fontSize: 13, color: '#4a5568', lineHeight: 1.5,
                marginBottom: 12, fontFamily: FONT,
            }}>
                {isExport ? type.exportDesc : type.importDesc}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {type.tags.map((tag) => (
                    <span key={tag} style={{
                        padding: '2px 8px', borderRadius: 8,
                        fontSize: 11, fontWeight: 600,
                        color: type.color, background: type.bg,
                        fontFamily: FONT,
                    }}>
                        {tag}
                    </span>
                ))}
            </div>
        </div>
    )
}
