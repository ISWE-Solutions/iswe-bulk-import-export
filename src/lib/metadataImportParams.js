/**
 * Build the query-string params sent to POST /api/metadata.
 *
 * Kept as a pure function (no React) so it can be unit-tested in isolation
 * and shared by the MetadataImportFlow component.
 *
 * Options:
 *  - importStrategy: 'CREATE_AND_UPDATE' | 'CREATE' | 'UPDATE'
 *  - mergeMode:      'MERGE' | 'REPLACE'
 *  - identifier:     'AUTO' | 'UID' | 'CODE' — how DHIS2 matches incoming
 *                    records to existing ones. AUTO matches by UID first and
 *                    falls back to code, which avoids DB unique-constraint
 *                    violations on re-import when the same record exists
 *                    under a different UID on the target server.
 *  - skipSharing:    boolean — when true DHIS2 ignores sharing fields in the
 *                    payload. Essential for re-importing full-metadata exports
 *                    when the current user lacks the original sharing refs.
 *  - dryRun:         boolean — when true DHIS2 validates only and does not commit
 *                    (importMode=VALIDATE).
 */
export const buildMetadataParams = (opts = {}) => {
    const {
        importStrategy = 'CREATE_AND_UPDATE',
        mergeMode = 'MERGE',
        identifier = 'AUTO',
        skipSharing = true,
        dryRun = false,
    } = opts
    const p = {
        importStrategy,
        atomicMode: 'NONE',
        mergeMode,
        identifier,
    }
    if (skipSharing) p.skipSharing = 'true'
    if (dryRun) p.importMode = 'VALIDATE'
    return p
}

/**
 * Serialize params to a URL query string (stable key order).
 */
export const paramsToQuery = (params) =>
    Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
