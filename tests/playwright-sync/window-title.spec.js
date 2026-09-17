import { expect, test } from "@playwright/test"

/**
 * The document title has to carry the app name in a browser tab, where it's the only label the
 * window has, but not in an installed app, whose window already shows "Heynote" — appending it
 * there gives "Heynote - Work - Heynote".
 */

const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'
const OTHER = "title-target.txt"

test.beforeEach(async ({ request }) => {
    await request.delete(`/api/notes?path=${OTHER}`)
    await request.post("/api/notes", {
        data: {
            path: OTHER,
            content: '{"formatVersion":"2.0.0","name":"Work"}\n∞∞∞text\nhello',
        },
    })
})

test.afterEach(async ({ request }) => {
    await request.delete(`/api/notes?path=${OTHER}`)
})

test("a browser tab shows the buffer name and the app name", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()

    await page.locator(".buffer-tree .item", {hasText: "Work"}).first().click()

    await expect(page).toHaveTitle("Work - Heynote", {timeout: 10000})

    await context.close()
})

test("an installed app shows only the buffer name", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    // Playwright can't emulate display-mode, and an installed PWA window can't be launched from
    // here, so stand in for it by reporting standalone from matchMedia before any app code runs.
    await page.addInitScript(() => {
        const real = window.matchMedia.bind(window)
        window.matchMedia = (query) =>
            query === "(display-mode: standalone)"
                ? {matches: true, media: query, addEventListener() {}, removeEventListener() {}}
                : real(query)
    })

    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()

    await page.locator(".buffer-tree .item", {hasText: "Work"}).first().click()

    await expect(page).toHaveTitle("Work", {timeout: 10000})

    await context.close()
})
