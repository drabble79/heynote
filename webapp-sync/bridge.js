import {
    LIBRARY_SEARCH_CANCEL,
    LIBRARY_SEARCH_START,
    LOAD_TABS_STATE,
    SAVE_TABS_STATE,
    SETTINGS_CHANGE_EVENT,
    WINDOW_CLOSE_EVENT,
    WINDOW_FOCUS_STATE,
    WINDOW_FULLSCREEN_STATE,
} from "@/src/common/constants"
import { DEVICE_LOCAL_SETTINGS, getDefaultSettings } from "@/src/common/default-settings"

import { ApiError, apiFetch, ConflictError, encodeQuery, getClientId, OfflineError } from "./api.js"
import { MERGE_CLEAN, mergeNoteContent } from "./merge.js"
import { SYNC_CONFLICT_EVENT, SYNC_STATUS_EVENT } from "./events.js"

import {
    deleteViewState,
    loadViewState,
    mergeViewState,
    moveViewState,
    saveViewState,
    splitViewState,
} from "./view-state.js"

/** Backoff bounds for retrying saves that failed because the server was unreachable. */
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30000

/**
 * The server-synced implementation of the `window.heynote` interface.
 *
 * This is the third implementation of the same surface, alongside electron/preload/index.js
 * (IPC) and webapp/bridge.js (localStorage). Everything under src/ is written against this
 * interface, which is why a synced web build needs almost no changes to the app itself.
 */

const DEVICE_SETTINGS_KEY = "settings"
const TABS_STATE_KEY = "openTabsState"
const THEME_KEY = "theme"

const mediaMatch = window.matchMedia("(prefers-color-scheme: dark)")
const isMobileDevice = window.matchMedia("(max-width: 600px)").matches

function detectPlatform() {
    // Playwright doesn't report navigator.userAgentData.platform correctly on Mac, so under test
    // we fall back to the deprecated (but still working) navigator.platform.
    if (__TESTS__ && window.navigator.platform.indexOf("Mac") !== -1) {
        return {isMac: true, isWindows: false, isLinux: false, isWebApp: true}
    }
    const uaPlatform = window.navigator?.userAgentData?.platform || window.navigator.platform
    if (uaPlatform.indexOf("Win") !== -1) {
        return {isMac: false, isWindows: true, isLinux: false, isWebApp: true}
    }
    if (uaPlatform.indexOf("Linux") !== -1) {
        return {isMac: false, isWindows: false, isLinux: true, isWebApp: true}
    }
    return {isMac: true, isWindows: false, isLinux: false, isWebApp: true}
}

/** In-process pub/sub standing in for Electron's ipcRenderer. */
class IpcRenderer {
    constructor() {
        this.callbacks = {}
    }

    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = []
        }
        this.callbacks[event].push(callback)
    }

    off(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter((cb) => cb !== callback)
        }
    }

    send(event, ...args) {
        for (const callback of this.callbacks[event] || []) {
            callback(null, ...args)
        }
    }
}

/**
 * Splits the renderer's single flat settings object into the part the server syncs and the part
 * that stays on this device (panel width, open sidebar folders, ... — see DEVICE_LOCAL_SETTINGS).
 */
function splitSettings(settings) {
    const deviceLocal = {}
    const synced = {}
    for (const [key, value] of Object.entries(settings || {})) {
        if (DEVICE_LOCAL_SETTINGS.includes(key)) {
            deviceLocal[key] = value
        } else {
            synced[key] = value
        }
    }
    return {deviceLocal, synced}
}

function loadDeviceSettings() {
    try {
        const stored = localStorage.getItem(DEVICE_SETTINGS_KEY)
        return stored ? JSON.parse(stored) : {}
    } catch {
        return {}
    }
}

