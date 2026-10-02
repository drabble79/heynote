/**
 * Builds DOM for a span of Markdown source, honouring inline formatting.
 *
 * Used by the widgets that replace source with rendered output (tables, for now). Everything is
 * built with createElement/textContent and never innerHTML: note content reaches this browser
 * from the sync server, so it is untrusted input. A `<script>` in a table cell must end up as
 * the literal characters, not as a script tag.
 */

/** Nodes whose own text is punctuation that shouldn't appear in rendered output. */
const HIDDEN_NODES = new Set([
    "EmphasisMark",
    "CodeMark",
    "StrikethroughMark",
    "LinkMark",
    "HeaderMark",
    "QuoteMark",
    "URL",
    "LinkTitle",
])

/** Markdown node -> the element that should wrap its rendered children. */
const WRAPPERS = {
    StrongEmphasis: "strong",
    Emphasis: "em",
    InlineCode: "code",
    Strikethrough: "s",
}

/**
 * Renders `node`'s children into `parent`.
 *
 * @param parent      element to append to
 * @param state       EditorState, for reading the source text
 * @param node        SyntaxNode from the mounted Markdown tree (relative positions)
 * @param offset      document position of the mounted tree's start
 */
export function renderInlineChildren(parent, state, node, offset) {
    let pos = node.from

    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.from > pos) {
            appendText(parent, state, pos + offset, child.from + offset)
        }
        renderNode(parent, state, child, offset)
        pos = child.to
    }

    if (pos < node.to) {
        appendText(parent, state, pos + offset, node.to + offset)
    }
}

function renderNode(parent, state, node, offset) {
    if (HIDDEN_NODES.has(node.name)) {
        return
    }

    if (node.name === "Link") {
        renderLink(parent, state, node, offset)
        return
    }

    const wrapper = WRAPPERS[node.name]
    if (wrapper) {
        const element = document.createElement(wrapper)
        if (node.firstChild) {
            renderInlineChildren(element, state, node, offset)
        } else {
            appendText(element, state, node.from + offset, node.to + offset)
        }
        parent.appendChild(element)
        return
    }

    // anything else (plain text, unknown node): render its children, or its text
    if (node.firstChild) {
        renderInlineChildren(parent, state, node, offset)
    } else {
        appendText(parent, state, node.from + offset, node.to + offset)
    }
}

/** Only http(s) and mailto links become anchors; anything else stays plain text. */
const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i

function renderLink(parent, state, node, offset) {
    const urlNode = node.getChild("URL")
    const href = urlNode
        ? state.doc.sliceString(urlNode.from + offset, urlNode.to + offset).trim()
        : ""

    // a javascript: URL in a note must never become a clickable anchor
    if (!SAFE_LINK_SCHEME.test(href)) {
        renderInlineChildren(parent, state, node, offset)
        return
    }

    const anchor = document.createElement("a")
    anchor.href = href
    anchor.target = "_blank"
    anchor.rel = "noreferrer noopener"
    renderInlineChildren(anchor, state, node, offset)
    parent.appendChild(anchor)
}

function appendText(parent, state, from, to) {
    if (to <= from) {
        return
    }
    parent.appendChild(document.createTextNode(state.doc.sliceString(from, to)))
}
