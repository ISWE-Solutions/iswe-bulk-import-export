---
applyTo: "src/lib/**/*.js"
---
# Library Module Instructions

When working with library modules (`src/lib/`):

## Modules

| Module | Responsibility |
|---|---|
| `templateGenerator.js` | Build Excel workbook from DHIS2 program metadata |
| `fileParser.js` | Parse uploaded Excel back into structured data |
| `validator.js` | Validate parsed data against metadata rules |
| `payloadBuilder.js` | Construct DHIS2 Tracker API nested payload |

## Rules

- **Pure functions** — no side effects, no API calls, no DOM access
- **Well-tested** — every function must be unit-testable
- **DHIS2 UID format**: 11 alphanumeric characters (`[A-Za-z0-9]{11}`)
- **Date format**: Always `YYYY-MM-DD` for DHIS2
- **Column header format**: `Display Name [UID]` — extract UID with regex `/\[([A-Za-z0-9]{11})\]\s*$/`

## Repeatable Events Logic (CRITICAL)

In `payloadBuilder.js`:
- Group events by `teiId` from stage sheets
- For repeatable stages: multiple events per TEI are allowed
- For non-repeatable stages: only ONE event per TEI (validator catches violations)
- Events are nested under: `trackedEntities[].enrollments[].events[]`

## Excel Constraints

- Sheet name max: 31 characters (truncate with suffix indicator)
- Row limit: ~1M rows (Excel 2007+) — warn if > 10,000 rows
- Option set codes: use CODE not displayName for DHIS2 compatibility
