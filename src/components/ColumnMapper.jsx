import React, { useState, useMemo, useCallback } from 'react'
import {
    Button,
    ButtonStrip,
    SingleSelectField,
    SingleSelectOption,
    InputField,
    DataTable,
    DataTableHead,
    DataTableBody,
    DataTableRow,
    DataTableCell,
    DataTableColumnHeader,
    NoticeBox,
    Tag,
    TabBar,
    Tab,
} from '@dhis2/ui'
import { getAttributes, getSheetHeaders, applyMapping, buildAutoMapping, detectHeaderRow } from '../lib/fileParser'

/**
 * Step 3.5: Column Mapper
 *
 * Shows when the uploaded Excel file doesn't use our template format.
 * The user maps Excel columns to DHIS2 attributes and data elements.
 * Auto-mapping is attempted first; user can correct.
 */
export const ColumnMapper = ({ workbook, sheetsInfo, mapping: initialMapping, metadata, onMapped, onBack }) => {
    const [mapping, setMapping] = useState(initialMapping)
    const [activeTab, setActiveTab] = useState('tei')
    const [error, setError] = useState(null)

    const attrs = useMemo(() => getAttributes(metadata), [metadata])
    const stages = useMemo(() => metadata.programStages ?? [], [metadata])

    // Count mapped fields for summary
    const mappedCounts = useMemo(() => {
        const attrTotal = attrs.length
        const attrMapped = Object.values(mapping.attributeMapping).filter(Boolean).length
        const stageCounts = {}
        for (const stage of stages) {
            const sm = mapping.stages[stage.id]
            if (!sm) continue
            const des = stage.programStageDataElements ?? []
            const total = des.length
            const groups = sm.eventGroups ?? []
            // Count unique mapped DEs across the first event group
            const mapped = groups.length > 0
                ? Object.values(groups[0].dataElementMapping ?? {}).filter(Boolean).length
                : 0
            stageCounts[stage.id] = { total, mapped, name: stage.displayName, groupCount: groups.length }
        }
        return { attrTotal, attrMapped, stageCounts }
    }, [mapping, attrs, stages])

    // All available sheet names as options
    const sheetOptions = useMemo(
        () => Object.keys(sheetsInfo).filter((n) => n !== 'Validation'),
        [sheetsInfo]
    )

    // Get headers for a given sheet name, respecting header row override
    const getHeaders = useCallback(
        (sheetName, headerRow = 1) => {
            if (!sheetName) return []
            if (headerRow === 1) {
                return sheetsInfo[sheetName]?.headers || []
            }
            return getSheetHeaders(workbook, sheetName, headerRow)
        },
        [workbook, sheetsInfo]
    )

    // Update a top-level mapping field
    const updateField = useCallback((field, value) => {
        setMapping((prev) => ({ ...prev, [field]: value }))

        // When header row or sheet changes, re-run auto-mapping to repopulate
        if (field === 'headerRow' || field === 'teiSheet') {
            // Use setTimeout so the state update above settles first
            setTimeout(() => {
                setMapping((prev) => {
                    const hr = field === 'headerRow' ? value : (prev.headerRow || 1)
                    const sheet = field === 'teiSheet' ? value : prev.teiSheet
                    if (!sheet) return prev

                    const updatedSheetsInfo = {}
                    for (const name of Object.keys(sheetsInfo)) {
                        updatedSheetsInfo[name] = {
                            ...sheetsInfo[name],
                            headers: getSheetHeaders(workbook, name, name === sheet ? hr : 1),
                        }
                    }
                    for (const [, stageMap] of Object.entries(prev.stages)) {
                        if (stageMap.sheet && stageMap.headerRow > 1) {
                            updatedSheetsInfo[stageMap.sheet] = {
                                ...updatedSheetsInfo[stageMap.sheet],
                                headers: getSheetHeaders(workbook, stageMap.sheet, stageMap.headerRow),
                            }
                        }
                    }
                    const fresh = buildAutoMapping(updatedSheetsInfo, metadata, workbook)
                    fresh.teiSheet = sheet
                    fresh.headerRow = hr
                    // Preserve user-set stage sheets and header rows
                    for (const [stageId, stageMap] of Object.entries(prev.stages)) {
                        if (fresh.stages[stageId] && stageMap.sheet) {
                            fresh.stages[stageId].sheet = stageMap.sheet
                            fresh.stages[stageId].headerRow = stageMap.headerRow || 1
                        }
                    }
                    return fresh
                })
            }, 0)
        }
    }, [sheetsInfo, workbook, metadata])

    // Update an attribute mapping
    const updateAttrMapping = useCallback((attrId, column) => {
        setMapping((prev) => ({
            ...prev,
            attributeMapping: { ...prev.attributeMapping, [attrId]: column },
        }))
    }, [])

    // Update a stage-level field
    const updateStageField = useCallback((stageId, field, value) => {
        setMapping((prev) => ({
            ...prev,
            stages: {
                ...prev.stages,
                [stageId]: { ...prev.stages[stageId], [field]: value },
            },
        }))

        // When stage headerRow or sheet changes, re-run auto-mapping for that stage
        if (field === 'headerRow' || field === 'sheet') {
            setTimeout(() => {
                setMapping((prev) => {
                    const stage = prev.stages[stageId]
                    if (!stage) return prev
                    const sh = field === 'sheet' ? value : stage.sheet
                    const hr = field === 'headerRow' ? value : (stage.headerRow || 1)
                    if (!sh) return prev

                    const stageHeaders = getSheetHeaders(workbook, sh, hr)
                    const updatedSheetsInfo = { [sh]: { headers: stageHeaders } }
                    const tempMapping = buildAutoMapping(updatedSheetsInfo, metadata, workbook)

                    // Take all auto-mapped event groups for this stage
                    const autoStage = Object.values(tempMapping.stages).find(
                        (s) => s.eventGroups?.length > 0
                    )
                    const autoGroups = autoStage?.eventGroups ?? []
                    if (autoGroups.length === 0) return prev

                    return {
                        ...prev,
                        stages: {
                            ...prev.stages,
                            [stageId]: { ...stage, [field]: value, eventGroups: autoGroups },
                        },
                    }
                })
            }, 0)
        }
    }, [workbook, metadata])

    // Update an event group field (eventDateColumn, orgUnitColumn)
    const updateGroupField = useCallback((stageId, groupIndex, field, value) => {
        setMapping((prev) => {
            const stage = prev.stages[stageId] || {}
            const groups = [...(stage.eventGroups || [])]
            groups[groupIndex] = { ...groups[groupIndex], [field]: value }
            return {
                ...prev,
                stages: {
                    ...prev.stages,
                    [stageId]: { ...stage, eventGroups: groups },
                },
            }
        })
    }, [])

    // Update a data element mapping within an event group
    const updateGroupDeMapping = useCallback((stageId, groupIndex, deId, column) => {
        setMapping((prev) => {
            const stage = prev.stages[stageId] || {}
            const groups = [...(stage.eventGroups || [])]
            groups[groupIndex] = {
                ...groups[groupIndex],
                dataElementMapping: {
                    ...(groups[groupIndex]?.dataElementMapping || {}),
                    [deId]: column,
                },
            }
            return {
                ...prev,
                stages: {
                    ...prev.stages,
                    [stageId]: { ...stage, eventGroups: groups },
                },
            }
        })
    }, [])

    // Add a new empty event group for a repeatable stage
    const addEventGroup = useCallback((stageId) => {
        setMapping((prev) => {
            const stage = prev.stages[stageId] || {}
            const groups = [...(stage.eventGroups || [])]
            groups.push({ eventDateColumn: '', orgUnitColumn: '', dataElementMapping: {} })
            return {
                ...prev,
                stages: {
                    ...prev.stages,
                    [stageId]: { ...stage, eventGroups: groups },
                },
            }
        })
    }, [])

    // Remove an event group
    const removeEventGroup = useCallback((stageId, groupIndex) => {
        setMapping((prev) => {
            const stage = prev.stages[stageId] || {}
            const groups = (stage.eventGroups || []).filter((_, i) => i !== groupIndex)
            return {
                ...prev,
                stages: {
                    ...prev.stages,
                    [stageId]: { ...stage, eventGroups: groups },
                },
            }
        })
    }, [])

    // Re-run auto-mapping with current sheet/header settings using fuzzy match
    const handleAutoMap = useCallback(() => {
        // Rebuild sheetsInfo based on current header row settings
        const updatedSheetsInfo = {}
        for (const name of Object.keys(sheetsInfo)) {
            updatedSheetsInfo[name] = {
                ...sheetsInfo[name],
                headers: getSheetHeaders(workbook, name, name === mapping.teiSheet ? (mapping.headerRow || 1) : 1),
            }
        }
        // Also update stage header rows
        for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
            if (stageMap.sheet && stageMap.headerRow > 1) {
                updatedSheetsInfo[stageMap.sheet] = {
                    ...updatedSheetsInfo[stageMap.sheet],
                    headers: getSheetHeaders(workbook, stageMap.sheet, stageMap.headerRow),
                }
            }
        }
        const newMapping = buildAutoMapping(updatedSheetsInfo, metadata, workbook)
        // Preserve user-set sheet/headerRow choices
        newMapping.teiSheet = mapping.teiSheet || newMapping.teiSheet
        newMapping.headerRow = mapping.headerRow || 1
        for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
            if (newMapping.stages[stageId] && stageMap.sheet) {
                newMapping.stages[stageId].sheet = stageMap.sheet
                newMapping.stages[stageId].headerRow = stageMap.headerRow || 1
            }
        }
        setMapping(newMapping)
    }, [mapping, sheetsInfo, workbook, metadata])

    // Auto-detect header row for any sheet
    const handleDetectHeaderRow = useCallback(() => {
        const sheetName = mapping.teiSheet
        if (!sheetName) return
        const detected = detectHeaderRow(workbook, sheetName, metadata)
        if (detected !== (mapping.headerRow || 1)) {
            updateField('headerRow', detected)
        }
        // Also detect for each stage sheet
        for (const [stageId, stageMap] of Object.entries(mapping.stages)) {
            const sh = stageMap.sheet
            if (!sh || sh === sheetName) continue
            const stageDetected = detectHeaderRow(workbook, sh, metadata)
            if (stageDetected !== (stageMap.headerRow || 1)) {
                updateStageField(stageId, 'headerRow', stageDetected)
            }
        }
    }, [mapping, workbook, metadata, updateField, updateStageField])

    const handleApply = useCallback(() => {
        setError(null)
        try {
            if (!mapping.teiSheet) {
                throw new Error('Select a sheet for TEI / Enrollment data.')
            }
            const parsed = applyMapping(workbook, mapping, metadata)
            if (parsed.trackedEntities.length === 0) {
                throw new Error('No tracked entities found. Check your TEI ID column mapping.')
            }
            onMapped(parsed)
        } catch (e) {
            setError(e.message)
        }
    }, [mapping, workbook, metadata, onMapped])

    const teiHeaders = getHeaders(mapping.teiSheet, mapping.headerRow || 1)

    return (
        <div>
            <h2>Step 3: Map Columns</h2>
            <p>
                Map your Excel columns to DHIS2 fields below.
                Auto-mapping has been attempted — review and correct as needed.
            </p>
            <NoticeBox title="How first-time import works">
                DHIS2 will automatically create Tracked Entities, Enrollments, and Events in one
                operation — no pre-existing UIDs needed. You can have all data on <strong>one
                sheet</strong> — attributes and events on the same row. Select the same sheet for
                TEI and each stage. For <strong>repeatable stages</strong>, click &quot;Add Another
                Event Group&quot; to map additional sets of columns on the same row (each group
                produces one event per person). Empty groups are skipped automatically.
            </NoticeBox>

            {/* Toolbar: Auto-Map + Detect Header Row */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <Button small secondary onClick={handleAutoMap}>
                    Auto-Map Columns
                </Button>
                <Button small secondary onClick={handleDetectHeaderRow}>
                    Detect Header Row
                </Button>
            </div>

            {/* Summary tags */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <Tag positive={mappedCounts.attrMapped > 0}>
                    Attributes: {mappedCounts.attrMapped}/{mappedCounts.attrTotal}
                </Tag>
                {Object.entries(mappedCounts.stageCounts).map(([id, sc]) => (
                    <Tag key={id} positive={sc.mapped > 0} neutral={sc.mapped === 0}>
                        {sc.name}: {sc.mapped}/{sc.total} DEs{sc.mapped > 0 ? `, ${sc.groupCount} event${sc.groupCount !== 1 ? 's' : ''}` : ' (skipped)'}
                    </Tag>
                ))}
            </div>

            <TabBar>
                <Tab selected={activeTab === 'tei'} onClick={() => setActiveTab('tei')}>
                    TEI + Enrollment
                </Tab>
                {stages.map((s) => (
                    <Tab
                        key={s.id}
                        selected={activeTab === s.id}
                        onClick={() => setActiveTab(s.id)}
                    >
                        {s.displayName}
                    </Tab>
                ))}
            </TabBar>

            <div style={{ marginTop: 16 }}>
                {activeTab === 'tei' && (
                    <TeiMappingPanel
                        mapping={mapping}
                        attrs={attrs}
                        sheetOptions={sheetOptions}
                        teiHeaders={teiHeaders}
                        getHeaders={getHeaders}
                        updateField={updateField}
                        updateAttrMapping={updateAttrMapping}
                    />
                )}

                {stages.map((stage) =>
                    activeTab === stage.id ? (
                        <StageMappingPanel
                            key={stage.id}
                            stage={stage}
                            stageMapping={mapping.stages[stage.id] || {}}
                            sheetOptions={sheetOptions}
                            getHeaders={getHeaders}
                            updateStageField={updateStageField}
                            updateGroupField={updateGroupField}
                            updateGroupDeMapping={updateGroupDeMapping}
                            addEventGroup={addEventGroup}
                            removeEventGroup={removeEventGroup}
                        />
                    ) : null
                )}
            </div>

            {error && (
                <NoticeBox error title="Mapping Error" style={{ marginTop: 16 }}>
                    {error}
                </NoticeBox>
            )}

            <ButtonStrip style={{ marginTop: 16 }}>
                <Button onClick={onBack} secondary>
                    Back
                </Button>
                <Button onClick={handleApply} primary>
                    Apply Mapping & Preview
                </Button>
            </ButtonStrip>
        </div>
    )
}


/** Return value only if it exists in the options list, otherwise empty string. */
function safeSelected(value, options) {
    if (!value) return ''
    return options.includes(value) ? value : ''
}

/**
 * TEI + Enrollment mapping panel
 */
function TeiMappingPanel({ mapping, attrs, sheetOptions, teiHeaders, getHeaders, updateField, updateAttrMapping }) {
    // When sheet changes, update teiHeaders via the parent
    const onSheetChange = ({ selected }) => {
        updateField('teiSheet', selected)
    }

    // Re-derive headers if sheet changed
    const headers = getHeaders(mapping.teiSheet, mapping.headerRow || 1)

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <SingleSelectField
                    label="Excel Sheet"
                    selected={safeSelected(mapping.teiSheet, sheetOptions)}
                    onChange={onSheetChange}
                    dense
                >
                    {sheetOptions.map((s) => (
                        <SingleSelectOption key={s} value={s} label={s} />
                    ))}
                </SingleSelectField>

                <InputField
                    label="Header Row"
                    type="number"
                    value={String(mapping.headerRow || 1)}
                    onChange={({ value }) => updateField('headerRow', Math.max(1, parseInt(value, 10) || 1))}
                    helpText="Row number where column titles start (1 = first row)"
                    dense
                    min="1"
                />

                <SingleSelectField
                    label="TEI ID Column (row identifier)"
                    selected={safeSelected(mapping.teiIdColumn, headers)}
                    onChange={({ selected }) => updateField('teiIdColumn', selected)}
                    helpText="Links events to the right person. Not sent to DHIS2. If empty, each row = new TEI."
                    dense
                    clearable
                    filterable
                >
                    {headers.map((h) => (
                        <SingleSelectOption key={h} value={h} label={h} />
                    ))}
                </SingleSelectField>

                <SingleSelectField
                    label="Organisation Unit Column"
                    selected={safeSelected(mapping.orgUnitColumn, headers)}
                    onChange={({ selected }) => updateField('orgUnitColumn', selected)}
                    dense
                    clearable
                    filterable
                >
                    {headers.map((h) => (
                        <SingleSelectOption key={h} value={h} label={h} />
                    ))}
                </SingleSelectField>

                <SingleSelectField
                    label="Enrollment Date Column"
                    selected={safeSelected(mapping.enrollmentDateColumn, headers)}
                    onChange={({ selected }) => updateField('enrollmentDateColumn', selected)}
                    dense
                    clearable
                    filterable
                >
                    {headers.map((h) => (
                        <SingleSelectOption key={h} value={h} label={h} />
                    ))}
                </SingleSelectField>

                <SingleSelectField
                    label="Incident Date Column"
                    selected={safeSelected(mapping.incidentDateColumn, headers)}
                    onChange={({ selected }) => updateField('incidentDateColumn', selected)}
                    dense
                    clearable
                    filterable
                >
                    {headers.map((h) => (
                        <SingleSelectOption key={h} value={h} label={h} />
                    ))}
                </SingleSelectField>
            </div>

            <h3>Attribute Mapping</h3>
            <MappingTable
                items={attrs.map((a) => ({ id: a.id, label: a.displayName }))}
                mappingObj={mapping.attributeMapping}
                columns={headers}
                onUpdate={updateAttrMapping}
            />
        </div>
    )
}


