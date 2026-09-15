import { WebSocketServer } from "ws"

import { isAuthenticatedRequest } from "./auth.js"
import { startLibrarySearch } from "@/shared-node/ripgrep.js"

/**
 * WebSocket hub: pushes note/library/settings changes to every connected browser, and carries
 * streaming library-search results.
 *
 * Search keeps the exact event contract the renderer already uses for Electron
 * (LIBRARY_SEARCH_MATCH/DONE/ERROR carrying a `searchId`), so src/stores/search-store.js needs
 * no changes.
 */

const HEARTBEAT_INTERVAL_MS = 30000

export class SyncHub {
    constructor({server, library}) {
        this.library = library
        this.wss = new WebSocketServer({noServer: true})
        /** @type {Map<import("ws").WebSocket, {clientId: string, search: {kill(): void}|null, alive: boolean}>} */
        this.clients = new Map()

        server.on("upgrade", (req, socket, head) => {
            const url = new URL(req.url, "http://localhost")
            if (url.pathname !== "/ws") {
                socket.destroy()
                return
            }
            if (!isAuthenticatedRequest(req)) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
                socket.destroy()
                return
            }
            this.wss.handleUpgrade(req, socket, head, (ws) => {
                this._onConnection(ws, url.searchParams.get("clientId") || "")
            })
        })

        this.heartbeat = setInterval(() => {
            for (const [ws, state] of this.clients) {
                if (!state.alive) {
                    ws.terminate()
                    continue
                }
                state.alive = false
                ws.ping()
            }
        }, HEARTBEAT_INTERVAL_MS)
        this.heartbeat.unref?.()
    }

    _onConnection(ws, clientId) {
        const state = {clientId, search: null, alive: true}
        this.clients.set(ws, state)

        ws.on("pong", () => {
            state.alive = true
        })

        ws.on("message", (raw) => {
            let message
            try {
                message = JSON.parse(raw.toString())
            } catch {
                return
            }
            this._onMessage(ws, state, message)
        })

        ws.on("close", () => {
            state.search?.kill()
            this.clients.delete(ws)
        })

        ws.on("error", () => {
            state.search?.kill()
            this.clients.delete(ws)
        })

        this._send(ws, {type: "connected", clientId})
    }

    _onMessage(ws, state, message) {
        switch (message?.type) {
            case "search:start":
                this._startSearch(ws, state, message.options || {})
                break
            case "search:cancel":
                state.search?.kill()
                state.search = null
                break
            case "identify":
                if (typeof message.clientId === "string") {
                    state.clientId = message.clientId
                }
                break
        }
    }

    _startSearch(ws, state, options) {
        // Only one search per connection: a newer query supersedes whatever is still running.
        state.search?.kill()
        state.search = null
        try {
            state.search = startLibrarySearch(this.library, options, (payload) => {
                // the spread has to come first: payload carries its own `type` ("match", "done",
                // ...) which would otherwise overwrite the channel name the client routes on
                this._send(ws, {...payload, type: `search:${payload.type}`})
            })
        } catch (error) {
            this._send(ws, {
                type: "search:error",
                searchId: options.searchId,
                message: error.message,
            })
        }
    }

    _send(ws, payload) {
        if (ws.readyState !== ws.OPEN) {
            return
        }
        ws.send(JSON.stringify(payload))
    }

    /**
     * @param {object} payload
     * @param {string} [originClientId] Client that caused the change; it already applied the
     *        change locally and must not be told to reload it.
     */
    broadcast(payload, originClientId = null) {
        for (const [ws, state] of this.clients) {
            if (originClientId && state.clientId === originClientId) {
                continue
            }
            this._send(ws, payload)
        }
    }

    noteChanged(path, content, version, originClientId = null) {
        this.broadcast({type: "note:changed", path, content, version}, originClientId)
    }

    libraryChanged(originClientId = null) {
        this.broadcast({type: "library:changed"}, originClientId)
    }

    settingsChanged(settings, originClientId = null) {
        this.broadcast({type: "settings:changed", settings}, originClientId)
    }

    close() {
        clearInterval(this.heartbeat)
        for (const [ws, state] of this.clients) {
            state.search?.kill()
            ws.close()
        }
        this.clients.clear()
        this.wss.close()
    }
}
