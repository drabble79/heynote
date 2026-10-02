import { StateField } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view"

import { forEachMarkdownNode, getRichMarkdownBlocks, markdownRoot } from "./tree.js"
import { readTable, TableWidget } from "./table.js"

/**
 * Renders Markdown instead of showing its source, for blocks using the Rich Markdown language.
 *
 * Follows the live-preview model: the rendered form is shown until the cursor reaches it, at
 * which point that line — or that table — reverts to source so it can be edited. The document
 * itself is always plain Markdown; nothing here changes what is saved.
 *
 * Split in two on purpose. CodeMirror refuses block decorations from a ViewPlugin ("Block
 * decorations may not be specified via plugins"), so tables and horizontal rules come from a
 * StateField, and everything inline comes from a ViewPlugin limited to the visible ranges.
 */

const HEADING_LEVEL = {
    ATXHeading1: 1, ATXHeading2: 2, ATXHeading3: 3,
    ATXHeading4: 4, ATXHeading5: 5, ATXHeading6: 6,
    SetextHeading1: 1, SetextHeading2: 2,
}

/** Punctuation that is hidden once the line is no longer being edited. */
const INLINE_MARKS = new Set([
    "HeaderMark",
    "EmphasisMark",
    "CodeMark",
    "StrikethroughMark",
    "QuoteMark",
])

const hiddenMark = Decoration.replace({})

class RuleWidget extends WidgetType {
    eq() { return true }
    toDOM() {
        const wrap = document.createElement("div")
        wrap.className = "cm-rmd-rule"
        wrap.appendChild(document.createElement("hr"))
        return wrap
    }
    ignoreEvent() { return false }
}

class BulletWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    eq(other) { return other.text === this.text }
    toDOM() {
        const span = document.createElement("span")
        span.className = "cm-rmd-bullet"
        span.textContent = this.text
        return span
    }
    ignoreEvent() { return false }
}

function selectionTouches(state, from, to) {
    return state.selection.ranges.some((range) => range.from <= to && from <= range.to)
}

function lineRevealed(state, pos) {
    const line = state.doc.lineAt(pos)
    return selectionTouches(state, line.from, line.to)
}

/** Block widgets must cover whole lines. */
function wholeLines(state, from, to) {
    return [state.doc.lineAt(from).from, state.doc.lineAt(to).to]
}

// ---------------------------------------------------------------- block decorations

function buildBlockDecorations(state) {
    const decorations = []

    for (const block of getRichMarkdownBlocks(state)) {
        const root = markdownRoot(state, block)
        const offset = root ? root.from : 0
        let skipUntil = -1

        forEachMarkdownNode(state, block, ({ name, from, to, node }) => {
            if (from < skipUntil) {
                return
            }

            if (name === "Table") {
                if (selectionTouches(state, from, to)) {
                    return
                }
                const { rows, aligns } = readTable(state, node, offset)
                if (rows.length === 0) {
                    return
                }
                const [start, end] = wholeLines(state, from, to)
                skipUntil = end
                decorations.push(
                    Decoration.replace({
                        widget: new TableWidget({ rows, aligns, state, offset, from: start }),
                        block: true,
                    }).range(start, end)
                )
                return
            }

            if (name === "HorizontalRule" && !selectionTouches(state, from, to)) {
                const [start, end] = wholeLines(state, from, to)
                skipUntil = end
                decorations.push(
                    Decoration.replace({ widget: new RuleWidget(), block: true }).range(start, end)
                )
            }
        })
    }

    return Decoration.set(decorations, true)
}

const richMarkdownBlockWidgets = StateField.define({
    create: (state) => buildBlockDecorations(state),

    update(decorations, tr) {
        // the selection decides whether a table is rendered or shown as source, so it has to
        // trigger a rebuild just as much as a document change does
        if (tr.docChanged || tr.selection) {
            return buildBlockDecorations(tr.state)
        }
        return decorations.map(tr.changes)
    },

    provide: (field) => EditorView.decorations.from(field),
})

// --------------------------------------------------------------- inline decorations

