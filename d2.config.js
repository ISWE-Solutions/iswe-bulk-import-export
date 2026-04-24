const config = {
    type: 'app',
    name: 'ISWE Bulk Import/Export',
    title: 'ISWE Bulk Import/Export',
    description: 'The only DHIS2 bulk import/export app with smart client-side validation, repeatable tracker event support, and GeoJSON org-unit geometry matching. Catches 25+ DHIS2 error codes (E1007, E1019, E1064, E5000…) with actionable hints before submission, suppresses cascade noise, and suggests fuzzy option-set fixes so users see the real problem on the right row. Round-trip Excel templates for tracker (with repeatable program stages), events, aggregate data values, and every common metadata type. Native JSON metadata import exposes full DHIS2 options (skipSharing, mergeMode, importStrategy, atomicMode). Batched uploads with auto-retry handle payloads that would otherwise hit HTTP 414/5xx. Template column-drift detection catches broken spreadsheets before upload. Round-trip Excel exports can be re-imported without transformation. Works on DHIS2 2.40, 2.41 and 2.42+, handles both legacy and new tracker query-param shapes, runs entirely inside the current DHIS2 instance with no external services and no stored credentials.',
    author: 'ISWE Solution',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
