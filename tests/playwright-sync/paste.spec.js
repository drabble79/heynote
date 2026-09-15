import { expect, test } from "@playwright/test"

/**
 * Pasting has to work in a plain browser tab: over http:// (so no secure context, no
 * navigator.clipboard at all) and without the clipboard-read permission.
 *
 * These tests deliberately use a context with no clipboard permissions, unlike the rest of the
 * suite, because that is the situation a real user is in.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'

test.use({permissions: []})

async function openApp(browser) {
    const context = await browser.newContext({permissions: []})
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(`[${error.name}] ${error.message}`))
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {context, page, errors}
}

async function docText(page) {
    return await page.evaluate(() => window._heynote_editor.view.state.doc.toString())
}

test.beforeEach(async ({ request }) => {
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
})

test("Ctrl/Cmd+V pastes system clipboard text", async ({ browser }) => {
    const {context, page, errors} = await openApp(browser)

    // put text on the clipboard the way another application would, then paste with the
    // real key combination
    await page.locator(".cm-content").click()
    await page.evaluate(() => {
        const input = document.createElement("textarea")
        input.value = "text from another app"
        document.body.appendChild(input)
        input.select()
        document.execCommand("copy")
        input.remove()
    })

    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")

    await expect.poll(() => docText(page)).toContain("text from another app")
    expect(errors).toStrictEqual([])

    await context.close()
})

test("the pasted text is saved to the server", async ({ browser, request }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".cm-content").click()
    await page.evaluate(() => {
        const input = document.createElement("textarea")
        input.value = "pasted and synced"
        document.body.appendChild(input)
        input.select()
        document.execCommand("copy")
        input.remove()
    })
    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")
    await expect.poll(() => docText(page)).toContain("pasted and synced")

    await expect.poll(async () => {
        const response = await request.get("/api/notes?path=" + SCRATCH)
        return (await response.json()).content
    }, {timeout: 15000}).toContain("pasted and synced")

    await context.close()
})

test("multi-line clipboard text keeps its line breaks", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await page.locator(".cm-content").click()
    await page.evaluate(() => {
        const input = document.createElement("textarea")
        input.value = "first line\nsecond line\nthird line"
        document.body.appendChild(input)
        input.select()
        document.execCommand("copy")
        input.remove()
    })
    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")

    await expect.poll(() => docText(page)).toContain("first line\nsecond line\nthird line")

    await context.close()
})
