/**
 * JSON source/sink smoke tests for the import/export flows.
 *
 * Verifies:
 *   1. parseNativeJsonPayload accepts valid tracker/event/dataEntry/metadata payloads
 *      and rejects malformed ones with helpful messages.
 *   2. Round-trip: export-side wrapping shape for each import type is re-parseable
 *      by the import-side parser without modification.
 *   3. (Optional, when DHIS2_BASE reachable) POST a minimal metadata payload using
 *      importStrategy=CREATE_AND_UPDATE + atomicMode=NONE, verify accepted status.
 *
 * Run:
 *   node test-harness/bundle-run.mjs test-harness/07-json-io.mjs
 */
import { parseNativeJsonPayload } from '../src/lib/fileParser.js'
import { api, section, ok, fail, info } from './api.mjs'

let failures = 0
const expect = (label, cond, detail = '') => {
    if (cond) { ok(label) } else { fail(label + (detail ? ` -- ${detail}` : '')); failures++ }
}
const expectThrow = (label, fn, msgPart) => {
    try { fn(); fail(label + ' -- expected throw'); failures++ }
    catch (e) {
        const msg = String(e.message || '')
        if (!msgPart || msg.toLowerCase().includes(msgPart.toLowerCase())) ok(label)
        else { fail(label + ` -- wrong message: ${msg}`); failures++ }
    }
}

