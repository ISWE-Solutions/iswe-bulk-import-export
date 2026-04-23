# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/compare/v1.2.5...HEAD
[1.2.5]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/ISWE-Solutions/iswe-bulk-import-export/releases/tag/v1.2.4
