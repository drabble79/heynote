import { merge as diff3Merge } from "node-diff3"

/**
 * Three-way line merge used when the server rejects a save because the note changed underneath us.
 *
 * `base` is the exact content the local edit was made on top of (the last version this browser
 * successfully read or wrote), which is what makes a real 3-way merge possible rather than a
 * guess. Two browsers editing different parts of a note merge cleanly; edits to the same lines
 * are reported as a conflict for the user to resolve.
 */

export const MERGE_CLEAN = "clean"
export const MERGE_CONFLICT = "conflict"

function splitLines(text) {
    return text.split("\n")
}

/**
 * @returns {{status: "clean", content: string} | {status: "conflict"}}
 */
export function mergeNoteContent({local, base, server}) {
    if (local === server) {
        return {status: MERGE_CLEAN, content: server}
    }
    if (base === undefined || base === null) {
        // Without a common ancestor any merge would be a guess.
        return {status: MERGE_CONFLICT}
    }
    if (base === server) {
        // The server hasn't actually moved; ours is a straight fast-forward.
        return {status: MERGE_CLEAN, content: local}
    }
    if (base === local) {
        // We changed nothing; take the server's version.
        return {status: MERGE_CLEAN, content: server}
    }

    const result = diff3Merge(splitLines(local), splitLines(base), splitLines(server))
    if (result.conflict) {
        return {status: MERGE_CONFLICT}
    }
    return {status: MERGE_CLEAN, content: result.result.join("\n")}
}
