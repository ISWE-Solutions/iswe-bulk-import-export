/**
 * Tests the v1.2.0+ "did you mean" diagnosis logic in validator.js.
 *
 * Covered:
 *   A. Fuzzy suggestion — near-miss option code gets a "Did you mean" hint
 *   B. Cross-column misalignment — value is valid, but for the wrong column
 *   C. Header-as-data — pasted header row surfaces a targeted message
 *   D. Unknown value with no near-miss falls back to sample list
 *
 * We drive validator.validateParsedData with synthetic parsedData that
 * mimics what fileParser.parseUploadedFile produces.
 */
import { api, section, ok, fail, info } from './api.mjs'
import { validateParsedData } from '../src/lib/validator.js'

// Fetch a program that reliably has DE optionSets on play.
// WHO RMNCH Tracker (WSGAb5XwJ3Y) has 32+ optionSet DEs across 5 stages.
const PROGRAM_ID = 'WSGAb5XwJ3Y'
const FIELDS =
    'id,displayName,programType,' +
    'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'programStages[id,displayName,repeatable,sortOrder,programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]],' +
    'organisationUnits[id,displayName]'

let failures = 0
const expect = (label, cond, detail = '') => {
    if (cond) ok(label)
    else { fail(label + (detail ? ` — ${detail}` : '')); failures++ }
}

const program = await api.get(`/api/programs/${PROGRAM_ID}?fields=${encodeURIComponent(FIELDS)}`)
const metadata = { ...program, assignedAttributes: [], assignedDataElements: [], ruleVarMap: {} }

// Find a DE with any non-trivial optionSet (>=2 options).
let targetDe = null
let targetStage = null
for (const stage of metadata.programStages ?? []) {
    for (const psde of stage.programStageDataElements ?? []) {
        const de = psde.dataElement
        if (de?.optionSet?.options?.length >= 2) {
            // Prefer one whose first option code is long enough for a meaningful typo
            const first = de.optionSet.options[0]
            const codeLen = (first.code || first.displayName || '').length
            if (codeLen >= 3) { targetDe = de; targetStage = stage; break }
            if (!targetDe) { targetDe = de; targetStage = stage }
        }
    }
    if (targetDe && (targetDe.optionSet.options[0].code || targetDe.optionSet.options[0].displayName || '').length >= 3) break
}
if (!targetDe) {
    fail('No suitable optionSet DE found in program — test cannot run')
    process.exit(2)
}

info(`target DE = ${targetDe.displayName} [${targetDe.id}] on stage ${targetStage.displayName}`)
info(`options  = ${targetDe.optionSet.options.map((o) => o.code || o.displayName).join(', ')}`)

const orgUnit = metadata.organisationUnits[0].id
const today = new Date().toISOString().slice(0, 10)
const validOption = targetDe.optionSet.options[0]
const validCode = validOption.code || validOption.displayName

function buildParsedData(stageId, deId, value) {
    return {
        trackedEntities: [{ teiId: 'tei-1', orgUnit, attributes: {} }],
        enrollments: [{
            teiId: 'tei-1', orgUnit,
            enrollmentDate: today, incidentDate: today,
        }],
        stageData: {
            [stageId]: [{
                teiId: 'tei-1', orgUnit,
                eventDate: today,
                dataValues: { [deId]: value },
                rowIndex: 2,
            }],
        },
    }
}

// ─────────────────────────────────────────────────────────────── A. fuzzy
section('A. Fuzzy "did you mean" suggestion for near-miss')
{
    // Introduce a single-char typo in the code
    const typo = validCode.slice(0, -1) + (validCode.slice(-1) === 'X' ? 'Y' : 'X')
    const parsed = buildParsedData(targetStage.id, targetDe.id, typo)
    const { errors } = validateParsedData(parsed, metadata)
    const msg = errors.find((e) => e.message?.includes(targetDe.displayName))?.message ?? ''
    info(`error message: ${msg.slice(0, 200)}`)
    expect('error was surfaced for bad value', msg.length > 0)
    expect('message contains "Did you mean"', msg.includes('Did you mean'),
        'fuzzy suggestion missing')
    expect('message references the correct valid code',
        msg.includes(validCode),
        `expected to see "${validCode}" in hint`)
}

// ─────────────────────────────────────────────────────────────── B. cross-col
section('B. Cross-column misalignment detection')
{
    // Find a SECOND DE with its own optionSet whose value won't match targetDe's
    let otherDe = null
    for (const stage of metadata.programStages ?? []) {
        for (const psde of stage.programStageDataElements ?? []) {
            const de = psde.dataElement
            if (de?.id !== targetDe.id && de?.optionSet?.options?.length) {
                // Must have at least one option not present in targetDe's options
                const targetCodes = new Set(targetDe.optionSet.options.map((o) => (o.code || o.displayName || '').toLowerCase()))
                const uniq = de.optionSet.options.find((o) =>
                    !targetCodes.has((o.code || o.displayName || '').toLowerCase()))
                if (uniq) { otherDe = de; break }
            }
        }
        if (otherDe) break
    }
    if (!otherDe) {
        info('skipped — no second-DE optionSet with disjoint values available')
    } else {
        const wrongValue = otherDe.optionSet.options[0].code || otherDe.optionSet.options[0].displayName
        const parsed = buildParsedData(targetStage.id, targetDe.id, wrongValue)
        const { errors } = validateParsedData(parsed, metadata)
        const msg = errors.find((e) => e.message?.includes(targetDe.displayName))?.message ?? ''
        info(`error message: ${msg.slice(0, 200)}`)
        expect('cross-column misalignment is detected',
            msg.includes('column misalignment') || msg.includes('IS valid for'),
            `message was: ${msg.slice(0, 160)}`)
    }
}

// ─────────────────────────────────────────────────────────────── C. header as data
section('C. Header-as-data detection')
{
    const headerValue = targetDe.displayName
    const parsed = buildParsedData(targetStage.id, targetDe.id, headerValue)
    const { errors } = validateParsedData(parsed, metadata)
    const msg = errors.find((e) => e.message?.includes(targetDe.displayName))?.message ?? ''
    info(`error message: ${msg.slice(0, 200)}`)
    // Either cross-column or header-as-data is acceptable here; our validator picks cross-column
    // first when the value is valid for another field. If headerValue isn't a valid code anywhere,
    // header-as-data fires.
    const handled = msg.includes('column header') || msg.includes('column misalignment') || msg.includes('Did you mean')
    expect('header-as-data or equivalent hint is surfaced', handled,
        `unexpected: ${msg.slice(0, 160)}`)
}

// ─────────────────────────────────────────────────────────────── D. unknown garbage
section('D. Garbage value falls back to sample list')
{
    const garbage = 'qxqxqxqxqxqx' // very unlikely to match anything via Levenshtein
    const parsed = buildParsedData(targetStage.id, targetDe.id, garbage)
    const { errors } = validateParsedData(parsed, metadata)
    const msg = errors.find((e) => e.message?.includes(targetDe.displayName))?.message ?? ''
    info(`error message: ${msg.slice(0, 200)}`)
    expect('fallback message lists "Valid options"',
        msg.includes('Valid options') || msg.includes('E1125'),
        `unexpected: ${msg.slice(0, 160)}`)
}

console.log('\n' + (failures === 0 ? '[OK] ALL VALIDATOR-SUGGESTION TESTS PASSED' : `[FAIL] ${failures} failure(s)`))
process.exit(failures === 0 ? 0 : 1)
