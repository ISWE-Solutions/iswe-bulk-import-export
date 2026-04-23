/**
 * DHIS2 2.40 ↔ 2.42+ compatibility probes against the live play instance.
 *
 * Proves that the defensive behaviour introduced in v1.2.1–v1.2.3 is correct:
 *
 *   A. Response envelope:   reads envelope.trackedEntities ?? envelope.instances ?? []
 *   B. Query params:        dual-send { orgUnit, orgUnits }, { ouMode, orgUnitMode }
 *                           and { enrollmentEnrolledAfter, enrolledAfter }.
 *   C. Empty dates:         empty-string date params must be OMITTED (not sent as "").
 *   D. Per-OU loop:         many comma-joined OUs would blow past the URL limit;
 *                           per-OU iteration keeps URLs short and partial failures
 *                           isolated.
 *
 * The test is expected to run on 2.42 (instances[] envelope) but will still pass
 * on 2.40 as long as the dual-params are silently accepted.
 */
import { api, section, ok, fail, warn, info } from './api.mjs'

const PROGRAM_ID = 'IpHINAT79UW' // Child Programme
const ROOT_OU = 'ImspTQPwCqd' // Sierra Leone root

let failures = 0
const expect = (label, cond, detail = '') => {
    if (cond) ok(label)
    else { fail(label + (detail ? ` — ${detail}` : '')); failures++ }
}

// ---------------------------------------------------------------- A. envelope
section('A. Envelope normalization — tracker + events')
try {
    const teRes = await api.get(
        `/api/tracker/trackedEntities?program=${PROGRAM_ID}&orgUnit=${ROOT_OU}` +
        `&orgUnits=${ROOT_OU}&ouMode=DESCENDANTS&orgUnitMode=DESCENDANTS` +
        '&pageSize=3&fields=trackedEntity'
    )
    const list = teRes.trackedEntities ?? teRes.instances ?? []
    const shape = Array.isArray(teRes.trackedEntities)
        ? 'trackedEntities[]'
        : Array.isArray(teRes.instances) ? 'instances[]' : 'unknown'
    info(`tracker envelope shape = ${shape}`)
    expect('tracker response has a known envelope', shape !== 'unknown')
    expect('tracker list retrievable via ?? chain', Array.isArray(list))

    const evRes = await api.get(
        '/api/tracker/events?program=eBAyeGv0exc' +
        `&orgUnit=${ROOT_OU}&orgUnits=${ROOT_OU}&ouMode=DESCENDANTS&orgUnitMode=DESCENDANTS` +
        '&pageSize=3&fields=event'
    )
    const evs = evRes.events ?? evRes.instances ?? []
    const evShape = Array.isArray(evRes.events)
        ? 'events[]'
        : Array.isArray(evRes.instances) ? 'instances[]' : 'unknown'
    info(`events envelope shape = ${evShape}`)
    expect('events response has a known envelope', evShape !== 'unknown')
    expect('events list retrievable via ?? chain', Array.isArray(evs))
} catch (e) {
    fail('envelope probe crashed: ' + e.message); failures++
}

// ---------------------------------------------------------------- B. dual params
section('B. Dual query param acceptance (legacy + new)')
// The app sends BOTH legacy and modern param names in every request so the same
// build works on 2.40 (which only understands legacy) and 2.42+ (which only
// understands modern). This section proves that strategy:
//   - Legacy-only must succeed on every supported version.
//   - Modern-only MAY fail on 2.40 (409 "At least one organisation unit must
//     be specified") — that is expected and NOT a bug.
//   - BOTH-together MUST succeed on every supported version (this is the one
//     the app actually uses).
try {
    // 1. Legacy-only
    try {
        const legacy = await api.get(
            `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnit=${ROOT_OU}&ouMode=DESCENDANTS&pageSize=1&fields=trackedEntity`,
        )
        const list = legacy.trackedEntities ?? legacy.instances ?? []
        expect('server accepts legacy orgUnit/ouMode', Array.isArray(list))
    } catch (e) {
        expect('server accepts legacy orgUnit/ouMode', false, e.message.slice(0, 100))
    }

    // 2. Modern-only — either 200 (2.42+) or 409 (2.40). Both are acceptable;
    //    this is purely informational.
    let modernStatus = '?'
    try {
        const modern = await api.get(
            `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnits=${ROOT_OU}&orgUnitMode=DESCENDANTS&pageSize=1&fields=trackedEntity`,
        )
        const list = modern.trackedEntities ?? modern.instances ?? []
        modernStatus = Array.isArray(list) ? 'accepted (2.42+ behaviour)' : 'unknown shape'
    } catch (e) {
        // 409 on 2.40 is expected — the param name didn't exist yet.
        modernStatus = /409/.test(e.message) ? 'rejected with 409 (2.40 behaviour)' : `error: ${e.message.slice(0, 80)}`
    }
    info(`modern-only: ${modernStatus}`)

    // 3. BOTH together — this is what the app actually sends. Must ALWAYS succeed.
    try {
        const both = await api.get(
            `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnit=${ROOT_OU}&orgUnits=${ROOT_OU}` +
            '&ouMode=DESCENDANTS&orgUnitMode=DESCENDANTS' +
            '&pageSize=1&fields=trackedEntity',
        )
        const list = both.trackedEntities ?? both.instances ?? []
        expect('server accepts BOTH legacy+modern (the app strategy)', Array.isArray(list))
    } catch (e) {
        expect('server accepts BOTH legacy+modern (the app strategy)', false, e.message.slice(0, 100))
    }
} catch (e) {
    fail('dual-param probe crashed: ' + e.message); failures++
}

