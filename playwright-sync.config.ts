import os from 'node:os'
import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests for the server-synced web build.
 *
 * Kept separate from playwright.config.ts so the upstream suite (which runs against the
 * localStorage webapp on port 3000) stays untouched and keeps working as a regression guard.
 *
 * Requires a build first: `npm run sync:build`.
 */

process.env["HEYNOTE_TESTS"] = "1"

const PORT = 3401
const LIBRARY_PATH = path.join(os.tmpdir(), 'heynote-sync-playwright')

export default defineConfig({
    testDir: './tests/playwright-sync',
    // Every test shares one server and one note library, so they must not overlap.
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? [['github'], ['html']] : 'list',

    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
        locale: 'en-GB',
    },

    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                contextOptions: {
                    permissions: ['clipboard-read', 'clipboard-write'],
                },
            },
        },
    ],

    webServer: {
        command: 'node dist-server/index.mjs',
        url: `http://127.0.0.1:${PORT}/api/session`,
        timeout: 20 * 1000,
        reuseExistingServer: false,
        env: {
            HEYNOTE_PORT: String(PORT),
            HEYNOTE_HOST: '127.0.0.1',
            HEYNOTE_LIBRARY_PATH: LIBRARY_PATH,
            HEYNOTE_PASSWORD: '',
        },
        stdout: 'pipe',
        stderr: 'pipe',
    },
})
