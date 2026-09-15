import { EditorSelection } from "@codemirror/state"
import { EditorView } from "@codemirror/view"

import { IMAGE_MIME_TYPES } from "../../common/constants.js"

import { createImageTag  } from "../image/image-parsing.js"
import { imageFileUrl, resolveImageUrl } from "../../common/image-url.js"
import { imageIsSelected, imageState } from "../image/image.js"
import { serializeToText, serializeToHeynote, serializeToHtml, serializeToHtmlWithoutImages, unserializeFromHeynote } from "./serialize.js"


function copiedRange(state) {
    let content = [], ranges = []
    for (let range of state.selection.ranges) {
        if (!range.empty) {
            content.push(state.sliceDoc(range.from, range.to))
            ranges.push(range)
        }
    }
    if (ranges.length == 0) {
        // if all ranges are empty, we want to copy each whole (unique) line for each selection
        const copiedLines = []
        for (let range of state.selection.ranges) {
            if (range.empty) {
                const line = state.doc.lineAt(range.head)
                const lineContent = state.sliceDoc(line.from, line.to)
                if (!copiedLines.includes(line.from)) {
                    content.push(lineContent)
                    ranges.push(range)
                    copiedLines.push(line.from)
                }
            }
        }
    }
    return { text: content.join(state.lineBreak), ranges }
}


/**
 * Set up event handlers for the browser's copy & cut events, that will replace block separators with newlines
 */
export const heynoteCopyCut = (editor) => {
    const copy = (event, view) => {
        event.preventDefault()

        // A selected image is copied as image data rather than as text. This lives here as well
        // as in copyCommand() because the web builds leave the copy key to the browser, so the
        // command never runs and this event is the only entry point.
        const state = editor.view.state
        for (const image of state.field(imageState)) {
            if (imageIsSelected(image, state.selection.main)) {
                copyImage(image.file).catch((error) => {
                    console.error("Failed to copy image:", error)
                })
                return
            }
        }

        if (asyncClipboardAvailable()) {
            copyCut(editor.view, event.type == "cut", editor)
        } else {
            copyCutSync(editor.view, event, event.type == "cut", editor)
        }
    }

    return EditorView.domEventHandlers({
        copy,
        cut: copy,
    })
}

/**
 * navigator.clipboard.write() only exists in a secure context. Served over plain http:// the
 * whole API is missing, so the copy has to go through the event's own clipboardData instead.
 */
function asyncClipboardAvailable() {
    return typeof navigator?.clipboard?.write === "function"
}

/**
 * Fills a copy/cut event's clipboardData directly. Needs no permission and no secure context,
 * but must complete synchronously — see serializeToHtmlWithoutImages().
 */
function copyCutSync(view, event, cut, editor) {
    const { text, ranges } = copiedRange(view.state)

    event.clipboardData.setData("text/plain", serializeToText(text))
    event.clipboardData.setData("text/html", serializeToHtmlWithoutImages(text))
    try {
        // custom types are browser-internal, which is all we need: this flavour exists so a
        // Heynote-to-Heynote copy keeps its block delimiters and languages
        event.clipboardData.setData("web text/heynote", serializeToHeynote(text))
    } catch (e) {
        // some browsers reject unknown types; plain text still works
    }

    if (cut && !view.state.readOnly) {
        view.dispatch({
            changes: ranges,
            scrollIntoView: true,
            userEvent: "delete.cut",
        })
    }

    editor.selectionMarkMode = false
    if (editor.deselectOnCopy && !cut) {
        deselect(view)
    }
    return true
}

function deselect(view) {
    view.dispatch(view.state.update({
        selection: EditorSelection.create(
            view.state.selection.ranges.map(r => EditorSelection.cursor(r.head)),
            view.state.selection.mainIndex,
        ),
    }))
}

const toBlob = (text, type) => new Blob([text], {type:type})

const copyCut = async (view, cut, editor) => {
    let { text, ranges } = copiedRange(view.state)

    //text = text.replaceAll(BLOCK_DELIMITER_REGEX, "\n\n")
    const formats = {
        "text/plain": toBlob(serializeToText(text), "text/plain"),
        "text/html": toBlob(await serializeToHtml(text), "text/html"),
    }
    if (ClipboardItem.supports("web text/heynote")) {
        formats["web text/heynote"] = toBlob(serializeToHeynote(text), "web text/heynote")
    }
    await navigator.clipboard.write([
        new ClipboardItem(formats)
    ])

    if (cut && !view.state.readOnly) {
        view.dispatch({
            changes: ranges,
            scrollIntoView: true,
            userEvent: "delete.cut"
        })
    }

    // if we're in Emacs mode, we want to exit mark mode in case we're in it
    editor.selectionMarkMode = false

    // if Editor.deselectOnCopy is set (e.g. we're in Emacs mode), we want to remove the selection after we've copied the text
    if (editor.deselectOnCopy && !cut) {
        const newSelection = EditorSelection.create(
            view.state.selection.ranges.map(r => EditorSelection.cursor(r.head)),
            view.state.selection.mainIndex,
        )
        view.dispatch(view.state.update({
            selection: newSelection,
        }))
    }
    return true
}


export function doPaste(view, input) {
    let { state } = view, changes, i = 1, text = state.toText(input)
    let byLine = text.lines == state.selection.ranges.length
    if (byLine) {
        changes = state.changeByRange(range => {
            let line = text.line(i++)
            return {
                changes: { from: range.from, to: range.to, insert: line.text },
                range: EditorSelection.cursor(range.from + line.length)
            }
        })
    } else {
        changes = state.replaceSelection(text)
    }
    view.dispatch(changes, {
        userEvent: "input.paste",
        scrollIntoView: true
    })
}

