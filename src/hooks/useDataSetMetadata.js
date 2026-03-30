import { useEffect } from 'react'
import { useDataQuery } from '@dhis2/app-runtime'

/**
 * Fetches full metadata for a given data set including:
 * - Data elements (with value types, option sets, category combos)
 * - Sections (for grouped layout)
 * - Organisation units assigned to the data set
 * - Period type
 * - Category combo (for attribute option combos)
 */
const DATA_SET_METADATA_QUERY = {
    dataSet: {
        resource: 'dataSets',
        id: ({ id }) => id,
        params: {
            fields: [
                'id',
                'displayName',
                'periodType',
                'categoryCombo[id,displayName,categories[id,displayName,categoryOptions[id,displayName]],categoryOptionCombos[id,displayName]]',
                'dataSetElements[dataElement[id,displayName,valueType,categoryCombo[id,displayName,categoryOptionCombos[id,displayName]],optionSet[id,displayName,options[id,displayName,code]]]]',
                'sections[id,displayName,sortOrder,dataElements[id]]',
                'organisationUnits[id,displayName,path]',
            ].join(','),
        },
    },
}

export const useDataSetMetadata = (dataSetId) => {
    const { data, loading, error, refetch } = useDataQuery(DATA_SET_METADATA_QUERY, {
        lazy: true,
        variables: { id: dataSetId },
    })

    useEffect(() => {
        if (dataSetId) {
            refetch({ id: dataSetId })
        }
    }, [dataSetId, refetch])

    const dataSet = data?.dataSet ?? null

    return {
        metadata: dataSet,
        loading,
        error,
    }
}
