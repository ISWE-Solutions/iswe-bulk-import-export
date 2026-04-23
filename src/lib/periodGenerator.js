/**
 * Generate DHIS2 period codes between two calendar dates for a given periodType.
 *
 * Returns an array of period ISO strings in the order DHIS2 uses, e.g.
 * Monthly → ['202401', '202402', ...], Quarterly → ['2024Q1', '2024Q2', ...].
 *
 * Supports the commonly used types. For unsupported types an empty array is
 * returned and callers should fall back to free-text entry.
 *
 * @param {string} periodType - DHIS2 period type (e.g. 'Monthly', 'Quarterly')
 * @param {string} from - ISO date 'YYYY-MM-DD'
 * @param {string} to - ISO date 'YYYY-MM-DD'
 * @returns {string[]} Period codes
 */
export function generatePeriods(periodType, from, to) {
    if (!periodType || !from || !to) return []
    const start = new Date(from + 'T00:00:00Z')
    const end = new Date(to + 'T00:00:00Z')
    if (isNaN(start) || isNaN(end) || start > end) return []

    switch (periodType) {
        case 'Daily': return daily(start, end)
        case 'Weekly': return weekly(start, end, 1) // Monday
        case 'WeeklyWednesday': return weekly(start, end, 3)
        case 'WeeklyThursday': return weekly(start, end, 4)
        case 'WeeklySaturday': return weekly(start, end, 6)
        case 'WeeklySunday': return weekly(start, end, 0)
        case 'Monthly': return monthly(start, end)
        case 'BiMonthly': return biMonthly(start, end)
        case 'Quarterly': return quarterly(start, end)
        case 'SixMonthly': return sixMonthly(start, end)
        case 'SixMonthlyApril': return sixMonthlyApril(start, end)
        case 'Yearly': return yearly(start, end)
        case 'FinancialApril': return financialYear(start, end, 3, 'April')
        case 'FinancialJuly': return financialYear(start, end, 6, 'July')
        case 'FinancialOct': return financialYear(start, end, 9, 'Oct')
        case 'FinancialNov': return financialYear(start, end, 10, 'Nov')
        default: return []
    }
}

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`

function daily(start, end) {
    const out = []
    const d = new Date(start)
    while (d <= end) {
        out.push(ymd(d))
        d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
}

function monthly(start, end) {
    const out = []
    let y = start.getUTCFullYear()
    let m = start.getUTCMonth()
    const ey = end.getUTCFullYear()
    const em = end.getUTCMonth()
    while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}${pad(m + 1)}`)
        m++
        if (m > 11) { m = 0; y++ }
    }
    return out
}

function biMonthly(start, end) {
    const out = []
    let y = start.getUTCFullYear()
    let biStart = Math.floor(start.getUTCMonth() / 2) * 2 // 0, 2, 4, 6, 8, 10
    const ey = end.getUTCFullYear()
    const eBiStart = Math.floor(end.getUTCMonth() / 2) * 2
    while (y < ey || (y === ey && biStart <= eBiStart)) {
        const idx = biStart / 2 + 1 // 1..6
        out.push(`${y}${pad(biStart + 1)}B`)
        biStart += 2
        if (biStart > 10) { biStart = 0; y++ }
        void idx // idx kept for clarity; code format is YYYYMMB where MM is first month
    }
    return out
}

function quarterly(start, end) {
    const out = []
    let y = start.getUTCFullYear()
    let q = Math.floor(start.getUTCMonth() / 3) + 1
    const ey = end.getUTCFullYear()
    const eq = Math.floor(end.getUTCMonth() / 3) + 1
    while (y < ey || (y === ey && q <= eq)) {
        out.push(`${y}Q${q}`)
        q++
        if (q > 4) { q = 1; y++ }
    }
    return out
}

function sixMonthly(start, end) {
    const out = []
    let y = start.getUTCFullYear()
    let h = start.getUTCMonth() < 6 ? 1 : 2
    const ey = end.getUTCFullYear()
    const eh = end.getUTCMonth() < 6 ? 1 : 2
    while (y < ey || (y === ey && h <= eh)) {
        out.push(`${y}S${h}`)
        h++
        if (h > 2) { h = 1; y++ }
    }
    return out
}

function sixMonthlyApril(start, end) {
    // Periods: YYYYAprilS1 (Apr–Sep), YYYYAprilS2 (Oct–Mar next year)
    const out = []
    const periodOf = (d) => {
        const m = d.getUTCMonth()
        const y = d.getUTCFullYear()
        if (m >= 3 && m <= 8) return { y, h: 1 }
        if (m >= 9) return { y, h: 2 }
        return { y: y - 1, h: 2 } // Jan–Mar belongs to previous year's S2
    }
    let p = periodOf(start)
    const ep = periodOf(end)
    while (p.y < ep.y || (p.y === ep.y && p.h <= ep.h)) {
        out.push(`${p.y}AprilS${p.h}`)
        p.h++
        if (p.h > 2) { p.h = 1; p.y++ }
    }
    return out
}

function yearly(start, end) {
    const out = []
    for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
        out.push(String(y))
    }
    return out
}

function financialYear(start, end, startMonth, label) {
    // e.g. FinancialApril period 2024April = Apr 2024 – Mar 2025
    const out = []
    const periodOf = (d) => {
        const m = d.getUTCMonth()
        const y = d.getUTCFullYear()
        return m >= startMonth ? y : y - 1
    }
    const startY = periodOf(start)
    const endY = periodOf(end)
    for (let y = startY; y <= endY; y++) out.push(`${y}${label}`)
    return out
}

function weekly(start, end, firstDayOfWeek) {
    // DHIS2 ISO weeks: YYYYWN (1..52/53). Use ISO 8601 for 'Weekly' (Monday start).
    // For other Weekly* variants, shift the week start accordingly.
    const out = []
    // Align `start` to the beginning of its week
    const d = new Date(start)
    const dow = d.getUTCDay()
    const shift = (dow - firstDayOfWeek + 7) % 7
    d.setUTCDate(d.getUTCDate() - shift)
    while (d <= end) {
        const [y, w] = isoWeek(d, firstDayOfWeek)
        out.push(`${y}W${w}`)
        d.setUTCDate(d.getUTCDate() + 7)
    }
    // Dedupe (edge case near year boundary)
    return [...new Set(out)]
}

function isoWeek(date, firstDayOfWeek) {
    // Compute a week number relative to the given first day of week.
    // Thursday of the current week lies in the ISO year for Monday-start weeks;
    // for other starts we approximate by using the mid-week day's year.
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    // Shift so that 'firstDayOfWeek' becomes 0
    const dayNum = (d.getUTCDay() - firstDayOfWeek + 7) % 7
    // Anchor = mid-week day (3 days after week start)
    d.setUTCDate(d.getUTCDate() - dayNum + 3)
    const year = d.getUTCFullYear()
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
    return [year, String(week).padStart(2, '0')]
}
