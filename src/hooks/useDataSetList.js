import { useDataQuery } from '@dhis2/app-runtime'

const DATA_SETS_QUERY = {
    dataSets: {
        resource: 'dataSets',
        params: {
            fields: 'id,displayName,periodType',
            paging: false,
            order: 'displayName:asc',
        },
    },
}

export const useDataSetList = () => {
    const { data, loading, error } = useDataQuery(DATA_SETS_QUERY)

    return {
        dataSets: data?.dataSets?.dataSets ?? [],
        loading,
        error,
    }
}
