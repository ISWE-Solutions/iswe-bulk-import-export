/**
 * Orchestrator: run every test harness and print a grand total.
 *
 * Usage:
 *   node test-harness/run-all.mjs               # all
 *   node test-harness/run-all.mjs 12 13         # filter by numeric prefix(es)
 *
 * Each harness is bundled + executed via bundle-run.mjs. We capture stdout,
 * tally [OK] / [FAIL] lines, and print a per-file + overall summary.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('test-harness')
const filter = process.argv.slice(2)

const all = fs.readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.mjs$/.test(f))
    .sort()

const pick = filter.length === 0
    ? all
    : all.filter((f) => filter.some((p) => f.startsWith(p)))

if (pick.length === 0) {
    console.error('No matching test files.')
    process.exit(2)
}

const results = []
for (const name of pick) {
    process.stdout.write(`\n▶ ${name}\n`)
    const abs = path.join(dir, name)
    const t0 = Date.now()
    const r = spawnSync(process.execPath, ['test-harness/bundle-run.mjs', abs], {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
    })
    const dur = Date.now() - t0
    const out = (r.stdout || '') + (r.stderr || '')
    const okCount = (out.match(/\[OK\]/g) || []).length
    const failCount = (out.match(/\[FAIL\]/g) || []).length
    const warnCount = (out.match(/\[WARN\]/g) || []).length
    const passed = r.status === 0 && failCount === 0
    // Keep per-file output compact for the run-all view
    const tailLines = out.split('\n').filter((l) =>
        /^\[|=== |ALL |expected|failure|error/i.test(l)
    ).slice(-20)
    for (const l of tailLines) console.log('  ' + l)
    results.push({ name, passed, ok: okCount, fail: failCount, warn: warnCount, ms: dur, exit: r.status })
    console.log(`  → ${passed ? 'PASS' : 'FAIL'} (ok=${okCount} fail=${failCount} warn=${warnCount} ${dur}ms)`)
}

console.log('\n══════════════════════════════════ SUMMARY ══════════════════════════════════')
console.log('File'.padEnd(40), 'Status'.padEnd(8), 'OK'.padEnd(5), 'FAIL'.padEnd(5), 'WARN'.padEnd(6), 'ms')
for (const r of results) {
    console.log(
        r.name.padEnd(40),
        (r.passed ? 'PASS' : 'FAIL').padEnd(8),
        String(r.ok).padEnd(5),
        String(r.fail).padEnd(5),
        String(r.warn).padEnd(6),
        String(r.ms),
    )
}
const passedCount = results.filter((r) => r.passed).length
const totalFail = results.reduce((s, r) => s + r.fail, 0)
const totalOk = results.reduce((s, r) => s + r.ok, 0)
console.log(`\nTotals: ${passedCount}/${results.length} files passed — ${totalOk} OK / ${totalFail} FAIL assertions`)
process.exit(passedCount === results.length ? 0 : 1)
