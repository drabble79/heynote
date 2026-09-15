import { EditorView } from "@codemirror/view"
import { EditorSelection } from "@codemirror/state"

import { createImageTag } from "../image/image-parsing.js"
import { doPaste } from "./copy-paste.js"
import { unserializeFromHeynote } from "./serialize.js"
import { imageFileUrl } from "../../common/image-url.js"

const MAX_DISPLAY_HEIGHT = 200

export const buildImageTagFromFile = async (file) => {
    if (!file.type.startsWith("image/")) {
        return null
    }
    if (typeof window?.heynote?.buffer?.saveImage !== "function") {
        return null
    }

    const img = new Image()
    const url = URL.createObjectURL(file)
    await new Promise((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = url
    })
    URL.revokeObjectURL(url)

    const width = img.naturalWidth
    const height = img.naturalHeight
    const aspect = width / height

    const filename = await window.heynote.buffer.saveImage({
        data: new Uint8Array(await file.arrayBuffer()),
        mime: file.type,
    })
    if (!filename) {
        return null
    }

    const image = {
        id: crypto.randomUUID(),
        file: imageFileUrl(filename),
        width,
        height,
    }

    if ((height / window.devicePixelRatio) > MAX_DISPLAY_HEIGHT) {
        image.displayHeight = MAX_DISPLAY_HEIGHT
        image.displayWidth = MAX_DISPLAY_HEIGHT * aspect
    }

    return createImageTag(image)
}

export const insertImageTags = (view, pos, tags) => {
    const insert = tags.join("")
    view.dispatch(view.state.update({
        changes: { from: pos, to: pos, insert },
        selection: EditorSelection.cursor(pos + insert.length),
        scrollIntoView: true,
        userEvent: "input.drop",
    }))
}

export const heynoteDropPaste = () => {
    const handleDrop = async (event, view) => {
        const files = Array.from(event.dataTransfer?.files || [])
        if (!files.length || view.state.readOnly) {
            return false
        }

        event.preventDefault()
        event.stopPropagation()
        view.focus()

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            ?? view.state.selection.main.head

        const tags = []
        for (const file of files) {
            const tag = await buildImageTagFromFile(file)
            if (tag) {
                tags.push(tag)
            }
        }

        if (!tags.length) {
            return false
        }

        insertImageTags(view, pos, tags)
        return true
    }

    const handleDragOver = (event) => {
        const files = Array.from(event.dataTransfer?.files || [])
        if (!files.length) {
            return false
        }
        event.preventDefault()
        return true
    }

    /**
     * Rich paste driven by the browser's own paste event.
     *
     * The Mod-v command reads the clipboard through navigator.clipboard.read(), which needs a
     * secure context and the clipboard-read permission, and isn't supported at all in some
     * browsers. When it isn't available a keybinding can't fall back to the native paste either,
     * because the async command has already reported the key as handled. So in the web builds
     * Mod-v is left to the browser (see src/editor/keymap.js) and the paste arrives here instead,
     * with the data already attached to the event — no permission required.
     */
    const handlePaste = (event, view) => {
        const clipboardData = event.clipboardData
        if (!clipboardData || view.state.readOnly) {
            return false
        }

        // blocks copied from Heynote itself, so languages and delimiters survive the round trip
        const heynoteData = clipboardData.getData("web text/heynote")
        if (heynoteData) {
            event.preventDefault()
            doPaste(view, unserializeFromHeynote(heynoteData))
            return true
        }

        const files = Array.from(clipboardData.files || [])
            .filter((file) => file.type.startsWith("image/"))
        if (files.length && typeof window?.heynote?.buffer?.saveImage === "function") {
            event.preventDefault()
            const pos = view.state.selection.main.head
            // the insert has to wait for the upload, so it happens after this handler returns
            Promise.all(files.map(buildImageTagFromFile)).then((tags) => {
                const imageTags = tags.filter(Boolean)
                if (imageTags.length) {
                    insertImageTags(view, pos, imageTags)
                }
            }).catch((error) => {
                console.error("Failed to paste image:", error)
            })
            return true
        }

        // anything else: let CodeMirror insert the plain text itself
        return false
    }

    return EditorView.domEventHandlers({
        dragover: handleDragOver,
        drop: handleDrop,
        paste: handlePaste,
    })
}
