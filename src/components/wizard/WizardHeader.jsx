import React from 'react'
import { COLORS, FONT, IMPORT_TYPE_STYLE } from './constants'

/** App icon shown in the wizard header — ISWE Solution logo. */
const AppIcon = () => (
    <img
        src="./iswe-logo.png"
        alt="ISWE Bulk Import/Export"
        width={38}
        height={38}
        style={{ borderRadius: 8 }}
    />
)

export const WizardHeader = ({ importType, isExport, isMetadata, activeName }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: `1px solid ${COLORS.border}`,
        }}
    >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AppIcon />
            <div>
                <h1
                    style={{
                        margin: 0,
                        fontSize: 19,
                        fontWeight: 700,
                        color: COLORS.text,
                        fontFamily: FONT,
                        letterSpacing: -0.2,
                    }}
                >
                    ISWE Bulk Import/Export
                </h1>
                <p style={{ margin: 0, fontSize: 12, color: COLORS.muted, fontFamily: FONT }}>
                    Bulk import &amp; export for tracker, repeatable events, aggregate and metadata
                </p>
            </div>
        </div>
        {importType && (activeName || isMetadata) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {activeName && (
                    <div
                        style={{
                            background: COLORS.primaryLight,
                            padding: '5px 14px',
                            borderRadius: 14,
                            fontSize: 12,
                            color: COLORS.primary,
                            fontWeight: 600,
                            fontFamily: FONT,
                        }}
                    >
                        {activeName}
                    </div>
                )}
                <div
                    style={{
                        background: IMPORT_TYPE_STYLE[importType].bg,
                        padding: '3px 10px',
                        borderRadius: 10,
                        fontSize: 11,
                        color: IMPORT_TYPE_STYLE[importType].color,
                        fontWeight: 600,
                        fontFamily: FONT,
                    }}
                >
                    {IMPORT_TYPE_STYLE[importType].label}
                </div>
                {isExport && (
                    <div
                        style={{
                            background: '#F3E5F5',
                            padding: '3px 10px',
                            borderRadius: 10,
                            fontSize: 11,
                            color: '#7B1FA2',
                            fontWeight: 600,
                            fontFamily: FONT,
                        }}
                    >
                        Export
                    </div>
                )}
            </div>
        )}
    </div>
)
