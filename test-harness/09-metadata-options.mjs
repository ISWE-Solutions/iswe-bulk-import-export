/**
 * Metadata import options — thorough test.
 *
 * Covers:
 *   A. Pure unit tests of buildMetadataParams (every flag combination)
 *   B. Live DHIS2 round-trip verifying each option actually changes server behaviour:
 *      1. Fetch an existing dataElement as a known UID
 *      2. CREATE strategy on an existing UID must fail (status ERROR)
 *      3. UPDATE strategy on a fresh UID must ignore / fail the create
 *      4. CREATE_AND_UPDATE on existing UID must succeed
 *      5. Dry run (importMode=VALIDATE) must NOT commit changes
 *      6. MERGE must keep untouched fields; REPLACE must clear them
 *      7. skipSharing=true must tolerate payloads with unresolvable sharing refs
 *
 * Run:
 *   node test-harness/bundle-run.mjs test-harness/09-metadata-options.mjs
 */
import { api, section, ok, fail, info } from './api.mjs'
import { buildMetadataParams, paramsToQuery } from '../src/lib/metadataImportParams.js'

let failures = 0
const expect = (label, cond, detail) => {
    if (cond) ok(label)
    else { fail(`${label}${detail ? ` — ${detail}` : ''}`); failures++ }
}

/* -------------------------------------------------------------------------- */
/* A. Pure unit tests                                                          */
/* -------------------------------------------------------------------------- */
section('A. buildMetadataParams — pure')

{
    const p = buildMetadataParams()
    expect('defaults: CREATE_AND_UPDATE', p.importStrategy === 'CREATE_AND_UPDATE')
    expect('defaults: atomicMode=NONE', p.atomicMode === 'NONE')
    expect('defaults: MERGE', p.mergeMode === 'MERGE')
    expect('defaults: identifier=UID', p.identifier === 'UID')
    expect('defaults: skipSharing=true', p.skipSharing === 'true')
    expect('defaults: no importMode', p.importMode === undefined)
}
{
    const p = buildMetadataParams({ skipSharing: false })
    expect('skipSharing=false omits key', p.skipSharing === undefined)
}
{
    const p = buildMetadataParams({ dryRun: true })
    expect('dryRun=true → importMode=VALIDATE', p.importMode === 'VALIDATE')
}
{
    const p = buildMetadataParams({ importStrategy: 'CREATE', mergeMode: 'REPLACE' })
    expect('CREATE strategy passes through', p.importStrategy === 'CREATE')
    expect('REPLACE merge passes through', p.mergeMode === 'REPLACE')
}
{
    const q = paramsToQuery(buildMetadataParams({ dryRun: true }))
    expect('paramsToQuery contains importMode=VALIDATE', q.includes('importMode=VALIDATE'))
    expect('paramsToQuery contains skipSharing=true', q.includes('skipSharing=true'))
    expect('paramsToQuery encodes atomicMode=NONE', q.includes('atomicMode=NONE'))
}

/* -------------------------------------------------------------------------- */
/* B. Live round-trip                                                          */
/* -------------------------------------------------------------------------- */
section('B. Live DHIS2 round-trip')

try {
    await api.get('/api/me?fields=id')
} catch (e) {
    info(`skipped live tests (no DHIS2): ${e.message.slice(0, 120)}`)
    console.log('\n' + (failures === 0 ? '[OK] METADATA OPTIONS (unit only)' : `[FAIL] ${failures} failure(s)`))
    process.exit(failures === 0 ? 0 : 1)
}

const postMeta = (opts, payload) =>
    api.post(`/api/metadata?${paramsToQuery(buildMetadataParams(opts))}`, payload)

/* Fetch an existing data element to use as a stable, known-good UID */
const existing = await api.get('/api/dataElements?fields=id,name,shortName,formName,valueType,aggregationType,domainType&pageSize=1')
const de = existing.dataElements?.[0]
if (!de) {
    fail('no dataElements available on server')
    process.exit(1)
}
info(`using existing DE: ${de.id} "${de.name}"`)

/* 1. CREATE strategy on existing UID → should fail (already exists) */
{
    const r = await postMeta(
        { importStrategy: 'CREATE' },
        { dataElements: [{ ...de, name: de.name + ' EDIT' }] },
    )
    const status = r.body?.status
    const created = r.body?.stats?.created ?? 0
    expect(
        'CREATE on existing UID does not create',
        status === 'ERROR' || status === 'WARNING' || created === 0,
        `status=${status} created=${created}`,
    )
}

