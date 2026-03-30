import React from 'react'
import { Button } from '@dhis2/ui'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

// --- Section colors ---
const C = {
    ou: { c: '#0277BD', bg: '#E1F5FE', hex: '0277BD' },
    de: { c: '#2E7D32', bg: '#E8F5E9', hex: '2E7D32' },
    ind: { c: '#6A1B9A', bg: '#F3E5F5', hex: '6A1B9A' },
    os: { c: '#E65100', bg: '#FFF3E0', hex: 'E65100' },
    cat: { c: '#00695C', bg: '#E0F2F1', hex: '00695C' },
    te: { c: '#4527A0', bg: '#EDE7F6', hex: '4527A0' },
    geo: { c: '#00838F', bg: '#E0F7FA', hex: '00838F' },
    all: { c: '#37474F', bg: '#ECEFF1', hex: '37474F' },
}

/**
 * Metadata sub-types available for import/export.
 * Each defines the DHIS2 API resource, columns for template, and query fields.
 */
export const METADATA_TYPES = [
    // ── Organisation ──
    {
        key: 'organisationUnits',
        label: 'Organisation Units',
        section: 'Organisation',
        desc: 'Org unit hierarchy with parent, level, and coordinates.',
        color: C.ou.c, bg: C.ou.bg,
        icon: iconTree(C.ou.c, C.ou.bg),
        resource: 'organisationUnits',
        fields: 'id,name,shortName,code,parent[id,name],level,openingDate,closedDate,geometry,phoneNumber,address,contactPerson,description',
        columns: [
            { key: 'id', label: 'ID', desc: 'Leave blank for new org units' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'parent.id', label: 'Parent ID', desc: 'UID of parent org unit (or leave blank and use Parent Name)' },
            { key: 'parent.name', label: 'Parent Name', desc: 'Name of parent — resolved via reference sheet' },
            { key: 'level', label: 'Level', readOnly: true },
            { key: 'hierarchyPath', label: 'Hierarchy Path', readOnly: true, desc: 'Full path from root' },
            { key: 'openingDate', label: 'Opening Date * (YYYY-MM-DD)', required: true },
            { key: 'closedDate', label: 'Closed Date (YYYY-MM-DD)' },
            { key: 'geometry', label: 'Coordinates (lng,lat)' },
            { key: 'phoneNumber', label: 'Phone Number' },
            { key: 'address', label: 'Address' },
            { key: 'contactPerson', label: 'Contact Person' },
            { key: 'description', label: 'Description' },
        ],
    },
    {
        key: 'organisationUnitGroups',
        label: 'Org Unit Groups',
        section: 'Organisation',
        desc: 'Group org units (e.g. Hospitals, Clinics).',
        color: C.ou.c, bg: C.ou.bg,
        icon: iconGroup(C.ou.c, C.ou.bg),
        resource: 'organisationUnitGroups',
        fields: 'id,name,shortName,code,organisationUnits[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
        ],
        memberConfig: {
            property: 'organisationUnits',
            sheetName: 'OUG Members',
            columns: [
                { key: 'group.id', label: 'Group ID *', required: true },
                { key: 'group.name', label: 'Group Name', readOnly: true },
                { key: 'id', label: 'Org Unit ID *', required: true },
                { key: 'name', label: 'Org Unit Name', readOnly: true },
            ],
        },
    },
    {
        key: 'organisationUnitGroupSets',
        label: 'Org Unit Group Sets',
        section: 'Organisation',
        desc: 'Group the groups (e.g. Facility Type, Ownership).',
        color: C.ou.c, bg: C.ou.bg,
        icon: iconGroupSet(C.ou.c, C.ou.bg),
        resource: 'organisationUnitGroupSets',
        fields: 'id,name,shortName,code,description,compulsory,dataDimension,organisationUnitGroups[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name' },
            { key: 'code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'compulsory', label: 'Compulsory', desc: 'TRUE or FALSE' },
            { key: 'dataDimension', label: 'Data Dimension', desc: 'TRUE or FALSE' },
        ],
        memberConfig: {
            property: 'organisationUnitGroups',
            sheetName: 'OUGS Members',
            columns: [
                { key: 'group.id', label: 'Group Set ID *', required: true },
                { key: 'group.name', label: 'Group Set Name', readOnly: true },
                { key: 'id', label: 'OU Group ID *', required: true },
                { key: 'name', label: 'OU Group Name', readOnly: true },
            ],
        },
    },

    // ── Data Elements ──
    {
        key: 'dataElements',
        label: 'Data Elements',
        section: 'Data Elements',
        desc: 'Data elements with value type, aggregation, and domain.',
        color: C.de.c, bg: C.de.bg,
        icon: iconList(C.de.c, C.de.bg),
        resource: 'dataElements',
        fields: 'id,name,shortName,code,description,valueType,domainType,aggregationType,categoryCombo[id,name],zeroIsSignificant',
        columns: [
            { key: 'id', label: 'ID', desc: 'Leave blank for new' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'valueType', label: 'Value Type *', required: true, desc: 'TEXT, NUMBER, INTEGER, BOOLEAN, DATE, etc.' },
            { key: 'domainType', label: 'Domain Type *', required: true, desc: 'AGGREGATE or TRACKER' },
            { key: 'aggregationType', label: 'Aggregation Type *', required: true, desc: 'SUM, AVERAGE, COUNT, NONE, etc.' },
            { key: 'categoryCombo.id', label: 'Category Combo ID' },
            { key: 'categoryCombo.name', label: 'Category Combo Name', readOnly: true },
            { key: 'zeroIsSignificant', label: 'Zero Is Significant', desc: 'TRUE or FALSE' },
        ],
    },
    {
        key: 'dataElementGroups',
        label: 'Data Element Groups',
        section: 'Data Elements',
        desc: 'Group data elements for analysis.',
        color: C.de.c, bg: C.de.bg,
        icon: iconGroup(C.de.c, C.de.bg),
        resource: 'dataElementGroups',
        fields: 'id,name,shortName,code,dataElements[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
        ],
        memberConfig: {
            property: 'dataElements',
            sheetName: 'DEG Members',
            columns: [
                { key: 'group.id', label: 'Group ID *', required: true },
                { key: 'group.name', label: 'Group Name', readOnly: true },
                { key: 'id', label: 'Data Element ID *', required: true },
                { key: 'name', label: 'Data Element Name', readOnly: true },
            ],
        },
    },
    {
        key: 'dataElementGroupSets',
        label: 'DE Group Sets',
        section: 'Data Elements',
        desc: 'Group the data element groups.',
        color: C.de.c, bg: C.de.bg,
        icon: iconGroupSet(C.de.c, C.de.bg),
        resource: 'dataElementGroupSets',
        fields: 'id,name,shortName,code,description,compulsory,dataDimension,dataElementGroups[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name' },
            { key: 'code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'compulsory', label: 'Compulsory', desc: 'TRUE or FALSE' },
            { key: 'dataDimension', label: 'Data Dimension', desc: 'TRUE or FALSE' },
        ],
        memberConfig: {
            property: 'dataElementGroups',
            sheetName: 'DEGS Members',
            columns: [
                { key: 'group.id', label: 'Group Set ID *', required: true },
                { key: 'group.name', label: 'Group Set Name', readOnly: true },
                { key: 'id', label: 'DE Group ID *', required: true },
                { key: 'name', label: 'DE Group Name', readOnly: true },
            ],
        },
    },

    // ── Indicators ──
    {
        key: 'indicatorTypes',
        label: 'Indicator Types',
        section: 'Indicators',
        desc: 'Number vs percentage indicator types.',
        color: C.ind.c, bg: C.ind.bg,
        icon: iconTag(C.ind.c, C.ind.bg),
        resource: 'indicatorTypes',
        fields: 'id,name,number,factor',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'number', label: 'Number', desc: 'TRUE = number, FALSE = percentage' },
            { key: 'factor', label: 'Factor', desc: '1 for number, 100 for percentage' },
        ],
    },
    {
        key: 'indicators',
        label: 'Indicators',
        section: 'Indicators',
        desc: 'Indicators with numerator, denominator, and type.',
        color: C.ind.c, bg: C.ind.bg,
        icon: iconChart(C.ind.c, C.ind.bg),
        resource: 'indicators',
        fields: 'id,name,shortName,code,description,indicatorType[id,name],numerator,numeratorDescription,denominator,denominatorDescription,annualized',
        columns: [
            { key: 'id', label: 'ID', desc: 'Leave blank for new' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'indicatorType.id', label: 'Indicator Type ID *', required: true },
            { key: 'indicatorType.name', label: 'Indicator Type Name', readOnly: true },
            { key: 'numerator', label: 'Numerator *', required: true },
            { key: 'numeratorDescription', label: 'Numerator Description' },
            { key: 'denominator', label: 'Denominator *', required: true },
            { key: 'denominatorDescription', label: 'Denominator Description' },
            { key: 'annualized', label: 'Annualized', desc: 'TRUE or FALSE' },
        ],
    },
    {
        key: 'indicatorGroups',
        label: 'Indicator Groups',
        section: 'Indicators',
        desc: 'Group indicators for analysis.',
        color: C.ind.c, bg: C.ind.bg,
        icon: iconGroup(C.ind.c, C.ind.bg),
        resource: 'indicatorGroups',
        fields: 'id,name,indicators[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
        ],
        memberConfig: {
            property: 'indicators',
            sheetName: 'IndG Members',
            columns: [
                { key: 'group.id', label: 'Group ID *', required: true },
                { key: 'group.name', label: 'Group Name', readOnly: true },
                { key: 'id', label: 'Indicator ID *', required: true },
                { key: 'name', label: 'Indicator Name', readOnly: true },
            ],
        },
    },

    // ── Option Sets ──
    {
        key: 'optionSets',
        label: 'Option Sets',
        section: 'Options',
        desc: 'Option sets with their options (two sheets).',
        color: C.os.c, bg: C.os.bg,
        icon: iconChecklist(C.os.c, C.os.bg),
        resource: 'optionSets',
        fields: 'id,name,code,valueType,options[id,name,code,sortOrder]',
        columns: [
            { key: 'id', label: 'ID', desc: 'Leave blank for new' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'valueType', label: 'Value Type *', required: true, desc: 'TEXT, INTEGER, etc.' },
        ],
        optionColumns: [
            { key: 'optionSet.id', label: 'Option Set ID *', required: true },
            { key: 'optionSet.name', label: 'Option Set Name', readOnly: true },
            { key: 'id', label: 'Option ID', desc: 'Leave blank for new' },
            { key: 'name', label: 'Option Name *', required: true },
            { key: 'code', label: 'Option Code *', required: true },
            { key: 'sortOrder', label: 'Sort Order' },
        ],
    },

    // ── Categories ──
    {
        key: 'categoryOptions',
        label: 'Category Options',
        section: 'Categories',
        desc: 'Individual disaggregation values (e.g. Male, Female, <5).',
        color: C.cat.c, bg: C.cat.bg,
        icon: iconTag(C.cat.c, C.cat.bg),
        resource: 'categoryOptions',
        fields: 'id,name,shortName,code',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name' },
            { key: 'code', label: 'Code' },
        ],
    },
    {
        key: 'categories',
        label: 'Categories',
        section: 'Categories',
        desc: 'Categories grouping options (e.g. Sex, Age).',
        color: C.cat.c, bg: C.cat.bg,
        icon: iconGroup(C.cat.c, C.cat.bg),
        resource: 'categories',
        fields: 'id,name,shortName,code,dataDimensionType,dataDimension,categoryOptions[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name' },
            { key: 'code', label: 'Code' },
            { key: 'dataDimensionType', label: 'Dimension Type', desc: 'DISAGGREGATION or ATTRIBUTE' },
            { key: 'dataDimension', label: 'Data Dimension', desc: 'TRUE or FALSE' },
        ],
        memberConfig: {
            property: 'categoryOptions',
            sheetName: 'Cat Options',
            columns: [
                { key: 'group.id', label: 'Category ID *', required: true },
                { key: 'group.name', label: 'Category Name', readOnly: true },
                { key: 'id', label: 'Cat Option ID *', required: true },
                { key: 'name', label: 'Cat Option Name', readOnly: true },
            ],
        },
    },
    {
        key: 'categoryCombos',
        label: 'Category Combos',
        section: 'Categories',
        desc: 'Combinations of categories for disaggregation.',
        color: C.cat.c, bg: C.cat.bg,
        icon: iconGroupSet(C.cat.c, C.cat.bg),
        resource: 'categoryCombos',
        fields: 'id,name,code,dataDimensionType,skipTotal,categories[id,name]',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'dataDimensionType', label: 'Dimension Type', desc: 'DISAGGREGATION or ATTRIBUTE' },
            { key: 'skipTotal', label: 'Skip Total', desc: 'TRUE or FALSE' },
        ],
        memberConfig: {
            property: 'categories',
            sheetName: 'CC Categories',
            columns: [
                { key: 'group.id', label: 'Combo ID *', required: true },
                { key: 'group.name', label: 'Combo Name', readOnly: true },
                { key: 'id', label: 'Category ID *', required: true },
                { key: 'name', label: 'Category Name', readOnly: true },
            ],
        },
    },

    // ── Tracker ──
    {
        key: 'trackedEntityTypes',
        label: 'Tracked Entity Types',
        section: 'Tracker',
        desc: 'Entity types (Person, Commodity, etc.).',
        color: C.te.c, bg: C.te.bg,
        icon: iconPerson(C.te.c, C.te.bg),
        resource: 'trackedEntityTypes',
        fields: 'id,name,description,featureType,minAttributesRequiredToSearch,maxTeiCountToReturn',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'description', label: 'Description' },
            { key: 'featureType', label: 'Feature Type', desc: 'NONE, POINT, POLYGON' },
            { key: 'minAttributesRequiredToSearch', label: 'Min Search Attrs', desc: 'Number' },
            { key: 'maxTeiCountToReturn', label: 'Max TEI Return', desc: 'Number' },
        ],
    },
    {
        key: 'trackedEntityAttributes',
        label: 'Tracked Entity Attributes',
        section: 'Tracker',
        desc: 'Attributes for tracked entities (Name, Age, etc.).',
        color: C.te.c, bg: C.te.bg,
        icon: iconAttr(C.te.c, C.te.bg),
        resource: 'trackedEntityAttributes',
        fields: 'id,name,shortName,code,description,valueType,aggregationType,unique,optionSet[id,name],confidential,inherit',
        columns: [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name *', required: true },
            { key: 'shortName', label: 'Short Name *', required: true },
            { key: 'code', label: 'Code' },
            { key: 'description', label: 'Description' },
            { key: 'valueType', label: 'Value Type *', required: true, desc: 'TEXT, NUMBER, DATE, BOOLEAN, etc.' },
            { key: 'aggregationType', label: 'Aggregation Type', desc: 'NONE, SUM, COUNT, etc.' },
            { key: 'unique', label: 'Unique', desc: 'TRUE or FALSE' },
            { key: 'optionSet.id', label: 'Option Set ID' },
            { key: 'optionSet.name', label: 'Option Set Name', readOnly: true },
            { key: 'confidential', label: 'Confidential', desc: 'TRUE or FALSE' },
            { key: 'inherit', label: 'Inherit', desc: 'TRUE or FALSE' },
        ],
    },

    // ── GIS ──
    {
        key: 'geoJson',
        label: 'GeoJSON / GIS',
        section: 'Organisation',
        desc: 'Import org unit boundaries and coordinates from GeoJSON.',
        color: C.geo.c, bg: C.geo.bg,
        icon: iconGlobe(C.geo.c, C.geo.bg),
        resource: null,
        columns: [],
        importOnly: true,
    },

    // ── Combined ──
    {
        key: 'allMetadata',
        label: 'All Metadata',
        section: 'Combined',
        desc: 'All types in one file — each on a separate sheet.',
        color: C.all.c, bg: C.all.bg,
        icon: iconStack(C.all.c),
        resource: null,
        columns: [],
    },
]

