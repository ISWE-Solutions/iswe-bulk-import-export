---
description: "Debug a tracker import issue (validation errors, payload problems, API failures)"
---

# Debug Import

## Context
- DHIS2 Tracker API: `POST /api/tracker` (v2.40+)
- Payload format: nested (trackedEntities > enrollments > events)
- Read `.github/skills/dhis2-api/SKILL.md` for API reference
- Read `.github/skills/tracker-import/SKILL.md` for payload structure

## Steps
1. Identify the error — is it client-side validation or DHIS2 API error?
2. If client-side: check `src/lib/validator.js` rules
3. If API error: check the error code (E1xxx series)
   - E1039 = non-repeatable stage already has an event
   - E1002 = tracked entity not found
   - E1048 = org unit not in program scope
4. Check `src/lib/payloadBuilder.js` for payload construction issues
5. Check `src/lib/fileParser.js` for Excel parsing issues

## Common Issues
- Date format wrong (must be YYYY-MM-DD)
- UID columns not matching DHIS2 metadata
- Repeatable stage rows missing TEI_ID linkage
- Org unit not assigned to program
