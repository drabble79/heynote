import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { PASSWORD, SECURE_COOKIES, SESSION_MAX_AGE_DAYS, SESSION_SECRET } from "./config.js"

/**
 * Single-user authentication: one shared password exchanged for an HMAC-signed session cookie.
 *
 * There are no user accounts, so there is nothing to put in the session beyond "this browser
 * proved it knows the password at time T".
 */

const COOKIE_NAME = "heynote_session"
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 3600 * 1000

// When no secret is configured we generate one per boot, which simply means existing sessions
// stop being valid after a restart.
const secret = SESSION_SECRET || randomBytes(32).toString("hex")

export const authEnabled = !!PASSWORD

function sign(value) {
    return createHmac("sha256", secret).update(value).digest("base64url")
}

function safeEqual(a, b) {
    const bufA = Buffer.from(a, "utf8")
    const bufB = Buffer.from(b, "utf8")
    if (bufA.length !== bufB.length) {
        return false
    }
    return timingSafeEqual(bufA, bufB)
}

export function checkPassword(candidate) {
    if (typeof candidate !== "string") {
        return false
    }
    return safeEqual(candidate, PASSWORD)
}

export function createSessionToken() {
    const payload = Buffer.from(JSON.stringify({iat: Date.now()}), "utf8").toString("base64url")
    return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token) {
    if (typeof token !== "string") {
        return false
    }
    const dot = token.lastIndexOf(".")
    if (dot <= 0) {
        return false
    }
    const payload = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    if (!safeEqual(signature, sign(payload))) {
        return false
    }
    try {
        const {iat} = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
        if (typeof iat !== "number") {
            return false
        }
        return Date.now() - iat < SESSION_MAX_AGE_MS
    } catch {
        return false
    }
}

export function parseCookies(cookieHeader) {
    const cookies = {}
    if (!cookieHeader) {
        return cookies
    }
    for (const part of cookieHeader.split(";")) {
        const eq = part.indexOf("=")
        if (eq === -1) {
            continue
        }
        const name = part.slice(0, eq).trim()
        if (name) {
            cookies[name] = decodeURIComponent(part.slice(eq + 1).trim())
        }
    }
    return cookies
}

export function isAuthenticatedRequest(req) {
    if (!authEnabled) {
        return true
    }
    const cookies = parseCookies(req.headers?.cookie)
    return verifySessionToken(cookies[COOKIE_NAME])
}

export function setSessionCookie(res) {
    const parts = [
        `${COOKIE_NAME}=${createSessionToken()}`,
        "HttpOnly",
        "SameSite=Strict",
        "Path=/",
        `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    ]
    if (SECURE_COOKIES) {
        parts.push("Secure")
    }
    res.setHeader("Set-Cookie", parts.join("; "))
}

export function clearSessionCookie(res) {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

/** Express middleware guarding the API. */
export function requireAuth(req, res, next) {
    if (isAuthenticatedRequest(req)) {
        next()
        return
    }
    res.status(401).json({error: "Unauthorized"})
}
