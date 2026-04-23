# ISWE Bulk Import/Export — User Guide

A step-by-step guide to using the app to move tracker, event, aggregate, and metadata records between DHIS2 and Excel.

## Contents

1. [Overview](#overview)
2. [Before you start](#before-you-start)
3. [Launching the app](#launching-the-app)
4. [Tracker import](#tracker-import)
5. [Event import](#event-import)
6. [Aggregate data entry import](#aggregate-data-entry-import)
7. [Metadata import](#metadata-import)
8. [GeoJSON (org unit geometry) import](#geojson-org-unit-geometry-import)
9. [Exporting data](#exporting-data)
10. [Exporting metadata](#exporting-metadata)
11. [Validation and error handling](#validation-and-error-handling)
12. [Tips and conventions](#tips-and-conventions)
13. [Troubleshooting](#troubleshooting)

---

## Overview

ISWE Bulk Import/Export is a DHIS2 web app that lets you round-trip data between DHIS2 and Excel. You pick a flow (import or export), pick a type (Tracker / Event / Data Entry / Metadata), and the wizard walks you through the rest.

Supported flows:

| Flow | Import | Export |
|---|---|---|
| Tracker (TEIs, enrollments, events) | Yes | Yes |
| Event programs (anonymous events) | Yes | Yes |
| Aggregate data values (Data Sets) | Yes | Yes |
| Metadata (org units, data elements, option sets, etc.) | Yes | Yes |
| Org unit geometry (GeoJSON) | Yes | — |

All work happens in the browser against the currently logged-in DHIS2 instance. No external services are called.

---

## Before you start

- **DHIS2 version**: 2.40 or later (tested against 2.42).
- **Permissions**: You need the DHIS2 authorities required to read or write the data you are working with (e.g. `F_TRACKED_ENTITY_ADD`, metadata authorities, data capture for the selected org units).
- **Browser**: Any modern browser (Chrome, Edge, Firefox, Safari).
- **Excel**: Microsoft Excel, LibreOffice Calc, or Google Sheets can open and edit the templates. Keep the file in `.xlsx` format when you re-upload.

---

## Launching the app

1. Sign in to DHIS2.
2. Open **Apps → ISWE Bulk Import/Export**.
3. On the landing screen, choose **Import** or **Export**, then pick the type of data (Tracker, Event, Data Entry, Metadata).

The wizard shows a stepper at the top so you can see where you are at all times.

---

## Tracker import

Steps: **Select → Template → Upload → Map Columns → Preview → Import**

### 1. Select the program

Pick a tracker program from the list. The app loads the program's metadata (attributes, stages, data elements, option sets) in the background.

### 2. Download the template

Click **Download Template**. You will get an `.xlsx` file with:

- One **Instructions** sheet explaining column conventions.
- One **TEI + Enrollment** sheet for tracked entity attributes, enrollment org unit, enrolled date, and incident date.
- One sheet per **program stage**, with one column per data element.
- A **Validation** sheet with option-set codes and display values (used for dropdown lists in other sheets).

Column headers follow the pattern `Display Name [UID]`. The UID in brackets is the DHIS2 identifier — do not change it. Columns marked with `*` are mandatory.

### 3. Fill in the template

- One row per tracked entity on the TEI sheet.
- Use the `TEI_ID` column (a local reference — any unique string per TEI) to link the same person's rows across stage sheets.
- For **repeatable stages**, add multiple rows per `TEI_ID` (one per event occurrence).
- For **non-repeatable stages**, add exactly one row per `TEI_ID`.
- Dates use `YYYY-MM-DD`.
- Org units can be entered by UID or display name (the app resolves names against the instance).
- Option-set fields accept either the **code** or the **display name**; dropdowns in the template use display names.

### 4. Upload the filled file

Drag and drop the `.xlsx` file, or click to browse. The app parses all sheets and keeps a structured preview in memory.

### 5. Map columns (only if needed)

If any header does not match a known UID — for example because you downloaded the template from a different instance or renamed a column — the **Map Columns** step lets you match each incoming header to a DHIS2 field. Confirm the mapping and continue.

### 6. Preview

Review the summary:

- Number of tracked entities, enrollments, and events to be created / updated.
- Any validation warnings (missing mandatory fields, unknown option codes, date format issues, org unit not found, non-repeatable stage with multiple events, etc.).

If there are errors you cannot ignore, go back and fix the Excel file.

### 7. Import

Click **Start Import**. The payload is sent to `/api/tracker` with `importStrategy=CREATE_AND_UPDATE` and `atomicMode=OBJECT` (partial success allowed). Large payloads (> 50 tracked entities) are submitted asynchronously and the progress screen polls `/api/tracker/jobs/{id}` until complete.

When it finishes you see a summary with created / updated / ignored counts and a list of any per-object errors.

---

## Event import

Same as tracker, but for programs **without** registration (anonymous events):

Steps: **Select → Template → Upload → Map Columns → Preview → Import**

- The template has one sheet per program stage — no TEI sheet.
- Each row is one event. `orgUnit`, `occurredAt`, and data values are required as per program configuration.
- Same submission rules as tracker (Tracker API, async for large payloads).

---

## Aggregate data entry import

For **Data Sets** (period-based aggregate reporting):

Steps: **Select → Template → Upload → Preview → Import**

### 1. Select the data set

Pick from the data sets you have access to.

### 2. Download the template

The template contains:

- One sheet per data element section (or a single sheet if the data set has none).
- Columns for `Period`, `Org Unit`, `Category Option Combo`, and each data element.
- A Validation sheet for any option sets or category combos used.

### 3. Fill in the template

- Periods must match the data set's period type (e.g. `202604` for monthly, `2026Q2` for quarterly, `2026` for yearly).
- Org units can be entered by UID or display name.
- Leave cells blank where there is no value — blank cells are skipped.

### 4. Upload, Preview, Import

Upload the file, review the preview (row counts, validation issues), and click **Start Import**. Data values are posted via `/api/dataValueSets`.

---

## Metadata import

Supported metadata types (pick one per import):

- Organisation Units
- Organisation Unit Groups / Group Sets
- Data Elements
- Data Element Groups / Group Sets
- Indicator Types / Indicators / Indicator Groups
- Option Sets
- Category Options / Categories / Category Combos
- Tracked Entity Types / Attributes

Steps: **Select Type → Import**

### Workflow

1. Choose the metadata type.
2. Download the template for that type. Templates include:
   - A **main sheet** with one row per object.
   - **Reference sheets** (e.g. a list of existing parent org units) used to resolve display-name lookups.
   - **Dropdowns** for enum fields (value type, aggregation type, domain type, boolean, etc.) backed by a hidden Validation sheet.
3. Fill in the file:
   - Leave `ID` blank for new objects (a UID is generated on import).
   - To update an existing object, enter its UID in the `ID` column.
   - Mandatory fields are marked with `*`.
   - For org units, you can enter either `parent.id` (UID) or `parent.name` — the app resolves the name via the reference sheet.
4. Upload the file. The app validates each row, shows a preview with counts and warnings, and submits via `/api/metadata` with sensible import options.

### Special notes

- **Org unit geometry** on the org unit template accepts `lng,lat` for points. Polygons longer than Excel's 32,767-character cell limit are automatically converted to a centroid on export; for polygons use the dedicated **GeoJSON** flow below.
- **Option sets** are imported together with their options in a single payload so cross-references resolve.

---

## GeoJSON (org unit geometry) import

Use this flow to attach polygon or point boundaries to existing org units from a GeoJSON file (e.g. a shapefile exported from QGIS).

Steps (from **Metadata Import → GeoJSON**): **Upload → Configure matching → Preview → Import**

1. **Upload** a `.geojson` or `.json` file. The app parses all features and lists the properties available for matching.
2. **Configure matching**:
   - Choose which GeoJSON property maps to which org unit field (by default it tries `name` → name, `id` → UID).
   - The matcher runs in three passes: exact match → normalised (case / whitespace / diacritics) → fuzzy/contains.
   - Optionally scope matching to a parent org unit or level.
3. **Preview**:
   - See matched, unmatched, and duplicate features (multiple features matching the same org unit).
   - Download unmatched features as a GeoJSON file for inspection.
4. **Import** — the app posts updated geometry objects to `/api/organisationUnits/{id}` one by one with progress.

---

## Exporting data

Steps: **Select → Configure → Export**

### Tracker / Event export

1. Select the program.
2. Configure:
   - Org unit(s) and org unit selection mode (selected / children / descendants).
   - Date range (enrollment or event dates, depending on program type).
   - Optional program stage filters.
3. Click **Export**. The app fetches tracked entities / events page by page, flattens them into a well-structured Excel workbook (same layout as the import template), and downloads the `.xlsx` file.

### Aggregate data entry export

1. Select the data set.
2. Configure:
   - Org unit(s).
   - **From** and **To** dates — the app auto-generates the list of matching periods for the data set's period type (Daily, Weekly, Monthly, Quarterly, Yearly, SixMonthlyApril, FinancialJuly, etc.). A live preview shows the first six generated periods and the total count.
3. Export — data values are fetched via `/api/dataValueSets` and written into the template.

The **Export** button stays disabled until at least one valid period is generated, so you cannot submit an empty request.

---

## Exporting metadata

Steps: **Select Type → Export**

1. Choose the metadata type (or **All Metadata** for a consolidated workbook).
2. The app calls `/api/metadata` with `fields=:owner` for a complete, re-importable representation.
3. Each object type goes into its own sheet. Enum fields (value type, aggregation type, domain type, booleans) get dropdown validation. Option-set references are resolved to display names and codes on a dedicated Validation sheet.
4. The workbook is downloaded as `.xlsx`.

The exported workbook is directly re-importable via the corresponding Import flow.

---

## Validation and error handling

The app validates locally before sending anything to DHIS2:

- Mandatory fields present.
- Dates are valid `YYYY-MM-DD`.
- Option codes / names resolve against the option set.
- Org units exist and you have access to them.
- Non-repeatable stages have at most one event per TEI (prevents DHIS2 error **E1039**).
- Geometry strings fit within Excel cell size; long polygons fall back to centroid on export.

Server-side errors returned by DHIS2 are shown per-row with the DHIS2 error code (e.g. `E1019`, `E1039`), the object that failed, and the message. Other rows in the same import can still succeed because the import runs with `atomicMode=OBJECT`.

---

## Tips and conventions

- **Never remove the `[UID]` in column headers** — the UID is how the app links a column to a DHIS2 field.
- **Do not rename sheets** — sheet names are matched to program stages and metadata types.
- **Keep `TEI_ID` consistent** across tracker sheets for the same person. It is only used locally and is never sent to DHIS2.
- **Blank = skip**. Leave a cell empty to skip that value; use `""` only if you explicitly want to clear a stored value.
- **Display name OR UID**: anywhere the template accepts an org unit or option, you can use either. The app prefers UIDs when both are present.
- **Large imports**: the app automatically switches to async mode (> 50 tracked entities). Do not close the tab while the job is running — the progress screen polls until the job ends.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| "At least one organisation unit must be specified" | Export request missing `orgUnit` | Re-select at least one org unit in the Configure step. |
| `E1039` — ProgramStage is not repeatable | Multiple rows for the same TEI on a non-repeatable stage sheet | Keep only one row per `TEI_ID` on that sheet, or make the stage repeatable in DHIS2. |
| `E1019` — Value does not match value type | Wrong data type in cell (text where number expected, bad date) | Fix the cell; use the template's dropdowns where provided. |
| Dropdowns disappear after editing | Excel removed validation on paste | Re-download the template and paste **values only** (`Paste Special → Values`). |
| Column header shows up in "Map Columns" | Header UID doesn't match this instance | Either download the template from this instance, or map the column manually in the wizard. |
| GeoJSON import: many "unmatched" features | Property mismatch or name differences | On Configure Matching, switch the source property (e.g. from `name` to `ADM2_EN`), or use the fuzzy / contains pass. |
| Aggregate export fails "no periods" | From/To range does not include any periods of the data set's period type | Widen the date range; the preview below the dates shows the period count. |

If you hit a problem not listed here, open an issue on the project repository with the DHIS2 version, a screenshot of the error, and (if relevant) a redacted copy of the Excel file.
