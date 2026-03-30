const config = {
    type: 'app',
    name: 'Bulk Import & Export',
    title: 'Bulk Import & Export',
    description: 'Import and export tracker, event, and aggregate data between DHIS2 and Excel',
    author: 'ISWE Consulting',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
