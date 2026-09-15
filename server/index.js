import http from "node:http"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import express from "express"

import { IMAGE_MIME_TYPES } from "@/src/common/constants"
import {
    HOST,
    MAX_IMAGE_BYTES,
    MAX_NOTE_BYTES,
    PORT,
    STATIC_PATH,
    describeConfig,
} from "./config.js"
import {
    authEnabled,
    checkPassword,
    clearSessionCookie,
    isAuthenticatedRequest,
    requireAuth,
    setSessionCookie,
} from "./auth.js"
import { ConflictError, SyncLibrary } from "./library.js"
import { InvalidPathError, validateDirectoryPath, validateNotePath } from "./paths.js"
import { SettingsStore } from "./settings.js"
import { SyncHub } from "./ws.js"
import { fetchCurrencyData } from "./currency.js"

const APP_VERSION = readPackageVersion()

function readPackageVersion() {
    try {
        const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
        return pkg.version
    } catch {
        return "unknown"
    }
}

/** Client that issued the current request, used to skip echoing changes back to it. */
function originClientId(req) {
    const value = req.get("X-Heynote-Client-Id") || req.body?.clientId
    return typeof value === "string" && value ? value : null
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function createServer() {
    const app = express()
    const server = http.createServer(app)

    const hub = new SyncHub({server, library: null})
    const library = new SyncLibrary({
        onNoteChanged: (path, content, version) => hub.noteChanged(path, content, version),
        onLibraryChanged: () => hub.libraryChanged(),
    })
    // the hub needs library.basePath for ripgrep; wire it up now that the library exists
    hub.library = library

    const settingsStore = new SettingsStore(library.basePath)

    app.set("trust proxy", true)
    app.disable("x-powered-by")
    app.use(express.json({limit: MAX_NOTE_BYTES}))

    // ---------------------------------------------------------------- auth

    app.post("/api/login", (req, res) => {
        if (!authEnabled) {
            res.json({ok: true, authEnabled: false})
            return
        }
        if (!checkPassword(req.body?.password)) {
            res.status(401).json({error: "Invalid password"})
            return
        }
        setSessionCookie(res)
        res.json({ok: true})
    })

    app.post("/api/logout", (req, res) => {
        clearSessionCookie(res)
        res.json({ok: true})
    })

    app.get("/api/session", (req, res) => {
        res.json({authEnabled, authenticated: isAuthenticatedRequest(req)})
    })

    // everything below requires a session
    app.use("/api", requireAuth)

    // ---------------------------------------------------------- bootstrap

    // The renderer reads window.heynote.settings synchronously at module-evaluation time, so the
    // client fetches everything it needs to build the bridge in one round trip before booting.
    app.get("/api/bootstrap", asyncRoute(async (req, res) => {
        const [notes, directories] = await Promise.all([
            library.getList(),
            library.getDirectoryList(),
        ])
        res.json({
            version: APP_VERSION,
            settings: settingsStore.get(),
            scratchFileName: library.scratchFileName,
            notes,
            directories,
        })
    }))

    // -------------------------------------------------------------- notes

    app.get("/api/notes", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.query.path)
        const {content, version} = await library.read(path)
        res.json({path, content, version})
    }))

    app.put("/api/notes", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.body?.path)
        const {content, baseVersion} = req.body || {}
        if (typeof content !== "string") {
            res.status(400).json({error: "content must be a string"})
            return
        }
        const result = await library.write(path, content, baseVersion ?? null)
        res.json({path, version: result.version})
        if (!result.unchanged) {
            hub.noteChanged(path, content, result.version, originClientId(req))
        }
    }))

    app.post("/api/notes", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.body?.path)
        const content = req.body?.content
        if (typeof content !== "string") {
            res.status(400).json({error: "content must be a string"})
            return
        }
        const {version} = await library.create(path, content)
        res.json({path, version})
        hub.libraryChanged(originClientId(req))
    }))

    app.delete("/api/notes", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.query.path)
        await library.delete(path)
        res.json({ok: true})
        hub.libraryChanged(originClientId(req))
    }))

    app.post("/api/notes/move", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.body?.path)
        const newPath = validateNotePath(req.body?.newPath)
        await library.move(path, newPath)
        res.json({ok: true})
        hub.libraryChanged(originClientId(req))
    }))

    app.get("/api/notes/exists", asyncRoute(async (req, res) => {
        const path = validateNotePath(req.query.path)
        res.json({exists: await library.exists(path)})
    }))

    /**
     * Bulk save used by navigator.sendBeacon() on page unload, where an async fetch is not
     * reliable. Beacons can't read a response, so conflicts are resolved by last-write-wins
     * rather than reported.
     */
    app.post("/api/notes/flush", asyncRoute(async (req, res) => {
        const contents = Array.isArray(req.body?.contents) ? req.body.contents : []
        const origin = originClientId(req)
        const saved = []
        for (const entry of contents) {
            const [path, content] = Array.isArray(entry) ? entry : []
            if (typeof path !== "string" || typeof content !== "string") {
                continue
            }
            try {
                const safePath = validateNotePath(path)
                const result = await library.write(safePath, content, null)
                if (!result.unchanged) {
                    saved.push(safePath)
                    hub.noteChanged(safePath, content, result.version, origin)
                }
            } catch (error) {
                console.error(`flush failed for ${path}:`, error.message)
            }
        }
        res.json({ok: true, saved})
    }))

    // ------------------------------------------------------------ library

    app.get("/api/library", asyncRoute(async (req, res) => {
        const [notes, directories] = await Promise.all([
            library.getList(),
            library.getDirectoryList(),
        ])
        res.json({notes, directories})
    }))

    app.post("/api/directories", asyncRoute(async (req, res) => {
        const path = validateDirectoryPath(req.body?.path)
        await library.createDirectory(path)
        res.json({ok: true})
        hub.libraryChanged(originClientId(req))
    }))

    app.delete("/api/directories", asyncRoute(async (req, res) => {
        const path = validateDirectoryPath(req.query.path)
        await library.deleteDirectory(path)
        res.json({ok: true})
        hub.libraryChanged(originClientId(req))
    }))

    app.get("/api/directories/empty", asyncRoute(async (req, res) => {
        const path = validateDirectoryPath(req.query.path)
        res.json({empty: await library.isDirectoryEmpty(path)})
    }))

    // ----------------------------------------------------------- settings

    app.get("/api/settings", (req, res) => {
        res.json({settings: settingsStore.get()})
    })

    app.put("/api/settings", (req, res) => {
        const settings = settingsStore.set(req.body?.settings)
        res.json({settings})
        hub.settingsChanged(settings, originClientId(req))
    })

    // ------------------------------------------------------------- images

    app.post(
        "/api/images",
        express.raw({type: IMAGE_MIME_TYPES, limit: MAX_IMAGE_BYTES}),
        asyncRoute(async (req, res) => {
            const mime = req.get("Content-Type")
            if (!IMAGE_MIME_TYPES.includes(mime)) {
                res.status(415).json({error: `Unsupported image type: ${mime}`})
                return
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                res.status(400).json({error: "empty image body"})
                return
            }
            const filename = await library.saveImage({mime, data: req.body})
            res.json({filename})
        })
    )

    app.get("/api/images/:filename", asyncRoute(async (req, res) => {
        const fullPath = library.imagePath(req.params.filename)
        if (!fullPath) {
            res.status(404).json({error: "Image not found"})
            return
        }
        res.sendFile(fullPath, {
            headers: {"Cache-Control": "private, max-age=31536000, immutable"},
        })
    }))

    // ----------------------------------------------------------- currency

    // Electron bypasses CORS for this request (electron/main/cors.ts); the browser can't, so the
    // server proxies it and caches the result the same way the desktop app does.
    app.get("/api/currency", asyncRoute(async (req, res) => {
        try {
            res.json(await fetchCurrencyData(APP_VERSION))
        } catch (error) {
            res.status(502).json({error: `Failed to fetch currency data: ${error.message}`})
        }
    }))

    // ------------------------------------------------------- static files

    if (STATIC_PATH) {
        app.use(express.static(STATIC_PATH, {index: false}))
        app.get(/^(?!\/api\/).*/, (req, res) => {
            res.sendFile(join(STATIC_PATH, "index.html"))
        })
    }

    // -------------------------------------------------- error handling

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            next(error)
            return
        }
        if (error instanceof ConflictError) {
            res.status(409).json({
                error: error.message,
                serverContent: error.serverContent,
                serverVersion: error.serverVersion,
            })
            return
        }
        if (error instanceof InvalidPathError) {
            res.status(400).json({error: error.message})
            return
        }
        const status = error.statusCode || 500
        if (status >= 500) {
            console.error(error)
        }
        res.status(status).json({error: error.message || "Internal server error"})
    })

    return {app, server, hub, library, settingsStore}
}

export function start() {
    const {server, hub, library} = createServer()

    server.listen(PORT, HOST, () => {
        console.log("Heynote sync server listening")
        for (const [key, value] of Object.entries(describeConfig())) {
            console.log(`  ${key}: ${value}`)
        }
        if (!authEnabled && HOST !== "127.0.0.1" && HOST !== "localhost") {
            console.warn(
                "\n  WARNING: HEYNOTE_PASSWORD is not set and the server is not bound to localhost.\n" +
                "  Anyone who can reach this port can read and write your notes.\n"
            )
        }
    })

    const shutdown = () => {
        console.log("\nShutting down...")
        hub.close()
        library.close()
        server.close(() => process.exit(0))
        setTimeout(() => process.exit(0), 3000).unref()
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    return {server, hub, library}
}

// `vite-node server/index.js` and the bundled build both execute this module directly.
if (!process.env.HEYNOTE_SERVER_NO_AUTOSTART) {
    start()
}
