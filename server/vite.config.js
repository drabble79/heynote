import path from 'path'

import { defineConfig } from 'vite'

/**
 * Build/run config for the sync server.
 *
 * The server shares code with the renderer (src/common/*) and with the Electron main process
 * (shared-node/*), which are ESM `.js`/`.ts` files living under a package.json without
 * `"type": "module"`. Running them through Vite — exactly like electron/main is already built —
 * keeps the `@/...` imports working without contorting the module format of the whole repo.
 *
 *   dev:   vite-node --config server/vite.config.js server/index.js
 *   build: vite build --config server/vite.config.js   ->   dist-server/index.mjs
 */
export default defineConfig({
    root: path.resolve(__dirname, '..'),

    resolve: {
        alias: {
            '@': path.resolve(__dirname, '..'),
        },
    },

    build: {
        ssr: 'server/index.js',
        outDir: 'dist-server',
        emptyOutDir: true,
        target: 'node22',
        minify: false,
        rollupOptions: {
            output: {
                format: 'es',
                entryFileNames: 'index.mjs',
            },
        },
    },
})
