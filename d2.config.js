const config = {
    type: 'app',
    name: 'ISWE Bulk Import/Export',
    title: 'ISWE Bulk Import/Export',
    description: 'Browser-based bulk import and export for DHIS2 tracker, event, aggregate, and metadata records. Supports Excel templates with built-in validation and option-set dropdowns, native JSON metadata imports, repeatable tracker event imports, large-file batch processing, and export workflows for editing, migration, backup, and data sharing. Works on DHIS2 2.40+ and runs entirely inside the current DHIS2 instance with no external services.',
    author: 'ISWE Solution',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
