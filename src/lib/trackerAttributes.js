/**
 * Return the tracked-entity attribute wrappers that define the enrollment
 * form for a tracker program, preferring the program's own list over the
 * tracked-entity type's list.
 *
 * DHIS2 data model:
 *   - program.programTrackedEntityAttributes is the authoritative list of
 *     attributes shown on the enrollment form, with each entry carrying
 *     the program-level `mandatory` flag that DHIS2 enforces at enrolment.
 *   - trackedEntityType.trackedEntityTypeAttributes is a narrower list of
 *     attributes attached to the TE type itself. Program-specific attrs
 *     (including program-only mandatory attrs) are NOT present here.
 *
 * Previously the code used TET attrs first and fell back to program attrs
 * only when TET was absent. That caused tracker exports / templates to
 * silently drop every program-scoped mandatory attribute, producing files
 * that could not be imported back (enrolment rejected with E1018 / E1076).
 *
 * This helper fixes that by preferring the program list when present.
 * Each element retains the same shape used throughout the codebase:
 *   { id, displayName?, mandatory, valueType?, trackedEntityAttribute: {...} }
 * so existing consumers that read `w.trackedEntityAttribute?.id ?? w.id`
 * continue to work unchanged.
 */
export function getTrackerAttributes(metadata) {
    if (!metadata) return []
    const programAttrs = metadata.programTrackedEntityAttributes
    if (Array.isArray(programAttrs) && programAttrs.length > 0) {
        return programAttrs
    }
    return metadata.trackedEntityType?.trackedEntityTypeAttributes ?? []
}
