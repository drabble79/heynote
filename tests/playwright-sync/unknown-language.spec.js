import { expect, test } from "@playwright/test"

/**
 * A note written by a newer build can name a block language this build doesn't know.
 *
 * That has to degrade to "show the text as it is". It used to throw out of the blockState
 * update, leaving the editor with an empty document which autosave then wrote back over the
 * real content — the note ended up as nothing but a chain of metadata headers.
 */

const NOTE = "unknown-lang.txt"
const CONTENT =
    '{"formatVersion":"2.0.0","name":"Unknown"}\n∞∞∞futurelang\n# Title\n\nimportant body text\n'

test.beforeEach(async ({ request }) => {
    await request.delete(`/api/notes?path=${NOTE}`)
    await request.post("/api/notes", {data: {path: NOTE, content: CONTENT}})
})

test.afterEach(async ({ request }) => {
    await request.delete(`/api/notes?path=${NOTE}`)
})

test("a note using an unknown block language still shows its content", async ({ browser, request }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))

    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()

    await page.locator(".buffer-tree .item", {hasText: "Unknown"}).first().click()
    await expect.poll(() => page.evaluate(() => window._heynote_editor?.path), {timeout: 10000})
        .toBe(NOTE)

    // long enough for the 2s autosave to have fired if it were going to
    await page.waitForTimeout(4000)

    const doc = await page.evaluate(() => window._heynote_editor.view.state.doc.toString())
    expect(doc).toContain("important body text")
    expect(errors).toStrictEqual([])

    const stored = (await (await request.get(`/api/notes?path=${NOTE}`)).json()).content
    expect(stored).toBe(CONTENT)

    await context.close()
})

test("the server refuses a write that would strip the note's blocks", async ({ request }) => {
    // the last line of defence, which holds even for a client this build can't fix
    const read = await (await request.get(`/api/notes?path=${NOTE}`)).json()
    const response = await request.put("/api/notes", {
        data: {path: NOTE, content: '{"formatVersion":"2.0.0"}', baseVersion: read.version},
    })

    expect(response.status()).toBe(422)
    expect((await (await request.get(`/api/notes?path=${NOTE}`)).json()).content).toBe(CONTENT)
})
