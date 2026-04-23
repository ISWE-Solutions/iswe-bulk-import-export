/**
 * Unit-style tests for detectColumnDrift (lib/fileParser.js).
 *
 * Exercises the four cases:
 *   1. Fresh template — zero drift
 *   2. Unknown column — header carries a UID no longer in metadata (renamed/removed)
 *   3. Missing field — new attribute/DE added to program after template was generated
 *   4. System columns (TEI_ID, ORG_UNIT_ID, etc.) don't count as drift
 *   5. Validation/Instructions sheets are skipped
 */
import * as XLSX from 'xlsx'
import { api, section, ok, fail } from './api.mjs'
import { generateTemplate } from '../src/lib/templateGenerator.js'
import { detectColumnDrift } from '../src/lib/fileParser.js'

const PROGRAM_ID = 'IpHINAT79UW'
const FIELDS =
    'id,displayName,programType,' +
    'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'programStages[id,displayName,repeatable,sortOrder,programStageSections[id,displayName,dataElements[id]],programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'organisationUnits[id,displayName,path]'

let failures = 0
const expect = (label, cond, detail = '') => {
    if (cond) ok(label)
    else { fail(label + (detail ? ` — ${detail}` : '')); failures++ }
}

const program = await api.get(`/api/programs/${PROGRAM_ID}?fields=${encodeURIComponent(FIELDS)}`)
const metadata = { ...program, assignedAttributes: [], assignedDataElements: [], ruleVarMap: {} }

// ─────────────────────────────────────────────────────────────── 1. fresh
section('1. Fresh template — no drift expected')
{
    const wb = generateTemplate(program, metadata)
    const drift = detectColumnDrift(wb, metadata)
    expect('unknownColumns is empty for fresh template',
        drift.unknownColumns.length === 0,
        `got ${JSON.stringify(drift.unknownColumns.slice(0, 3))}`)
    expect('missingFields is empty for fresh template',
        drift.missingFields.length === 0,
        `got ${JSON.stringify(drift.missingFields.slice(0, 3))}`)
}

// ─────────────────────────────────────────────────────────────── 2. unknown
section('2. Header carries UID no longer in metadata')
{
    const wb = generateTemplate(program, metadata)
    // Mutate an existing header cell directly so the injection survives
    // whatever styling/range metadata the template generator added.
    const fakeUid = 'ZzZzZzZzZz1'
    const teiSheet = wb.Sheets['TEI + Enrollment']
    const range = XLSX.utils.decode_range(teiSheet['!ref'])
    // Write a new header into the column immediately after the last existing one
    const newCol = range.e.c + 1
    const addr = XLSX.utils.encode_cell({ r: 0, c: newCol })
    teiSheet[addr] = { t: 's', v: `Removed Attribute [${fakeUid}]` }
    range.e.c = newCol
    teiSheet['!ref'] = XLSX.utils.encode_range(range)

    const drift = detectColumnDrift(wb, metadata)
    const found = drift.unknownColumns.find((c) => c.uid === fakeUid)
    expect('unknownColumns contains the injected UID', !!found,
        `got ${JSON.stringify(drift.unknownColumns)}`)
    expect('unknown column reports correct sheet', found?.sheet === 'TEI + Enrollment')
}

// ─────────────────────────────────────────────────────────────── 3. missing
section('3. Metadata field absent from template')
{
    const wb = generateTemplate(program, metadata)

    // Clone metadata and add a new synthetic attribute that isn't in the template
    const synthAttr = { id: 'SYNTH_ATTR1', displayName: 'Newly added attribute' }
    const extendedMeta = {
        ...metadata,
        trackedEntityType: {
            ...metadata.trackedEntityType,
            trackedEntityTypeAttributes: [
                ...(metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []),
                { trackedEntityAttribute: synthAttr, mandatory: false },
            ],
        },
    }

    const drift = detectColumnDrift(wb, extendedMeta)
    const found = drift.missingFields.find((m) => m.uid === 'SYNTH_ATTR1')
    expect('missingFields contains the new metadata attribute', !!found,
        `got ${JSON.stringify(drift.missingFields.slice(0, 5))}`)
    expect('missing field carries displayName', found?.displayName === 'Newly added attribute')
}

// ─────────────────────────────────────────────────────────────── 4. system cols
section('4. System columns are not flagged as drift')
{
    const wb = generateTemplate(program, metadata)
    const drift = detectColumnDrift(wb, metadata)
    const systemHits = drift.unknownColumns.filter(
        (c) => ['TEI_ID', 'ORG_UNIT_ID', 'ENROLLMENT_DATE', 'INCIDENT_DATE', 'EVENT_DATE'].includes(c.header)
    )
    expect('no system columns appear in unknownColumns', systemHits.length === 0,
        `got ${JSON.stringify(systemHits)}`)
}

// ─────────────────────────────────────────────────────────────── 5. validation sheet
section('5. Validation + Instructions sheets are skipped')
{
    const wb = generateTemplate(program, metadata)
    // Inject a fake UID into the Validation sheet — must NOT surface as drift
    if (wb.Sheets['Validation']) {
        const val = wb.Sheets['Validation']
        const range = XLSX.utils.decode_range(val['!ref'] || 'A1:A1')
        const newCol = range.e.c + 1
        const addr = XLSX.utils.encode_cell({ r: 0, c: newCol })
        val[addr] = { t: 's', v: 'Should Not Surface [ZzZzZzZzZz2]' }
        range.e.c = newCol
        val['!ref'] = XLSX.utils.encode_range(range)
    }
    const drift = detectColumnDrift(wb, metadata)
    const sneaky = drift.unknownColumns.find((c) => c.uid === 'ZzZzZzZzZz2')
    expect('Validation sheet contents are ignored', !sneaky,
        `got ${JSON.stringify(sneaky)}`)
}

// ─────────────────────────────────────────────────────────────── 6. defensive
section('6. Null/empty inputs are handled safely')
{
    const empty = detectColumnDrift(null, metadata)
    expect('null workbook returns empty result',
        Array.isArray(empty.unknownColumns) && empty.unknownColumns.length === 0)
    const empty2 = detectColumnDrift({ SheetNames: [], Sheets: {} }, null)
    expect('null metadata returns empty result',
        Array.isArray(empty2.unknownColumns) && empty2.unknownColumns.length === 0)
}

console.log('\n' + (failures === 0 ? '[OK] ALL COLUMN-DRIFT TESTS PASSED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
