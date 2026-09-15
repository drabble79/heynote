<script>
    import { mapActions, mapState } from 'pinia'
    import { useSyncStore } from "../stores/sync-store"

    /**
     * Shown when a note was edited in two places at once and the changes touched the same lines,
     * so the automatic three-way merge couldn't reconcile them.
     *
     * Only the server-synced web build can produce conflicts; in the Electron and localStorage
     * builds the store stays empty and this renders nothing.
     */
    export default {
        computed: {
            ...mapState(useSyncStore, ["currentConflict", "conflicts"]),

            noteName() {
                return this.currentConflict?.path || ""
            },
        },

        methods: {
            ...mapActions(useSyncStore, ["resolveConflict"]),

            keepMine() {
                this.resolveConflict(this.currentConflict.path, "local")
            },

            useServer() {
                this.resolveConflict(this.currentConflict.path, "server")
            },

            preview(content) {
                if (!content) {
                    return ""
                }
                // strip the JSON metadata header so the user sees the note, not its bookkeeping
                const separator = content.indexOf("\n∞∞∞")
                return (separator === -1 ? content : content.slice(separator)).trim()
            },
        },
    }
</script>


<template>
    <div class="sync-conflict" v-if="currentConflict">
        <div class="dialog">
            <div class="dialog-content">
                <h1>Conflicting changes in {{ noteName }}</h1>
                <p class="explanation">
                    This note was changed somewhere else while you were editing it, and the two
                    versions touch the same lines. Choose which one to keep.
                </p>
                <div class="versions">
                    <div class="version">
                        <h2>Your version</h2>
                        <pre>{{ preview(currentConflict.localContent) }}</pre>
                    </div>
                    <div class="version">
                        <h2>Version on the server</h2>
                        <pre>{{ preview(currentConflict.serverContent) }}</pre>
                    </div>
                </div>
            </div>
            <div class="bottom-bar">
                <div class="count" v-if="conflicts.length > 1">
                    {{ conflicts.length - 1 }} more to resolve
                </div>
                <div style="flex-grow:1;"></div>
                <button @click="useServer">Use server version</button>
                <button @click="keepMine" class="primary">Keep my version</button>
            </div>
        </div>
        <div class="shader"></div>
    </div>
</template>


<style lang="sass" scoped>
    .sync-conflict
        z-index: 1000
        position: fixed
        top: 0
        left: 0
        bottom: 0
        right: 0

        .shader
            z-index: 1
            position: absolute
            top: 0
            left: 0
            bottom: 0
            right: 0
            background: rgba(0, 0, 0, 0.5)

        .dialog
            box-sizing: border-box
            z-index: 2
            position: absolute
            left: 50%
            top: 50%
            transform: translate(-50%, -50%)
            width: 720px
            max-width: 100%
            max-height: 90%
            display: flex
            flex-direction: column
            border-radius: 5px
            background: #fff
            color: #333
            box-shadow: 0 0 25px rgba(0, 0, 0, 0.2)
            +dark-mode
                background: #333
                color: #eee
                box-shadow: 0 0 25px rgba(0, 0, 0, 0.3)

            .dialog-content
                flex-grow: 1
                padding: 24px 24px 12px
                overflow-y: auto
                h1
                    font-size: 14px
                    font-weight: 700
                    margin-bottom: 0.6em
                .explanation
                    font-size: 13px
                    margin-bottom: 1.2em
                    opacity: 0.8

            .versions
                display: flex
                gap: 16px
                .version
                    flex: 1 1 0
                    min-width: 0
                    h2
                        font-size: 12px
                        font-weight: 600
                        margin-bottom: 6px
                        opacity: 0.7
                    pre
                        font-family: monospace
                        font-size: 12px
                        white-space: pre-wrap
                        word-break: break-word
                        max-height: 260px
                        overflow-y: auto
                        padding: 10px
                        border-radius: 4px
                        background: #f4f4f4
                        +dark-mode
                            background: #222

            .bottom-bar
                border-radius: 0 0 5px 5px
                background: #eee
                padding: 10px 20px
                display: flex
                align-items: center
                gap: 10px
                +dark-mode
                    background: #222
                .count
                    font-size: 12px
                    opacity: 0.7
                button
                    height: 28px
                    padding: 0 12px
                    &.primary
                        font-weight: 600
</style>
