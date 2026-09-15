import { join } from "node:path"

import jetpack from "fs-jetpack"

import {
    DESKTOP_ONLY_SETTINGS,
    DEVICE_LOCAL_SETTINGS,
    getDefaultSettings,
} from "@/src/common/default-settings"

/**
 * Server-side settings storage, so that preferences follow the user between browsers.
 *
 * Two groups are deliberately *not* stored here:
 *  - DESKTOP_ONLY_SETTINGS: meaningless without Electron (tray, global hotkey, auto-update, ...)
 *  - DEVICE_LOCAL_SETTINGS: describe the local window rather than the user's preferences, so a
 *    wide desktop and a narrow laptop shouldn't fight over them. The client keeps these in
 *    localStorage.
 *
 * The colour theme is likewise kept per-device by the client: the default is "system", which
 * already adapts to whatever each machine is set to.
 */

const SETTINGS_FILE = ".heynote-settings.json"
const EXCLUDED = new Set([...DESKTOP_ONLY_SETTINGS, ...DEVICE_LOCAL_SETTINGS])

export function stripNonSyncedSettings(settings) {
    const result = {}
    for (const [key, value] of Object.entries(settings || {})) {
        if (!EXCLUDED.has(key)) {
            result[key] = value
        }
    }
    return result
}

export class SettingsStore {
    constructor(libraryPath) {
        this.filePath = join(libraryPath, SETTINGS_FILE)
        this.settings = stripNonSyncedSettings(getDefaultSettings())
        this._load()
    }

    _load() {
        let stored = null
        try {
            stored = jetpack.read(this.filePath, "json")
        } catch (err) {
            console.error(`Failed to read ${this.filePath}, falling back to defaults:`, err.message)
            return
        }
        if (!stored) {
            return
        }
        if (stored.settings && typeof stored.settings === "object") {
            this.settings = {...this.settings, ...stripNonSyncedSettings(stored.settings)}
        }
    }

    _persist() {
        jetpack.write(this.filePath, {settings: this.settings}, {atomic: true})
    }

    get() {
        return {...this.settings}
    }

    /** Replaces the synced settings wholesale, mirroring the renderer's setSettings() semantics. */
    set(settings) {
        if (!settings || typeof settings !== "object") {
            throw Object.assign(new Error("settings must be an object"), {statusCode: 400})
        }
        this.settings = stripNonSyncedSettings(settings)
        this._persist()
        return this.get()
    }
}
