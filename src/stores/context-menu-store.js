import { defineStore } from "pinia"

/**
 * Backs the HTML context menus used by the web builds.
 *
 * Electron shows real native menus (electron/main/menu.js). A browser has no equivalent, and
 * until now the web build simply had no context menus at all in the sidebar and tab bar.
 */
export const useContextMenuStore = defineStore("contextMenu", {
    state: () => ({
        visible: false,
        x: 0,
        y: 0,
        /** @type {Array<{label?: string, separator?: boolean, enabled?: boolean, action?: Function}>} */
        items: [],
        /** Called after the menu closes, however it closes. */
        onClose: null,
    }),

    actions: {
        /**
         * @param {{clientX: number, clientY: number}} position Usually the triggering event.
         * @param {Array} items
         * @param {Function} [onClose]
         */
        open(position, items, onClose = null) {
            this.x = position.clientX
            this.y = position.clientY
            this.items = items
            this.onClose = onClose
            this.visible = true
        },

        close() {
            if (!this.visible) {
                return
            }
            this.visible = false
            this.items = []
            const onClose = this.onClose
            this.onClose = null
            onClose?.()
        },

        run(item) {
            if (item.separator || item.enabled === false) {
                return
            }
            const action = item.action
            this.close()
            action?.()
        },
    },
})