function buildInlineDecorations(view) {
    const { state } = view
    const decorations = []

    for (const block of getRichMarkdownBlocks(state)) {
        // only pay for what is on screen
        if (!view.visibleRanges.some((r) => r.from <= block.content.to && block.content.from <= r.to)) {
            continue
        }

        const root = markdownRoot(state, block)
        const offset = root ? root.from : 0
        let skipUntil = -1

        forEachMarkdownNode(state, block, ({ name, from, to, node }) => {
            if (from < skipUntil) {
                return
            }

            // these are replaced wholesale by the StateField above; nothing inside them may be
            // decorated again
            if ((name === "Table" || name === "HorizontalRule") && !selectionTouches(state, from, to)) {
                skipUntil = state.doc.lineAt(to).to
                return
            }

            const level = HEADING_LEVEL[name]
            if (level) {
                decorations.push(
                    Decoration.line({ class: `cm-rmd-heading cm-rmd-h${level}` })
                        .range(state.doc.lineAt(from).from)
                )
                return
            }

            if (name === "Blockquote") {
                forEachLine(state, from, to, (line) => {
                    decorations.push(Decoration.line({ class: "cm-rmd-quote" }).range(line.from))
                })
                return
            }

            if (name === "FencedCode" || name === "CodeBlock") {
                forEachLine(state, from, to, (line) => {
                    decorations.push(Decoration.line({ class: "cm-rmd-code" }).range(line.from))
                })
                return
            }

            if (name === "ListMark") {
                if (lineRevealed(state, from)) {
                    return
                }
                const text = state.doc.sliceString(from, to)
                // ordered lists keep their number; bullets become a real bullet glyph
                const rendered = /^\d/.test(text) ? text : "•"
                decorations.push(
                    Decoration.replace({ widget: new BulletWidget(rendered) }).range(from, to)
                )
                return
            }

            if (name === "Link") {
                decorations.push(Decoration.mark({ class: "cm-rmd-link" }).range(from, to))
                if (lineRevealed(state, from)) {
                    return
                }
                // hiding only LinkMark would leave the URL behind, turning
                // "[docs](https://x)" into "docshttps://x" - worse than not hiding anything
                for (const child of linkChildrenToHide(node)) {
                    decorations.push(hiddenMark.range(child.from + offset, child.to + offset))
                }
                return
            }

            if (INLINE_MARKS.has(name) && !lineRevealed(state, from)) {
                decorations.push(hiddenMark.range(from, to))
            }
        })
    }

    return Decoration.set(decorations, true)
}

/** The bracket/paren punctuation and the URL, i.e. everything but the link text. */
function linkChildrenToHide(linkNode) {
    const hide = []
    for (let child = linkNode.firstChild; child; child = child.nextSibling) {
        if (child.name === "LinkMark" || child.name === "URL" || child.name === "LinkTitle") {
            hide.push(child)
        }
    }
    return hide
}

function forEachLine(state, from, to, callback) {
    let line = state.doc.lineAt(from)
    while (true) {
        callback(line)
        if (line.to >= to || line.number >= state.doc.lines) {
            break
        }
        line = state.doc.line(line.number + 1)
    }
}

const richMarkdownInline = ViewPlugin.fromClass(
    class {
        constructor(view) {
            this.decorations = buildInlineDecorations(view)
        }

        update(update) {
            // selectionSet matters as much as docChanged here: moving the cursor is what reveals
            // and re-hides the source
            if (update.docChanged || update.viewportChanged || update.selectionSet) {
                this.decorations = buildInlineDecorations(update.view)
            }
        }
    },
    {
        decorations: (v) => v.decorations,

        eventHandlers: {
            mousedown(event, view) {
                const cell = event.target.closest?.("[data-pos]")
                if (!cell) {
                    return false
                }
                // put the cursor in the cell that was clicked, so the source appears there
                const pos = Number(cell.dataset.pos)
                if (Number.isNaN(pos)) {
                    return false
                }
                event.preventDefault()
                view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
                view.focus()
                return true
            },
        },
    }
)

export const richMarkdownDecorations = [
    richMarkdownBlockWidgets,
    richMarkdownInline,
]
