/**
 * Live server-side VALIDATE probes for JSON import payloads.
 *
 * For each of {tracker, event, aggregate} we:
 *   1. Build a minimal payload using parseNativeJsonPayload (the same function
 *      the FileUploader → MetadataImportFlow toggle uses).
 *   2. POST it to DHIS2 with importMode=VALIDATE + atomicMode=OBJECT.
 *   3. Assert the server accepts the shape (OK or WARNING status).
 *
 * Proves the JSON toggle end-to-end for all three data models without writing
 * anything to the play instance.
 */
import { api, section, ok, fail, info } from './api.mjs'
import { parseNativeJsonPayload } from '../src/lib/fileParser.js'

const ORG_UNIT = 'DiszpKrYNg8' // Ngelehun CHC
const TRACKER_PROGRAM = 'IpHINAT79UW' // Child Programme (WITH_REGISTRATION)
const TRACKED_ENTITY_TYPE = 'nEenWmSyUEp' // Person (needed by Child Programme)
const EVENT_PROGRAM = 'eBAyeGv0exc' // Inpatient morbidity (WITHOUT_REGISTRATION)
const EVENT_STAGE = 'Zj7UnCAulEk'
const DATA_SET = 'lyLU2wR22tC' // ART monthly summary
const DE_ID = 'Ix2HsbDMLea' // "ART No. taking ARVs - Pregnant women (baseline)"
const PERIOD = '202501'

let failures = 0
const expect = (label, cond, detail = '') => {
    if (cond) ok(label)
    else { fail(label + (detail ? ` — ${detail}` : '')); failures++ }
}

// ─────────────────────────────────────────────────────────────── tracker
section('A. Tracker JSON → /api/tracker VALIDATE')
{
    const today = new Date().toISOString().slice(0, 10)
    const raw = {
        trackedEntities: [{
            trackedEntityType: TRACKED_ENTITY_TYPE,
            orgUnit: ORG_UNIT,
            attributes: [],
            enrollments: [{
                program: TRACKER_PROGRAM,
                orgUnit: ORG_UNIT,
                enrolledAt: today,
                occurredAt: today,
                events: [],
            }],
        }],
    }
    const { payload, summary } = parseNativeJsonPayload(JSON.stringify(raw), 'tracker')
    info(`parsed summary: ${JSON.stringify(summary)}`)

    const res = await api.post(
        '/api/tracker?async=false&importMode=VALIDATE&importStrategy=CREATE_AND_UPDATE&atomicMode=OBJECT',
        payload,
    )
    info(`HTTP ${res.status} server status ${res.body?.status}`)
    const status = res.body?.status
    expect('tracker VALIDATE returned status OK or WARNING',
        status === 'OK' || status === 'WARNING',
        `got ${status}; body=${JSON.stringify(res.body?.stats || {})}`)
}

// ─────────────────────────────────────────────────────────────── event
section('B. Event JSON → /api/tracker VALIDATE')
{
    const today = new Date().toISOString().slice(0, 10)
    const raw = {
        events: [{
            program: EVENT_PROGRAM,
            programStage: EVENT_STAGE,
            orgUnit: ORG_UNIT,
            occurredAt: today,
            status: 'COMPLETED',
            dataValues: [],
        }],
    }
    const { payload, summary } = parseNativeJsonPayload(JSON.stringify(raw), 'event')
    info(`parsed summary: ${JSON.stringify(summary)}`)

    const res = await api.post(
        '/api/tracker?async=false&importMode=VALIDATE&importStrategy=CREATE_AND_UPDATE&atomicMode=OBJECT',
        payload,
    )
    info(`HTTP ${res.status} server status ${res.body?.status}`)
    const status = res.body?.status
    expect('event VALIDATE returned status OK or WARNING',
        status === 'OK' || status === 'WARNING',
        `got ${status}; body=${JSON.stringify(res.body?.stats || {})}`)
}

// ─────────────────────────────────────────────────────────────── aggregate
section('C. Aggregate JSON → /api/dataValueSets dryRun')
{
    const raw = {
        dataSet: DATA_SET,
        dataValues: [{
            dataElement: DE_ID,
            period: PERIOD,
            orgUnit: ORG_UNIT,
            value: '1',
        }],
    }
    const { payload, summary } = parseNativeJsonPayload(JSON.stringify(raw), 'dataEntry')
    info(`parsed summary: ${JSON.stringify(summary)}`)

    // dryRun=true is the aggregate-endpoint equivalent of importMode=VALIDATE.
    const res = await api.post(
        '/api/dataValueSets?dryRun=true&importStrategy=CREATE_AND_UPDATE',
        payload,
    )
    info(`HTTP ${res.status} server status ${res.body?.status}`)
    const status = res.body?.status
    expect('aggregate dryRun returned status OK, WARNING, or SUCCESS',
        ['OK', 'SUCCESS', 'WARNING'].includes(status),
        `got ${status}; body=${JSON.stringify(res.body?.importCount || {})}`)
}

// ─────────────────────────────────────────────────────────────── negative
section('D. Malformed JSON rejected with helpful message')
{
    try {
        parseNativeJsonPayload('{', 'tracker')
        fail('expected parseNativeJsonPayload to throw')
        failures++
    } catch (e) {
        expect('invalid JSON raises parse error',
            /not valid json/i.test(e.message),
            `got: ${e.message}`)
    }
    try {
        parseNativeJsonPayload(JSON.stringify({ wrongKey: [] }), 'tracker')
        fail('expected missing-trackedEntities throw')
        failures++
    } catch (e) {
        expect('missing trackedEntities key is rejected',
            /trackedEntities/i.test(e.message))
    }
}

console.log('\n' + (failures === 0 ? '[OK] ALL JSON VALIDATE TESTS PASSED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
