---
applyTo: "src/hooks/**/*.js"
---
# Hooks Instructions

When working with hooks (`src/hooks/`):

## Pattern

All hooks wrap `@dhis2/app-runtime` queries:

```js
import { useDataQuery } from '@dhis2/app-runtime'

const QUERY = {
    resource: {
        resource: 'programs',
        params: { fields: '...', paging: false },
    },
}

export const useMyHook = () => {
    const { data, loading, error } = useDataQuery(QUERY)
    return { result: data?.resource ?? [], loading, error }
}
```

## Rules

- Prefix with `use` (React convention)
- Return `{ data, loading, error }` pattern
- Use `lazy: true` + `refetch` for queries that depend on parameters
- Include `paging: false` for metadata queries (programs, org units, option sets)
- Use DHIS2 field filters to fetch only what's needed (minimize payload)
- Cache metadata locally when appropriate (program metadata doesn't change often)
