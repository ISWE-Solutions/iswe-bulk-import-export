/**
 * Shared design tokens and step definitions for the ImportWizard
 * and its child flow components.
 */

export const FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export const COLORS = {
    primary: '#1565C0',
    primaryLight: '#e3f2fd',
    success: '#2E7D32',
    muted: '#4a5568',
    mutedLight: '#6b7280',
    border: '#e0e5ec',
    bg: '#f4f6f8',
    text: '#1a202c',
}

/** Color + label for import type badges */
export const IMPORT_TYPE_STYLE = {
    tracker: { bg: '#e8f5e9', color: '#2E7D32', label: 'Tracker' },
    event: { bg: '#FFF8E1', color: '#E65100', label: 'Event' },
    dataEntry: { bg: '#E8F5E9', color: '#2E7D32', label: 'Data Entry' },
    metadata: { bg: '#F3E5F5', color: '#6A1B9A', label: 'Metadata' },
}

/**
 * Step definitions per import type.
 * Tracker/Event: Select → Template → Upload → Map → Preview → Import
 * Data Entry: Select → Template → Upload → Preview → Import
 */
export const TRACKER_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'TEMPLATE', label: 'Template' },
    { key: 'UPLOAD', label: 'Upload' },
    { key: 'MAP', label: 'Map Columns' },
    { key: 'PREVIEW', label: 'Preview' },
    { key: 'IMPORT', label: 'Import' },
]

export const DATA_ENTRY_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'TEMPLATE', label: 'Template' },
    { key: 'UPLOAD', label: 'Upload' },
    { key: 'PREVIEW', label: 'Preview' },
    { key: 'IMPORT', label: 'Import' },
]

export const EXPORT_STEPS = [
    { key: 'SELECT', label: 'Select' },
    { key: 'CONFIGURE', label: 'Configure' },
    { key: 'EXPORT', label: 'Export' },
]

export const METADATA_IMPORT_STEPS = [
    { key: 'SELECT', label: 'Select Type' },
    { key: 'IMPORT', label: 'Import' },
]

export const METADATA_EXPORT_STEPS = [
    { key: 'SELECT', label: 'Select Type' },
    { key: 'EXPORT', label: 'Export' },
]
