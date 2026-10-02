import { EditorSelection } from "@codemirror/state"

import { getNoteBlockFromPos } from "../block/block.js"
import { RICH_MARKDOWN_TOKEN } from "../languages.js"

/**
 * Table editing: Tab/Shift-Tab between cells, alignment, and inserting a table.
 *
 * Alignment is done here rather than through formatBlockContent(). That runs Prettier over the
 * *whole block* and is async, so pressing Tab would also rewrap paragraphs and renumber lists.
 * This touches only the table the cursor is in. `Alt+Shift+F` still formats the whole block.
 */

const MARKDOWN_LANGUAGES = new Set(["markdown", RICH_MARKDOWN_TOKEN])

function inMarkdownBlock(state, pos) {
    return MARKDOWN_LANGUAGES.has(getNoteBlockFromPos(state, pos)?.language?.name)
}

const isTableLine = (text) => /^\s*\|/.test(text)
/** The |---|:--:| row, which carries alignment and holds no content. */
const isDelimiterLine = (text) => /^\s*\|[\s:|-]*\|?\s*$/.test(text) && text.includes("-")

/** The contiguous run of table lines around `pos`, or null. */
function tableAt(state, pos) {
    const line = state.doc.lineAt(pos)
    if (!isTableLine(line.text)) {
        return null
    }

    let first = line.number
    while (first > 1 && isTableLine(state.doc.line(first - 1).text)) {
        first--
    }
    let last = line.number
    while (last < state.doc.lines && isTableLine(state.doc.line(last + 1).text)) {
        last++
    }

    const lines = []
    for (let n = first; n <= last; n++) {
        lines.push(state.doc.line(n))
    }
    return { lines, from: lines[0].from, to: lines[lines.length - 1].to }
}

/** Splits a table row into cells, ignoring the leading and trailing pipes. */
function splitCells(text) {
    const trimmed = text.trim()
    const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "")
    return inner.split("|").map((cell) => cell.trim())
}

function alignmentsFrom(text) {
    return splitCells(text).map((spec) => {
        const left = spec.startsWith(":")
        const right = spec.endsWith(":")
        return left && right ? "center" : right ? "right" : left ? "left" : null
    })
}

function pad(text, width, align) {
    const space = Math.max(0, width - [...text].length)
    if (align === "right") {
        return " ".repeat(space) + text
    }
    if (align === "center") {
        const left = Math.floor(space / 2)
        return " ".repeat(left) + text + " ".repeat(space - left)
    }
    return text + " ".repeat(space)
}

function delimiterCell(width, align) {
    const dashes = "-".repeat(Math.max(3, width))
    if (align === "center") return `:${dashes.slice(2)}:`
    if (align === "right") return `${dashes.slice(1)}:`
    if (align === "left") return `:${dashes.slice(1)}`
    return dashes
}

/** Re-pads every cell so the pipes line up. Returns the new text, or null if nothing changed. */
function formatTableText(table) {
    const rows = table.lines.map((line) => ({
        line,
        delimiter: isDelimiterLine(line.text),
        cells: splitCells(line.text),
    }))

    const delimiterRow = rows.find((row) => row.delimiter)
    const aligns = delimiterRow ? alignmentsFrom(delimiterRow.line.text) : []
    const columns = Math.max(...rows.map((row) => row.cells.length))

    const widths = []
    for (let column = 0; column < columns; column++) {
        widths.push(Math.max(
            3,
            ...rows.filter((row) => !row.delimiter)
                .map((row) => [...(row.cells[column] ?? "")].length),
        ))
    }

    const formatted = rows.map((row) => {
        const cells = []
        for (let column = 0; column < columns; column++) {
            cells.push(row.delimiter
                ? delimiterCell(widths[column], aligns[column])
                : pad(row.cells[column] ?? "", widths[column], aligns[column]))
        }
        return `| ${cells.join(" | ")} |`
    }).join("\n")

    const current = table.lines.map((line) => line.text).join("\n")
    return formatted === current ? null : formatted
}

