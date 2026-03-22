import React from 'react'
import { SingleSelectField, SingleSelectOption, CircularLoader } from '@dhis2/ui'
import { useProgramList } from '../hooks/useProgramList'
import { useProgramMetadata } from '../hooks/useProgramMetadata'

export const ProgramSelector = ({ onSelect }) => {
    const { programs, loading: listLoading, error: listError } = useProgramList()
    const [selectedId, setSelectedId] = React.useState(null)
    const { metadata, loading: metaLoading } = useProgramMetadata(selectedId)

    React.useEffect(() => {
        if (metadata && selectedId) {
            const prog = programs.find((p) => p.id === selectedId)
            onSelect(prog, metadata)
        }
    }, [metadata, selectedId])

    if (listLoading) return <CircularLoader />
    if (listError) return <p>Failed to load programs: {listError.message}</p>

    return (
        <div>
            <h2>Step 1: Select Tracker Program</h2>
            <p>Choose the tracker program you want to import data into.</p>
            <SingleSelectField
                label="Tracker Program"
                selected={selectedId}
                onChange={({ selected }) => setSelectedId(selected)}
                loading={metaLoading}
            >
                {programs.map((p) => (
                    <SingleSelectOption key={p.id} value={p.id} label={p.displayName} />
                ))}
            </SingleSelectField>
        </div>
    )
}
