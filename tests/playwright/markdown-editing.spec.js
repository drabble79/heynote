import { expect, test } from "@playwright/test"
import { HeynotePage } from "./test-utils.js"

/**
 * The editing commands that stand in for a toolbar: formatting toggles and table cell
 * navigation. They produce ordinary Markdown, so they work in both Markdown block types.
 */

let heynotePage

test.beforeEach(async ({ page }) => {
    heynotePage = new HeynotePage(page)
    await heynotePage.goto()
})

const mod = (key) => (process.platform === "darwin" ? `Meta+${key}` : `Control+${key}`)

async function selectRange(page, from, to) {
    await page.evaluate(([a, b]) => {
        window._heynote_editor.view.dispatch({selection: {anchor: a, head: b}})
    }, [from, to])
}

test.describe("formatting toggles", () => {
    test("Ctrl+B wraps and unwraps the selection", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\nmake this bold\n`)
        const source = await heynotePage.getContent()
        const from = source.indexOf("this")
        await selectRange(page, from, from + 4)

        await page.locator("body").press(mod("b"))
        expect(await heynotePage.getContent()).toContain("make **this** bold")

        await page.locator("body").press(mod("b"))
        expect(await heynotePage.getContent()).toContain("make this bold")
    })

    test("Ctrl+I works in a plain markdown block too", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞markdown\nmake this italic\n`)
        const source = await heynotePage.getContent()
        const from = source.indexOf("this")
        await selectRange(page, from, from + 4)

        await page.locator("body").press(mod("i"))
        expect(await heynotePage.getContent()).toContain("make *this* italic")
    })

    test("Ctrl+B does nothing outside a markdown block", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞javascript\nconst value = 1\n`)
        const source = await heynotePage.getContent()
        const from = source.indexOf("value")
        await selectRange(page, from, from + 5)

        await page.locator("body").press(mod("b"))
        expect(await heynotePage.getContent()).toContain("const value = 1")
        expect(await heynotePage.getContent()).not.toContain("**")
    })
})

test.describe("table editing", () => {
    const TABLE = `\n∞∞∞richmarkdown\n| Name | Qty |\n| --- | --- |\n| apple | 3 |\n`

    test("Tab moves to the next cell and aligns the table", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        const source = await heynotePage.getContent()
        await heynotePage.setCursorPosition(source.indexOf("Name"))

        await page.locator("body").press("Tab")

        const updated = await heynotePage.getContent()
        // the columns are padded so the pipes line up
        expect(updated).toContain("| Name  | Qty |")
        expect(updated).toContain("| apple | 3   |")

        // and the cursor sits in the second cell
        const cursor = await heynotePage.getCursorPosition()
        expect(updated.slice(cursor, cursor + 3)).toBe("Qty")
    })

    test("Shift+Tab moves back", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        const source = await heynotePage.getContent()
        await heynotePage.setCursorPosition(source.indexOf("Qty"))

        await page.locator("body").press("Shift+Tab")

        const updated = await heynotePage.getContent()
        const cursor = await heynotePage.getCursorPosition()
        expect(updated.slice(cursor, cursor + 4)).toBe("Name")
    })

    test("Tab in the last cell adds a row", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        const source = await heynotePage.getContent()
        await heynotePage.setCursorPosition(source.indexOf("3"))

        await page.locator("body").press("Tab")

        const lines = (await heynotePage.getContent()).trim().split("\n")
        expect(lines[lines.length - 1]).toMatch(/^\|\s+\|\s+\|$/)
    })

    test("Tab outside a table still indents", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\nplain line\n`)
        const source = await heynotePage.getContent()
        await heynotePage.setCursorPosition(source.indexOf("plain"))

        await page.locator("body").press("Tab")

        // the fallback to insertIndentation must survive: this is what the ordering in
        // keymap.js exists for
        expect(await heynotePage.getContent()).toMatch(/\n\s+plain line/)
    })

    test("aligning only touches the table, not the rest of the block", async ({ page }) => {
        await heynotePage.setContent(
            `\n∞∞∞richmarkdown\nA paragraph that prettier would rewrap if it ran on the whole block.\n\n| a | bb |\n| --- | --- |\n| 1 | 2 |\n`
        )
        const source = await heynotePage.getContent()
        await heynotePage.setCursorPosition(source.indexOf("| a |") + 3)

        await page.locator("body").press("Tab")

        const updated = await heynotePage.getContent()
        expect(updated).toContain("A paragraph that prettier would rewrap if it ran on the whole block.")
        expect(updated).toContain("| a   | bb  |")
    })
})
