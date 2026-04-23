import { useEffect } from 'react'
import { useDataQuery } from '@dhis2/app-runtime'

const PROGRAM_METADATA_QUERY = {
    program: {
        resource: 'programs',
        id: ({ id }) => id,
        params: {
            fields: [
                'id',
                'displayName',
                'programType',
                'trackedEntityType[id,displayName,trackedEntityTypeAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]]',
                'programTrackedEntityAttributes[id,displayName,mandatory,valueType,trackedEntityAttribute[id,displayName,valueType,unique,optionSet[id,displayName,options[id,displayName,code]]]]',
                'programStages[id,displayName,repeatable,sortOrder,programStageSections[id,displayName,dataElements[id]],programStageDataElements[id,compulsory,dataElement[id,displayName,valueType,optionSet[id,displayName,options[id,displayName,code]]]]]',
                'organisationUnits[id,displayName,path]',
            ].join(','),
        },
    },
    programRules: {
        resource: 'programRules',
        params: ({ id }) => ({
            filter: `program.id:eq:${id}`,
            fields: 'name,condition,programRuleActions[programRuleActionType,trackedEntityAttribute[id],dataElement[id],data]',
            paging: false,
        }),
    },
    programRuleVariables: {
        resource: 'programRuleVariables',
        params: ({ id }) => ({
            filter: `program.id:eq:${id}`,
            fields: 'name,programRuleVariableSourceType,trackedEntityAttribute[id],dataElement[id]',
            paging: false,
        }),
    },
}

/**
 * Extract attribute/DE IDs that are auto-assigned by program rules.
 * These should be excluded from the import payload to avoid E1309 conflicts.
 */
function extractAssignedIds(programRules) {
    const attrs = new Set()
    const des = new Set()
    const assignRules = []
    for (const rule of programRules ?? []) {
        for (const action of rule.programRuleActions ?? []) {
            if (action.programRuleActionType !== 'ASSIGN') continue
            if (action.trackedEntityAttribute?.id) {
                attrs.add(action.trackedEntityAttribute.id)
                assignRules.push({
                    targetId: action.trackedEntityAttribute.id,
                    targetType: 'attribute',
                    expression: action.data ?? '',
                    condition: rule.condition ?? '',
                    name: rule.name ?? '',
                })
            }
            if (action.dataElement?.id) {
                des.add(action.dataElement.id)
                assignRules.push({
                    targetId: action.dataElement.id,
                    targetType: 'dataElement',
                    expression: action.data ?? '',
                    condition: rule.condition ?? '',
                    name: rule.name ?? '',
                })
            }
        }
    }
    return { assignedAttributes: [...attrs], assignedDataElements: [...des], assignRules }
}

export const useProgramMetadata = (programId) => {
    const { data, loading, error, refetch } = useDataQuery(PROGRAM_METADATA_QUERY, {
        lazy: true,
        variables: { id: programId },
    })

    useEffect(() => {
        if (programId) {
            refetch({ id: programId })
        }
    }, [programId, refetch])

    const program = data?.program ?? null
    const assigned = program
        ? extractAssignedIds(data?.programRules?.programRules)
        : { assignedAttributes: [], assignedDataElements: [] }

    // Build a map of program rule variable name → UID for reference resolution
    const ruleVarMap = {}
    for (const v of data?.programRuleVariables?.programRuleVariables ?? []) {
        const uid = v.trackedEntityAttribute?.id ?? v.dataElement?.id
        if (uid) ruleVarMap[v.name] = uid
    }

    const metadata = program
        ? { ...program, ...assigned, ruleVarMap }
        : null

    return {
        metadata,
        loading,
        error,
    }
}
