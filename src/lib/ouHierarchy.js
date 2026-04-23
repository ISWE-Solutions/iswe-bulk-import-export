/**
 * Fetch organisation unit hierarchy (level + ancestor chain) for a set of OU UIDs.
 *
 * Used by the data exporters to add human-readable hierarchy columns
 * (Country → Province → District → Facility) and optional UID columns to
 * every exported row regardless of data type (tracker, event, aggregate).
 *
 * The DHIS2 `ancestors` field returns the full chain sorted by level. We
 * collapse self + ancestors into a per-level map so each row can safely
 * fill in an OU's name at any level up to `maxLevel`.
 */

const CHUNK = 200

/**
 * @param {object} engine - @dhis2/app-runtime data engine
 * @param {string[]} ouIds - OU UIDs to resolve
 * @returns {Promise<{ map: Record<string, { id, name, level, levelNames: string[] }>, maxLevel: number }>}
 */
export async function fetchOUHierarchy(engine, ouIds) {
    const unique = [...new Set((ouIds ?? []).filter(Boolean))]
    const map = {}
    let maxLevel = 0
    if (unique.length === 0) return { map, maxLevel }

    for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK)
        const result = await engine.query({
            ous: {
                resource: 'organisationUnits',
                params: {
                    filter: `id:in:[${chunk.join(',')}]`,
                    fields: 'id,displayName,level,ancestors[id,displayName,level]',
                    paging: false,
                },
            },
        })
        const rows = result?.ous?.organisationUnits ?? []
        for (const ou of rows) {
            const levelNames = []
            for (const a of ou.ancestors ?? []) {
                if (a.level && a.displayName) levelNames[a.level - 1] = a.displayName
            }
            if (ou.level && ou.displayName) levelNames[ou.level - 1] = ou.displayName
            map[ou.id] = {
                id: ou.id,
                name: ou.displayName,
                level: ou.level ?? 0,
                levelNames,
            }
            if ((ou.level ?? 0) > maxLevel) maxLevel = ou.level
        }
    }
    return { map, maxLevel }
}

/**
 * Column header names for the OU section of a sheet. Order is fixed so
 * builders can rely on it when computing downstream column indices:
 *   [ORG_UNIT_ID] [ORG_UNIT_UID?] [OU_L1 .. OU_Lmax?]
 *
 * ORG_UNIT_ID (name) is always included so round-trip imports keep working.
 */
export function buildOUHeaders({ includeUids = false, includeHierarchy = true } = {}, maxLevel = 0) {
    const cols = ['ORG_UNIT_ID']
    if (includeUids) cols.push('ORG_UNIT_UID')
    if (includeHierarchy && maxLevel > 0) {
        for (let l = 1; l <= maxLevel; l++) cols.push(`OU_L${l}`)
    }
    return cols
}

/**
 * Number of OU columns that buildOUHeaders will emit for given options.
 */
export function ouColCount(opts = {}, maxLevel = 0) {
    return buildOUHeaders(opts, maxLevel).length
}

/**
 * Produce the OU-section cells for a single row. Matches header order.
 */
export function buildOURowCells(ouId, { includeUids = false, includeHierarchy = true } = {}, hierarchyMap = {}, maxLevel = 0) {
    const info = hierarchyMap[ouId]
    const cells = [info?.name ?? ouId ?? '']
    if (includeUids) cells.push(ouId ?? '')
    if (includeHierarchy && maxLevel > 0) {
        for (let l = 1; l <= maxLevel; l++) {
            cells.push(info?.levelNames?.[l - 1] ?? '')
        }
    }
    return cells
}

/**
 * Convenience — scan a dataset and collect every OU UID mentioned so
 * callers can pass them directly to `fetchOUHierarchy`.
 */
export function collectOUIds({ trackedEntities, eventsMap, dataValues } = {}) {
    const ids = new Set()
    if (Array.isArray(trackedEntities)) {
        for (const t of trackedEntities) {
            if (t.orgUnit) ids.add(t.orgUnit)
            for (const e of t.enrollments ?? []) {
                if (e.orgUnit) ids.add(e.orgUnit)
                for (const ev of e.events ?? []) {
                    if (ev.orgUnit) ids.add(ev.orgUnit)
                }
            }
        }
    }
    if (eventsMap && typeof eventsMap === 'object') {
        for (const arr of Object.values(eventsMap)) {
            for (const ev of arr ?? []) if (ev.orgUnit) ids.add(ev.orgUnit)
        }
    }
    if (Array.isArray(dataValues)) {
        for (const dv of dataValues) if (dv.orgUnit) ids.add(dv.orgUnit)
    }
    return [...ids]
}
