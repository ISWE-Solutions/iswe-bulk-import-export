---
description: "Add a new UI component to the import wizard"
---

# New Component

## Context
- This is a DHIS2 app using `@dhis2/app-runtime` and `@dhis2/ui`
- Components live in `src/components/`
- The wizard flow is orchestrated by `ImportWizard.jsx`

## Steps
1. Read `.github/instructions/components.instructions.md` for conventions
2. Create the component in `src/components/`
3. Use DHIS2 UI components — never raw HTML for buttons, inputs, tables
4. Wire it into `ImportWizard.jsx` if it's a new step
5. Add any needed hooks to `src/hooks/`

## Checklist
- [ ] Uses DHIS2 UI components
- [ ] Has Back/Continue navigation buttons
- [ ] Handles loading and error states
- [ ] Props are minimal (data down, events up)
