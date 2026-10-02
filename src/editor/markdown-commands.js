import { EditorSelection } from "@codemirror/state"

import { getNoteBlockFromPos } from "./block/block.js"
import { RICH_MARKDOWN_TOKEN } from "./languages.js"

/**
 * Inline formatting commands, as a stand-in for a toolbar.
 *
 * Heynote has no toolbar and these don't add one — they just insert or remove the Markdown
 * markers around the selection, so the result is the same plain Markdown someone would type by
 * hand. Useful in both Markdown block types.
 */

const MARKDOWN_LANGUAGES = new Set(["markdown", RICH_MARKDOWN_TOKEN])

function inMarkdownBlock(state, pos) {
    return MARKDOWN_LANGUAGES.has(getNoteBlockFromPos(state, pos)?.language?.name)
}

/**
 * Wraps each selection in `marker`, or unwraps it when it's already wrapped.
 * An empty selection inserts the pair and puts the cursor between them.
 */
function toggleWrapping(marker) {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false
        }
        // leave the key alone outside Markdown so it can fall through to anything else bound to it
        if (!state.selection.ranges.some((range) => inMarkdownBlock(state, range.head))) {
            return false
        }

        const length = marker.length
        const changes = state.changeByRange((range) => {
            const before = state.sliceDoc(range.from - length, range.from)
            const after = state.sliceDoc(range.to, range.to + length)

            if (before === marker && after === marker) {
                return {
                    changes: [
                        { from: range.from - length, to: range.from },
                        { from: range.to, to: range.to + length },
                    ],
                    range: EditorSelection.range(range.from - length, range.to - length),
                }
            }

            const text = state.sliceDoc(range.from, range.to)
            if (text.length >= length * 2 && text.startsWith(marker) && text.endsWith(marker)) {
                return {
                    changes: [
                        { from: range.from, to: range.from + length },
                        { from: range.to - length, to: range.to },
                    ],
                    range: EditorSelection.range(range.from, range.to - length * 2),
                }
            }

            return {
                changes: { from: range.from, to: range.to, insert: marker + text + marker },
                range: range.empty
                    ? EditorSelection.cursor(range.from + length)
                    : EditorSelection.range(range.from + length, range.to + length),
            }
        })

        dispatch(state.update(changes, { userEvent: "input" }))
        return true
    }
}

export const toggleBold = toggleWrapping("**")
export const toggleItalic = toggleWrapping("*")
export const toggleInlineCode = toggleWrapping("`")
export const toggleStrikethrough = toggleWrapping("~~")
