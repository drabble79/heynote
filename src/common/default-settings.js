import { DEFAULT_LEFT_PANEL_WIDTH } from "./constants.js"

/**
 * Single source of truth for the settings schema and its defaults.
 *
 * Previously this lived only in electron/config.js, with a partial (and drifting) copy in
 * webapp/bridge.js. All three build targets — Electron, the localStorage webapp and the
 * server-synced webapp — import from here instead.
 */


/**
 * JSON-schema properties for the `settings` object, as consumed by electron-store.
 */
export const SETTINGS_SCHEMA_PROPERTIES = {
    "keymap": { "enum": ["default", "emacs"], default: "default" },
    "emacsMetaKey": { "enum": [null, "alt", "meta"], default: null },
    "keyBindings": {
        "type": "array",
        "items": {
            "type": "object",
            "required": ["key", "command"],
            "properties": {
                "key": { "type": "string" },
                "command": { "type": "string" },
            },
            "additionalProperties": false,
        },
    },

    "showLineNumberGutter": {type: "boolean", default: true},
    "showFoldGutter": {type: "boolean", default: true},
    "showTabs": {type: "boolean", default: true},
    "showTabsInFullscreen": {type: "boolean", default: true},
    "showLeftPanel": {type: "boolean", default: true},
    "leftPanelWidth": {type: "integer", default: DEFAULT_LEFT_PANEL_WIDTH},
    "bufferTreeOpenFolders": {
        type: "array",
        items: {type: "string"},
        default: [],
    },
    "autoUpdate": {type: "boolean", default: true},
    "autoInstallUpdates": {type: "boolean", default: true},
    "allowBetaVersions": {type: "boolean", default: false},
    "enableGlobalHotkey": {type: "boolean", default: false},
    "globalHotkey": {type: "string", default: "CmdOrCtrl+Shift+H"},
    "bufferPath": {type: "string", default: ""},
    "showInDock": {type: "boolean", default: true},
    "showInMenu": {type: "boolean", default: false},
    "alwaysOnTop": {type: "boolean", default: false},
    "openAtLogin": {type: "boolean", default: false},
    "startHidden": {type: "boolean", default: false},
    "bracketClosing": {type: "boolean", default: false},
    "indentType": {type: "string", default: "space"},
    "tabSize": {type: "integer", default: 4},
    "defaultBlockLanguage": {type: "string"},
    "defaultBlockLanguageAutoDetect": {type: "boolean"},
    "spellcheckEnabled": {type: "boolean", default: false},
    "showWhitespace": {type: "boolean", default: false},
    "colorPreviewEnabled": {type: "boolean", default: true},
    "cursorBlinkRate": {type: "integer", default: 1000},
    "drawSettings": {
        type: "object",
        properties: {
            color: {type: "string"},
            shadowEnabled: {type: "boolean"},
        },
    },

    // when default font settings are used, fontFamily and fontSize is not specified in the
    // settings file, so that it's possible for us to change the default settings in the
    // future and have it apply to existing users
    "fontFamily": {type: "string"},
    "fontSize": {type: "integer"},

    "searchSettings": {
        type: "object",
        properties: {
            onlyCurrentBlock: {type: "boolean"},
            caseSensitive: {type: "boolean"},
            wholeWord: {type: "boolean"},
            regexp: {type: "boolean"},
        },
    },
    "librarySearchSettings": {
        type: "object",
        properties: {
            caseSensitive: {type: "boolean"},
            wholeWord: {type: "boolean"},
            regexp: {type: "boolean"},
        },
    },
}


/**
 * Settings that only have meaning in the Electron build. The web builds neither render
 * these in the settings dialog nor persist them server side.
 */
export const DESKTOP_ONLY_SETTINGS = [
    "autoUpdate",
    "autoInstallUpdates",
    "allowBetaVersions",
    "enableGlobalHotkey",
    "globalHotkey",
    "bufferPath",
    "showInDock",
    "showInMenu",
    "alwaysOnTop",
    "openAtLogin",
    "startHidden",
]

/**
 * Settings that stay per-device even when the rest of the settings are synced by a server,
 * because they describe the local window/viewport rather than the user's preferences.
 */
export const DEVICE_LOCAL_SETTINGS = [
    "leftPanelWidth",
    "showLeftPanel",
    "bufferTreeOpenFolders",
]


/**
 * @param {object} [options]
 * @param {boolean} [options.isMac] Mac defaults the emacs meta key to Cmd instead of Alt.
 * @returns {object} A fresh copy of the default settings.
 */
export function getDefaultSettings({isMac = false} = {}) {
    return {
        keymap: "default",
        emacsMetaKey: isMac ? "meta" : "alt",
        keyBindings: [],
        showLineNumberGutter: true,
        showFoldGutter: true,
        showTabs: true,
        showTabsInFullscreen: true,
        showLeftPanel: true,
        leftPanelWidth: DEFAULT_LEFT_PANEL_WIDTH,
        bufferTreeOpenFolders: [],
        autoUpdate: true,
        autoInstallUpdates: true,
        allowBetaVersions: false,
        enableGlobalHotkey: false,
        globalHotkey: "CmdOrCtrl+Shift+H",
        bufferPath: "",
        showInDock: true,
        showInMenu: false,
        alwaysOnTop: false,
        openAtLogin: false,
        startHidden: false,
        bracketClosing: false,
        indentType: "space",
        tabSize: 4,
        searchSettings: {
            onlyCurrentBlock: true,
            caseSensitive: false,
            wholeWord: false,
            regexp: false,
        },
        librarySearchSettings: {
            caseSensitive: false,
            wholeWord: false,
            regexp: false,
        },
        spellcheckEnabled: false,
        showWhitespace: false,
        colorPreviewEnabled: true,
        cursorBlinkRate: 1000,
    }
}
