import fs from 'fs'
import path from 'path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import * as child from "child_process";
import pkg from '../package.json'

const SERVICE_WORKER = path.resolve(__dirname, 'sw.js')

/**
 * Emits sw.js at the site root.
 *
 * A service worker can only control pages at or below its own path, so it has to be served from
 * "/" rather than from the hashed asset directory. It also must not be bundled — it runs in its
 * own worker context, not as part of the app.
 */
function serviceWorkerPlugin() {
    return {
        name: 'heynote-service-worker',

        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'sw.js',
                source: fs.readFileSync(SERVICE_WORKER, 'utf8'),
            })
        },

        configureServer(server) {
            // the dev build doesn't register it, but serving it keeps a stale registration from
            // a previous production visit from 404ing
            server.middlewares.use((req, res, next) => {
                if (req.url?.split('?')[0] !== '/sw.js') {
                    return next()
                }
                res.setHeader('Content-Type', 'application/javascript')
                res.end(fs.readFileSync(SERVICE_WORKER, 'utf8'))
            })
        },
    }
}

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
        serviceWorkerPlugin(),
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
