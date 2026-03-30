import { useDataQuery } from '@dhis2/app-runtime'

const PROGRAMS_QUERY = {
    programs: {
        resource: 'programs',
        params: {
            fields: 'id,displayName,programType',
            paging: false,
            order: 'displayName:asc',
        },
    },
}

export const useProgramList = () => {
    const { data, loading, error } = useDataQuery(PROGRAMS_QUERY)

    return {
        programs: data?.programs?.programs ?? [],
        loading,
        error,
    }
}
