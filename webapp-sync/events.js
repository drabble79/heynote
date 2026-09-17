/**
 * Re-exported from src/common/constants.js so that both the bridge and the Vue side of the app
 * agree on these channel names. They live in the shared constants file because src/ needs them
 * too, even though only this build target ever emits them.
 *
 * The derived SYNC_STATUS_* values aren't re-exported: nothing here reports a status directly.
 * The bridge reports the save queue, the sync client reports the connection, and the store works
 * out what to display.
 */
export {
    SYNC_CONFLICT_EVENT,
    SYNC_STATUS_EVENT,
} from "@/src/common/constants"
