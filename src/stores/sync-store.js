import { defineStore } from "pinia"

import {
    SYNC_CONFLICT_EVENT,
    SYNC_STATUS_EVENT,
    SYNC_STATUS_SYNCED,
} from "@/src/common/constants"

/**
 * Connection/save state of the server-synced web build.
 *
 * In the Electron and localStorage builds nothing ever emits these events, so the store stays in
 * its initial "synced" state and the status bar indicator renders nothing.
 */
export const useSyncStore = defineStore("sync", {
    state: () => ({
        status: SYNC_STATUS_SYNCED,
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
    },

    actions: {
        setUp() {
            window.heynote.mainProcess.on(SYNC_STATUS_EVENT, (event, payload) => {
                this.status = payload.status
                this.pending = payload.pending || 0
                this.message = payload.message || ""
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
