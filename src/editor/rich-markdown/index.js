import { richMarkdownDecorations } from "./decorations.js"

/**
 * Markdown rendering for blocks using the Rich Markdown language.
 *
 * Every decoration is gated on the block's language, so `markdown` blocks — and every other
 * language — are untouched by this extension.
 */
export const richMarkdownExtension = [
    richMarkdownDecorations,
]
