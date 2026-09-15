<script>
    import { mapActions, mapState } from 'pinia'
    import { useSyncStore } from "../stores/sync-store"
    import {
        SYNC_STATUS_ERROR,
        SYNC_STATUS_OFFLINE,
        SYNC_STATUS_SAVING,
    } from "@/src/common/constants"

    /**
     * Shows whether the server-synced web build is actually keeping up.
     *
     * Renders nothing while everything is fine, and nothing at all in the Electron and
     * localStorage builds, where the status never leaves its initial "synced" value.
     */
    export default {
        computed: {
            ...mapState(useSyncStore, ["status", "pending", "message", "hasConflicts"]),

            visible() {
                return this.hasConflicts ||
                    [SYNC_STATUS_OFFLINE, SYNC_STATUS_ERROR, SYNC_STATUS_SAVING].includes(this.status)
            },

            label() {
                if (this.hasConflicts) {
                    return "Conflict"
                }
                if (this.status === SYNC_STATUS_OFFLINE) {
                    return this.pending > 0 ? `Offline (${this.pending} unsaved)` : "Offline"
                }
                if (this.status === SYNC_STATUS_ERROR) {
                    return this.pending > 0 ? `Not saved (${this.pending})` : "Not saved"
                }
                return "Saving…"
            },

            tooltip() {
                if (this.hasConflicts) {
                    return "This note was changed elsewhere; choose which version to keep"
                }
                if (this.message) {
                    return this.message
                }
                if (this.status === SYNC_STATUS_OFFLINE) {
                    return "Can't reach the server. Changes are kept here and retried."
                }
                return ""
            },

            severity() {
                if (this.hasConflicts || this.status === SYNC_STATUS_ERROR) {
                    return "error"
                }
                if (this.status === SYNC_STATUS_OFFLINE) {
                    return "warning"
                }
                return "info"
            },
        },
    }
</script>


<template>
    <div
        v-if="visible"
        :class="['status-block', 'sync-status', severity]"
        :title="tooltip"
    >{{ label }}</div>
</template>


<style lang="sass" scoped>
    .sync-status
        padding: 0 8px
        white-space: nowrap
        &.warning
            color: #8a6200
            background: #ffe8a3
            +dark-mode
                color: #ffd970
                background: #4a3a00
        &.error
            color: #fff
            background: #c0392b
        &.info
            opacity: 0.7
</style>
