import { expect, test } from "@playwright/test"

/**
 * The status bar has to tell the truth about whether syncing is actually working — including the
 * case where saving still succeeds but the push channel is dead, which is invisible otherwise.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'

async function openApp(browser) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {context, page}
}

const status = (page) => page.locator(".sync-status")

test.beforeEach(async ({ request }) => {
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
})

test("shows a healthy state once connected", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await expect(status(page)).toBeVisible()
    await expect(status(page)).toHaveText("Synced", {timeout: 10000})
    await expect(status(page)).toHaveClass(/\bok\b/)

    await context.close()
})

test("reports offline when the push channel drops, even though saving still works", async ({ browser }) => {
    const {context, page} = await openApp(browser)
    await expect(status(page)).toHaveText("Synced", {timeout: 10000})

    // kill only the WebSocket; HTTP saves keep succeeding
    await page.evaluate(() => window.heynoteSync.syncClient.close())

    await expect(status(page)).toHaveText("Offline", {timeout: 10000})
    await expect(status(page)).toHaveClass(/\bwarning\b/)

    // a successful save must not paper over the dead push channel
    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\nsaved while push is down`)
        await window._heynote_editor.save()
    }, SCRATCH_HEADER)

    await expect(status(page)).toHaveText("Offline")

    await context.close()
})

test("counts unsaved changes while the server is unreachable, and clears them after", async ({ browser }) => {
    const {context, page} = await openApp(browser)
    await expect(status(page)).toHaveText("Synced", {timeout: 10000})

    await context.route("**/api/notes", (route) =>
        route.request().method() === "PUT" ? route.abort() : route.continue())

    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\nqueued while offline`)
        await window._heynote_editor.save()
    }, SCRATCH_HEADER)

    // the socket is still up here — only the save endpoint is failing — so it reports the
    // queue rather than claiming the whole connection is down
    await expect(status(page)).toHaveText(/Unsaved \(\d+\)/, {timeout: 10000})
    await expect(status(page)).toHaveClass(/\berror\b/)

    await context.unroute("**/api/notes")

    // once the queue drains and the socket is up, it goes back to healthy on its own
    await expect(status(page)).toHaveText("Synced", {timeout: 30000})
    await expect(status(page)).toHaveClass(/\bok\b/)

    await context.close()
})

test("reports a conflict that needs the user to decide", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = (await contextA.newPage())
    const pageB = (await contextB.newPage())
    for (const page of [pageA, pageB]) {
        await page.goto("/")
        await expect(page.locator(".cm-editor")).toBeVisible()
    }

    await pageA.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\nshared line`)
        await window._heynote_editor.save()
    }, SCRATCH_HEADER)
    await expect.poll(
        () => pageB.evaluate(() => window._heynote_editor.view.state.doc.toString()),
        {timeout: 10000},
    ).toContain("shared line")

    await pageB.evaluate(() => window.heynoteSync.syncClient.close())
    for (const [page, who] of [[pageA, "A"], [pageB, "B"]]) {
        await page.evaluate(async ({header, name}) => {
            await window._heynote_editor.setContent(`${header}\n∞∞∞text\nshared line by ${name}`)
            await window._heynote_editor.save()
        }, {header: SCRATCH_HEADER, name: who})
    }

    await expect(status(pageB)).toHaveText("Conflict", {timeout: 15000})
    await expect(status(pageB)).toHaveClass(/\berror\b/)

    await contextA.close()
    await contextB.close()
})
