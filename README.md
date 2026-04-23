# ISWE Bulk Import/Export for DHIS2

**User Guide:** [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

A DHIS2 app for round-tripping tracker, event, aggregate, and metadata data between
DHIS2 and Excel (`.xlsx`) files. Includes first-class support for repeatable
program stages and a GeoJSON-based org-unit geometry import flow.

## Problem

The standard DHIS2 Import/Export app accepts CSV/JSON uploads but offers no
template generation, no repeatable-event handling, no Excel support, and no
guided workflow. This app fills those gaps.

## Features

### Imports

- **Tracker programs** (`WITH_REGISTRATION`) — program-aware Excel templates,
  repeatable-stage sheets, client-side validation, nested payload submission
  via `POST /api/tracker` with async polling for large payloads.
- **Event programs** (`WITHOUT_REGISTRATION`) — single-stage event template
  and nested `POST /api/tracker` submission.
- **Aggregate data entry** — template with `DE × CategoryOptionCombo` columns
  per data set, submission via `POST /api/dataValueSets`.
- **Metadata** — spreadsheet-driven create/update for data elements, indicators,
  org units, option sets, category options/combos, tracked entity types/attributes,
  and the various group and group-set types, via `POST /api/metadata`.
- **Geo import** — upload a GeoJSON file, fuzzy-match features against existing
  org units (exact → normalized-suffix-stripped → substring), and write
  `geometry` back to `/api/metadata`.

### Exports

- **Tracker / event data** — export filtered TEIs or events back to Excel
  templates that can be re-edited and re-imported without transformation.
- **Aggregate data** — export `dataValueSets` for an org unit / period range
  to an Excel template.
- **Metadata** — export any supported metadata type (or a combined "All
  Metadata" workbook) for review, bulk edit, and re-import.

### Safety & correctness

- Client-side validation surfaces most DHIS2 server-side errors (E1039,
  E1064, E1019, E1020, E1021, E1007, …) before submission.
- Repeatable vs non-repeatable program stages are enforced client-side
  to avoid E1039 ("event already exists for non-repeatable stage").
- Client-generated UIDs let DHIS2 error reports be traced back to specific
  Excel rows via a `rowMap`.

## Architecture

```
src/
  App.jsx                      # Entry point (DataProvider wrapper)
  components/
    ImportWizard.jsx             # Top-level wizard orchestrator
    ImportTypeSelector.jsx       # Pick Import / Export / Metadata / Geo flow
    ProgramSelector.jsx          # Tracker/event program picker
    DataSetSelector.jsx          # Data set picker for aggregate flows
    TemplateDownloader.jsx       # Tracker/event template generator
    DataEntryTemplateDownloader.jsx  # Aggregate template generator
    MetadataTypeSelector.jsx     # Metadata type registry + picker
    MetadataImportFlow.jsx       # Metadata upload + validation UI
    MetadataExportProgress.jsx   # Metadata export orchestration
    GeoImportFlow.jsx            # GeoJSON upload + matching UI
    FileUploader.jsx             # Tracker/event upload
    DataEntryFileUploader.jsx    # Aggregate upload
    ColumnMapper.jsx             # Fallback mapper for external (non-app) files
    ImportPreview.jsx            # Validation summary before submit
    ImportProgress.jsx           # POST /api/tracker or /api/dataValueSets
    ExportConfigurator.jsx       # Data export filter UI
    ExportProgress.jsx           # Data export download orchestration
  hooks/
    useProgramList.js              # Tracker/event program list
    useProgramMetadata.js          # Full program metadata (incl. program rules)
    useDataSetList.js              # Data set list
    useDataSetMetadata.js          # Full data set metadata
    useSampleData.js               # Fetch sample data for preview
  lib/
    templateGenerator.js           # Build Excel templates (tracker/event/aggregate)
    metadataExporter.js            # Build metadata workbooks + parse them back; GeoJSON helpers
    fileParser.js                  # Parse uploaded Excel into structured data
    validator.js                   # Client-side validation
    payloadBuilder.js              # Build /api/tracker and /api/dataValueSets payloads
    dataCleaner.js                 # Invisible-char & date cleanup, suggestion analyzer
    dataExporter.js                # Build export workbooks from live DHIS2 data
```

## Wizard Flow (Tracker example)

1. **Select Program** — picks a tracker program (WITH_REGISTRATION type)
2. **Download Template** — generates an Excel file with:
   - `TEI + Enrollment` sheet (one row per tracked entity)
   - One sheet per program stage (repeatable stages allow multiple rows)
   - `Validation` sheet with option-set codes
3. **Upload File** — parses the filled-in Excel back into structured data
4. **Preview & Validate** — shows row counts, validates mandatory fields, checks
   repeatable constraints
5. **Import** — submits to `POST /api/tracker` (async for large payloads), polls
   for completion, shows results

Event, aggregate, metadata, and geo flows follow the same download → fill →
upload → validate → submit pattern.

## Repeatable Events

**Each row on a repeatable stage sheet becomes a separate event.** Rows are
linked to tracked entities via the `TEI_ID` column — a local reference that is
not sent to DHIS2.

For non-repeatable stages, the validator enforces exactly one row per `TEI_ID`.

## Prerequisites

- Node.js >= 18
- A DHIS2 instance at v2.40 or later (v2.41+ preferred)

## Development

```bash
# Install dependencies
yarn install

# Start development server (proxied to a DHIS2 instance)
yarn start --proxy https://play.im.dhis2.org/stable-2-42-4

# Build for production
yarn build

# Lint
yarn lint
```

## Deployment

The built `.zip` bundle in `build/bundle/` can be uploaded to a DHIS2 instance
via the App Management app, or submitted to the DHIS2 App Hub.

## Tech Stack

- [DHIS2 App Platform](https://developers.dhis2.org/docs/app-platform/getting-started)
- [DHIS2 UI Components](https://ui.dhis2.nu/)
- [DHIS2 App Runtime](https://runtime.dhis2.nu/)
- [SheetJS (xlsx)](https://sheetjs.com/) for Excel I/O
- [fflate](https://github.com/101arrowz/fflate) for in-browser zip handling

## Licence

BSD-3-Clause
