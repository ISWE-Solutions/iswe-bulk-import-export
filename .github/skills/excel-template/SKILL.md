# Excel Template Generation Skill

Reference for building and parsing Excel templates with SheetJS.

## Template Structure

Each generated workbook has these sheets:

1. **Instructions** — how to fill in the template
2. **TEI + Enrollment** — one row per tracked entity (attributes + enrollment dates)
3. **{Stage Name} (single/repeatable)** — one sheet per program stage
4. **Validation** — option set code/display pairs for reference

## Column Header Format

```
Display Name * [UID]
```

- `Display Name` — human-readable field name
- `*` — present if field is mandatory
- `[UID]` — DHIS2 11-character UID in brackets

Parsing regex: `/\[([A-Za-z0-9]{11})\]\s*$/`

## Fixed Columns

### TEI + Enrollment sheet

| Column | Required | Description |
|---|---|---|
| `TEI_ID` | Yes | Local reference (links rows across sheets) |
| `ORG_UNIT_ID` | Yes | DHIS2 org unit UID |
| `ENROLLMENT_DATE` | Yes | YYYY-MM-DD |
| `INCIDENT_DATE` | No | YYYY-MM-DD (defaults to enrollment date) |

### Stage sheets

| Column | Required | Description |
|---|---|---|
| `TEI_ID` | Yes | Must match a TEI_ID from TEI sheet |
| `EVENT_DATE` | Yes | YYYY-MM-DD |
| `ORG_UNIT_ID` | No | Defaults to TEI org unit |

## SheetJS Patterns

### Creating workbook

```js
import * as XLSX from 'xlsx'

const wb = XLSX.utils.book_new()
const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
XLSX.utils.book_append_sheet(wb, ws, 'Sheet Name')  // max 31 chars
XLSX.writeFile(wb, 'filename.xlsx')
```

### Reading workbook

```js
const buffer = await file.arrayBuffer()
const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
```

## Sheet Name Rules

- Max 31 characters (Excel limit)
- No special characters: `\ / ? * [ ]`
- Truncate long names, keep suffix for type: `(single)` or `(repeatable)`

## Option Set Validation Sheet

Two columns per option set:
- `{OptionSet ID} [code]` — the code to use in data entry
- `{OptionSet ID} [display]` — human-readable name

## Data Type Formatting

| DHIS2 Type | Excel Format | Notes |
|---|---|---|
| TEXT | General | Free text |
| NUMBER | Number | Decimal allowed |
| INTEGER | Number | Whole numbers only |
| DATE | YYYY-MM-DD | Use `cellDates: true` when reading |
| BOOLEAN | General | `true` / `false` |
| OPTION_SET | General | Use CODE (not display name) |
