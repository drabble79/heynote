import { expect, test } from "@playwright/test"

/**
 * Copy, cut and paste have to work in a plain browser tab: over http:// (so no secure context and
 * no navigator.clipboard at all) and without clipboard permissions.
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

/**
 * Reads the system clipboard by pasting into a plain textarea with a real key press.
 * document.execCommand("paste") can't be used — browsers refuse it — and the async clipboard API
 * isn't available in these contexts, which is the whole point of these tests.
 */
async function readClipboardViaPaste(page) {
    await page.evaluate(() => {
        const input = document.createElement("textarea")
        input.id = "clipboard-probe"
        document.body.appendChild(input)
        input.focus()
    })
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")
    return await page.evaluate(() => {
        const input = document.getElementById("clipboard-probe")
        const value = input.value
        input.remove()
        return value
    })
}

test("Ctrl/Cmd+C copies the selection to the system clipboard", async ({ browser }) => {
    const {context, page, errors} = await openApp(browser)

    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\ncopy me please`)
    }, SCRATCH_HEADER)

    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a")
    await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c")

    // paste it back into a plain textarea: if the clipboard is empty, nothing arrives
    await expect.poll(() => readClipboardViaPaste(page)).toContain("copy me please")

    expect(errors).toStrictEqual([])
    await context.close()
})

test("Ctrl/Cmd+X cuts the selection", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\ncut this line`)
    }, SCRATCH_HEADER)

    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a")
    await page.keyboard.press(process.platform === "darwin" ? "Meta+x" : "Control+x")

    await expect.poll(() => readClipboardViaPaste(page)).toContain("cut this line")
    await expect.poll(() => docText(page)).not.toContain("cut this line")

    await context.close()
})

test("copying inside Heynote round-trips through a paste", async ({ browser }) => {
    const {context, page} = await openApp(browser)

    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\nround trip content`)
    }, SCRATCH_HEADER)

    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a")
    await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c")

    // replace everything, then paste the copy back
    await page.evaluate(async (header) => {
        await window._heynote_editor.setContent(`${header}\n∞∞∞text\n`)
    }, SCRATCH_HEADER)
    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v")

    await expect.poll(() => docText(page)).toContain("round trip content")

    await context.close()
})
