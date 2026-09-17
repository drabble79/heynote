import { expect, test } from "@playwright/test"

/**
 * Whatever the user is looking at has to survive the things that happen around it: a reload, a
 * dropped and restored connection, and another browser adding or removing a note.
 *
 * The library root never changes in the web build, so none of these are a reason to throw away
 * the open tabs.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'
const OTHER = "tab-target.txt"

async function openApp(browser) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {context, page}
}

const currentBuffer = (page) =>
    page.evaluate(() => window._heynote_editor.path)

const openTabs = (page) =>
    page.locator(".tab-bar li.tab-item").allInnerTexts()

test.beforeEach(async ({ request }) => {
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
    await request.delete(`/api/notes?path=${OTHER}`)
    await request.post("/api/notes", {
        data: {
            path: OTHER,
            content: '{"formatVersion":"2.0.0","name":"TabTarget"}\n∞∞∞text\nsecond note',
        },
    })
})

test.afterEach(async ({ request }) => {
    await request.delete(`/api/notes?path=${OTHER}`)
})

test("the open buffer survives a page reload", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".buffer-tree .item", {hasText: "TabTarget"}).first().click()
    await expect.poll(() => currentBuffer(page), {timeout: 10000}).toBe(OTHER)

    await page.reload()
    await expect(page.locator(".cm-editor")).toBeVisible()

    await expect.poll(() => currentBuffer(page), {timeout: 10000}).toBe(OTHER)

    await context.close()
})

test("the open buffer survives losing and regaining the connection", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".buffer-tree .item", {hasText: "TabTarget"}).first().click()
    await expect.poll(() => currentBuffer(page), {timeout: 10000}).toBe(OTHER)
    const tabsBefore = await openTabs(page)

    // drop the socket and let the client reconnect on its own
    await page.evaluate(() => window.heynoteSync.syncClient.ws?.close())
    await expect(page.locator(".sync-status")).toHaveText("Synced", {timeout: 20000})

    expect(await currentBuffer(page)).toBe(OTHER)
    expect(await openTabs(page)).toEqual(tabsBefore)

    await context.close()
})

test("the open buffer survives another browser adding a note", async ({ browser, request }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".buffer-tree .item", {hasText: "TabTarget"}).first().click()
    await expect.poll(() => currentBuffer(page), {timeout: 10000}).toBe(OTHER)

    // someone else creates a note; this browser should learn about it without losing its place
    await request.post("/api/notes", {
        data: {
            path: "created-elsewhere.txt",
            content: '{"formatVersion":"2.0.0","name":"Elsewhere"}\n∞∞∞text\nhi',
        },
    })

    await expect(
        page.locator(".buffer-tree .item", {hasText: "Elsewhere"}).first()
    ).toBeVisible({timeout: 10000})

    expect(await currentBuffer(page)).toBe(OTHER)

    await request.delete("/api/notes?path=created-elsewhere.txt")
    await context.close()
})

test("falls back to scratch when the open note is deleted elsewhere", async ({ browser, request }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".buffer-tree .item", {hasText: "TabTarget"}).first().click()
    await expect.poll(() => currentBuffer(page), {timeout: 10000}).toBe(OTHER)

    await request.delete(`/api/notes?path=${OTHER}`)

    // the note really is gone, so this one has to move - but only this one
    await expect.poll(() => currentBuffer(page), {timeout: 15000}).toBe(SCRATCH)

    await context.close()
})
