import { expect, test } from "@playwright/test"

/**
 * Library search (server-side ripgrep streamed over the WebSocket) and image upload/serving,
 * both of which replace an Electron-only mechanism.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'

async function openApp(context) {
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(`[${error.name}] ${error.message}`))
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {page, errors}
}

test.describe("library search", () => {
    test.beforeEach(async ({ request }) => {
        const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
        await request.put("/api/notes", {
            data: {
                path: SCRATCH,
                content: `${SCRATCH_HEADER}\n∞∞∞text\nthe quick brown fox\nnothing here`,
                baseVersion: read.version,
            },
        })
        await request.post("/api/notes", {
            data: {
                path: "search-target.txt",
                content: '{"formatVersion":"2.0.0","name":"Target"}\n∞∞∞text\nanother quick line',
            },
        })
    })

    test.afterEach(async ({ request }) => {
        await request.delete("/api/notes?path=search-target.txt")
    })

    test("streams matches from the server across all notes", async ({ browser }) => {
        const context = await browser.newContext()
        const {page, errors} = await openApp(context)

        await page.getByRole("button", {name: "Search"}).click()
        await page.locator(".search-query").fill("quick")

        const results = page.locator(".results")
        await expect(results.locator(".buffer .name").filter({hasText: "Scratch"}))
            .toBeVisible({timeout: 10000})
        await expect(results.locator(".buffer .name").filter({hasText: "Target"})).toBeVisible()
        await expect(results).toContainText("the quick brown fox")
        await expect(results).toContainText("another quick line")

        expect(errors).toStrictEqual([])
        await context.close()
    })

    test("reports no matches for a query that isn't there", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        await page.getByRole("button", {name: "Search"}).click()
        await page.locator(".search-query").fill("zzzznotpresent")

        await expect(page.locator(".result-summary")).toBeVisible({timeout: 10000})
        await expect(page.locator(".result-summary")).toContainText("0 results")
        await expect(page.locator(".search-error")).toHaveCount(0)

        await context.close()
    })

    test("does not search the metadata header or block delimiters", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        // "formatVersion" only ever appears in the JSON header, which is bookkeeping the user
        // never sees and should never match
        await page.getByRole("button", {name: "Search"}).click()
        await page.locator(".search-query").fill("formatVersion")

        await expect(page.locator(".result-summary")).toBeVisible({timeout: 10000})
        await expect(page.locator(".result-summary")).toContainText("0 results")

        await context.close()
    })
})

test.describe("images", () => {
    // 1x1 transparent PNG
    const PNG_BASE64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

    test("uploads an image and serves it back", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        const filename = await page.evaluate(async (base64) => {
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i)
            }
            return await window.heynote.buffer.saveImage({mime: "image/png", data: bytes})
        }, PNG_BASE64)

        expect(filename).toMatch(/\.png$/)

        const response = await page.request.get(`/api/images/${encodeURIComponent(filename)}`)
        expect(response.status()).toBe(200)
        expect(response.headers()["content-type"]).toContain("image/png")
        expect((await response.body()).length).toBeGreaterThan(0)

        await context.close()
    })

    test("an image in a note renders, and the note keeps the portable URL", async ({ browser, request }) => {
        const context = await browser.newContext()
        const {page, errors} = await openApp(context)

        const filename = await page.evaluate(async (base64) => {
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i)
            }
            return await window.heynote.buffer.saveImage({mime: "image/png", data: bytes})
        }, PNG_BASE64)

        await page.evaluate(async ({name, header}) => {
            // matches createImageTag() in src/editor/image/image-parsing.js
            const url = `heynote-file://image/${encodeURIComponent(name)}`
            const tag = `<∞img;id=test-image;file=${url};w=1;h=1∞>`
            await window._heynote_editor.setContent(`${header}\n∞∞∞text\n${tag}\n`)
            await window._heynote_editor.save()
        }, {name: filename, header: SCRATCH_HEADER})

        // the widget must have rewritten the src to something the browser can load
        const img = page.locator(".heynote-image img")
        await expect(img).toBeVisible({timeout: 10000})
        await expect(img).toHaveAttribute("src", `/api/images/${encodeURIComponent(filename)}`)
        expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

        // ...while the stored note still uses the scheme the desktop app understands
        const stored = await (await request.get("/api/notes?path=" + SCRATCH)).json()
        expect(stored.content).toContain("heynote-file://image/")
        expect(stored.content).not.toContain("/api/images/")

        expect(errors).toStrictEqual([])
        await context.close()
    })

    test("rejects a non-image upload and a traversal attempt", async ({ page, request }) => {
        const bad = await request.post("/api/images", {
            headers: {"Content-Type": "text/plain"},
            data: "not an image",
        })
        expect(bad.status()).toBe(415)

        const traversal = await request.get("/api/images/..%2F..%2Fscratch.txt")
        expect(traversal.status()).toBeGreaterThanOrEqual(400)
    })
})
