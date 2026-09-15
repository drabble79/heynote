import path from 'path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import * as child from "child_process";
import pkg from '../package.json'

const SERVER_TARGET = process.env.HEYNOTE_SERVER_URL || 'http://127.0.0.1:3333'

function gitHash() {
    try {
        return child.execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
        return 'unknown'
    }
}

/**
 * Build target for the server-synced web app.
 *
 * Identical to webapp/ except that window.heynote talks to the sync server over HTTP and
 * WebSocket instead of localStorage. Everything under src/ is shared verbatim.
 */
export default defineConfig({
    publicDir: "../public",

    plugins: [
        vue(),
    ],

    css: {
        preprocessorOptions: {
            sass: {
                api: "modern-compiler",
                additionalData: `
    @use "@/src/css/include.sass" as *
    `
            },
        },
    },

    resolve: {
        alias: {
            '@': path.resolve(__dirname, '..'),
        },
    },

    server: {
        proxy: {
            '/api': {target: SERVER_TARGET, changeOrigin: true},
            '/ws': {target: SERVER_TARGET, ws: true, changeOrigin: true},
        },
    },

    define: {
        '__APP_VERSION__': JSON.stringify(pkg.version),
        '__GIT_HASH__': JSON.stringify(gitHash()),
        '__TESTS__': process.env.HEYNOTE_TESTS,
    },
})
