import { describe, expect, it } from "vitest"

import { LANGUAGES, RICH_MARKDOWN_TOKEN, getLanguage } from "../../src/editor/languages.js"

describe("language registry", () => {
    it("declares guesslang explicitly, never by omission", () => {
        // vite.config.mjs builds the language-detection worker's list with
        // `LANGUAGES.map(l => l.guesslang).filter(l => l !== null)`. An omitted guesslang is
        // `undefined`, which survives that filter and JSON.stringify turns it into a null in the
        // worker's language array.
        const omitted = LANGUAGES.filter((language) => language.guesslang === undefined)
        expect(omitted.map((l) => l.token)).toEqual([])
    })

    it("keeps every block token usable as a delimiter", () => {
        // lang-heynote/heynote.grammar lists tokens literally and block.js matches them with
        // /∞∞∞[a-z]+/, so anything else can't round-trip through a note file
        for (const language of LANGUAGES) {
            expect(language.token).toMatch(/^[a-z]+$/)
        }
    })

    it("has no duplicate tokens", () => {
        const tokens = LANGUAGES.map((l) => l.token)
        expect(tokens).toHaveLength(new Set(tokens).size)
    })

    describe("Rich Markdown", () => {
        const richMarkdown = () => getLanguage(RICH_MARKDOWN_TOKEN)

        it("is registered and formattable", () => {
            expect(richMarkdown()?.name).toBe("Rich Markdown")
            expect(richMarkdown()?.supportsFormat).toBe(true)
        })

        it("is never chosen by language auto-detection", () => {
            // switching a block to rendered Markdown has to be a deliberate Ctrl+L choice
            expect(richMarkdown()?.guesslang).toBeNull()
        })
    })
})
