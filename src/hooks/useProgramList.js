import { useDataQuery } from '@dhis2/app-runtime'

// Request the per-user `access` descriptor so we can flag programs the user
// can see in metadata but cannot read data from (E1006 at export time).
const PROGRAMS_QUERY = {
    programs: {
        resource: 'programs',
        params: {
            fields: 'id,displayName,programType,access[data[read,write]]',
            paging: false,
            order: 'displayName:asc',
        },
    },
}

export const useProgramList = () => {
    const { data, loading, error } = useDataQuery(PROGRAMS_QUERY)

    const raw = data?.programs?.programs ?? []
    const programs = raw.map((p) => ({
        ...p,
        canReadData: !!p.access?.data?.read,
        canWriteData: !!p.access?.data?.write,
    }))

    return {
        programs,
        loading,
        error,
    }
}
