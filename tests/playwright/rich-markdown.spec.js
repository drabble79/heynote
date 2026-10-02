import { expect, test } from "@playwright/test"
import { HeynotePage } from "./test-utils.js"

/**
 * Rich Markdown blocks render their content instead of showing the source, while plain
 * `markdown` blocks keep behaving exactly as before.
 */

let heynotePage

test.beforeEach(async ({ page }) => {
    heynotePage = new HeynotePage(page)
    await heynotePage.goto()
})

const content = (page) => page.locator(".cm-content")

/**
 * Moves the cursor to a trailing marker line, away from whatever is being asserted.
 * Position 0 is NOT far enough - it sits on the first content line, which reveals it.
 */
const PARK = "\n\npark the cursor here\n"

async function parkCursor(page) {
    const source = await heynotePage.getContent()
    await heynotePage.setCursorPosition(source.indexOf("park the cursor here") + 3)
}

test.describe("existing blocks are untouched", () => {
    test("a markdown block still shows its source", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞markdown\n# Heading\n\n**bold**\n`)

        // the markup is still visible, exactly as before this feature existed
        await expect(content(page)).toContainText("# Heading")
        await expect(content(page)).toContainText("**bold**")
        await expect(page.locator(".cm-rmd-heading")).toHaveCount(0)
    })

    test("a plain text block gets no decorations", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞text\n# Not a heading\n\n| a | b |\n| - | - |\n| 1 | 2 |\n`)

        await expect(content(page)).toContainText("# Not a heading")
        await expect(page.locator(".cm-rmd-heading")).toHaveCount(0)
        await expect(page.locator(".cm-rmd-table")).toHaveCount(0)
    })
})

test.describe("rendering", () => {
    test("headings get a size hierarchy", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\n# One\n\n### Three\n\ntext\n${PARK}`)

        const h1 = page.locator(".cm-rmd-h1")
        const h3 = page.locator(".cm-rmd-h3")
        await expect(h1).toHaveCount(1)
        await expect(h3).toHaveCount(1)

        // assert the rendered size, not just the class: a missing CSS rule must fail here
        const h1Box = await h1.boundingBox()
        const h3Box = await h3.boundingBox()
        expect(h1Box.height).toBeGreaterThan(h3Box.height)
    })

    test("markup is hidden until the cursor reaches the line", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\n# Heading\n\n**bold** text\n${PARK}`)
        await parkCursor(page)

        await expect(content(page)).not.toContainText("**bold**")
        await expect(content(page)).toContainText("bold text")

        // putting the cursor on that line brings the source back so it can be edited
        const pos = (await heynotePage.getContent()).indexOf("**bold**") + 2
        await heynotePage.setCursorPosition(pos)
        await expect(content(page)).toContainText("**bold**")
    })

    test("a link shows its text without the URL", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\nsee [the docs](https://example.com) now\n${PARK}`)
        await parkCursor(page)

        await expect(content(page)).toContainText("see the docs now")
        // hiding only the brackets would leave "the docshttps://example.com"
        await expect(content(page)).not.toContainText("example.com")
    })

    test("bullet markers become bullets", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\n- first\n- second\n${PARK}`)
        await parkCursor(page)

        await expect(page.locator(".cm-rmd-bullet")).toHaveCount(2)
    })

    test("ordered markers are left as they are", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\n1. first\n2. second\n10. tenth\n${PARK}`)
        await parkCursor(page)

        // "1." already reads correctly; replacing it with a same-text widget gained nothing and
        // squeezed multi-digit markers into a one-character box, wrapping the line
        await expect(page.locator(".cm-rmd-bullet")).toHaveCount(0)
        await expect(content(page)).toContainText("1. first")
        await expect(content(page)).toContainText("10. tenth")

        // every item stays on one line
        const lines = page.locator(".cm-line")
        const heights = await lines.evaluateAll((els) =>
            els.filter((el) => /^\s*\d+\./.test(el.textContent)).map((el) => el.getBoundingClientRect().height))
        expect(heights).toHaveLength(3)
        expect(Math.max(...heights)).toBeCloseTo(Math.min(...heights), 0)
    })

    test("a horizontal rule becomes a line", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\nabove\n\n---\n\nbelow\n${PARK}`)
        await parkCursor(page)

        await expect(page.locator(".cm-rmd-rule hr")).toHaveCount(1)
    })

    test("blockquotes and code blocks are styled", async ({ page }) => {
        await heynotePage.setContent(`\n∞∞∞richmarkdown\n> quoted\n\n\`\`\`js\nconst x = 1\n\`\`\`\n${PARK}`)
        await parkCursor(page)

        await expect(page.locator(".cm-rmd-quote")).toHaveCount(1)
        expect(await page.locator(".cm-rmd-code").count()).toBeGreaterThan(0)
    })
})

test.describe("tables", () => {
    const TABLE = `\n∞∞∞richmarkdown\n| Name | Qty |\n| :--- | ---: |\n| apple | 3 |\n${PARK}`

    test("a pipe table renders as a real table", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        await parkCursor(page)

        const table = page.locator(".cm-rmd-table table")
        await expect(table).toHaveCount(1)
        await expect(table.locator("th")).toHaveCount(2)
        await expect(table.locator("td")).toHaveCount(2)
        await expect(table.locator("th").first()).toHaveText("Name")
        await expect(table.locator("td").first()).toHaveText("apple")

        // :--- / ---: alignment reaches the cells
        await expect(table.locator("th").nth(1)).toHaveCSS("text-align", "right")
    })

    test("clicking a cell reverts to source with the cursor in that cell", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        await parkCursor(page)
        await expect(page.locator(".cm-rmd-table")).toHaveCount(1)

        await page.locator(".cm-rmd-table td").first().click()

        // the whole point: the table must be editable after being rendered
        await expect(page.locator(".cm-rmd-table")).toHaveCount(0)
        await expect(content(page)).toContainText("| apple | 3 |")

        const cursor = await heynotePage.getCursorPosition()
        const source = await heynotePage.getContent()
        expect(source.slice(cursor, cursor + 5)).toContain("apple")
    })

    test("moving the cursor away renders it again", async ({ page }) => {
        await heynotePage.setContent(TABLE)
        const pos = (await heynotePage.getContent()).indexOf("apple")
        await heynotePage.setCursorPosition(pos)
        await expect(page.locator(".cm-rmd-table")).toHaveCount(0)

        await parkCursor(page)
        await expect(page.locator(".cm-rmd-table")).toHaveCount(1)
    })

    test("cell content is never treated as HTML", async ({ page }) => {
        await heynotePage.setContent(
            `\n∞∞∞richmarkdown\n| a |\n| - |\n| <img src=x onerror=alert(1)> |\n${PARK}`)
        await parkCursor(page)

        const cell = page.locator(".cm-rmd-table td").first()
        await expect(cell).toHaveText("<img src=x onerror=alert(1)>")
        await expect(cell.locator("img")).toHaveCount(0)
    })
})
