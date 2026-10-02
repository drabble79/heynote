import { syntaxTree } from "@codemirror/language"

import { getBlocks } from "../block/block.js"
import { RICH_MARKDOWN_TOKEN } from "../languages.js"

/**
 * Reaching the Markdown syntax tree inside a Heynote block.
 *
 * lang-heynote/nested-parser.js attaches the Markdown parser as a *mounted overlay* on the
 * NoteContent node. Plain `syntaxTree(state).iterate()` does NOT descend into such an overlay —
 * it only ever reports the Heynote block nodes (Document, Note, NoteDelimiter, NoteContent).
 *
 * `resolveInner()` does cross into the mount, so the way in is to resolve a position inside the
 * block's content and climb to the Markdown `Document` node that sits directly under NoteContent.
 * From there a normal iterate() walks the whole Markdown tree, with positions relative to that
 * node's start.
 */

/** @returns the Heynote blocks in `state` that use the Rich Markdown language. */
export function getRichMarkdownBlocks(state) {
    return getBlocks(state).filter((block) => block.language?.name === RICH_MARKDOWN_TOKEN)
}

export function isRichMarkdownBlock(block) {
    return block?.language?.name === RICH_MARKDOWN_TOKEN
}

/**
 * Finds the root of the Markdown tree mounted on a block's content.
 * @returns {import("@lezer/common").SyntaxNode | null}
 */
export function markdownRoot(state, block) {
    const { from, to } = block.content
    if (from >= to) {
        return null
    }
    let node = syntaxTree(state).resolveInner(from + 1, 1)
    while (node && node.parent && node.parent.name !== "NoteContent") {
        node = node.parent
    }
    // an empty or unparsed block resolves straight to NoteContent, with no Markdown tree below it
    return node && node.parent?.name === "NoteContent" ? node : null
}

/**
 * Calls `callback({name, from, to, node})` for every Markdown node in `block`, with absolute
 * document positions. Nodes are visited parents-first, in document order.
 */
export function forEachMarkdownNode(state, block, callback) {
    const root = markdownRoot(state, block)
    if (!root) {
        return
    }
    const offset = root.from
    root.toTree().iterate({
        enter: (ref) => {
            callback({
                name: ref.name,
                from: ref.from + offset,
                to: ref.to + offset,
                // iterate() hands out a cursor, where firstChild/nextSibling are *methods* that
                // move it. `.node` gives a real SyntaxNode whose firstChild/nextSibling are the
                // getters callers expect - without this, child traversal silently finds nothing.
                node: ref.node,
            })
        },
    })
}