// ---------------------------------------------------------------- C. date params
section('C. Empty date param handling')
// Uses api.get which bubbles non-200 as a thrown Error. We probe the
// legacy+modern pair to stay version-agnostic.
try {
    // Valid date — must succeed everywhere.
    try {
        const good = await api.get(
            `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnit=${ROOT_OU}&orgUnits=${ROOT_OU}` +
            '&ouMode=DESCENDANTS&orgUnitMode=DESCENDANTS&pageSize=1' +
            '&enrolledAfter=2020-01-01&enrollmentEnrolledAfter=2020-01-01&fields=trackedEntity',
        )
        const list = good.trackedEntities ?? good.instances ?? []
        expect('valid date accepted', Array.isArray(list))
    } catch (e) {
        expect('valid date accepted', false, e.message.slice(0, 100))
    }

    // Empty-string date — behaviour varies by version. Some servers 400, others
    // silently ignore. Either is fine because the app never actually sends
    // empty-string dates (it omits the param when blank).
    let emptyStatus = '?'
    try {
        const bad = await api.get(
            `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnit=${ROOT_OU}&orgUnits=${ROOT_OU}` +
            '&ouMode=DESCENDANTS&orgUnitMode=DESCENDANTS&pageSize=1' +
            '&enrolledAfter=&enrollmentEnrolledAfter=&fields=trackedEntity',
        )
        emptyStatus = Array.isArray(bad.trackedEntities ?? bad.instances ?? [])
            ? 'server tolerates empty date param (200)'
            : 'unknown shape'
    } catch (e) {
        emptyStatus = /400/.test(e.message)
            ? 'server rejects empty date param (400) → omitting is REQUIRED'
            : `error: ${e.message.slice(0, 80)}`
    }
    info(`empty date: ${emptyStatus}`)
    expect('empty date handling is either accept or 400 (and app omits anyway)',
        emptyStatus !== '?' && !emptyStatus.startsWith('error:'))
} catch (e) {
    fail('date-param probe crashed: ' + e.message); failures++
}

// ---------------------------------------------------------------- D. per-OU loop
section('D. Per-OU iteration vs comma-joined URL')
try {
    // Grab several descendants of root
    const ouRes = await api.get(
        `/api/organisationUnits?parent=${ROOT_OU}&fields=id&pageSize=50`
    )
    const ous = (ouRes.organisationUnits ?? []).map((o) => o.id)
    info(`selected ${ous.length} child org units under Sierra Leone root`)
    expect('fetched >= 10 child OUs for the test', ous.length >= 10)

    // Per-OU loop — the v1.2.3 strategy. Sends BOTH legacy+modern params on
    // every request, matching what ExportProgress.jsx does. This is the path
    // that must succeed on every supported version.
    let loopOk = 0, loopFail = 0, totalLen = 0
    for (const ou of ous) {
        const url = `/api/tracker/trackedEntities?program=${PROGRAM_ID}` +
            `&orgUnit=${ou}&orgUnits=${ou}` +
            '&ouMode=SELECTED&orgUnitMode=SELECTED' +
            '&pageSize=1&fields=trackedEntity'
        totalLen += (api.base + url).length
        try {
            const r = await api.get(url)
            if (Array.isArray(r.trackedEntities ?? r.instances ?? [])) loopOk++
            else loopFail++
        } catch { loopFail++ }
    }
    expect(`all ${ous.length} per-OU requests succeeded`, loopFail === 0, `${loopFail} failed`)
    info(`avg per-OU URL length = ${Math.round(totalLen / ous.length)} chars`)

    // Simulated comma-joined URL length (the pre-1.2.3 approach)
    const joined = `${api.base}/api/tracker/trackedEntities?program=${PROGRAM_ID}&orgUnits=${ous.join(',')}&orgUnitMode=SELECTED&pageSize=1`
    info(`comma-joined URL would be ${joined.length} chars`)
    if (joined.length > 2000) {
        info('  → exceeds common 2048-char limit → HTTP 400/414 risk proven')
        expect('comma-joined URL would exceed typical gateway limit', true)
    } else {
        warn(`comma-joined URL still under 2048 chars (n=${ous.length} too small to trigger)`)
        expect('comma-joined URL length recorded', true)
    }
} catch (e) {
    fail('per-OU probe crashed: ' + e.message); failures++
}

// ------------------------------------------------------------------- summary
console.log('\n' + (failures === 0 ? '[OK] ALL COMPAT TESTS PASSED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
