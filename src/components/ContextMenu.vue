<script>
    import { mapActions, mapState } from 'pinia'
    import { useContextMenuStore } from "../stores/context-menu-store"

    const MARGIN = 6

    export default {
        data() {
            return {
                adjusted: {left: 0, top: 0},
            }
        },

        computed: {
            ...mapState(useContextMenuStore, ["visible", "x", "y", "items"]),
        },

        watch: {
            visible(value) {
                if (value) {
                    this.$nextTick(this.positionMenu)
                }
            },
        },

        mounted() {
            window.addEventListener("keydown", this.onKeydown, true)
            window.addEventListener("resize", this.close)
        },

        beforeUnmount() {
            window.removeEventListener("keydown", this.onKeydown, true)
            window.removeEventListener("resize", this.close)
        },

        methods: {
            ...mapActions(useContextMenuStore, ["close", "run"]),

            onKeydown(event) {
                if (this.visible && event.key === "Escape") {
                    event.stopPropagation()
                    this.close()
                }
            },

            // keep the menu on screen when opened near an edge
            positionMenu() {
                const menu = this.$refs.menu
                if (!menu) {
                    return
                }
                const {width, height} = menu.getBoundingClientRect()
                const maxLeft = window.innerWidth - width - MARGIN
                const maxTop = window.innerHeight - height - MARGIN
                this.adjusted = {
                    left: Math.max(MARGIN, Math.min(this.x, maxLeft)),
                    top: Math.max(MARGIN, Math.min(this.y, maxTop)),
                }
            },
        },
    }
</script>


<template>
    <div
        v-if="visible"
        class="context-menu-layer"
        @pointerdown.self="close"
        @contextmenu.prevent.self="close"
    >
        <ul
            ref="menu"
            class="context-menu"
            :style="{left: adjusted.left + 'px', top: adjusted.top + 'px'}"
        >
            <template v-for="(item, index) in items" :key="index">
                <li v-if="item.separator" class="separator"></li>
                <li
                    v-else
                    :class="{item: true, disabled: item.enabled === false}"
                    @click="run(item)"
                >{{ item.label }}</li>
            </template>
        </ul>
    </div>
</template>


<style lang="sass" scoped>
    .context-menu-layer
        position: fixed
        inset: 0
        z-index: 900

    .context-menu
        position: absolute
        min-width: 180px
        max-width: 320px
        padding: 4px 0
        margin: 0
        list-style: none
        border-radius: 6px
        background: #fff
        color: #222
        border: 1px solid rgba(0, 0, 0, 0.12)
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18)
        font-size: 13px
        user-select: none
        +dark-mode
            background: #2c2c2c
            color: #eee
            border-color: rgba(255, 255, 255, 0.12)
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45)

        .item
            padding: 5px 16px
            cursor: pointer
            white-space: nowrap
            overflow: hidden
            text-overflow: ellipsis
            &:hover
                background: #2f6fed
                color: #fff
            &.disabled
                opacity: 0.4
                cursor: default
                &:hover
                    background: transparent
                    color: inherit
                    +dark-mode
                        color: inherit

        .separator
            height: 1px
            margin: 4px 0
            background: rgba(0, 0, 0, 0.12)
            +dark-mode
                background: rgba(255, 255, 255, 0.14)
</style>
