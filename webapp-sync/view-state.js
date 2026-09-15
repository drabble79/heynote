import { NoteFormat } from "@/src/common/note-format"

/**
 * Keeps per-note cursor and fold state out of the synced note content.
 *
 * Heynote stores `cursors` and `foldedRanges` inside the note's own JSON metadata header, and
 * HeynoteEditor.getContent() rewrites them on every save. With a shared server that means two
 * browsers which merely have the same note *open* would produce a different byte stream every
 * two seconds and collide constantly, even though nobody typed anything.
 *
 * So the bridge strips these two fields before sending a note to the server and re-injects the
 * browser's own copy after loading. The editor never notices: it still sees a note whose
 * metadata carries its cursor position.
 */

const VIEW_STATE_KEY_PREFIX = "heynote-viewstate__"

function key(path) {
    return VIEW_STATE_KEY_PREFIX + path
}

/**
 * @returns {{shared: string, viewState: {cursors?: object, foldedRanges?: Array}|null}}
 *          `shared` is the note as it should be stored on the server.
 */
export function splitViewState(serialized) {
    let note
    try {
        note = NoteFormat.load(serialized)
    } catch {
        // unparseable notes are passed through untouched; the editor will surface the error
        return {shared: serialized, viewState: null}
    }

    const {cursors, foldedRanges, ...shared} = note.metadata
    if (cursors === undefined && foldedRanges === undefined) {
        // nothing to strip - avoid re-serializing, which would change the bytes for no reason
        return {shared: serialized, viewState: null}
    }

    note.metadata = shared
    return {shared: note.serialize(), viewState: {cursors, foldedRanges}}
}

/** Re-attaches this browser's cursor/fold state to a note fetched from the server. */
export function mergeViewState(shared, viewState) {
    if (!viewState || (viewState.cursors === undefined && viewState.foldedRanges === undefined)) {
        return shared
    }
    let note
    try {
        note = NoteFormat.load(shared)
    } catch {
        return shared
    }
    if (viewState.cursors !== undefined) {
        note.metadata.cursors = viewState.cursors
    }
    if (viewState.foldedRanges !== undefined) {
        note.metadata.foldedRanges = viewState.foldedRanges
    }
    return note.serialize()
}

export function loadViewState(path) {
    try {
        const stored = localStorage.getItem(key(path))
        return stored ? JSON.parse(stored) : null
    } catch {
        return null
    }
}

export function saveViewState(path, viewState) {
    if (!viewState) {
        return
    }
    try {
        localStorage.setItem(key(path), JSON.stringify(viewState))
    } catch {
        // localStorage can be full or disabled; losing the cursor position is not worth failing a save
    }
}

export function deleteViewState(path) {
    try {
        localStorage.removeItem(key(path))
    } catch {
        // ignore
    }
}

export function moveViewState(path, newPath) {
    const viewState = loadViewState(path)
    if (viewState) {
        saveViewState(newPath, viewState)
    }
    deleteViewState(path)
}
