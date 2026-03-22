import React, { useEffect, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, CircularLoader, NoticeBox, Tag } from '@dhis2/ui'

const POLL_INTERVAL = 2000

export const ImportProgress = ({ payload, onReset }) => {
    const engine = useDataEngine()
    const [status, setStatus] = useState('submitting') // submitting | polling | complete | error
    const [jobId, setJobId] = useState(null)
    const [report, setReport] = useState(null)
    const [error, setError] = useState(null)

    // Submit the import
    useEffect(() => {
        const submit = async () => {
            try {
                const mutation = {
                    resource: 'tracker',
                    type: 'create',
                    params: {
                        async: true,
                        importStrategy: 'CREATE_AND_UPDATE',
                        atomicMode: 'OBJECT',
                    },
                    data: payload,
                }
                const response = await engine.mutate(mutation)
                if (response?.response?.id) {
                    setJobId(response.response.id)
                    setStatus('polling')
                } else {
                    // Synchronous response (small payload)
                    setReport(response)
                    setStatus('complete')
                }
            } catch (e) {
                setError(e.message || 'Import submission failed')
                setStatus('error')
            }
        }
        submit()
    }, [engine, payload])

    // Poll for async job status
    useEffect(() => {
        if (status !== 'polling' || !jobId) return

        const interval = setInterval(async () => {
            try {
                const query = {
                    job: {
                        resource: `tracker/jobs/${jobId}`,
                    },
                }
                const result = await engine.query(query)
                const jobReport = result?.job

                if (jobReport && jobReport.status !== 'RUNNING') {
                    setReport(jobReport)
                    setStatus('complete')
                    clearInterval(interval)
                }
            } catch (e) {
                // Job may not be ready yet, keep polling
            }
        }, POLL_INTERVAL)

        return () => clearInterval(interval)
    }, [engine, jobId, status])

    if (status === 'submitting') {
        return (
            <div>
                <h2>Step 5: Importing...</h2>
                <CircularLoader />
                <p>Submitting tracker payload to DHIS2...</p>
            </div>
        )
    }

    if (status === 'polling') {
        return (
            <div>
                <h2>Step 5: Importing...</h2>
                <CircularLoader />
                <p>Import job submitted. Checking progress...</p>
                <p>Job ID: <code>{jobId}</code></p>
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div>
                <h2>Step 5: Import Failed</h2>
                <NoticeBox error title="Import Error">
                    {error}
                </NoticeBox>
                <Button onClick={onReset} style={{ marginTop: 16 }}>
                    Start Over
                </Button>
            </div>
        )
    }

    // Complete
    const stats = report?.stats || report?.response?.stats || {}
    const importErrors = report?.validationReport?.errorReports || []

    return (
        <div>
            <h2>Step 5: Import Complete</h2>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <Tag positive>Created: {stats.created ?? 0}</Tag>
                <Tag neutral>Updated: {stats.updated ?? 0}</Tag>
                <Tag negative>Ignored: {stats.ignored ?? 0}</Tag>
                <Tag>Deleted: {stats.deleted ?? 0}</Tag>
            </div>

            {importErrors.length > 0 && (
                <NoticeBox warning title={`${importErrors.length} Import Errors`}>
                    <ul>
                        {importErrors.slice(0, 20).map((e, i) => (
                            <li key={i}>
                                [{e.errorCode}] {e.message}
                                {e.trackerType && ` (${e.trackerType}: ${e.uid})`}
                            </li>
                        ))}
                        {importErrors.length > 20 && (
                            <li>...and {importErrors.length - 20} more</li>
                        )}
                    </ul>
                </NoticeBox>
            )}

            {importErrors.length === 0 && (
                <NoticeBox title="Success">
                    All records imported successfully.
                </NoticeBox>
            )}

            <Button onClick={onReset} style={{ marginTop: 16 }}>
                Import More Data
            </Button>
        </div>
    )
}
