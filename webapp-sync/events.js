/**
 * Re-exported from src/common/constants.js so that both the bridge and the Vue side of the app
 * agree on these channel names. They live in the shared constants file because src/ needs them
 * too, even though only this build target ever emits them.
 */
export {
    SYNC_CONFLICT_EVENT,
    SYNC_STATUS_ERROR,
    SYNC_STATUS_EVENT,
    SYNC_STATUS_OFFLINE,
    SYNC_STATUS_SAVING,
    SYNC_STATUS_SYNCED,
} from "@/src/common/constants"
