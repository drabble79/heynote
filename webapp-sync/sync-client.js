import {
    LIBRARY_SEARCH_DONE,
    LIBRARY_SEARCH_ERROR,
    LIBRARY_SEARCH_MATCH,
} from "@/src/common/constants"

import { getClientId } from "./api.js"
import { SYNC_STATUS_EVENT } from "./events.js"

/**
 * WebSocket client: receives changes other browsers made, and carries streaming library-search
 * results.
 *
 * Search deliberately reuses the LIBRARY_SEARCH_* channels the renderer already uses for
 * Electron's ripgrep integration, so src/stores/search-store.js works unmodified.
 */

const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 15000

export class SyncClient {
    constructor(bridge) {
        this.bridge = bridge
        this.ws = null
        this.connected = false
        this.attempt = 0
        this.closed = false
        this.everConnected = false
        this.reconnectTimer = null
    }

    connect() {
        if (this.closed) {
            return
        }
        const protocol = location.protocol === "https:" ? "wss:" : "ws:"
        const url = `${protocol}//${location.host}/ws?clientId=${encodeURIComponent(getClientId())}`

        let ws
        try {
            ws = new WebSocket(url)
        } catch (error) {
            this._scheduleReconnect()
            return
        }
        this.ws = ws

        ws.addEventListener("open", () => {
            const wasDisconnected = this.everConnected && this.attempt > 0
            this.attempt = 0
            this.everConnected = true
            this._setConnected(true)
            if (wasDisconnected) {
                // We may have missed pushes while we were away.
                this.bridge.resyncOpenNotes()
                this.bridge.applyLibraryChange()
            }
        })

        ws.addEventListener("message", (event) => {
            let message
            try {
                message = JSON.parse(event.data)
            } catch {
                return
            }
            this._dispatch(message)
        })

        ws.addEventListener("close", () => {
            this.ws = null
            this._setConnected(false)
            this._scheduleReconnect()
        })

        ws.addEventListener("error", () => {
            // 'close' always follows, which is where reconnection is handled
        })
    }

    _dispatch(message) {
        switch (message.type) {
            case "note:changed":
                this.bridge.applyRemoteNoteChange(message.path, message.content, message.version)
                break
            case "library:changed":
                this.bridge.applyLibraryChange()
                break
            case "settings:changed":
                this.bridge.applyRemoteSettings(message.settings)
                break
            case "search:match":
                this.bridge.ipcRenderer.send(LIBRARY_SEARCH_MATCH, message)
                break
            case "search:done":
                this.bridge.ipcRenderer.send(LIBRARY_SEARCH_DONE, message)
                break
            case "search:error":
                this.bridge.ipcRenderer.send(LIBRARY_SEARCH_ERROR, message)
                break
        }
    }

    /** Reports only the push channel; the save queue reports itself from the bridge. */
    _setConnected(connected) {
        this.connected = connected
        this.bridge.ipcRenderer.send(SYNC_STATUS_EVENT, {connected})
    }

    _scheduleReconnect() {
        if (this.closed || this.reconnectTimer) {
            return
        }
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempt, RECONNECT_MAX_MS)
        this.attempt += 1
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.connect()
        }, delay)
    }

    _send(payload) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload))
            return true
        }
        return false
    }

    startSearch(options) {
        if (!this._send({type: "search:start", options})) {
            // Without a connection there's nothing to search against; end the search cleanly so
            // the UI doesn't sit on a spinner.
            this.bridge.ipcRenderer.send(LIBRARY_SEARCH_ERROR, {
                searchId: options?.searchId,
                message: "Not connected to the server",
            })
        }
    }

    cancelSearch() {
        this._send({type: "search:cancel"})
    }

    close() {
        this.closed = true
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
        this.ws?.close()
        this.ws = null
    }
}