// -----------------------------------------------------------------------------
section('parseNativeJsonPayload — tracker')
// -----------------------------------------------------------------------------
{
    const payload = {
        trackedEntities: [{
            trackedEntityType: 'nEenWmSyUEp',
            orgUnit: 'DiszpKrYNg8',
            attributes: [{ attribute: 'w75KJ2mc4zz', value: 'Jane' }],
            enrollments: [{
                program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8',
                enrolledAt: '2026-01-01', occurredAt: '2026-01-01',
                events: [
                    { programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-01-05', status: 'COMPLETED', dataValues: [] },
                    { programStage: 'A03MvHHogjR', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-02-05', status: 'COMPLETED', dataValues: [] },
                ],
            }],
        }],
    }
    const r = parseNativeJsonPayload(JSON.stringify(payload), 'tracker')
    expect('returns payload object', !!r.payload && Array.isArray(r.payload.trackedEntities))
    expect('summary has TEI count = 1', r.summary && String(r.summary['Tracked entities']) === '1')
    expect('summary has Enrollments = 1', r.summary && String(r.summary['Enrollments']) === '1')
    expect('summary has Events = 2', r.summary && String(r.summary['Events']) === '2')

    expectThrow('rejects invalid JSON', () => parseNativeJsonPayload('{not json', 'tracker'), 'json')
    expectThrow('rejects empty trackedEntities', () => parseNativeJsonPayload(JSON.stringify({ trackedEntities: [] }), 'tracker'), 'trackedEntities')
    expectThrow('rejects missing key', () => parseNativeJsonPayload(JSON.stringify({}), 'tracker'), 'trackedEntities')
}

// -----------------------------------------------------------------------------
section('parseNativeJsonPayload — event (program without registration)')
// -----------------------------------------------------------------------------
{
    const payload = {
        events: [
            { program: 'lxAQ7Zs9VYR', programStage: 'Zj7UnCAulEk', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-03-01', status: 'COMPLETED', dataValues: [] },
            { program: 'lxAQ7Zs9VYR', programStage: 'Zj7UnCAulEk', orgUnit: 'DiszpKrYNg8', occurredAt: '2026-03-02', status: 'COMPLETED', dataValues: [] },
        ],
    }
    const r = parseNativeJsonPayload(JSON.stringify(payload), 'event')
    expect('returns 2 events', r.payload?.events?.length === 2)
    expect('summary Events = 2', String(r.summary?.Events) === '2')
    expectThrow('rejects empty events', () => parseNativeJsonPayload(JSON.stringify({ events: [] }), 'event'), 'event')
}

// -----------------------------------------------------------------------------
section('parseNativeJsonPayload — dataEntry (aggregate)')
// -----------------------------------------------------------------------------
{
    const payload = {
        dataSet: 'BfMAe6Itzgt',
        dataValues: [
            { dataElement: 'fbfJHSPpUQD', period: '202601', orgUnit: 'DiszpKrYNg8', value: '10' },
            { dataElement: 'fbfJHSPpUQD', period: '202602', orgUnit: 'DiszpKrYNg8', value: '12' },
            { dataElement: 'cYeuwXTCPkU', period: '202601', orgUnit: 'DiszpKrYNg8', value: '5' },
        ],
    }
    const r = parseNativeJsonPayload(JSON.stringify(payload), 'dataEntry')
    expect('returns 3 dataValues', r.payload?.dataValues?.length === 3)
    expect('summary has Data values = 3', String(r.summary?.['Data values']) === '3')
    expect('summary unique orgUnits = 1', String(r.summary?.['Org units']) === '1')
    expect('summary unique periods = 2', String(r.summary?.['Periods']) === '2')

    // bare {dataValues} also allowed
    const r2 = parseNativeJsonPayload(JSON.stringify({ dataValues: payload.dataValues }), 'dataEntry')
    expect('accepts bare {dataValues}', r2.payload?.dataValues?.length === 3)
    expectThrow('rejects empty dataValues', () => parseNativeJsonPayload(JSON.stringify({ dataValues: [] }), 'dataEntry'), 'dataValues')
}

// -----------------------------------------------------------------------------
section('parseNativeJsonPayload — metadata')
// -----------------------------------------------------------------------------
{
    const payload = {
        options: [{ name: 'Opt-A', code: 'A' }, { name: 'Opt-B', code: 'B' }],
        optionSets: [{ name: 'Gender', valueType: 'TEXT' }],
    }
    const r = parseNativeJsonPayload(JSON.stringify(payload), 'metadata')
    expect('returns metadata payload', !!r.payload?.optionSets && !!r.payload?.options)
    expect('summary options = 2', String(r.summary?.options) === '2')
    expect('summary optionSets = 1', String(r.summary?.optionSets) === '1')
    expectThrow('rejects payload with no array fields', () => parseNativeJsonPayload(JSON.stringify({ foo: 'bar' }), 'metadata'), 'metadata')
}

// -----------------------------------------------------------------------------
section('Export round-trip shapes')
// Mirrors the wrapping logic in ExportProgress.jsx:
//   tracker -> { trackedEntities: data }
//   event   -> { events: flatten(data) }
//   dataEntry -> { dataSet: id, dataValues: data }
// -----------------------------------------------------------------------------
{
    // tracker: fetched data shape is [tei, tei, ...]
    const trackerFetched = [
        {
            trackedEntityType: 'nEenWmSyUEp', orgUnit: 'DiszpKrYNg8', attributes: [],
            enrollments: [{ program: 'IpHINAT79UW', orgUnit: 'DiszpKrYNg8', enrolledAt: '2026-01-01', occurredAt: '2026-01-01', events: [] }],
        },
    ]
    const trackerJson = JSON.stringify({ trackedEntities: trackerFetched }, null, 2)
    const rt = parseNativeJsonPayload(trackerJson, 'tracker')
    expect('tracker export re-imports', rt.payload.trackedEntities.length === 1)

    // event: fetched data is grouped by stageId -> [events]
    const eventFetched = { Zj7UnCAulEk: [{ program: 'lx', programStage: 'Zj7UnCAulEk', orgUnit: 'o', occurredAt: '2026-03-01', dataValues: [] }] }
    const eventJson = JSON.stringify({ events: Object.values(eventFetched).flat() }, null, 2)
    const re = parseNativeJsonPayload(eventJson, 'event')
    expect('event export re-imports', re.payload.events.length === 1)

    // dataEntry
    const dvJson = JSON.stringify({ dataSet: 'BfMAe6Itzgt', dataValues: [{ dataElement: 'x', period: '202601', orgUnit: 'o', value: '1' }] }, null, 2)
    const rd = parseNativeJsonPayload(dvJson, 'dataEntry')
    expect('dataEntry export re-imports', rd.payload.dataValues.length === 1)
}

// -----------------------------------------------------------------------------
section('Live DHIS2 — metadata dry-run (importMode=VALIDATE)')
// -----------------------------------------------------------------------------
try {
    await api.get('/api/me?fields=id')
    const probe = {
        options: [
            { code: 'ISWE_JSON_TEST_A', name: 'ISWE JSON Test A' },
            { code: 'ISWE_JSON_TEST_B', name: 'ISWE JSON Test B' },
        ],
    }
    const r = await api.post(
        '/api/metadata?importStrategy=CREATE_AND_UPDATE&atomicMode=NONE&importMode=VALIDATE',
        probe,
    )
    info(`HTTP ${r.status}`)
    if (r.ok && r.body?.status) {
        expect(`server status = ${r.body.status}`, ['OK', 'WARNING'].includes(r.body.status))
        info(`stats: ${JSON.stringify(r.body.stats || {})}`)
    } else {
        fail('metadata validate request failed')
        info((r.text || '').slice(0, 300))
        failures++
    }
} catch (e) {
    info(`skipped (no live DHIS2): ${e.message.slice(0, 120)}`)
}

// -----------------------------------------------------------------------------
console.log('\n' + (failures === 0 ? '[OK] ALL JSON IO TESTS PASSED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
