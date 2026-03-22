import { useDataQuery } from '@dhis2/app-runtime'

const PROGRAM_METADATA_QUERY = {
    program: {
        resource: 'programs',
        id: ({ id }) => id,
        params: {
            fields: [
                'id',
                'displayName',
                'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,optionSet[id,options[id,displayName,code]]]]]',
                'programStages[id,displayName,repeatable,sortOrder,programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,options[id,displayName,code]]]]]',
                'organisationUnits[id,displayName,path]',
            ].join(','),
        },
    },
}

export const useProgramMetadata = (programId) => {
    const { data, loading, error, refetch } = useDataQuery(PROGRAM_METADATA_QUERY, {
        lazy: true,
        variables: { id: programId },
    })

    // Trigger fetch when programId changes
    if (programId && !data && !loading) {
        refetch({ id: programId })
    }

    return {
        metadata: data?.program ?? null,
        loading,
        error,
    }
}
