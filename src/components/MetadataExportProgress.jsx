import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDataEngine } from '@dhis2/app-runtime'
import { Button, ButtonStrip, CircularLoader, NoticeBox } from '@dhis2/ui'
import { buildMetadataWorkbook, buildAllMetadataWorkbook, downloadMetadataWorkbook } from '../lib/metadataExporter'
import { METADATA_TYPES } from './MetadataTypeSelector'

const PAGE_SIZE = 500

/**
 * Fetches metadata from DHIS2, builds Excel, and offers download.
 *
 * Props:
 *  - metadataType: type definition from METADATA_TYPES
 *  - onReset: () => void
 *  - onBack: () => void
 */
export const MetadataExportProgress = ({ metadataType, onReset, onBack }) => {
    const engine = useDataEngine()
    const [status, setStatus] = useState('fetching')
    const [error, setError] = useState(null)
    const [fetched, setFetched] = useState(0)
    const [statusMsg, setStatusMsg] = useState('Fetching metadata...')
    const resultRef = useRef(null)

    const fetchMetadata = useCallback(async () => {
        const allItems = []
        let page = 1
        // eslint-disable-next-line no-constant-condition
        while (true) {
            setStatusMsg(`Fetching ${metadataType.label} (page ${page})...`)
            const result = await engine.query({
                data: {
                    resource: metadataType.resource,
                    params: {
                        fields: metadataType.fields,
                        page,
                        pageSize: PAGE_SIZE,
                        paging: true,
                    },
                },
            })
            const items = result?.data?.[metadataType.resource] ?? []
            allItems.push(...items)
            setFetched(allItems.length)
            if (items.length < PAGE_SIZE) break
            page++
        }
        return allItems
    }, [engine, metadataType])

    useEffect(() => {
        const run = async () => {
            try {
                if (metadataType.key === 'allMetadata') {
                    const realTypes = METADATA_TYPES.filter((t) => t.resource)
                    const dataByType = {}
                    let totalFetched = 0
                    for (const mt of realTypes) {
                        setStatusMsg(`Fetching ${mt.label}...`)
                        let page = 1
                        const items = []
                        // eslint-disable-next-line no-constant-condition
                        while (true) {
                            const result = await engine.query({
                                data: {
                                    resource: mt.resource,
                                    params: { fields: mt.fields, page, pageSize: PAGE_SIZE, paging: true },
                                },
                            })
                            const batch = result?.data?.[mt.resource] ?? []
                            items.push(...batch)
                            totalFetched += batch.length
                            setFetched(totalFetched)
                            if (batch.length < PAGE_SIZE) break
                            page++
                        }
                        dataByType[mt.key] = items
                    }
                    if (totalFetched === 0) { setStatus('empty'); return }
                    setStatus('building')
                    setStatusMsg('Building combined workbook...')
                    const result = buildAllMetadataWorkbook(realTypes, dataByType)
                    resultRef.current = result
                    setStatus('complete')
                } else {
                    const data = await fetchMetadata()
                    if (data.length === 0) {
                        setStatus('empty')
                        return
                    }
                    setStatus('building')
                    setStatusMsg('Building Excel workbook...')
                    const result = buildMetadataWorkbook(metadataType, data)
                    resultRef.current = result
                    setStatus('complete')
                }
            } catch (e) {
                setError(e.message || 'Export failed')
                setStatus('error')
            }
        }
        run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleDownload = () => {
        if (resultRef.current) {
            const { wb, filename, sheetColors } = resultRef.current
            downloadMetadataWorkbook(wb, filename, sheetColors)
        }
    }

    if (status === 'fetching' || status === 'building') {
        return (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <CircularLoader />
                <p style={{ color: '#4a5568', fontSize: 14, marginTop: 16 }}>{statusMsg}</p>
                {fetched > 0 && (
                    <p style={{ color: '#6b7280', fontSize: 13 }}>{fetched} records fetched so far</p>
                )}
            </div>
        )
    }

    if (status === 'empty') {
        return (
            <div>
                <NoticeBox warning title="No Data Found">
                    No {metadataType.label.toLowerCase()} found in the system.
                </NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div>
                <NoticeBox error title="Export Failed">{error}</NoticeBox>
                <ButtonStrip style={{ marginTop: 16 }}>
                    <Button secondary onClick={onBack}>Back</Button>
                    <Button onClick={onReset}>Start Over</Button>
                </ButtonStrip>
            </div>
        )
    }

    return (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: '#E8F5E9', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                    <path d="M8 16l5 5L24 10" stroke="#2E7D32" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1a202c' }}>
                Export Ready
            </h2>
            <p style={{ color: '#4a5568', fontSize: 14, marginBottom: 4 }}>
                {fetched} {metadataType.label.toLowerCase()} exported.
            </p>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
                {resultRef.current?.filename}
            </p>
            <ButtonStrip style={{ justifyContent: 'center' }}>
                <Button primary onClick={handleDownload}>Download Excel</Button>
                <Button onClick={onReset}>Start Over</Button>
            </ButtonStrip>
        </div>
    )
}
