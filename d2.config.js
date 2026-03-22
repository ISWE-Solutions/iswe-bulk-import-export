const config = {
    type: 'app',
    name: 'Tracker Bulk Import',
    title: 'Tracker Bulk Import',
    description: 'Bulk import tracker data with repeatable event support',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