// --- Icon helpers (small inline SVGs) ---

function iconTree(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="6" r="4" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="6" cy="22" r="4" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="22" cy="22" r="4" stroke={c} strokeWidth="1.5" fill={bg} />
            <path d="M14 10v4M10 18l-2 0M18 18l2 0M12 14H16" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

function iconGroup(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="6" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="10" cy="12" r="3" stroke={c} strokeWidth="1.2" fill="none" />
            <circle cx="18" cy="12" r="3" stroke={c} strokeWidth="1.2" fill="none" />
            <circle cx="14" cy="20" r="3" stroke={c} strokeWidth="1.2" fill="none" />
        </svg>
    )
}

function iconGroupSet(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="6" stroke={c} strokeWidth="1.5" fill={bg} />
            <rect x="7" y="7" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.2" fill="none" />
            <rect x="15" y="7" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.2" fill="none" />
            <rect x="7" y="15" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.2" fill="none" />
            <rect x="15" y="15" width="6" height="6" rx="1.5" stroke={c} strokeWidth="1.2" fill="none" />
        </svg>
    )
}

function iconList(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <path d="M8 10h12M8 14h12M8 18h8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

function iconChart(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <path d="M7 20l5-6 4 3 5-8" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function iconChecklist(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="9" cy="10" r="2" fill={c} />
            <circle cx="9" cy="18" r="2" fill={c} />
            <path d="M14 10h8M14 18h8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

function iconTag(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="10" cy="10" r="2.5" fill={c} />
            <path d="M12 12l8 8M17 23h3a2 2 0 002-2v-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

function iconPerson(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <circle cx="14" cy="11" r="3" stroke={c} strokeWidth="1.5" fill="none" />
            <path d="M8 22c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    )
}

function iconAttr(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="3" y="3" width="22" height="22" rx="3" stroke={c} strokeWidth="1.5" fill={bg} />
            <path d="M8 10h4M8 14h8M8 18h6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="20" cy="10" r="2" fill={c} />
        </svg>
    )
}

function iconGlobe(c, bg) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="10" stroke={c} strokeWidth="1.5" fill={bg} />
            <ellipse cx="14" cy="14" rx="6" ry="10" stroke={c} strokeWidth="1.2" fill="none" />
            <path d="M4 14h20M5 9h18M5 19h18" stroke={c} strokeWidth="1" strokeLinecap="round" />
        </svg>
    )
}

function iconStack(c) {
    return (
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="2" y="8" width="16" height="14" rx="2" stroke={c} strokeWidth="1.5" fill="#CFD8DC" />
            <rect x="5" y="4" width="16" height="14" rx="2" stroke={c} strokeWidth="1.5" fill="#ECEFF1" />
            <rect x="8" y="0" width="16" height="14" rx="2" stroke={c} strokeWidth="1.5" fill="#fff" />
            <path d="M12 4h8M12 7h8M12 10h5" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    )
}

/**
 * Let the user choose which metadata type to work with.
 * Types are grouped by section headers.
 */
export const MetadataTypeSelector = ({ mode, onSelect, onBack }) => {
    const isExport = mode === 'export'

    // Group types by section
    const sections = []
    const sectionMap = {}
    for (const mt of METADATA_TYPES) {
        if (isExport && mt.importOnly) continue
        const s = mt.section || 'Other'
        if (!sectionMap[s]) {
            sectionMap[s] = []
            sections.push(s)
        }
        sectionMap[s].push(mt)
    }

    return (
        <div>
            <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
                <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #AB47BC, #6A1B9A)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 12, boxShadow: '0 4px 12px rgba(106,27,154,0.25)',
                }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                        <rect x="3" y="1" width="22" height="26" rx="3" fill="#E1BEE7" />
                        <path d="M9 9h10M9 14h10M9 19h7" stroke="#6A1B9A" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                </div>
                <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#1a202c', fontFamily: FONT }}>
                    {isExport ? 'Metadata Export' : 'Metadata Import'}
                </h2>
                <p style={{
                    color: '#4a5568', margin: '0 0 8px', fontSize: 15,
                    maxWidth: 520, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6, fontFamily: FONT,
                }}>
                    {isExport
                        ? 'Select the metadata type you want to export to Excel.'
                        : 'Select the metadata type you want to import from Excel.'}
                </p>
            </div>

            <div style={{ borderTop: '1px solid #e0e5ec', margin: '0 0 20px' }} />

            <div style={{ maxWidth: 740, margin: '0 auto 24px' }}>
                {sections.map((section) => (
                    <div key={section} style={{ marginBottom: 20 }}>
                        <div style={{
                            fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase',
                            letterSpacing: '0.05em', marginBottom: 8, fontFamily: FONT,
                        }}>
                            {section}
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                            gap: 10,
                        }}>
                            {sectionMap[section].map((mt) => (
                                <MetaCard key={mt.key} type={mt} onSelect={() => onSelect(mt)} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ textAlign: 'center' }}>
                <Button secondary onClick={onBack}>Back</Button>
            </div>
        </div>
    )
}

const MetaCard = ({ type, onSelect }) => {
    const [hovered, setHovered] = React.useState(false)

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => e.key === 'Enter' && onSelect()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                border: `1.5px solid ${hovered ? type.color : '#e0e5ec'}`,
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background: hovered ? type.bg : '#fff',
                boxShadow: hovered ? `0 4px 12px ${type.color}20` : 'none',
            }}
        >
            <div style={{ marginBottom: 8 }}>{type.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#1a202c', marginBottom: 3, fontFamily: FONT }}>
                {type.label}
            </div>
            <div style={{ fontSize: 12, color: '#4a5568', lineHeight: 1.4, fontFamily: FONT }}>
                {type.desc}
            </div>
        </div>
    )
}
