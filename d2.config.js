const config = {
    type: 'app',
    name: 'ISWE Bulk Import/Export',
    title: 'ISWE Bulk Import/Export',
    description: "ISWE Bulk Import/Export is a browser-based DHIS2 app that makes it easy to move large volumes of data in and out of DHIS2 using Excel, JSON, and GeoJSON files. It supports tracker enrollments and events (including repeatable program stages), event-program data, aggregate data values, metadata, and organisation-unit geometry.\n\nA key feature of the app is automatic Excel template generation and field mapping. Templates are generated directly from the live DHIS2 program configuration, so Excel columns are mapped to the correct program attributes, data elements, option sets, organisation units, periods, and identifiers automatically. Users do not need to manually match spreadsheet columns to DHIS2 fields — reducing setup time and eliminating common import errors.\n\nGenerated templates also include built-in validation rules and dropdown lists. Wherever DHIS2 uses option sets, organisation units, or other controlled values, the template provides selectable dropdowns directly in Excel. This helps users enter valid values from the start, improves data quality, and reduces rejected records during upload.\n\nThe app lets users complete templates offline, upload them back into DHIS2, preview the results, and submit validated data without manual file transformation. Exported files are designed for round-trip editing: export data, update it in Excel or JSON, and re-import it through the same workflow.\n\nISWE Bulk Import/Export follows a simple guided wizard: select the data type, download or generate a template, complete the file, upload it, preview validation results, and submit. Before anything reaches the server, the app validates the upload in the browser against your live DHIS2 configuration — catching missing mandatory fields, invalid value types, incorrect option codes, unknown organisation units, duplicate UIDs, date and period format errors, template column changes, and repeatable-stage rule violations.\n\nThe app also includes smart DHIS2-aware validation, fuzzy option-code suggestions, cascade-error suppression for tracker imports, GeoJSON matching for organisation-unit geometry, flexible metadata import options, and resilient batching for large uploads. It runs inside the user's DHIS2 session, stores no credentials, and does not send data outside the DHIS2 instance.\n\nBuilt for data managers, DHIS2 implementers, migration teams, and organisations that regularly need to import, export, clean, migrate, or update thousands of DHIS2 records safely and efficiently.",
    author: 'ISWE Solution',
    minDHIS2Version: '2.40',

    entryPoints: {
        app: './src/App.jsx',
    },
}

module.exports = config
