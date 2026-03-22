# DHIS2 Tracker Bulk Import — AI Agent Instructions

**Stack**: React 18 · DHIS2 App Platform · DHIS2 UI · SheetJS (xlsx) · JavaScript/JSX

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary.
- **DHIS2 API First**: Always validate against official DHIS2 Tracker API documentation before implementing.

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
    useProgramMetadata.js     # Fetch full program metadata
  lib/
    templateGenerator.js      # Build Excel workbook from metadata
    fileParser.js             # Parse uploaded Excel into structured data
    validator.js              # Validate parsed data against metadata
    payloadBuilder.js         # Construct nested tracker API payload
```

## DHIS2 Tracker API Rules (CRITICAL)

- **API Version**: Target v2.40+ (v41 preferred). Use `/api/tracker` endpoint (NOT legacy `/api/trackedEntityInstances`).
- **Payload Format**: Always use **nested** format: `trackedEntities > enrollments > events`
- **Import Strategy**: Default to `CREATE_AND_UPDATE` with `atomicMode: OBJECT` (partial success allowed)
- **Async for Large Payloads**: Use `async=true` for payloads > 50 tracked entities, poll `/api/tracker/jobs/{id}`
- **Repeatable Events**: Multiple rows per TEI on repeatable stage sheets. Non-repeatable stages: exactly ONE event per TEI.
- **Error E1039**: "ProgramStage is not repeatable and an event already exists" — validator MUST catch this client-side before submission.

### Tracker Payload Structure

```json
{
  "trackedEntities": [{
    "trackedEntityType": "UID",
    "orgUnit": "UID",
    "attributes": [{ "attribute": "UID", "value": "..." }],
    "enrollments": [{
      "program": "UID",
      "orgUnit": "UID",
      "enrolledAt": "YYYY-MM-DD",
      "occurredAt": "YYYY-MM-DD",
      "events": [{
        "programStage": "UID",
        "orgUnit": "UID",
        "occurredAt": "YYYY-MM-DD",
        "status": "COMPLETED",
        "dataValues": [{ "dataElement": "UID", "value": "..." }]
      }]
    }]
  }]
}
```

## Code Reuse (CRITICAL)

**BEFORE creating new code — search for existing implementations.**

| Before Creating | Check First |
|---|---|
| DHIS2 query | Existing hooks in `src/hooks/` |
| UI component | `@dhis2/ui` library components |
| Excel logic | `src/lib/templateGenerator.js`, `src/lib/fileParser.js` |
| Validation | `src/lib/validator.js` |
| Payload building | `src/lib/payloadBuilder.js` |

## DHIS2 App Platform Rules

- **Data Queries**: Use `useDataQuery` hook from `@dhis2/app-runtime` (NOT raw fetch/axios)
- **Mutations**: Use `useDataMutation` or `engine.mutate()` for POST/PUT/DELETE
- **UI Components**: Use `@dhis2/ui` exclusively (NOT MUI, NOT custom CSS for standard patterns)
- **i18n**: Use `@dhis2/app-runtime` i18n for all user-visible strings
- **Config**: All app metadata in `d2.config.js`

## Excel Template Rules

- **Sheet names**: Max 31 characters (Excel limit). Truncate long stage names.
- **Column format**: `Display Name [UID]` — the UID in brackets is the DHIS2 identifier
- **Mandatory fields**: Mark with asterisk `*` in column header
- **Option sets**: Separate Validation sheet with code/display pairs
- **TEI_ID**: Local reference column linking rows across sheets. NOT sent to DHIS2.

## Code Standards

- **No secrets** in code — use `.env` / environment variables
- **No emojis** — use `[OK]`, `[FAIL]`, `[WARN]` in logs
- **No TODO/FIXME** — describe intent, not history
- **Document all new logic** with JSDoc or comment explaining what and why
- **React best practices**: Memoize expensive operations, avoid unnecessary re-renders
- **Error boundaries**: Wrap major sections in error boundaries

## Token Optimization (CRITICAL)

### Responses

| Bad | Good |
|---|---|
| Paragraphs explaining what you did | Terse: "Done." |
| "I'll now proceed to..." | Just do it |
| Print code user didn't ask for | Use edit tools silently |
| Explain obvious changes | Only explain complex logic |

### Tool Usage

| Bad | Good |
|---|---|
| Full output | `tail -5`, `head -10`, `grep` |
| Read 100+ lines | `grep` first, read 20-30 lines |
| Sequential independent calls | Parallel tool calls |
| One edit at a time | `multi_replace_string_in_file` for batches |

### Output Truncation

Always filter: `| tail -10`, `| head -5`, `| grep -E "error|fail|success"`, `2>&1 | tail -10`

## Skills (on-demand)

Load the relevant skill file when working on that type of task:

| Task | Skill |
|---|---|
| DHIS2 API integration | `dhis2-api` |
| Excel template generation | `excel-template` |
| Tracker import logic | `tracker-import` |
| React component development | `component-dev` |
| Testing | `testing` |
| Pre-commit cleanup | `deslop` |
| Committing changes | `smart-commit` |

**Location**: `.github/skills/{name}/SKILL.md` — read when needed, not every turn.

## Workflow Orchestration

1. **Plan Mode**: Enter for non-trivial tasks (3+ steps). If things go sideways, STOP and re-plan.
2. **Subagents**: Use liberally for research/exploration to keep main context clean.
3. **Self-Improvement**: After ANY correction, update `tasks/lessons.md` with categorized pattern.
4. **Verification**: Never mark complete without proving it works. Run tests, check builds.
5. **Elegance**: For non-trivial changes, ask "is there a more elegant way?"

## Task Management

1. Plan to `tasks/todo.md` with checkable items
2. Track progress, mark items complete as you go
3. Capture lessons in `tasks/lessons.md` after corrections

## Prompts

| Prompt | Purpose |
|---|---|
| `add-stage` | Add support for a new program stage type |
| `add-validation` | Add a new validation rule |
| `fix-import` | Debug import errors |
| `new-component` | Create a new UI component |
| `test-payload` | Generate test payload for DHIS2 |

**Location**: `.github/prompts/{name}.prompt.md`