export function createBridge(boot) {
    const platform = detectPlatform()
    const ipcRenderer = new IpcRenderer()

    // Version (content hash) of each note as last seen from the server, used as the
    // `baseVersion` of the next write so the server can detect a concurrent edit.
    const versions = new Map()
    // The exact content that version corresponds to — the common ancestor for a 3-way merge.
    const baseContents = new Map()

    let settings = {
        ...getDefaultSettings({isMac: platform.isMac}),
        ...boot.settings,
        ...loadDeviceSettings(),
    }

    let themeCallback = null
    let sync = null

    /**
     * Saves that failed because the server was unreachable, keyed by path so a later edit
     * supersedes an earlier one. Without this a save lost to a dropped connection would be
     * silently discarded: HeynoteEditor marks the buffer clean as soon as it hands the content
     * over, so nothing would ever retry it.
     */
    const pendingSaves = new Map()
    let retryTimer = null
    let retryDelay = RETRY_BASE_MS

    /** Reports only the save queue; the WebSocket reports itself from the sync client. */
    function reportStatus(message = "") {
        ipcRenderer.send(SYNC_STATUS_EVENT, {pending: pendingSaves.size, message})
    }

    function queueRetry(path, content) {
        pendingSaves.set(path, content)
        reportStatus()
        scheduleRetry()
    }

    function scheduleRetry() {
        if (retryTimer || pendingSaves.size === 0) {
            return
        }
        retryTimer = setTimeout(async () => {
            retryTimer = null
            const entries = [...pendingSaves.entries()]
            let recovered = true
            for (const [path, content] of entries) {
                try {
                    await sendSave(path, content, {retrying: true})
                    pendingSaves.delete(path)
                } catch (error) {
                    if (error instanceof OfflineError) {
                        recovered = false
                        break
                    }
                    // a real server error won't fix itself by retrying the same bytes
                    pendingSaves.delete(path)
                    reportStatus(error.message)
                }
            }
            if (pendingSaves.size === 0 && recovered) {
                retryDelay = RETRY_BASE_MS
                reportStatus()
                return
            }
            retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
            scheduleRetry()
        }, retryDelay)
    }

    /** The actual write, shared by the normal path and the retry loop. */
    async function sendSave(path, shared, {retrying = false} = {}) {
        const baseVersion = versions.get(path) ?? null
        try {
            const result = await apiFetch("/notes", {
                method: "PUT",
                body: {path, content: shared, baseVersion},
            })
            versions.set(path, result.version)
            baseContents.set(path, shared)
            if (!retrying) {
                reportStatus()
            }
        } catch (error) {
            if (error instanceof ConflictError) {
                await resolveConflict(path, shared, error)
                return
            }
            throw error
        }
    }

    const onChangeCallbacks = {}
    const libraryChangeCallbacks = []

    /**
     * Hands new content to the open editor for `path`, with this device's cursor re-attached.
     *
     * @param {object} [options]
     * @param {boolean} [options.force] Apply even if the editor has unsaved changes. Only set
     *        when the user explicitly chose to discard them.
     */
    function pushToEditor(path, sharedContent, options = {}) {
        const withViewState = mergeViewState(sharedContent, loadViewState(path))
        for (const callback of onChangeCallbacks[path] || []) {
            callback(withViewState, options)
        }
    }

    /**
     * The server rejected our save because the note moved on. Try to reconcile automatically;
     * only bother the user when the same lines were edited on both sides.
     */
    async function resolveConflict(path, localShared, conflict) {
        const merged = mergeNoteContent({
            local: localShared,
            base: baseContents.get(path),
            server: conflict.serverContent,
        })

        if (merged.status !== MERGE_CLEAN) {
            ipcRenderer.send(SYNC_CONFLICT_EVENT, {
                path,
                localContent: localShared,
                serverContent: conflict.serverContent,
                serverVersion: conflict.serverVersion,
            })
            return
        }

        if (merged.content === conflict.serverContent) {
            // nothing of ours survived the merge - just adopt the server's copy
            versions.set(path, conflict.serverVersion)
            baseContents.set(path, conflict.serverContent)
            pushToEditor(path, conflict.serverContent)
            return
        }

        const result = await apiFetch("/notes", {
            method: "PUT",
            body: {path, content: merged.content, baseVersion: conflict.serverVersion},
        })
        versions.set(path, result.version)
        baseContents.set(path, merged.content)
        pushToEditor(path, merged.content)
    }

    const buffer = {
        pathSeparator: "/",

        async load(path) {
            const {content, version} = await apiFetch(`/notes${encodeQuery({path})}`)
            versions.set(path, version)
            baseContents.set(path, content)
            return mergeViewState(content, loadViewState(path))
        },

        async save(path, content) {
            const {shared, viewState} = splitViewState(content)
            saveViewState(path, viewState)

            // A cursor move rewrites the note header but changes nothing worth syncing. Without
            // this check every open tab would POST twice a second forever.
            if (baseContents.get(path) === shared) {
                return
            }

            try {
                await sendSave(path, shared)
                pendingSaves.delete(path)
            } catch (error) {
                if (error instanceof OfflineError) {
                    queueRetry(path, shared)
                    return
                }
                reportStatus(error.message)
                throw error
            }
        },

        async create(path, content) {
            const {shared, viewState} = splitViewState(content)
            saveViewState(path, viewState)
            const result = await apiFetch("/notes", {method: "POST", body: {path, content: shared}})
            versions.set(path, result.version)
            baseContents.set(path, shared)
        },

        async delete(path) {
            await apiFetch(`/notes${encodeQuery({path})}`, {method: "DELETE"})
            versions.delete(path)
            baseContents.delete(path)
            deleteViewState(path)
        },

        async move(path, newPath) {
            await apiFetch("/notes/move", {method: "POST", body: {path, newPath}})
            const version = versions.get(path)
            const base = baseContents.get(path)
            versions.delete(path)
            baseContents.delete(path)
            if (version !== undefined) {
                versions.set(newPath, version)
            }
            if (base !== undefined) {
                baseContents.set(newPath, base)
            }
            moveViewState(path, newPath)
        },

        async exists(path) {
            const {exists} = await apiFetch(`/notes/exists${encodeQuery({path})}`)
            return exists
        },

        async getList() {
            const {notes} = await apiFetch("/library")
            return notes
        },

        async getDirectoryList() {
            const {directories} = await apiFetch("/library")
            return directories
        },

        async createDirectory(path) {
            await apiFetch("/directories", {method: "POST", body: {path}})
        },

        async deleteDirectory(path) {
            await apiFetch(`/directories${encodeQuery({path})}`, {method: "DELETE"})
            return true
        },

        async isDirectoryEmpty(path) {
            const {empty} = await apiFetch(`/directories/empty${encodeQuery({path})}`)
            return empty
        },

        async close(path) {
            versions.delete(path)
            baseContents.delete(path)
        },

        /**
         * Called from a beforeunload handler, where an async fetch is not guaranteed to be
         * delivered — sendBeacon is.
         */
        async saveAndQuit(contents) {
            const payload = []
            // anything still waiting to be retried has to go out now or it's lost
            for (const [path, content] of pendingSaves) {
                payload.push([path, content])
            }
            for (const [path, content] of contents) {
                const {shared, viewState} = splitViewState(content)
                saveViewState(path, viewState)
                if (baseContents.get(path) !== shared) {
                    payload.push([path, shared])
                }
            }
            if (payload.length === 0) {
                return
            }
            const body = JSON.stringify({contents: payload, clientId: getClientId()})
            const blob = new Blob([body], {type: "application/json"})
            if (!navigator.sendBeacon("/api/notes/flush", blob)) {
                await fetch("/api/notes/flush", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body,
                    keepalive: true,
                    credentials: "same-origin",
                })
            }
        },

        async saveImage({mime, data}) {
            const {filename} = await apiFetch("/images", {
                method: "POST",
                rawBody: data instanceof Blob ? data : new Blob([data], {type: mime}),
                contentType: mime,
            })
            return filename
        },

        _onChangeCallbacks: onChangeCallbacks,

        addOnChangeCallback(path, callback) {
            if (!onChangeCallbacks[path]) {
                onChangeCallbacks[path] = []
            }
            onChangeCallbacks[path].push(callback)
        },

        removeOnChangeCallback(path, callback) {
            if (onChangeCallbacks[path]) {
                onChangeCallbacks[path] = onChangeCallbacks[path].filter((cb) => cb !== callback)
            }
        },

        setLibraryPathChangeCallback(callback) {
            libraryChangeCallbacks.push(callback)
        },
    }

    const Heynote = {
        platform,
        defaultFontFamily: "Hack",
        defaultFontSize: isMobileDevice ? 16 : 12,
        isDev: import.meta.env.DEV,

        buffer,

        init() {
            if (platform.isMac) {
                document.documentElement.setAttribute("platform", "mac")
            } else if (platform.isWindows) {
                document.documentElement.setAttribute("platform", "windows")
            } else if (platform.isLinux) {
                document.documentElement.setAttribute("platform", "linux")
            }

            // The Electron main process pushes these; in the browser they come from the window
            // itself. Without them heynoteStore.isFocused stays permanently true and the sidebar
            // never renders its blurred colours.
            window.addEventListener("focus", () => ipcRenderer.send(WINDOW_FOCUS_STATE, true))
            window.addEventListener("blur", () => ipcRenderer.send(WINDOW_FOCUS_STATE, false))
            document.addEventListener("fullscreenchange", () => {
                ipcRenderer.send(WINDOW_FULLSCREEN_STATE, !!document.fullscreenElement)
            })
            window.addEventListener("beforeunload", () => ipcRenderer.send(WINDOW_CLOSE_EVENT))
        },

        mainProcess: {
            on(event, callback) {
                ipcRenderer.on(event, callback)
            },
            off(event, callback) {
                ipcRenderer.off(event, callback)
            },
            invoke(event, ...args) {
                switch (event) {
                    // Tab layout is deliberately per-device: which notes you have open on your
                    // laptop shouldn't rearrange the tabs on your desktop.
                    case SAVE_TABS_STATE:
                        try {
                            localStorage.setItem(TABS_STATE_KEY, JSON.stringify(args[0]))
                        } catch {
                            // ignore quota errors
                        }
                        return undefined
                    case LOAD_TABS_STATE: {
                        try {
                            const stored = localStorage.getItem(TABS_STATE_KEY)
                            return stored ? JSON.parse(stored) : undefined
                        } catch {
                            return undefined
                        }
                    }
                    case LIBRARY_SEARCH_START:
                        sync?.startSearch(args[0])
                        return {ok: true}
                    case LIBRARY_SEARCH_CANCEL:
                        sync?.cancelSearch()
                        return {ok: true}
                    default:
                        return undefined
                }
            },
        },

        get settings() {
            return settings
        },

        setSettings(newSettings) {
            const {deviceLocal, synced} = splitSettings(newSettings)
            settings = {...newSettings}

            try {
                localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(deviceLocal))
            } catch {
                // ignore quota errors
            }

            // Update the UI immediately, then persist. A failed write is reported but must not
            // roll the UI back under the user.
            ipcRenderer.send(SETTINGS_CHANGE_EVENT, settings)
            apiFetch("/settings", {method: "PUT", body: {settings: synced}}).catch((error) => {
                console.error("Failed to save settings:", error)
            })
        },

        /** Applies settings pushed from another browser. */
        _applyRemoteSettings(syncedSettings) {
            settings = {...settings, ...syncedSettings}
            ipcRenderer.send(SETTINGS_CHANGE_EVENT, settings)
        },

        themeMode: {
            set(mode) {
                localStorage.setItem(THEME_KEY, mode)
                themeCallback?.(mode)
            },
            async get() {
                const theme = localStorage.getItem(THEME_KEY) || "system"
                return {
                    theme,
                    computed: theme === "system" ? (mediaMatch.matches ? "dark" : "light") : theme,
                }
            },
            onChange(callback) {
                themeCallback = callback
            },
            removeListener() {
                themeCallback = null
            },
            initial: localStorage.getItem(THEME_KEY) || "system",
        },

        async getCurrencyData() {
            return await apiFetch("/currency")
        },

        async getVersion() {
            return `${boot.version} (${__GIT_HASH__})`
        },

        async getInitErrors() {
            return undefined
        },

        setWindowTitle(title) {
            document.title = `${title} - Heynote`
        },

        async getSystemLocale() {
            return navigator.language
        },
    }

    mediaMatch.addEventListener("change", async () => {
        if (themeCallback) {
            themeCallback((await Heynote.themeMode.get()).computed)
        }
    })

    return {
        Heynote,
        ipcRenderer,

        /** Lets the WebSocket client drive library search through mainProcess.invoke(). */
        attachSync(client) {
            sync = client
        },

        /**
         * The current sync state, for a subscriber that starts listening after the fact.
         * The socket usually connects during boot(), before the Vue app has mounted and the
         * store has subscribed, so the first status event would otherwise be missed.
         */
        getSyncState() {
            return {
                connected: sync?.connected === true,
                pending: pendingSaves.size,
            }
        },

        /** A different browser saved this note. */
        applyRemoteNoteChange(path, content, version) {
            versions.set(path, version)
            baseContents.set(path, content)
            pushToEditor(path, content)
        },

        /** A note was created, deleted or moved somewhere else. */
        applyLibraryChange() {
            for (const callback of libraryChangeCallbacks) {
                callback()
            }
        },

        applyRemoteSettings(syncedSettings) {
            Heynote._applyRemoteSettings(syncedSettings)
        },

        /** Conflict resolution: the user chose to keep what they wrote. */
        async overwriteWithLocal(path, localSerialized) {
            const {shared, viewState} = splitViewState(localSerialized)
            saveViewState(path, viewState)
            const result = await apiFetch("/notes", {
                method: "PUT",
                body: {path, content: shared, baseVersion: null},
            })
            versions.set(path, result.version)
            baseContents.set(path, shared)
            pushToEditor(path, shared, {force: true})
        },

        /** Conflict resolution: the user chose the server's copy. */
        async discardLocalChanges(path) {
            // re-read rather than trusting the copy captured when the conflict was raised,
            // since the server may have moved on again while the dialog was open
            const {content, version} = await apiFetch(`/notes${encodeQuery({path})}`)
            versions.set(path, version)
            baseContents.set(path, content)
            pushToEditor(path, content, {force: true})
        },

        /**
         * After a reconnect the server may have missed nothing, or everything. Re-read every
         * note this browser has open and push through whatever changed.
         */
        async resyncOpenNotes() {
            for (const path of [...versions.keys()]) {
                try {
                    const {content, version} = await apiFetch(`/notes${encodeQuery({path})}`)
                    if (version !== versions.get(path)) {
                        versions.set(path, version)
                        baseContents.set(path, content)
                        pushToEditor(path, content)
                    }
                } catch (error) {
                    if (!(error instanceof OfflineError)) {
                        console.error(`Failed to resync ${path}:`, error)
                    }
                }
            }
        },
    }
}

export { ApiError, OfflineError }
