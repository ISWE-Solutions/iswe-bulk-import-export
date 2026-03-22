# Tracker Import Skill

End-to-end guide for the import workflow.

## Wizard Flow

```
ProgramSelector → TemplateDownloader → FileUploader → ImportPreview → ImportProgress
```

## Data Flow

```
1. ProgramSelector
   Input:  user selection
   Output: program object + full metadata (stages, DEs, option sets)

2. TemplateDownloader
   Input:  program + metadata
   Output: Excel file download (no state change)

3. FileUploader
   Input:  Excel file + metadata
   Output: parsedData { trackedEntities[], stageData: { stageId: events[] } }

4. ImportPreview
   Input:  parsedData + metadata
   Output: validated payload (nested tracker format)

5. ImportProgress
   Input:  payload
   Output: import report (created, updated, ignored, errors)
```

## Parsed Data Format

```js
{
  trackedEntities: [
    {
      teiId: "LOCAL_001",           // local reference, NOT sent to DHIS2
      orgUnit: "DiszpKrYNg8",       // DHIS2 UID
      enrollmentDate: "2024-01-15",
      incidentDate: "2024-01-15",
      attributes: {
        "w75KJ2mc4zz": "John",      // attribute UID → value
        "zDhUuAYrxNC": "Doe"
      }
    }
  ],
  stageData: {
    "A03MvHHogjR": [                // stage UID
      {
        teiId: "LOCAL_001",         // links to TEI above
        eventDate: "2024-01-20",
        orgUnit: "",                // optional, defaults to TEI orgUnit
        dataValues: {
          "UXz7xuGCEhU": "3500"    // DE UID → value
        }
      },
      {
        teiId: "LOCAL_001",         // same TEI, second event (repeatable stage)
        eventDate: "2024-02-20",
        orgUnit: "",
        dataValues: {
          "UXz7xuGCEhU": "3700"
        }
      }
    ]
  }
}
```

## Validation Rules

### Must-check before import

1. Every TEI has `TEI_ID`, `ORG_UNIT_ID`, `ENROLLMENT_DATE`
2. No duplicate `TEI_ID` in TEI sheet
3. Non-repeatable stages: max 1 row per `TEI_ID`
4. Every stage row's `TEI_ID` exists in TEI sheet
5. Every stage row has `EVENT_DATE`
6. Mandatory attributes and data elements are present
7. Date format is valid (`YYYY-MM-DD`)

### Warning-level checks

- Stage with no data rows (might be intentional)
- Large payload (> 500 TEIs) — suggest async mode

## Import Strategy

| Payload Size | Mode | atomicMode |
|---|---|---|
| 1-50 TEIs | sync | ALL |
| 51-500 TEIs | async | OBJECT |
| 500+ TEIs | async + batch | OBJECT |

### Batching (future)

For very large imports (500+), split into batches of 200 TEIs each.
Submit sequentially, aggregate results.

## Error Recovery

When import returns errors:
1. Parse `validationReport.errorReports[]`
2. Map error `uid` back to row in original spreadsheet
3. Display row number + field + error message
4. Allow user to download error report as Excel
