import React from 'react'
import { COLORS, FONT } from './constants'

export const WizardFooter = ({ version }) => (
    <footer
        style={{
            textAlign: 'center',
            fontSize: 12,
            color: COLORS.mutedLight,
            marginTop: 20,
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.border}`,
            fontFamily: FONT,
            lineHeight: 1.6,
        }}
    >
        <div>
            Built by{' '}
            <a
                href="https://iswesolutions.com"
                target="_blank"
                rel="noreferrer"
                style={{ color: COLORS.primary, textDecoration: 'none', fontWeight: 500 }}
            >
                ISWE Solutions
            </a>{' '}
            &middot; Bulk Import/Export v{version} &middot; Compatible with DHIS2 2.40+
        </div>
        <div style={{ fontSize: 11, marginTop: 2 }}>
            Open-source (BSD-3-Clause) &middot;{' '}
            <a
                href="https://github.com/ISWE-Solutions/iswe-bulk-import-export"
                target="_blank"
                rel="noreferrer"
                style={{ color: COLORS.mutedLight, textDecoration: 'underline' }}
            >
                Source code
            </a>{' '}
            &middot;{' '}
            <a
                href="https://github.com/ISWE-Solutions/iswe-bulk-import-export/issues"
                target="_blank"
                rel="noreferrer"
                style={{ color: COLORS.mutedLight, textDecoration: 'underline' }}
            >
                Report an issue
            </a>
        </div>
    </footer>
)
