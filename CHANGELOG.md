# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.7] — 2026-04-29

### Security
- Upgraded `xlsx` from `0.18.5` to `0.20.3` (sourced from the official
  SheetJS CDN tarball) to address the prototype-pollution advisory
  [CVE-2023-30533 / GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6).
  API-compatible drop-in; no source changes required.

### Fixed
- Added explicit `@dhis2/data-engine@^3.17.0` runtime dependency in
  `package.json` so fresh installs no longer fail with
  `Module not found: Can't resolve '@dhis2/data-engine'`.

### Changed
- **Refactored `ImportWizard`** from a single 605-line file into a small
  orchestrator (286 lines) plus dedicated modules under
  `src/components/wizard/` (constants, `Stepper`, `WizardHeader`,
  `WizardFooter`) and per-flow components under
  `src/components/wizard/flows/` (`TrackerImportFlow`,
  `DataEntryImportFlow`, `ExportFlow`, `MetadataFlow`). Behaviour is
  unchanged.

### CI
- Added a scheduled end-to-end workflow (`.github/workflows/e2e.yml`)
  that boots a Dockerised DHIS2 stack (postgres + `dhis2/core`) seeded
  with the Sierra Leone demo database and runs `yarn test:e2e` against
  versions 2.40, 2.41 and 2.42. Runs weekly and on manual dispatch to
  back the README's "DHIS2 2.40 / 2.41 / 2.42+ compatible" claim with
  green builds.

## [1.2.6] — 2026-04-24

### Added
- **Actionable error hints** for 25+ DHIS2 error codes (E1007, E1019, E1020,
  E1041, E1055, E1063, E1064, E1076, E1084, E1125, E1300, E5000, E7600, …)
  rendered alongside raw server messages and in the CSV download.
- **"What went wrong" summary panel** groups failures by error code with
  counts and actionable hints, so users see the pattern at a glance.
- **Cascade-error suppression.** Enrollments and events that fail only because
  their parent TEI failed (E5000) are hidden by default, surfacing the real
  root-cause row. A single checkbox reveals them.
- **Hint column** in the per-row error table and CSV export.
- Error-download button now shows the total error count.

### Changed
- **Stricter numeric validation** — `NUMBER`, `INTEGER`, `INTEGER_POSITIVE`,
  `INTEGER_NEGATIVE` and `INTEGER_ZERO_OR_POSITIVE` now reject leading zeros
  (e.g. `0007`) client-side, matching DHIS2's server-side E1007 parser. This
  catches a common category of tracker import failures before submission.
- Rewrote the app's About description and README to foreground the unique
  capabilities (smart validation, repeatable events, geometry matching,
  column-drift detection, cascade suppression, round-trip Excel).

### Chore
- Untracked generated `test-harness/.tmp/` artifacts (already in `.gitignore`
  but historically committed).

## [1.2.5] — 2026-04-23

### Fixed
- Tracker export now populates **program-scoped attribute values** from
  `enrollments[].attributes[]` (previously the columns were present but cells
  were blank).
- Program-scoped attribute **columns** are now included in tracker templates
  and exports.
- Removed stray row-2 shading on all data exports.

### Changed
- Repository is now public under BSD-3-Clause; README rewritten for a public
  audience and internal tooling (`.github/`, `.vscode/`) removed from source
  control.

## [1.2.4] — 2026-04-22

Baseline public release. Tracker / event / aggregate / metadata / geometry
import and export flows, guided wizard, validation, Excel and JSON templates.

[Unreleased]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/compare/v1.2.6...HEAD
[1.2.5]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/releases/tag/v1.2.4