/**
 * @param editor Editor instance
 * @returns CodeMirror command that copies the current selection to the clipboard
 */
export function copyCommand(editor) {
    return (view) => {
        for (const image of view.state.field(imageState)) {
            if (imageIsSelected(image, view.state.selection.main)) {
                copyImage(image.file)
                return true
            }
        }
        if (!asyncClipboardAvailable()) {
            // Ask the browser to raise a copy event, which heynoteCopyCut() then fills in. This
            // is how the emacs bindings and the command palette reach the clipboard when
            // navigator.clipboard is unavailable.
            return document.execCommand("copy")
        }
        return copyCut(view, false, editor)
    }
}

/**
 * @param editor Editor instance
 * @returns CodeMirror command that cuts the current selection to the clipboard
 */
export function cutCommand(editor) {
    return (view) => {
        if (!asyncClipboardAvailable()) {
            return document.execCommand("cut")
        }
        return copyCut(view, true, editor)
    }
}

/**
 * CodeMirror command that pastes the plain text clipboard content into the editor
 */
export async function pasteAsTextCommand(view) {
    return doPaste(view, await navigator.clipboard.readText())
}

/**
 * CodeMirror command that pastes the clipboard content into the editor
 */
export async function pasteCommand(/** @type {EditorView} */view) {
    const { dispatch, state } = view


    const items = await navigator.clipboard.read()
    const canSaveImages = typeof window?.heynote?.buffer?.saveImage === "function"

    for (const item of items) {
        //console.log("item:", item, item.types)
        if (item.types.includes("web text/heynote")) {
            const blob = await item.getType("web text/heynote")
            doPaste(view, unserializeFromHeynote(await blob.text()))
            return

        //} else if (itemType == "text/html") {
        //    const blob = await item.getType("text/html")
        //    console.log("raw html:", await blob.text())

        } else {
            for (const itemType of item.types) {
                //console.log(itemType, ":", await item.getType(itemType))
                // handle images data
                if (IMAGE_MIME_TYPES.includes(itemType)) {
                    if (!canSaveImages) {
                        continue
                    }
                    const blob = await item.getType(itemType)
                    //console.log("image data:", blob.arrayBuffer())

                    // get image dimensions
                    const img = new Image();
                    const url = URL.createObjectURL(blob);
                    await new Promise((resolve, reject) => {
                        img.onload = () => resolve();
                        img.onerror = reject;
                        img.src = url;
                    });
                    URL.revokeObjectURL(url);
                    let width = img.naturalWidth
                    let height = img.naturalHeight
                    const aspect = width / height

                    const filename = await window.heynote.buffer.saveImage({
                        data: new Uint8Array(await blob.arrayBuffer()),
                        mime: blob.type,
                    })
                    //console.log("saved:", filename)

                    if (filename) {
                        const image = {
                            id: crypto.randomUUID(),
                            file: imageFileUrl(filename),
                            width: width,
                            height: height,
                        }
                        if ((height / window.devicePixelRatio) > 200) {
                            image.displayHeight = 200
                            image.displayWidth = 200 * aspect
                        }

                        let imageTag = createImageTag(image)

                        // if we're not on an empty line, insert on a new line after the current
                        let insertAt = state.selection.main
                        //const line = state.doc.lineAt(state.selection.main.head)
                        //if (line.to > line.from) {
                        //    imageTag = "\n" + imageTag
                        //    insertAt = {from:line.to, to: line.to}
                        //}

                        dispatch(state.update({
                            changes: {
                                from: insertAt.from,
                                to: insertAt.to,
                                insert: imageTag,
                            },
                            selection: EditorSelection.cursor(insertAt.from + imageTag.length),
                        }, {
                            scrollIntoView: true,
                            userEvent: "input",
                        }))

                        return
                    }
                }
            }
        }
    }

    return doPaste(view, await navigator.clipboard.readText())
}


export async function copyImage(url) {
    // callers pass either the URL stored in the note (heynote-file://) or an already-resolved
    // one from an <img>; resolveImageUrl() leaves the latter alone
    const res = await fetch(resolveImageUrl(url), { mode: "cors" })
    if (!res.ok) {
        throw new Error(`Fetch failed: ${res.status}`)
    }
    const blob = await res.blob()

    if (!blob.type.startsWith("image/")) {
        throw new Error(`Not an image content type. Got: ${blob.type}`)
    }
    if (ClipboardItem.supports(blob.type)) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } else {
        // convert image to PNG through a canvas
        const img = new Image()
        const blobUrl = URL.createObjectURL(blob)
        const pngBlob = await new Promise((resolve, reject) => {
            img.onload = () => {
                const canvas = document.createElement("canvas")
                canvas.width = img.naturalWidth
                canvas.height = img.naturalHeight
                const ctx = canvas.getContext("2d")
                ctx.drawImage(img, 0, 0)
                canvas.toBlob((result) => {
                    if (result) {
                        resolve(result)
                    } else {
                        reject(new Error("Failed to convert image to PNG"))
                    }
                }, "image/png")
            }
            img.onerror = () => reject(new Error("Failed to decode image"))
            img.src = blobUrl
        }).finally(() => {
            URL.revokeObjectURL(blobUrl)
        })
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })])
    }
}
