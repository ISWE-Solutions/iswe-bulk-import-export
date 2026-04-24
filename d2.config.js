const config = {
    type: 'app',
    name: 'ISWE Bulk Import/Export',
    title: 'ISWE Bulk Import/Export',
    description: 'ISWE Bulk Import/Export is a DHIS2 app for moving large amounts of data in and out of your instance using Excel, JSON, and GeoJSON files.\n\nUse it to import tracker enrollments and events (including repeatable stages), event program data, aggregate data values, metadata (org units, data elements, indicators, option sets, and more), and org-unit geometry from GeoJSON. Use the same app to export any of these back out as ready-to-edit Excel workbooks or JSON.\n\nA guided wizard walks users through each import, and smart client-side validation checks the file against your DHIS2 configuration before anything is sent to the server — so problems are caught and fixed in the browser instead of appearing as cryptic errors after upload. Works on DHIS2 2.40, 2.41, and 2.42+, runs entirely inside your DHIS2 instance, and stores no credentials or data outside the server.',
    author: 'ISWE Solution',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
