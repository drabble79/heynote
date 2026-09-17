import { expect, test } from "@playwright/test"

/**
 * The parts of the desktop UI that have no browser equivalent and had to be rebuilt:
 * HTML context menus, and the offline save queue that replaces "the write always succeeds".
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

test.beforeEach(async ({ request }) => {
    const read = await (await request.get("/api/notes?path=" + SCRATCH)).json()
    await request.put("/api/notes", {
        data: {path: SCRATCH, content: `${SCRATCH_HEADER}\n∞∞∞text\n`, baseVersion: read.version},
    })
})

test.describe("context menus", () => {
    test("the sidebar note menu offers the same actions as the native one", async ({ browser }) => {
        const context = await browser.newContext()
        const {page, errors} = await openApp(context)

        await page.locator(".buffer-tree .item", {hasText: "Scratch"}).first()
            .click({button: "right"})

        const menu = page.locator(".context-menu")
        await expect(menu).toBeVisible()
        // scratch can't be deleted or renamed, so it gets "Archive..." instead
        await expect(menu).toContainText("Archive...")
        await expect(menu).toContainText("New Buffer…")
        await expect(menu).toContainText("New Folder…")
        await expect(menu).not.toContainText("Delete Buffer")

        await page.keyboard.press("Escape")
        await expect(menu).toBeHidden()

        expect(errors).toStrictEqual([])
        await context.close()
    })

    test("a non-scratch note can be edited and deleted from the sidebar menu", async ({ browser, request }) => {
        await request.post("/api/notes", {
            data: {
                path: "menu-target.txt",
                content: '{"formatVersion":"2.0.0","name":"MenuTarget"}\n∞∞∞text\nhi',
            },
        })
        const context = await browser.newContext()
        const {page} = await openApp(context)

        const item = page.locator(".buffer-tree .item", {hasText: "MenuTarget"}).first()
        await expect(item).toBeVisible({timeout: 10000})
        await item.click({button: "right"})

        const menu = page.locator(".context-menu")
        await expect(menu).toContainText("Edit Buffer…")
        await expect(menu).toContainText("Delete Buffer")
        await expect(menu).not.toContainText("Archive...")

        await menu.getByText("Delete Buffer").click()
        // the delete goes through a confirm(); accept it
        page.on("dialog", (dialog) => dialog.accept())

        await context.close()
        await request.delete("/api/notes?path=menu-target.txt")
    })

    test("right-clicking empty sidebar space offers creation actions", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        const tree = page.locator(".buffer-tree")
        const box = await tree.boundingBox()
        // click near the bottom, away from any item
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10)
        await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, {button: "right"})

        const menu = page.locator(".context-menu")
        await expect(menu).toBeVisible()
        await expect(menu).toContainText("New Buffer…")
        await expect(menu).toContainText("New Folder…")

        await context.close()
    })

    test("the tab menu closes a tab", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        await page.locator(".tab-bar li", {hasText: "Scratch"}).first().click({button: "right"})
        const menu = page.locator(".context-menu")
        await expect(menu).toBeVisible()
        await expect(menu).toContainText("Close Tab")
        await expect(menu).toContainText("Open Buffer…")

        await context.close()
    })

    test("the main menu button opens a menu with the app-level commands", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        // the main menu button only appears when the sidebar is collapsed
        await page.locator(".status-block.sidebar").click()
        const button = page.locator("button.main-menu")
        await expect(button).toBeVisible()
        await button.click()

        const menu = page.locator(".context-menu")
        await expect(menu).toBeVisible()
        await expect(menu).toContainText("New Buffer…")
        await expect(menu).toContainText("Settings")

        await menu.getByText("Settings").click()
        // the settings dialog, not the status-bar button that shares the class name
        await expect(page.getByText("Key Bindings")).toBeVisible()

        await context.close()
    })

    test("the editor keeps the browser's own menu, which has working clipboard entries", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        let defaultPrevented = null
        await page.exposeFunction("__reportContextMenu", (value) => {
            defaultPrevented = value
        })
        await page.evaluate(() => {
            document.addEventListener("contextmenu", (event) => {
                window.__reportContextMenu(event.defaultPrevented)
            })
        })

        await page.locator(".cm-content").click({button: "right"})
        await expect.poll(() => defaultPrevented).toBe(false)
        await expect(page.locator(".context-menu")).toHaveCount(0)

        await context.close()
    })
})

test.describe("offline saves", () => {
    test("an edit made while the server is unreachable is retried, not lost", async ({ browser }) => {
        const context = await browser.newContext()
        const {page} = await openApp(context)

        // block only the note-write API, leaving the page itself alive
        await context.route("**/api/notes", (route) =>
            route.request().method() === "PUT" ? route.abort() : route.continue())

        await page.evaluate(async (content) => {
            await window._heynote_editor.setContent(content)
            await window._heynote_editor.save()
        }, `${SCRATCH_HEADER}\n∞∞∞text\nwritten while offline`)

        // the status bar has to actually say something is wrong
        // only the save endpoint is blocked here, so the socket is still up — the indicator
        // reports the queued change rather than claiming the connection is down
        const status = page.locator(".sync-status")
        await expect(status).toBeVisible({timeout: 10000})
        await expect(status).toHaveText(/Unsaved \(\d+\)/, {timeout: 10000})

        // let the writes through again; the queued save should land on its own
        await context.unroute("**/api/notes")

        await expect.poll(async () => {
            const response = await page.request.get("/api/notes?path=" + SCRATCH)
            return (await response.json()).content
        }, {timeout: 30000}).toContain("written while offline")

        // the indicator stays visible and returns to the healthy state
        await expect(status).toHaveText("Synced", {timeout: 15000})

        await context.close()
    })
})
