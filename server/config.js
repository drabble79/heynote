import fs from "node:fs"
import os from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Server configuration, all driven by environment variables so that the server can be run
 * from a systemd unit / container without a config file.
 */

function envInt(name, fallback) {
    const raw = process.env[name]
    if (raw === undefined || raw === "") {
        return fallback
    }
    const value = Number.parseInt(raw, 10)
    if (Number.isNaN(value)) {
        throw new Error(`${name} must be an integer, got: ${raw}`)
    }
    return value
}

export const PORT = envInt("HEYNOTE_PORT", 3333)
export const HOST = process.env.HEYNOTE_HOST || "127.0.0.1"

/** Root of the note library on the server's filesystem. Created on boot if missing. */
export const LIBRARY_PATH =
    process.env.HEYNOTE_LIBRARY_PATH || join(os.homedir(), ".heynote-server", "notes")

/**
 * Shared password for the single user this server belongs to. When unset the server runs
 * without authentication, which is only acceptable when it's bound to localhost.
 */
export const PASSWORD = process.env.HEYNOTE_PASSWORD || ""

/** Secret used to sign session cookies. Generated per boot when unset (invalidates sessions on restart). */
export const SESSION_SECRET = process.env.HEYNOTE_SESSION_SECRET || ""

export const SESSION_MAX_AGE_DAYS = envInt("HEYNOTE_SESSION_DAYS", 90)

/** Set when running behind a TLS-terminating reverse proxy, so the session cookie gets `Secure`. */
export const SECURE_COOKIES = process.env.HEYNOTE_SECURE_COOKIES === "1"

/** Max accepted note size, guards against a runaway client filling the disk. */
export const MAX_NOTE_BYTES = envInt("HEYNOTE_MAX_NOTE_BYTES", 10 * 1024 * 1024)

/** Max accepted image upload size. */
export const MAX_IMAGE_BYTES = envInt("HEYNOTE_MAX_IMAGE_BYTES", 20 * 1024 * 1024)

/**
 * Directory containing the built webapp-sync assets. Defaults to the output of
 * `npm run webapp-sync:build` when that exists, so `npm run server` serves the app too.
 * Set to "none" to run an API-only server (e.g. alongside the Vite dev server).
 */
export const STATIC_PATH = resolveStaticPath()

function resolveStaticPath() {
    const configured = process.env.HEYNOTE_STATIC_PATH
    if (configured === "none") {
        return ""
    }
    if (configured) {
        return configured
    }
    const built = fileURLToPath(new URL("../webapp-sync/dist", import.meta.url))
    return fs.existsSync(join(built, "index.html")) ? built : ""
}

export function describeConfig() {
    return {
        host: HOST,
        port: PORT,
        libraryPath: LIBRARY_PATH,
        authEnabled: !!PASSWORD,
        secureCookies: SECURE_COOKIES,
        staticPath: STATIC_PATH || "(not serving static files)",
    }
}
