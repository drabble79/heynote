import { randomUUID } from "node:crypto"

import { CURRENCY_RATES_URL, getCurrencyFetchOptions } from "@/src/common/currency-request"

/**
 * Currency-rate proxy.
 *
 * The renderer fetches this URL directly in Electron only because electron/main/cors.ts
 * rewrites the response headers. A browser can't do that, so the server fetches it instead and
 * caches the result for the same 12 hours the desktop app does.
 */

const STALE_TIME_MS = 1000 * 3600 * 12

const clientId = randomUUID()

let cache = {data: null, timeFetched: 0}

export async function fetchCurrencyData(version) {
    const age = Date.now() - cache.timeFetched
    if (cache.data && age < STALE_TIME_MS) {
        return cache.data
    }

    let response
    try {
        response = await fetch(
            CURRENCY_RATES_URL,
            getCurrencyFetchOptions(clientId, `${version}-server`),
        )
    } catch (error) {
        // serve stale data rather than failing the request
        if (cache.data) {
            return cache.data
        }
        throw error
    }

    if (!response.ok) {
        if (cache.data) {
            return cache.data
        }
        throw new Error(`upstream responded ${response.status}`)
    }

    const data = JSON.parse(await response.text())
    cache = {data, timeFetched: Date.now()}
    return data
}
