<script>
    import { mapState } from 'pinia'
    import { useSyncStore } from "../stores/sync-store"
    import {
        SYNC_STATUS_CONFLICT,
        SYNC_STATUS_ERROR,
        SYNC_STATUS_OFFLINE,
    } from "@/src/common/constants"

    /**
     * Sync state in the status bar, for the server-synced web build.
     *
     * Shown even when everything is fine: "nothing is wrong" and "the indicator isn't working"
     * would otherwise look identical, which is no use to someone who wants to know their notes
     * are actually reaching the server.
     *
     * Renders nothing in the Electron and localStorage builds, where the store stays disabled.
     */
    export default {
        computed: {
            ...mapState(useSyncStore, ["enabled", "status", "pending", "message"]),

            label() {
                switch (this.status) {
                    case SYNC_STATUS_CONFLICT:
                        return "Conflict"
                    case SYNC_STATUS_ERROR:
                        return `Unsaved (${this.pending})`
                    case SYNC_STATUS_OFFLINE:
                        return this.pending > 0 ? `Offline (${this.pending} unsaved)` : "Offline"
                    default:
                        return "Synced"
                }
            },

            tooltip() {
                const detail = this.message ? `\n${this.message}` : ""
                switch (this.status) {
                    case SYNC_STATUS_CONFLICT:
                        return "This note was changed elsewhere too - choose which version to keep"
                    case SYNC_STATUS_ERROR:
                        // could be a refusal or a failed request; "couldn't save" covers both
                        return `Couldn't save ${this.pending} change(s). Retrying.${detail}`
                    case SYNC_STATUS_OFFLINE:
                        return this.pending > 0
                            ? `Can't reach the server. ${this.pending} change(s) are kept here and will be sent when it's back.${detail}`
                            : `Can't reach the server. Changes from other browsers won't arrive until the connection is back.${detail}`
                    default:
                        return "Connected. Changes are saved to the server and other browsers are kept up to date."
                }
            },

            severity() {
                switch (this.status) {
                    case SYNC_STATUS_CONFLICT:
                    case SYNC_STATUS_ERROR:
                        return "error"
                    case SYNC_STATUS_OFFLINE:
                        return "warning"
                    default:
                        return "ok"
                }
            },
        },
    }
</script>


<template>
    <div
        v-if="enabled"
        :class="['status-block', 'sync-status', severity]"
        :title="tooltip"
    >
        <span class="dot"></span>{{ label }}
    </div>
</template>


<style lang="sass" scoped>
    .sync-status
        display: flex
        align-items: center
        gap: 5px
        padding: 0 8px
        white-space: nowrap

        .dot
            width: 7px
            height: 7px
            border-radius: 50%
            flex-shrink: 0
            background: currentColor

        // the healthy state has to be legible without drawing the eye
        &.ok
            opacity: 0.6
            .dot
                background: #2e9e4f
        &.warning
            color: #8a6200
            background: #ffe8a3
            +dark-mode
                color: #ffd970
                background: #4a3a00
        &.error
            color: #fff
            background: #c0392b
            .dot
                // a currentColor dot disappears against the red fill
                background: #fff
</style>