/**
 * Program Stage mapping panel — supports multiple event groups for repeatable stages.
 * Each event group maps the same data elements to different Excel columns,
 * producing one event per group per row.
 */
function StageMappingPanel({ stage, stageMapping, sheetOptions, getHeaders, updateStageField, updateGroupField, updateGroupDeMapping, addEventGroup, removeEventGroup }) {
    const headers = getHeaders(stageMapping.sheet, stageMapping.headerRow || 1)
    const des = (stage.programStageDataElements ?? []).map((psde) => {
        const de = psde.dataElement ?? psde
        return { id: de.id, label: de.displayName }
    })
    const repeatable = stage.repeatable === true
    const groups = stageMapping.eventGroups ?? []

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <SingleSelectField
                    label="Excel Sheet"
                    selected={safeSelected(stageMapping.sheet, sheetOptions)}
                    onChange={({ selected }) => updateStageField(stage.id, 'sheet', selected)}
                    dense
                    clearable
                >
                    {sheetOptions.map((s) => (
                        <SingleSelectOption key={s} value={s} label={s} />
                    ))}
                </SingleSelectField>

                <InputField
                    label="Header Row"
                    type="number"
                    value={String(stageMapping.headerRow || 1)}
                    onChange={({ value }) => updateStageField(stage.id, 'headerRow', Math.max(1, parseInt(value, 10) || 1))}
                    helpText="Row number where column titles start"
                    dense
                    min="1"
                />

                <SingleSelectField
                    label="TEI ID Column"
                    selected={safeSelected(stageMapping.teiIdColumn, headers)}
                    onChange={({ selected }) => updateStageField(stage.id, 'teiIdColumn', selected)}
                    helpText="Only needed if events are on a separate sheet from TEI data"
                    dense
                    clearable
                    filterable
                >
                    {headers.map((h) => (
                        <SingleSelectOption key={h} value={h} label={h} />
                    ))}
                </SingleSelectField>
            </div>

            {stageMapping.sheet && groups.map((group, gi) => (
                <div key={gi} style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h3 style={{ margin: 0 }}>
                            Event {groups.length > 1 ? gi + 1 : ''} — Data Element Mapping
                        </h3>
                        {repeatable && groups.length > 1 && (
                            <Button small destructive onClick={() => removeEventGroup(stage.id, gi)}>
                                Remove Event
                            </Button>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                        <SingleSelectField
                            label="Event Date Column"
                            selected={safeSelected(group.eventDateColumn, headers)}
                            onChange={({ selected }) => updateGroupField(stage.id, gi, 'eventDateColumn', selected)}
                            dense
                            clearable
                            filterable
                        >
                            {headers.map((h) => (
                                <SingleSelectOption key={h} value={h} label={h} />
                            ))}
                        </SingleSelectField>

                        <SingleSelectField
                            label="Organisation Unit Column"
                            selected={safeSelected(group.orgUnitColumn, headers)}
                            onChange={({ selected }) => updateGroupField(stage.id, gi, 'orgUnitColumn', selected)}
                            dense
                            clearable
                            filterable
                        >
                            {headers.map((h) => (
                                <SingleSelectOption key={h} value={h} label={h} />
                            ))}
                        </SingleSelectField>
                    </div>

                    <MappingTable
                        items={des}
                        mappingObj={group.dataElementMapping || {}}
                        columns={headers}
                        onUpdate={(deId, col) => updateGroupDeMapping(stage.id, gi, deId, col)}
                    />
                </div>
            ))}

            {stageMapping.sheet && repeatable && (
                <Button small onClick={() => addEventGroup(stage.id)}>
                    + Add Another Event Group
                </Button>
            )}

            {stageMapping.sheet && !repeatable && groups.length === 0 && (
                <p style={{ color: '#666' }}>No event group configured. The stage has no column mappings.</p>
            )}
        </div>
    )
}

/**
 * Reusable mapping table: DHIS2 field on left, Excel column dropdown on right.
 */
function MappingTable({ items, mappingObj, columns, onUpdate }) {
    return (
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
            <DataTable>
                <DataTableHead>
                    <DataTableRow>
                        <DataTableColumnHeader>DHIS2 Field</DataTableColumnHeader>
                        <DataTableColumnHeader>Excel Column</DataTableColumnHeader>
                        <DataTableColumnHeader width="80px">Status</DataTableColumnHeader>
                    </DataTableRow>
                </DataTableHead>
                <DataTableBody>
                    {items.map(({ id, label }) => (
                        <DataTableRow key={id}>
                            <DataTableCell>
                                {label}
                                <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{id}</span>
                            </DataTableCell>
                            <DataTableCell>
                                <SingleSelectField
                                    selected={safeSelected(mappingObj[id], columns)}
                                    onChange={({ selected }) => onUpdate(id, selected)}
                                    dense
                                    clearable
                                    filterable
                                >
                                    {columns.map((c) => (
                                        <SingleSelectOption key={c} value={c} label={c} />
                                    ))}
                                </SingleSelectField>
                            </DataTableCell>
                            <DataTableCell>
                                {mappingObj[id] ? (
                                    <Tag positive>Mapped</Tag>
                                ) : (
                                    <Tag neutral>--</Tag>
                                )}
                            </DataTableCell>
                        </DataTableRow>
                    ))}
                </DataTableBody>
            </DataTable>
        </div>
    )
}
