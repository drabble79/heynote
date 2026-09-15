import fs from "node:fs"
import path from "node:path"

/**
 * Path validation for anything that arrives from a client.
 *
 * In Electron the renderer was trusted — it ran the same code as the main process and could
 * only reach the local filesystem anyway. A network server cannot make that assumption, so
 * every path crossing the API boundary is validated here before it reaches NoteLibrary.
 *
 * Clients always speak POSIX paths (the bridge sets `pathSeparator: "/"`).
 */

const MAX_PATH_LENGTH = 1024

export class InvalidPathError extends Error {
    constructor(message) {
        super(message)
        this.name = "InvalidPathError"
        this.statusCode = 400
    }
}

/**
 * Normalize a client-supplied relative path and reject anything that could escape the
 * library root or reach internal files.
 */
function normalizeRelative(inputPath, {label = "path"} = {}) {
    if (typeof inputPath !== "string") {
        throw new InvalidPathError(`${label} must be a string`)
    }
    if (inputPath.length === 0) {
        throw new InvalidPathError(`${label} is empty`)
    }
    if (inputPath.length > MAX_PATH_LENGTH) {
        throw new InvalidPathError(`${label} is too long`)
    }
    if (inputPath.includes("\0")) {
        throw new InvalidPathError(`${label} contains a null byte`)
    }
    // Clients always use "/". Rejecting backslashes stops a Windows-style path (or a
    // backslash-escaped traversal) from being interpreted differently further down.
    if (inputPath.includes("\\")) {
        throw new InvalidPathError(`${label} must not contain backslashes`)
    }
    if (path.posix.isAbsolute(inputPath)) {
        throw new InvalidPathError(`${label} must be relative`)
    }

    const normalized = path.posix.normalize(inputPath)
    for (const segment of normalized.split("/")) {
        if (segment === "" || segment === "." || segment === "..") {
            throw new InvalidPathError(`${label} contains an invalid path segment`)
        }
        // Blocks ".images", ".heynote-meta.json" and any other internal/hidden entry.
        if (segment.startsWith(".")) {
            throw new InvalidPathError(`${label} must not contain hidden path segments`)
        }
    }
    return normalized
}

/** Validate the path of a note file. Notes are always `*.txt`. */
export function validateNotePath(inputPath) {
    const normalized = normalizeRelative(inputPath, {label: "note path"})
    if (!normalized.endsWith(".txt")) {
        throw new InvalidPathError("note path must end with .txt")
    }
    if (normalized === ".txt" || path.posix.basename(normalized) === ".txt") {
        throw new InvalidPathError("note path must have a file name")
    }
    return normalized
}

/** Validate the path of a directory inside the library. */
export function validateDirectoryPath(inputPath) {
    return normalizeRelative(inputPath, {label: "directory path"})
}

const IMAGE_FILENAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/

/** Validate an image file name. Images live flat inside `<library>/.images`. */
export function validateImageFilename(filename) {
    if (typeof filename !== "string" || filename.length === 0) {
        throw new InvalidPathError("image filename is required")
    }
    if (filename.length > 255) {
        throw new InvalidPathError("image filename is too long")
    }
    if (!IMAGE_FILENAME_REGEX.test(filename)) {
        throw new InvalidPathError("invalid image filename")
    }
    if (filename.includes("..")) {
        throw new InvalidPathError("invalid image filename")
    }
    return filename
}

/**
 * Defence in depth against symlinks inside the library pointing outside of it: resolve the
 * real path of the closest existing ancestor and require it to stay under the root.
 *
 * Path-string validation alone can't catch this, because `library/link/note.txt` contains no
 * traversal syntax yet may resolve anywhere on disk.
 */
export function assertWithinLibrary(libraryRealPath, relativePath) {
    const target = path.resolve(libraryRealPath, relativePath)

    let existing = target
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing)
        if (parent === existing) {
            throw new InvalidPathError("path resolves outside the library")
        }
        existing = parent
    }

    const realExisting = fs.realpathSync(existing)
    const rootWithSep = libraryRealPath.endsWith(path.sep) ? libraryRealPath : libraryRealPath + path.sep
    if (realExisting !== libraryRealPath && !realExisting.startsWith(rootWithSep)) {
        throw new InvalidPathError("path resolves outside the library")
    }
    return target
}
