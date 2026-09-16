<script>
    import { mapState } from 'pinia'
    import { useHeynoteStore } from "@/src/stores/heynote-store"
    import { useContextMenuStore } from "@/src/stores/context-menu-store"
    import { OPEN_SETTINGS_EVENT } from "@/src/common/constants"
    import { canInstall, promptInstall } from "@/src/common/pwa"

    export default {
        computed: {
            ...mapState(useHeynoteStore, [
                "showLeftPanel",
            ]),
        },
        methods: {
            onMainMenuClick(event) {
                if (!window.heynote.platform.isWebApp) {
                    const x = event.target.offsetLeft
                    const y = event.target.offsetTop + event.target.offsetHeight
                    window.heynote.mainProcess.invoke("showMainMenu", x, y)
                    return
                }

                // The web build has no application menu bar, so this button carries the
                // entries from electron/main/menu.js that still make sense in a browser.
                // Window/zoom/quit roles and the separate About window are dropped.
                const store = useHeynoteStore()
                const editor = () => window._heynote_editor
                const rect = event.currentTarget.getBoundingClientRect()
                useContextMenuStore().open({clientX: rect.left, clientY: rect.bottom}, [
                    {label: "New Buffer…", action: () => store.openCreateBuffer()},
                    {label: "Open Buffer…", action: () => store.openBufferSelector()},
                    {label: "Move block to another buffer…", action: () => store.openMoveToBufferSelector()},
                    {separator: true},
                    {label: "Command Palette…", action: () => store.openCommandPalette()},
                    {label: "Change block language…", action: () => store.openLanguageSelector()},
                    {label: "Delete block", action: () => editor()?.deleteActiveBlock()},
                    {separator: true},
                    // only offered while the browser is actually willing to install
                    ...(canInstall() ? [{label: "Install as app…", action: () => promptInstall()}] : []),
                    {label: "Settings", action: () => window.ipcRenderer?.send(OPEN_SETTINGS_EVENT)},
                ])
            },
        },
    }
</script>

<template>
    <div class="main-menu-container">
        <button class="main-menu"
            @click="onMainMenuClick"
        ></button>
    </div>
</template>

<style lang="sass" scoped>
    .main-menu-container
        width: 37px
        flex-shrink: 0
        text-align: center
        button
            app-region: none
            border: none
            padding: 0
            margin: 0
            width: 18px
            height: 20px
            margin-top: 6px
            background: none
            background-image: url("@/assets/icons/vertical-dots-light.svg")
            background-repeat: no-repeat
            background-position: center
            background-size: 14px
            border-radius: 3px
            +dark-mode
                background-image: url("@/assets/icons/vertical-dots-dark.svg")
            &:hover
                background-color: #ccc
                +dark-mode
                    background-color: #3a3a3a
        +platform-mac
            width: 80px
            button
                display: none
        +platform-mac-fullscreen
            width: 16px
</style>
