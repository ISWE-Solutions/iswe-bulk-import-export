# ISWE Bulk Import / Export for DHIS2

[![DHIS2](https://img.shields.io/badge/DHIS2-2.40%2B-1976d2)](https://dhis2.org/)
[![Licence](https://img.shields.io/badge/licence-BSD--3--Clause-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org/)

A browser-based DHIS2 app that moves **tracker, event, aggregate, metadata, and
org-unit geometry** data between DHIS2 and Excel (`.xlsx`) / JSON / GeoJSON
files — with program-aware templates, smart client-side validation, and a
guided wizard for every flow.

The app runs entirely inside the current DHIS2 instance (no external services,
no stored credentials) and uses the logged-in user's session.

---

## What makes this different

Most DHIS2 import tools accept a file, send it to the server, and surface
whatever errors come back. This app goes further:

- **Smart validation that speaks DHIS2.** 25+ server error codes (E1007,
  E1019, E1020, E1041, E1055, E1063, E1064, E1076, E1084, E1125, E1300, E5000,
  E7600, …) are caught client-side with actionable hints before the payload is
  ever submitted — including leading-zero rejection that matches DHIS2's
  strict numeric parser.
- **Cascade-error suppression.** When a parent TEI fails, its enrollments and
  events are automatically flagged as cascade failures and hidden from the
  error list by default, so users see the real problem on the right row.
- **Fuzzy option-set suggestions.** Mistyped option codes get a ranked list of
  likely matches ("`yellow` → did you mean `Yellow Fever`?") instead of a bare
  rejection.
- **Repeatable tracker event imports.** Program-aware templates generate one
  sheet per stage and correctly handle repeatable stages — something the
  stock app does not do.
- **GeoJSON org-unit geometry.** Three-level fuzzy matching (exact →
  normalized → contains/fuzzy), CRS detection, geometry-complexity warnings,
  and a diff preview before writing coordinates back to DHIS2.
- **Round-trip Excel.** Every export can be re-imported without
  transformation. Client-generated UIDs preserve identity across edits.
- **Column-drift detection.** Templates are fingerprinted so broken
  spreadsheets (renamed headers, dropped columns, wrong stage order) are
  rejected with a clear diff instead of a confusing server error.
- **Native JSON metadata import with full DHIS2 options.** `skipSharing`,
  `mergeMode`, `importStrategy`, `atomicMode`, `importMode=VALIDATE` dry runs
  — all exposed in the UI.
- **Resilient at scale.** Large payloads are auto-batched, retried on
  transient server errors (Hibernate "no Session" / HTTP 5xx) with
  exponentially smaller batches, and polled asynchronously until done — so
  1000-OU org-unit imports don't hit HTTP 414 or 500.
- **DHIS2 2.40, 2.41, 2.42+ compatible.** The app sends both legacy and new
  tracker query-param shapes and normalises the `instances[]` response
  envelope so it works across all supported server versions.

## Why this app

The stock DHIS2 Import/Export app accepts CSV and JSON but offers no template
generation, no repeatable-event support, no Excel I/O, no geometry matching,
no client-side validation, and no guided UI. ISWE Bulk Import/Export fills
those gaps for data managers, implementers, and migration teams.

## Features

### Import

| Flow | What it does |
| --- | --- |
| **Tracker** (`WITH_REGISTRATION`) | Program-aware templates with one sheet per program stage, repeatable-stage support, option-set dropdowns, mandatory-field markers, submission via `POST /api/tracker` with async polling for large payloads. |
| **Event** (`WITHOUT_REGISTRATION`) | Single-stage event template and nested `POST /api/tracker` submission. |
| **Aggregate** | `DE × CategoryOptionCombo` template per data set, submission via `POST /api/dataValueSets`. |
| **Metadata** | Excel or native JSON for data elements, indicators, org units, option sets, category options/combos, tracked entity types/attributes, and every common group/group-set, via `POST /api/metadata`. |
| **Geometry** | Upload a GeoJSON file, fuzzy-match features to org units, and write `geometry` back with a diff-preview. |

### Export

- **Tracker / event data** — filter TEIs or events and export into Excel
  templates that can be re-edited and re-imported without transformation.
- **Aggregate data** — export `dataValueSets` for any org unit / period range.
- **Metadata** — export any supported type, or a combined "All Metadata"
  workbook, for review, bulk edit, and re-import.

### Safety & validation

- **25+ DHIS2 error codes caught client-side** with actionable hints before
  submission (E1007, E1019, E1020, E1041, E1055, E1063, E1064, E1076, E1084,
  E1125, E1300, E5000, E7600, and more).
- **Strict numeric parsing** matches DHIS2's server behaviour — `0007` is
  rejected before upload instead of failing with a cryptic E1007 after.
- **Cascade suppression** hides enrollment/event errors that only failed
  because their parent TEI failed; a single toggle reveals them if needed.
- **Fuzzy option suggestions** rank likely matches when an option code is
  mistyped.
- **Template column-drift detection** compares uploaded workbooks against the
  generated template fingerprint and rejects mismatches with a diff.
- **Repeatable vs non-repeatable** program stages are enforced client-side.
- **Client-generated UIDs** map DHIS2 error reports back to specific Excel
  rows so fixes land on the right row.
- **Batched uploads with auto-retry** survive transient server failures
  (Hibernate "no Session", HTTP 5xx) by halving batch size up to six levels
  deep; large payloads are polled asynchronously until completion.

---

## Installation

### Option 1 — App Management (recommended)

1. Download the latest release bundle from the
   [Releases page](https://github.com/ISWE-Solutions/iswe-bulk-import-export/releases)
   (`ISWE Bulk Import-Export-<version>.zip`).
2. In DHIS2, open **App Management** → **Upload App** and select the zip.
3. Launch **ISWE Bulk Import/Export** from the app menu.

### Option 2 — DHIS2 App Hub

Once listed, install directly from the in-instance **App Hub** browser.

### Option 3 — Build from source

```bash
git clone https://github.com/ISWE-Solutions/iswe-bulk-import-export.git
cd iswe-bulk-import-export
yarn install
yarn build
# Upload build/bundle/*.zip via App Management.
```

---

## Usage

See the full [**User Guide**](docs/USER_GUIDE.md) for step-by-step walkthroughs
of every flow.

At a glance, every flow follows the same five-step wizard:

1. **Select** the program, data set, or metadata type.
2. **Download** the template (Excel) or proceed to export filters.
3. **Fill in** the template in any spreadsheet editor.
4. **Upload** the file back into the app.
5. **Preview & Submit** — the app validates client-side, submits to DHIS2, and
   shows per-row results.

---

## Requirements

| Component | Version |
| --- | --- |
| DHIS2 server | 2.40 or later (2.41+ recommended) |
| Browser | Any modern browser (Chrome, Firefox, Edge, Safari) |
| User permissions | Depends on the flow — at minimum, data-capture for the chosen program / data set, or metadata write for metadata flows. |

Build-time (only if compiling from source):

| Component | Version |
| --- | --- |
| Node.js | 18 or later |
| Yarn | 1.x |

---

## Building & running locally

```bash
yarn install
yarn start --proxy https://play.im.dhis2.org/stable-2-42-4   # dev server
yarn build                                                   # production bundle
yarn lint
```

The built `.zip` lands in `build/bundle/` ready for upload.

---

## Security

- The app runs under the signed-in DHIS2 user's session — it never stores or
  transmits credentials.
- All external links in the UI use `rel="noreferrer"`.
- No data leaves the DHIS2 instance; parsing and validation happen in the
  browser.

To report a vulnerability privately, see [SECURITY.md](SECURITY.md).

---

## Contributing

Pull requests are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for
the development workflow, coding standards, and PR checklist, and abide by
the [Code of Conduct](CODE_OF_CONDUCT.md). For non-trivial changes, open an
issue first so we can agree on scope. All contributions are released under
the project's BSD-3-Clause licence.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

---

## Support

- **Bug reports & feature requests:** [GitHub Issues](https://github.com/ISWE-Solutions/iswe-bulk-import-export/issues)
- **Maintainer:** [ISWE Solutions](https://github.com/ISWE-Solutions)

---

## Licence

[BSD 3-Clause](LICENSE) © ISWE Solutions.