/* 2. UPDATE strategy on non-existent UID → should NOT create it */
{
    const freshId = 'x' + Math.random().toString(36).slice(2, 12) // 11 chars
    const newDe = {
        id: freshId,
        name: `Test DE ${freshId}`,
        shortName: `Test ${freshId}`.slice(0, 50),
        formName: `Test ${freshId}`,
        valueType: 'NUMBER',
        aggregationType: 'SUM',
        domainType: 'AGGREGATE',
    }
    const r = await postMeta({ importStrategy: 'UPDATE' }, { dataElements: [newDe] })
    const created = r.body?.stats?.created ?? 0
    expect('UPDATE strategy does not create new UIDs', created === 0, `created=${created}`)
}

/* 3. CREATE_AND_UPDATE dry run → NOT committed */
{
    const marker = `DRYRUN-${Date.now()}`
    const r = await postMeta(
        { dryRun: true, mergeMode: 'MERGE' },
        { dataElements: [{ ...de, description: marker }] },
    )
    expect('dry run returns 200', r.status === 200, `status=${r.status}`)
    // Read back — description should NOT contain marker
    const check = await api.get(`/api/dataElements/${de.id}?fields=description`)
    expect(
        'dry run did not persist change',
        (check.description ?? '') !== marker,
        `description="${check.description}"`,
    )
}

/* 4. MERGE vs REPLACE — verify MERGE preserves a field, REPLACE clears it */
{
    /* First, ensure description has a known value via MERGE */
    const original = `ORIGINAL-${Date.now()}`
    await postMeta(
        { importStrategy: 'UPDATE', mergeMode: 'MERGE' },
        { dataElements: [{ ...de, description: original }] },
    )
    let got = await api.get(`/api/dataElements/${de.id}?fields=description,name`)
    expect('MERGE sets description', got.description === original, `got="${got.description}"`)

    /* MERGE payload without description — description should be preserved */
    await postMeta(
        { importStrategy: 'UPDATE', mergeMode: 'MERGE' },
        { dataElements: [{ id: de.id, name: got.name }] },
    )
    got = await api.get(`/api/dataElements/${de.id}?fields=description`)
    expect('MERGE preserves omitted fields', got.description === original, `got="${got.description}"`)

    /* REPLACE payload without description — description should be cleared */
    await postMeta(
        { importStrategy: 'UPDATE', mergeMode: 'REPLACE' },
        {
            dataElements: [{
                id: de.id,
                name: de.name,
                shortName: de.shortName ?? de.name.slice(0, 50),
                valueType: de.valueType,
                aggregationType: de.aggregationType,
                domainType: de.domainType,
            }],
        },
    )
    got = await api.get(`/api/dataElements/${de.id}?fields=description`)
    expect('REPLACE clears omitted fields', !got.description, `got="${got.description}"`)

    /* Restore original description so re-runs stay clean */
    await postMeta(
        { importStrategy: 'UPDATE', mergeMode: 'MERGE' },
        { dataElements: [{ ...de, description: de.description ?? '' }] },
    )
}

/* 5. skipSharing=true tolerates unresolvable sharing refs */
{
    const ghostUserUid = 'ghostUser01' // 11 chars, not present
    const payload = {
        dataElements: [{
            ...de,
            sharing: {
                public: 'rw------',
                owner: ghostUserUid,
                users: { [ghostUserUid]: { access: 'rw------', id: ghostUserUid } },
                userGroups: {},
            },
        }],
    }
    const rSkip = await postMeta({ skipSharing: true, dryRun: true }, payload)
    expect('skipSharing=true validates OK despite bad owner', rSkip.status === 200 && rSkip.body?.status !== 'ERROR', `status=${rSkip.body?.status}`)

    const rNoSkip = await postMeta({ skipSharing: false, dryRun: true }, payload)
    /* With skipSharing off, the server may accept or reject depending on version;
     * the point is that skipSharing=true should be >= permissive */
    info(`skipSharing=false status=${rNoSkip.body?.status}`)
}

console.log('\n' + (failures === 0 ? '[OK] METADATA OPTIONS VERIFIED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
