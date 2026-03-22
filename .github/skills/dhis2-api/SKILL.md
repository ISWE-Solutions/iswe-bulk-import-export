# DHIS2 Tracker API Skill

Reference for working with the DHIS2 Tracker Web API (v2.40+).

## Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/tracker` | Import tracker data (TEIs, enrollments, events) |
| `GET` | `/api/tracker/trackedEntities` | Query tracked entities |
| `GET` | `/api/tracker/enrollments` | Query enrollments |
| `GET` | `/api/tracker/events` | Query events |
| `GET` | `/api/tracker/jobs/{id}` | Check async import job status |
| `GET` | `/api/programs` | Program metadata |
| `GET` | `/api/programStages` | Stage metadata |
| `GET` | `/api/trackedEntityTypes` | TEI type metadata |

## Import Parameters

```
POST /api/tracker?async=true
  &importStrategy=CREATE_AND_UPDATE
  &atomicMode=OBJECT
  &importMode=COMMIT
  &validationMode=FULL
  &skipRuleEngine=false
```

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `async` | true/false | false | Use true for > 50 entities |
| `importStrategy` | CREATE, UPDATE, CREATE_AND_UPDATE, DELETE | CREATE_AND_UPDATE | |
| `atomicMode` | ALL, OBJECT | ALL | OBJECT = partial success |
| `importMode` | VALIDATE, COMMIT | COMMIT | VALIDATE = dry run |
| `validationMode` | FULL, SKIP | FULL | Never skip in production |
| `skipRuleEngine` | true/false | false | Skip program rules |

## Nested Payload Format

```json
{
  "trackedEntities": [
    {
      "trackedEntityType": "nEenWmSyUEp",
      "orgUnit": "DiszpKrYNg8",
      "attributes": [
        { "attribute": "w75KJ2mc4zz", "value": "John" },
        { "attribute": "zDhUuAYrxNC", "value": "Doe" }
      ],
      "enrollments": [
        {
          "program": "IpHINAT79UW",
          "orgUnit": "DiszpKrYNg8",
          "enrolledAt": "2024-01-15",
          "occurredAt": "2024-01-15",
          "events": [
            {
              "programStage": "A03MvHHogjR",
              "orgUnit": "DiszpKrYNg8",
              "occurredAt": "2024-01-15",
              "status": "COMPLETED",
              "dataValues": [
                { "dataElement": "UXz7xuGCEhU", "value": "3500" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Repeatable Events

- Program stages have `repeatable: true/false` property
- Repeatable: multiple events per enrollment allowed (different dates)
- Non-repeatable: exactly ONE event per enrollment per stage
- Error `E1039`: "ProgramStage is not repeatable and an event already exists"

## Async Job Polling

```
GET /api/tracker/jobs/{jobId}
```

Response when complete:
```json
{
  "status": "OK",
  "stats": { "created": 10, "updated": 0, "deleted": 0, "ignored": 2 },
  "validationReport": {
    "errorReports": [
      { "errorCode": "E1039", "message": "...", "trackerType": "EVENT", "uid": "..." }
    ]
  }
}
```

## Metadata Queries

### Programs with stages and data elements

```
GET /api/programs/{id}?fields=id,displayName,
  trackedEntityType[id,displayName,
    trackedEntityTypeAttributes[id,mandatory,valueType,
      trackedEntityAttribute[id,displayName,valueType,
        optionSet[id,options[id,displayName,code]]]]],
  programStages[id,displayName,repeatable,sortOrder,
    programStageDataElements[id,compulsory,
      dataElement[id,displayName,valueType,
        optionSet[id,options[id,displayName,code]]]]]
```

## Common Error Codes

| Code | Meaning |
|---|---|
| E1000 | User not authorised |
| E1001 | TrackedEntity not found |
| E1039 | Stage not repeatable, event exists |
| E1063 | Org unit not in program scope |
| E1080 | Enrollment not found |
| E1081 | Event not found |
| E1090 | Attribute not valid for TEI type |
| E4000 | Missing mandatory attribute |
