/**
 * Minimal DHIS2 API client for test harnesses.
 * Uses basic auth against the play instance.
 */

const BASE = process.env.DHIS2_BASE ?? 'https://play.im.dhis2.org/stable-2-42-4'
const USER = process.env.DHIS2_USER ?? 'admin'
const PASS = process.env.DHIS2_PASS ?? 'district'

const authHeader = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

export const api = {
    base: BASE,
    async get(path) {
        const url = path.startsWith('http') ? path : `${BASE}${path}`
        const res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } })
        if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`)
        return res.json()
    },
    async post(path, body, opts = {}) {
        const url = path.startsWith('http') ? path : `${BASE}${path}`
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: authHeader,
                'Content-Type': opts.contentType ?? 'application/json',
                Accept: 'application/json',
            },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        })
        const text = await res.text()
        let json = null
        try { json = text ? JSON.parse(text) : null } catch {}
        return { status: res.status, ok: res.ok, body: json, text }
    },
    async del(path) {
        const url = path.startsWith('http') ? path : `${BASE}${path}`
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { Authorization: authHeader, Accept: 'application/json' },
        })
        return { status: res.status, ok: res.ok }
    },
}

export function section(title) {
    console.log('\n=== ' + title + ' ===')
}

export function ok(msg) { console.log('[OK] ' + msg) }
export function fail(msg) { console.log('[FAIL] ' + msg) }
export function warn(msg) { console.log('[WARN] ' + msg) }
export function info(msg) { console.log('       ' + msg) }
