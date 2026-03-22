# DHIS2 Tracker Bulk Import

A custom DHIS2 app for bulk-importing tracker data from Excel templates, with full support for **repeatable events**.

## Problem

The standard DHIS2 Import/Export app only supports file uploads for aggregate, event, and TEI data — it has no template generation, no repeatable-event handling, and no guided workflow.

## Features

- **Program-aware template generation** — downloads an Excel template with correct attributes, data elements, and option set lookups per program
- **Repeatable event support** — repeatable stage sheets allow multiple rows per TEI, each becoming a separate event
- **Client-side validation** — catches missing mandatory fields, duplicate TEIs on non-repeatable stages, and orphaned stage rows before submission
- **Nested payload builder** — constructs the `POST /api/tracker` payload in the DHIS2 v41+ nested format (trackedEntities > enrollments > events)
- **Async import with polling** — submits large payloads asynchronously and polls for job completion
- **Clear error reporting** — surfaces DHIS2 validation errors with error codes and row references

## Architecture

```
src/
  App.jsx                    # Entry point (DataProvider wrapper)
  components/
    ImportWizard.jsx          # 5-step wizard orchestrator
    ProgramSelector.jsx       # Step 1: select tracker program
    TemplateDownloader.jsx    # Step 2: generate & download Excel template
    FileUploader.jsx          # Step 3: upload filled-in Excel
    ImportPreview.jsx         # Step 4: validate & preview summary
    ImportProgress.jsx        # Step 5: submit to DHIS2 & track progress
  hooks/
    useProgramList.js         # Fetch tracker programs
    useProgramMetadata.js     # Fetch full program metadata (stages, DEs, option sets)
  lib/
    templateGenerator.js      # Build Excel workbook from metadata
    fileParser.js             # Parse uploaded Excel into structured data
    validator.js              # Validate parsed data against metadata
    payloadBuilder.js         # Construct nested tracker API payload
```

## Wizard Flow

1. **Select Program** — picks a tracker program (WITH_REGISTRATION type)
2. **Download Template** — generates an Excel file with:
   - `TEI + Enrollment` sheet (one row per tracked entity)
   - One sheet per program stage (repeatable stages allow multiple rows)
   - `Validation` sheet with option set codes
3. **Upload File** — parses the filled-in Excel back into structured data
4. **Preview & Validate** — shows row counts, validates mandatory fields, checks repeatable constraints
5. **Import** — submits to `POST /api/tracker` (async for large payloads), polls for completion, shows results

## Repeatable Events

The key design decision: **each row on a repeatable stage sheet becomes a separate event**. Rows are linked to tracked entities via the `TEI_ID` column (a local reference, not sent to DHIS2).

For non-repeatable stages, the validator enforces exactly one row per TEI_ID.

## Prerequisites

- Node.js >= 18
- A running DHIS2 instance (v2.40+)

## Development

```bash
# Install dependencies
yarn install

# Start development server (proxied to a DHIS2 instance)
yarn start --proxy http://localhost:8080

# Build for production
yarn build
```

## Deployment

The built app can be uploaded to a DHIS2 instance via the App Management app, or installed from the DHIS2 App Hub.

## Tech Stack

- [DHIS2 App Platform](https://developers.dhis2.org/docs/app-platform/getting-started)
- [DHIS2 UI Components](https://ui.dhis2.nu/)
- [DHIS2 App Runtime](https://runtime.dhis2.nu/)
- [SheetJS (xlsx)](https://sheetjs.com/) for Excel I/O

## Licence

BSD-3-Clause
