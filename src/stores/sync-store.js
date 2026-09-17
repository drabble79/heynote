import { defineStore } from "pinia"

import {
    SYNC_CONFLICT_EVENT,
    SYNC_STATUS_CONFLICT,
    SYNC_STATUS_ERROR,
    SYNC_STATUS_EVENT,
    SYNC_STATUS_OFFLINE,
    SYNC_STATUS_SYNCED,
} from "@/src/common/constants"

/**
 * Sync state of the server-synced web build, shown in the status bar.
 *
 * Two independent things decide whether syncing actually works, and they have to be tracked
 * separately rather than collapsed into one status value:
 *
 *  - `connected`: is the WebSocket up? Without it, other browsers' changes never arrive, even
 *    though saving over HTTP may still succeed.
 *  - `pending`:   how many saves are queued because the server couldn't be reached?
 *
 * Reporting a single status from both places meant whichever spoke last won — a successful save
 * would claim "synced" while the push channel was still dead, and a reconnect would claim
 * "synced" while edits were still unsaved.
 *
 * `enabled` stays false in the Electron and localStorage builds, where nothing emits these
 * events, so the indicator renders nothing at all there.
 */
export const useSyncStore = defineStore("sync", {
    state: () => ({
        enabled: false,
        connected: false,
        pending: 0,
        message: "",
        /** @type {Array<{path: string, localContent: string, serverContent: string, serverVersion: string}>} */
        conflicts: [],
    }),

    getters: {
        hasConflicts(state) {
            return state.conflicts.length > 0
        },

        currentConflict(state) {
            return state.conflicts[0] || null
        },

        /** Worst-first, because the most broken thing is what the user needs to know about. */
        status(state) {
            if (state.conflicts.length > 0) {
                return SYNC_STATUS_CONFLICT
            }
            if (state.pending > 0) {
                return state.connected ? SYNC_STATUS_ERROR : SYNC_STATUS_OFFLINE
            }
            if (!state.connected) {
                return SYNC_STATUS_OFFLINE
            }
            return SYNC_STATUS_SYNCED
        },
    },

    actions: {
        setUp() {
            this.enabled = true

            // The socket is usually already connected by the time the app mounts, so the first
            // status event has come and gone. Seed from the bridge rather than waiting for the
            // next one, which might not arrive until something goes wrong.
            const initial = window.heynoteSync?.getSyncState?.()
            if (initial) {
                this.connected = initial.connected
                this.pending = initial.pending
            }

            // the payload is a partial update; whatever it doesn't mention stays as it was
            window.heynote.mainProcess.on(SYNC_STATUS_EVENT, (event, payload) => {
                if (payload.connected !== undefined) {
                    this.connected = payload.connected
                }
                if (payload.pending !== undefined) {
                    this.pending = payload.pending
                }
                if (payload.message !== undefined) {
                    this.message = payload.message
                }
            })

            window.heynote.mainProcess.on(SYNC_CONFLICT_EVENT, (event, payload) => {
                this.addConflict(payload)
            })
        },

        /**
         * Resolve a conflict the user was asked about.
         *
         * @param {string} path
         * @param {"local"|"server"} choice
         */
        async resolveConflict(path, choice) {
            const conflict = this.conflicts.find((c) => c.path === path)
            if (!conflict) {
                return
            }
            // Only the synced web build ever produces conflicts, and it installs this bridge.
            const sync = window.heynoteSync
            if (!sync) {
                this.dismissConflict(path)
                return
            }

            try {
                if (choice === "local") {
                    await sync.overwriteWithLocal(path, conflict.localContent)
                } else {
                    await sync.discardLocalChanges(path, conflict.serverContent)
                }
                this.dismissConflict(path)
            } catch (error) {
                this.message = error.message
            }
        },

        addConflict(conflict) {
            // one dialog per note is enough; the newest state wins
            const existing = this.conflicts.findIndex((c) => c.path === conflict.path)
            if (existing !== -1) {
                this.conflicts.splice(existing, 1, conflict)
            } else {
                this.conflicts.push(conflict)
            }
        },

        dismissConflict(path) {
            this.conflicts = this.conflicts.filter((c) => c.path !== path)
        },
    },
})
