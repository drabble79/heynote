import { WidgetType } from "@codemirror/view"

import { renderInlineChildren } from "./inline.js"

/**
 * Renders a Markdown table as a real <table>.
 *
 * The decoration that uses this widget deliberately does NOT provide atomicRanges. Images are
 * atomic because they are a single token nobody edits; a table is the opposite. If its range
 * were atomic the cursor could never be placed inside it, the "selection overlaps -> show the
 * source" rule would never fire, and the table would become uneditable.
 */
export class TableWidget extends WidgetType {
    /**
     * @param rows    [{ cells: [{from, to, node}], header: boolean }]
     * @param aligns  per-column CSS text-align, or null
     * @param state   EditorState, read when building the DOM
     * @param offset  document position of the mounted Markdown tree's start
     */
    constructor({ rows, aligns, state, offset, from }) {
        super()
        this.rows = rows
        this.aligns = aligns
        this.state = state
        this.offset = offset
        this.from = from
    }

    eq(other) {
        // the source range plus its text is enough to decide the rendering is unchanged
        return other.from === this.from && other.source() === this.source()
    }

    source() {
        const last = this.rows[this.rows.length - 1]
        const end = last?.cells[last.cells.length - 1]?.to
        return end === undefined ? "" : this.state.doc.sliceString(this.from, end + this.offset)
    }

    toDOM() {
        const wrap = document.createElement("div")
        wrap.className = "cm-rmd-table"

        const table = document.createElement("table")
        wrap.appendChild(table)

        let body = null
        for (const row of this.rows) {
            const section = row.header
                ? table.appendChild(document.createElement("thead"))
                : (body ||= table.appendChild(document.createElement("tbody")))

            const tr = section.appendChild(document.createElement("tr"))
            row.cells.forEach((cell, column) => {
                const td = tr.appendChild(document.createElement(row.header ? "th" : "td"))
                const align = this.aligns[column]
                if (align) {
                    td.style.textAlign = align
                }
                // clicking a cell should put the cursor in that cell, not at the table start
                td.dataset.pos = String(cell.from + this.offset)
                renderInlineChildren(td, this.state, cell.node, this.offset)
            })
        }

        return wrap
    }

    ignoreEvent() {
        // let mousedown through so the plugin can move the cursor into the source
        return false
    }
}

/**
 * Reads a Table node into the shape TableWidget needs.
 * @returns {{rows: Array, aligns: Array<string|null>}}
 */
export function readTable(state, tableNode, offset) {
    const rows = []
    const aligns = []

    for (let row = tableNode.firstChild; row; row = row.nextSibling) {
        if (row.name === "TableDelimiter") {
            // the |---|:--:| row: it defines alignment and is never rendered
            readAlignments(state, row, offset, aligns)
            continue
        }
        if (row.name !== "TableHeader" && row.name !== "TableRow") {
            continue
        }

        const cells = []
        for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
            if (cell.name === "TableCell") {
                cells.push({ from: cell.from, to: cell.to, node: cell })
            }
        }
        if (cells.length > 0) {
            rows.push({ cells, header: row.name === "TableHeader" })
        }
    }

    return { rows, aligns }
}

function readAlignments(state, delimiterRow, offset, aligns) {
    const text = state.doc.sliceString(delimiterRow.from + offset, delimiterRow.to + offset)
    text.split("|").forEach((part) => {
        const spec = part.trim()
        if (!spec || !spec.includes("-")) {
            return
        }
        const left = spec.startsWith(":")
        const right = spec.endsWith(":")
        aligns.push(left && right ? "center" : right ? "right" : left ? "left" : null)
    })
}
