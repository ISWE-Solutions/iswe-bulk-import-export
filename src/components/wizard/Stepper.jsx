import React from 'react'
import { COLORS, FONT } from './constants'

/** Stepper with numbered circles and connecting lines. */
export const Stepper = ({ steps, currentStep }) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            margin: '0 0 20px',
            padding: '14px 20px',
            background: COLORS.bg,
            borderRadius: 8,
            fontFamily: FONT,
        }}
    >
        {steps.map((s, i) => {
            const isActive = i === currentStep
            const isDone = i < currentStep
            const bg = isActive ? COLORS.primary : isDone ? COLORS.success : '#d1d5db'
            const fg = isActive || isDone ? '#fff' : '#6b7280'
            return (
                <React.Fragment key={s.key}>
                    {i > 0 && (
                        <div
                            style={{
                                flex: 1,
                                height: 2,
                                background: isDone ? COLORS.success : '#d1d5db',
                                margin: '0 4px',
                            }}
                        />
                    )}
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            minWidth: 56,
                        }}
                    >
                        <div
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: bg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: fg,
                                fontSize: 12,
                                fontWeight: 700,
                                fontFamily: FONT,
                                boxShadow: isActive
                                    ? '0 0 0 3px rgba(21,101,192,0.2)'
                                    : 'none',
                                transition: 'all 0.2s',
                            }}
                        >
                            {isDone ? '\u2713' : i + 1}
                        </div>
                        <span
                            style={{
                                fontSize: 10,
                                marginTop: 4,
                                color: isActive
                                    ? COLORS.primary
                                    : isDone
                                    ? COLORS.success
                                    : '#6b7280',
                                fontWeight: isActive ? 600 : 400,
                                whiteSpace: 'nowrap',
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                                fontFamily: FONT,
                            }}
                        >
                            {s.label}
                        </span>
                    </div>
                </React.Fragment>
            )
        })}
    </div>
)