/** Positions of each cell's content in a formatted row, in document coordinates. */
function cellPositions(state, table) {
    const positions = []
    for (const line of table.lines) {
        if (isDelimiterLine(line.text)) {
            continue
        }
        const regex = /\|/g
        const pipes = []
        let match
        while ((match = regex.exec(line.text)) !== null) {
            pipes.push(match.index)
        }
        for (let i = 0; i < pipes.length - 1; i++) {
            positions.push(line.from + pipes[i] + 2)
        }
    }
    return positions
}

function moveCell(direction) {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false
        }
        const pos = state.selection.main.head
        if (!inMarkdownBlock(state, pos)) {
            return false
        }
        const table = tableAt(state, pos)
        if (!table) {
            // not in a table, so Tab keeps its normal indentation behaviour
            return false
        }

        // Work out which cell the cursor is in *before* reformatting. Mapping the position
        // through the change afterwards doesn't work: aligning replaces the table wholesale, so
        // every position inside it maps to the same point.
        let index = cellIndexAt(state, table, pos)

        const formatted = formatTableText(table)
        let workingState = state
        if (formatted !== null) {
            const transaction = state.update({
                changes: { from: table.from, to: table.to, insert: formatted },
                userEvent: "input.format",
            })
            dispatch(transaction)
            workingState = transaction.state
        }

        // reformatting preserves the number and order of cells, so the index still points at the
        // same one
        const current = tableAt(workingState, Math.min(table.from + 1, workingState.doc.length))
        if (!current) {
            return true
        }
        const positions = cellPositions(workingState, current)
        if (positions.length === 0) {
            return true
        }
        if (index === -1) {
            index = positions.length - 1
        }

        const target = index + direction
        if (target < 0) {
            return true
        }
        if (target >= positions.length) {
            appendRow(workingState, current, dispatch)
            return true
        }

        dispatch(workingState.update({
            selection: EditorSelection.cursor(positions[target]),
            scrollIntoView: true,
        }))
        return true
    }
}

/**
 * Index into cellPositions() of the cell containing `pos`, or -1.
 *
 * Positions ascend, so the containing cell is the last one starting at or before `pos`. The -2
 * lets a cursor sitting on the "| " separator count as being in the cell that follows it.
 */
function cellIndexAt(state, table, pos) {
    const positions = cellPositions(state, table)
    let index = -1
    for (let i = 0; i < positions.length; i++) {
        if (positions[i] - 2 > pos) {
            break
        }
        index = i
    }
    return index
}

function appendRow(state, table, dispatch) {
    const lastLine = table.lines[table.lines.length - 1]
    const columns = splitCells(lastLine.text).length
    const row = `\n| ${Array(columns).fill("   ").join(" | ")} |`
    const transaction = state.update({
        changes: { from: lastLine.to, insert: row },
        selection: EditorSelection.cursor(lastLine.to + 3),
        userEvent: "input",
    })
    dispatch(transaction)
}

export const markdownTableNextCell = moveCell(1)
export const markdownTablePrevCell = moveCell(-1)

export const formatMarkdownTable = ({ state, dispatch }) => {
    if (state.readOnly) {
        return false
    }
    const pos = state.selection.main.head
    if (!inMarkdownBlock(state, pos)) {
        return false
    }
    const table = tableAt(state, pos)
    if (!table) {
        return false
    }
    const formatted = formatTableText(table)
    if (formatted === null) {
        return true
    }
    dispatch(state.update({
        changes: { from: table.from, to: table.to, insert: formatted },
        userEvent: "input.format",
    }))
    return true
}

export const insertMarkdownTable = ({ state, dispatch }) => {
    if (state.readOnly) {
        return false
    }
    const pos = state.selection.main.head
    if (!inMarkdownBlock(state, pos)) {
        return false
    }
    const line = state.doc.lineAt(pos)
    const prefix = line.text.trim() === "" ? "" : "\n"
    const table = [
        "| Column 1 | Column 2 | Column 3 |",
        "| -------- | -------- | -------- |",
        "|          |          |          |",
    ].join("\n")

    dispatch(state.update({
        changes: { from: line.to, insert: prefix + "\n" + table },
        selection: EditorSelection.cursor(line.to + prefix.length + 3),
        userEvent: "input",
    }))
    return true
}
