import { expect, test } from "@playwright/test"

import { NoteFormat } from "@/src/common/note-format.js"

/**
 * Conflicts that the automatic three-way merge can't resolve, i.e. when both sides edited the
 * same lines. The user is asked which version to keep.
 */

const SCRATCH = "scratch.txt"
const SCRATCH_HEADER = '{"formatVersion":"2.0.0","name":"Scratch"}'

async function openApp(context) {
    const page = await context.newPage()
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return page
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

/** Puts two browsers in a state where both have edited the same line from the same base. */
async function createSameLineConflict(browser) {
    const contextA = await browser.newContext()
    const contextB = await browser.newContext()
    const pageA = await openApp(contextA)
    const pageB = await openApp(contextB)

    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nshared line`)
    await expect.poll(() => getContent(pageB), {timeout: 10000}).toContain("shared line")

    // B stops hearing about A's changes, so it edits a copy that's about to go stale
    await pageB.evaluate(() => window.heynoteSync.syncClient.close())

    await setContent(pageA, `${SCRATCH_HEADER}\n∞∞∞text\nshared line changed by A`)
    await setContent(pageB, `${SCRATCH_HEADER}\n∞∞∞text\nshared line changed by B`)

    return {contextA, contextB, pageA, pageB}
}

test.beforeEach(async ({ request }) => {
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
})

test("same-line edits raise a conflict dialog instead of losing data", async ({ browser }) => {
    const {contextA, contextB, pageB} = await createSameLineConflict(browser)

    const dialog = pageB.locator(".sync-conflict")
    await expect(dialog).toBeVisible({timeout: 10000})
    await expect(dialog).toContainText("shared line changed by B")
    await expect(dialog).toContainText("shared line changed by A")

    await contextA.close()
    await contextB.close()
})

test("keeping the local version overwrites the server", async ({ browser, request }) => {
    const {contextA, contextB, pageA, pageB} = await createSameLineConflict(browser)

    await expect(pageB.locator(".sync-conflict")).toBeVisible({timeout: 10000})
    await pageB.getByRole("button", {name: "Keep my version"}).click()
    await expect(pageB.locator(".sync-conflict")).toBeHidden()

    const stored = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    expect(stored.content).toContain("changed by B")
    expect(stored.content).not.toContain("changed by A")

    // A is still connected, so it receives B's resolution
    await expect.poll(() => getContent(pageA), {timeout: 10000}).toContain("changed by B")

    await contextA.close()
    await contextB.close()
})

test("taking the server version discards the local edit", async ({ browser, request }) => {
    const {contextA, contextB, pageB} = await createSameLineConflict(browser)

    await expect(pageB.locator(".sync-conflict")).toBeVisible({timeout: 10000})
    await pageB.getByRole("button", {name: "Use server version"}).click()
    await expect(pageB.locator(".sync-conflict")).toBeHidden()

    await expect.poll(() => getContent(pageB), {timeout: 10000}).toContain("changed by A")
    expect(await getContent(pageB)).not.toContain("changed by B")

    const stored = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    expect(stored.content).toContain("changed by A")

    await contextA.close()
    await contextB.close()
})
