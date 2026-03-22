---
applyTo: "src/components/**/*.{jsx,js}"
---
# Component Instructions

When working with React components in this project:

## Framework

- **DHIS2 UI only** — use `@dhis2/ui` components (Button, Card, DataTable, NoticeBox, SingleSelectField, etc.)
- **No MUI, no Tailwind, no Bootstrap** — this is a DHIS2 app
- **Functional components only** with hooks

## Data Fetching

- Use `useDataQuery` for GET requests (declarative queries)
- Use `useDataMutation` or `engine.mutate()` for POST/PUT
- Never use raw `fetch()` or `axios` — always go through `@dhis2/app-runtime`

## State Management

- Local state with `useState` / `useReducer` for component state
- Lift state to `ImportWizard.jsx` for cross-step data (program, metadata, parsedData, payload)
- No Redux, no Zustand — keep it simple

## Patterns

```jsx
// Query pattern
const { data, loading, error } = useDataQuery(QUERY)

// Loading states — always show
if (loading) return <CircularLoader />
if (error) return <NoticeBox error>{error.message}</NoticeBox>

// Memoize expensive computations
const result = useMemo(() => expensiveOp(data), [data])
```

## Wizard Steps

Each step component receives callbacks from ImportWizard:
- `onSelect`, `onContinue`, `onBack`, `onConfirm`, `onReset`
- Steps do NOT navigate themselves — they call parent callbacks
