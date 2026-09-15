import { expect, test } from "@playwright/test"

import { NoteFormat } from "@/src/common/note-format.js"

/**
 * End-to-end sync tests: two independent browser contexts against one server, which is the whole
 * point of the web build.
 *
 * Each context gets its own storage (so its own clientId and its own cursor state), exactly like
 * two different machines.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'

async function openApp(context) {
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(`[${error.name}] ${error.message}`))
    await page.goto("/")
    await expect(page).toHaveTitle(/Heynote/)
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {page, errors}
}

async function setContent(page, content) {
    await page.evaluate(async (value) => {
        await window._heynote_editor.setContent(value)
        await window._heynote_editor.save()
    }, content)
}

async function getContent(page) {
    const raw = await page.evaluate(() => window._heynote_editor.getContent())
    return NoteFormat.load(raw).content
}

/**
 * setContent() restores the cursor inside a requestAnimationFrame, so right after a remote push
 * the editor can still overwrite a position we just set. Retry until it sticks.
 */
async function setCursor(page, position) {
    await expect.poll(async () => {
        await page.evaluate((pos) => window._heynote_editor.setCursorPosition(pos), position)
        return await page.evaluate(() => window._heynote_editor.getCursorPosition())
    }).toBe(position)
}

/** Types into the editor the way a user would, so the autosave path is exercised. */
async function typeIntoEditor(page, text) {
    await page.locator(".cm-content").click()
    await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End")
    await page.keyboard.type(text)
}

test.beforeEach(async ({ request }) => {
    // reset the scratch note so tests don't inherit each other's text
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
})

test("a note saved in one browser appears in the other", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA, errors: errorsA} = await openApp(contextA)
    const {page: pageB, errors: errorsB} = await openApp(contextB)

    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nwritten in browser A`)

    await expect.poll(() => getContent(pageB), {timeout: 10000}).toContain("written in browser A")

    expect(errorsA).toStrictEqual([])
    expect(errorsB).toStrictEqual([])

    await contextA.close()
    await contextB.close()
})

test("typing in one browser propagates through autosave", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA} = await openApp(contextA)
    const {page: pageB} = await openApp(contextB)

    await typeIntoEditor(pageA, "hello from a keyboard")

    // AUTO_SAVE_INTERVAL is 2s, plus a round trip and the push to B
    await expect.poll(() => getContent(pageB), {timeout: 15000}).toContain("hello from a keyboard")

    await contextA.close()
    await contextB.close()
})

test("content survives a reload because the server holds it", async ({ browser }) => {
    const context = await browser.newContext()
    const {page} = await openApp(context)

    await setContent(page, `${SCRATCH_HEADER}\n∞∞∞text\npersisted on the server`)
    await page.reload()
    await expect(page.locator(".cm-editor")).toBeVisible()

    await expect.poll(() => getContent(page)).toContain("persisted on the server")

    // a completely fresh browser profile sees the same content
    const fresh = await browser.newContext()
    const {page: freshPage} = await openApp(fresh)
    await expect.poll(() => getContent(freshPage)).toContain("persisted on the server")

    await context.close()
    await fresh.close()
})

test("concurrent edits to different lines merge without losing either", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA} = await openApp(contextA)
    const {page: pageB} = await openApp(contextB)

    // both start from the same base
    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nline one\nline two\nline three`)
    await expect.poll(() => getContent(pageB), {timeout: 10000}).toContain("line two")

    // Cut B's push channel so it genuinely edits an outdated copy — otherwise it would receive
    // A's change first and this would be a sequential edit, not a concurrent one.
    await pageB.evaluate(() => window.heynoteSync.syncClient.close())

    // A rewrites the first line, B the last; B's save will be rejected as stale and merged
    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nline one EDITED BY A\nline two\nline three`)
    await setContent(pageB, `${SCRATCH_HEADER}\n∞∞∞text\nline one\nline two\nline three EDITED BY B`)

    // B's editor is updated in place with the merge result
    await expect.poll(async () => await getContent(pageB), {timeout: 15000}).toContain("EDITED BY A")
    expect(await getContent(pageB)).toContain("EDITED BY B")

    // and A receives the merged note over its own (still connected) socket
    await expect.poll(async () => await getContent(pageA), {timeout: 15000}).toContain("EDITED BY B")
    expect(await getContent(pageA)).toContain("EDITED BY A")

    await contextA.close()
    await contextB.close()
})

test("a new note created in one browser shows up in the other's list", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA} = await openApp(contextA)
    const {page: pageB} = await openApp(contextB)

    const name = `synced-note-${Date.now()}`
    await pageA.evaluate(async (noteName) => {
        await window.heynote.buffer.create(
            `${noteName}.txt`,
            `{"formatVersion":"2.0.0","name":"${noteName}"}\n∞∞∞text\nhello`,
        )
    }, name)

    await expect.poll(async () => {
        const list = await pageB.evaluate(() => window.heynote.buffer.getList())
        return Object.keys(list)
    }, {timeout: 10000}).toContain(`${name}.txt`)

    await contextA.close()
    await contextB.close()
})

test("cursor position stays per-browser and never reaches the server", async ({ browser, request }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA} = await openApp(contextA)
    const {page: pageB} = await openApp(contextB)

    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nabcdefghij`)
    await expect.poll(() => getContent(pageB), {timeout: 10000}).toContain("abcdefghij")

    // two different positions inside the text body
    const cursorA = 12
    const cursorB = 17
    await setCursor(pageA, cursorA)
    await setCursor(pageB, cursorB)

    await pageA.evaluate(() => window._heynote_editor.save())
    await pageB.evaluate(() => window._heynote_editor.save())

    // the copy on the server carries no cursor metadata at all
    const stored = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    const metadata = JSON.parse(stored.content.slice(0, stored.content.indexOf("\n∞∞∞")))
    expect(metadata.cursors).toBeUndefined()
    expect(metadata.foldedRanges).toBeUndefined()
    expect(metadata.name).toBe("Scratch")

    // ...yet each browser keeps its own position across a reload
    await pageA.reload()
    await expect(pageA.locator(".cm-editor")).toBeVisible()
    await expect.poll(
        () => pageA.evaluate(() => window._heynote_editor.getCursorPosition()),
    ).toBe(cursorA)

    await pageB.reload()
    await expect(pageB.locator(".cm-editor")).toBeVisible()
    await expect.poll(
        () => pageB.evaluate(() => window._heynote_editor.getCursorPosition()),
    ).toBe(cursorB)

    await contextA.close()
    await contextB.close()
})

test("settings changes propagate between browsers", async ({ browser }) => {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()

    const {page: pageA} = await openApp(contextA)
    const {page: pageB} = await openApp(contextB)

    await pageA.evaluate(() => {
        window.heynote.setSettings({...window.heynote.settings, tabSize: 7})
    })

    await expect.poll(async () => {
        return await pageB.evaluate(() => window.heynote.settings.tabSize)
    }, {timeout: 10000}).toBe(7)

    // restore so the next test isn't affected
    await pageA.evaluate(() => {
        window.heynote.setSettings({...window.heynote.settings, tabSize: 4})
    })

    await contextA.close()
    await contextB.close()
})
