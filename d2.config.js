const config = {
    type: 'app',
    name: 'ISWE Bulk Import/Export',
    title: 'ISWE Bulk Import/Export',
    description: "ISWE Bulk Import/Export is a DHIS2 app for moving large amounts of data in and out of your instance using Excel, JSON, and GeoJSON files.\n\nUse it to import tracker enrollments and events (including repeatable program stages), event-program data, aggregate data values, metadata (org units, data elements, indicators, option sets, and more), and org-unit geometry from GeoJSON. Use the same app to export any of these back out as ready-to-edit Excel workbooks or JSON, then re-import the same file without any transformation.\n\nEvery flow follows the same five-step wizard — select, download template, fill in, upload, preview & submit — and every upload is checked in the browser against your live DHIS2 configuration before anything reaches the server. Smart client-side validation recognises common DHIS2 server errors (wrong value types, mistyped option codes, missing mandatory fields, unknown org units, duplicate UIDs, date/period format issues, and more) and shows an actionable hint next to each row, so users fix problems in the spreadsheet instead of chasing cryptic server responses after upload.\n\nBuilt for data managers, implementers, and migration teams who regularly move thousands of records at a time. Compatible with DHIS2 2.40, 2.41, and 2.42+. Runs entirely inside your DHIS2 instance under the logged-in user's session, with no external services, no stored credentials, and no data leaving the server.",
    author: 'ISWE Solution',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
