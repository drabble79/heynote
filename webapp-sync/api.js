import { generateClientId, TEST_CLIENT_ID } from "@/src/common/client-id"

/**
 * Thin fetch wrapper for the sync server API.
 *
 * Every mutating request carries this browser's client id so the server can skip echoing the
 * change back over the WebSocket to the tab that caused it.
 */

const CLIENT_ID_KEY = "clientId"

let cachedClientId = null

export function getClientId() {
    if (cachedClientId) {
        return cachedClientId
    }
    if (__TESTS__) {
        localStorage.setItem(CLIENT_ID_KEY, TEST_CLIENT_ID)
        cachedClientId = TEST_CLIENT_ID
        return cachedClientId
    }
    let clientId = localStorage.getItem(CLIENT_ID_KEY)
    if (!clientId) {
        clientId = generateClientId()
        localStorage.setItem(CLIENT_ID_KEY, clientId)
    }
    cachedClientId = clientId
    return clientId
}

export class ApiError extends Error {
    constructor(status, body, fallbackMessage) {
        super(body?.error || fallbackMessage || `Request failed with status ${status}`)
        this.name = "ApiError"
        this.status = status
        this.body = body
    }
}

/** Raised when the note changed on the server since the version we based our edit on. */
export class ConflictError extends ApiError {
    constructor(body) {
        super(409, body)
        this.name = "ConflictError"
        this.serverContent = body?.serverContent
        this.serverVersion = body?.serverVersion
    }
}

/** Raised when the network (rather than the server) failed, so the caller can queue and retry. */
export class OfflineError extends Error {
    constructor(cause) {
        super("Could not reach the server")
        this.name = "OfflineError"
        this.cause = cause
    }
}

export async function apiFetch(path, {method = "GET", body, rawBody, contentType} = {}) {
    const headers = {"X-Heynote-Client-Id": getClientId()}
    const init = {method, headers, credentials: "same-origin"}

    if (rawBody !== undefined) {
        headers["Content-Type"] = contentType
        init.body = rawBody
    } else if (body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(body)
    }

    let response
    try {
        response = await fetch(`/api${path}`, init)
    } catch (error) {
        throw new OfflineError(error)
    }

    if (response.status === 204) {
        return null
    }

    let parsed = null
    const text = await response.text()
    if (text) {
        try {
            parsed = JSON.parse(text)
        } catch {
            parsed = null
        }
    }

    if (!response.ok) {
        if (response.status === 409 && parsed?.serverVersion !== undefined) {
            throw new ConflictError(parsed)
        }
        throw new ApiError(response.status, parsed, response.statusText)
    }
    return parsed
}

export function encodeQuery(params) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            search.set(key, value)
        }
    }
    const query = search.toString()
    return query ? `?${query}` : ""
}
