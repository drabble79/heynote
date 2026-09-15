import { apiFetch } from "./api.js"
import { createBridge } from "./bridge.js"
import { ensureAuthenticated } from "./login.js"
import { SyncClient } from "./sync-client.js"

/**
 * Installs `window.heynote` before the Vue app is imported.
 *
 * This ordering is not optional: src/stores/settings-store.js and src/editor/keymap.js read
 * window.heynote.* at module-evaluation time, so the bridge has to exist — fully populated,
 * including settings — before any of src/ is loaded. That's why the bootstrap endpoint returns
 * settings, the note list and the version in a single request.
 */
export async function boot() {
    await ensureAuthenticated()

    const bootstrap = await apiFetch("/bootstrap")
    const bridge = createBridge(bootstrap)

    const sync = new SyncClient(bridge)
    bridge.attachSync(sync)
    bridge.syncClient = sync

    window.heynote = bridge.Heynote
    window.ipcRenderer = bridge.ipcRenderer
    // exposed for debugging and for the sync tests, which need to simulate a disconnected browser
    window.heynoteSync = bridge

    bridge.Heynote.init()
    sync.connect()

    return bridge
}

/** Last resort when the server is unreachable before the app has even rendered. */
export function showBootError(error) {
    console.error("Heynote failed to start:", error)
    const container = document.createElement("div")
    container.setAttribute(
        "style",
        "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
        "font-family:system-ui,sans-serif;text-align:center;padding:24px;color:#d33"
    )
    container.innerHTML = `
        <div>
            <p style="font-size:16px;margin:0 0 8px">Could not reach the Heynote server.</p>
            <p style="font-size:13px;color:#888;margin:0 0 16px"></p>
            <button style="font:inherit;padding:8px 14px;cursor:pointer">Retry</button>
        </div>
    `
    container.querySelector("p:nth-of-type(2)").textContent = error?.message || String(error)
    container.querySelector("button").addEventListener("click", () => location.reload())
    document.body.appendChild(container)
}
