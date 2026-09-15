import { app } from "electron"
import Store from "electron-store"
import { generateClientId, TEST_CLIENT_ID } from "../src/common/client-id"
import { getDefaultSettings, SETTINGS_SCHEMA_PROPERTIES } from "../src/common/default-settings"
import { isMac } from "./detect-platform"

// the process.type === "browser" check is needed because both the main and renderer process 
// imports this file, and app is not available in the renderer process
if (process.env.HEYNOTE_TEST_USER_DATA_DIR && process.type === "browser") {
    app.setPath("userData", process.env.HEYNOTE_TEST_USER_DATA_DIR)
}

const isDev = !!process.env.VITE_DEV_SERVER_URL

const schema = {
    additionalProperties: false,

    clientId: {type: "string"},

    windowConfig: {
        type: "object",
        properties: {
            width: {type: "number"},
            height: {type: "number"},
            x: {type: "number"},
            y: {type: "number"},
            isMaximized: {type: "boolean"},
            isFullScreen: {type: "boolean"},
            visibleOnQuit: {type: "boolean", default: true},
        },
        additionalProperties: false,
    },
    
    settings: {
        type: "object",
        properties: SETTINGS_SCHEMA_PROPERTIES,
    },

    theme: {type: "string", default: "system"},

    openTabsState: {
        type: "object",
        properties: {
            currentBufferPath: {type: "string"},
            openTabs: {
                type: "array",
                items: {
                    type: "string",
                },
            },
            recentBuffers: {
                type: "array",
                items: {
                    type: "string",
                },
            },
        },
    },

    currency: {
        type: "object",
        properties: {
            data: {type: "object"},
            timeFetched: {type: "number"},
        },
    },
}

const defaults = {
    settings: getDefaultSettings({isMac}),
    theme: "system",
}

const config = new Store({schema, defaults, name: isDev ? "config-dev" : "config"})

if (process.env.HEYNOTE_TESTS) {
    config.set("clientId", TEST_CLIENT_ID)
} else if (!config.get("clientId")) {
    config.set("clientId", generateClientId())
}

export default config
