---
description: "Add or modify an Excel template feature (new columns, validation dropdowns, conditional formatting)"
---

# Template Feature

## Context
- Template generation: `src/lib/templateGenerator.js`
- Template parsing: `src/lib/fileParser.js`
- Uses SheetJS (xlsx) library
- Read `.github/skills/excel-template/SKILL.md` for conventions

## Steps
1. Understand the metadata structure from `useProgramMetadata.js`
2. Modify `templateGenerator.js` to add/change template columns or sheets
3. Update `fileParser.js` to parse the new columns correctly
4. Update `validator.js` if new validation rules are needed
5. Update `payloadBuilder.js` if the new data needs to go into the API payload

## Rules
- Column headers MUST follow pattern: `Display Name [dhis2Uid]`
- Mandatory columns get asterisk: `Name * [uid]`
- Option set columns should reference the Validation sheet
- Keep template/parser in sync — if you add a column, parse it too
