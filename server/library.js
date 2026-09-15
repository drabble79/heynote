import { createHash } from "node:crypto"
import fs from "node:fs"
import { join } from "node:path"

import jetpack from "fs-jetpack"

import { SCRATCH_FILE_NAME } from "@/src/common/constants"
import { NoteLibrary, untildify } from "@/shared-node/note-library.js"
import { initialContent } from "@/electron/initial-content"
import { LIBRARY_PATH } from "./config.js"
import { assertWithinLibrary, validateImageFilename } from "./paths.js"

/**
 * Adds optimistic-concurrency versioning on top of the shared NoteLibrary.
 *
 * The version of a note is simply the SHA-256 of its content. This is deliberately stateless:
 * no counter to persist, no drift after a restart, and it stays correct even when a note is
 * edited directly on the server's filesystem. "My baseVersion still matches" is exactly
 * "the content I based my edit on is still what's on disk".
 */

export class ConflictError extends Error {
    constructor(serverContent, serverVersion) {
        super("Note was modified by someone else")
        this.name = "ConflictError"
        this.statusCode = 409
        this.serverContent = serverContent
        this.serverVersion = serverVersion
    }
}

export function versionOf(content) {
    return createHash("sha256").update(content, "utf8").digest("hex")
}

/** NoteLibrary throws plain Errors; the API needs statuses a client can act on. */
function httpError(message, statusCode) {
    return Object.assign(new Error(message), {statusCode})
}

export class SyncLibrary {
    /**
     * @param {object} [options]
     * @param {(path: string, content: string, version: string) => void} [options.onNoteChanged]
     *        Fired when a note changes on disk outside of a client write.
     * @param {() => void} [options.onLibraryChanged]
     */
    constructor({onNoteChanged = null, onLibraryChanged = null} = {}) {
        const basePath = untildify(LIBRARY_PATH)
        // NoteLibrary requires the directory to exist already
        jetpack.dir(basePath)

        this.library = new NoteLibrary({
            basePath,
            initialContent,
            onChange: (path, content) => {
                onNoteChanged?.(path, content, versionOf(content))
            },
            onLibraryChange: () => {
                onLibraryChanged?.()
            },
        })
        this.basePath = this.library.basePath
        this.imagesBasePath = this.library.imagesBasePath

        /** @type {Map<string, Promise<any>>} per-note write serialization */
        this._locks = new Map()

        this.library.setupWatcher()
    }

    /**
     * Serializes work per note path. Without this, two concurrent saves could both read the
     * same current version, both find their baseVersion valid, and the second would silently
     * discard the first.
     */
    async _withLock(path, fn) {
        const previous = this._locks.get(path) || Promise.resolve()
        // swallow the previous outcome so one failed write doesn't reject the next
        const run = previous.then(() => fn())
        const tail = run.catch(() => {})
        this._locks.set(path, tail)
        try {
            return await run
        } finally {
            // only the last queued operation clears the entry
            if (this._locks.get(path) === tail) {
                this._locks.delete(path)
            }
        }
    }

    _assertSafe(relativePath) {
        assertWithinLibrary(this.basePath, relativePath)
    }

    async exists(path) {
        this._assertSafe(path)
        return await this.library.exists(path)
    }

    /** @returns {Promise<{content: string, version: string}>} */
    async read(path) {
        this._assertSafe(path)
        if (!(await this.library.exists(path))) {
            throw httpError(`Note not found: ${path}`, 404)
        }
        const content = await this.library.load(path)
        return {content, version: versionOf(content)}
    }

    /**
     * @param {string|null} baseVersion The version the client's edit was based on, or null to
     *        force the write through (used by explicit "overwrite" conflict resolution).
     * @throws {ConflictError} when the note changed on disk since baseVersion.
     */
    async write(path, content, baseVersion) {
        this._assertSafe(path)
        if (!(await this.library.exists(path))) {
            throw httpError(`Note not found: ${path}`, 404)
        }
        return await this._withLock(path, async () => {
            const current = await this.library.load(path)
            const currentVersion = versionOf(current)

            if (baseVersion != null && baseVersion !== currentVersion) {
                throw new ConflictError(current, currentVersion)
            }
            if (current === content) {
                return {version: currentVersion, unchanged: true}
            }
            await this.library.save(path, content)
            return {version: versionOf(content), unchanged: false}
        })
    }

    async create(path, content) {
        this._assertSafe(path)
        if (await this.library.exists(path)) {
            throw httpError(`File already exists: ${path}`, 409)
        }
        await this.library.create(path, content)
        return {version: versionOf(content)}
    }

    async delete(path) {
        this._assertSafe(path)
        if (path === SCRATCH_FILE_NAME) {
            throw httpError("Can't delete the scratch note", 403)
        }
        if (!(await this.library.exists(path))) {
            throw httpError(`Note not found: ${path}`, 404)
        }
        await this.library.delete(path)
        this.library.closeFile(path)
    }

    async move(path, newPath) {
        this._assertSafe(path)
        this._assertSafe(newPath)
        if (!(await this.library.exists(path))) {
            throw httpError(`Note not found: ${path}`, 404)
        }
        if (await this.library.exists(newPath)) {
            throw httpError(`File already exists: ${newPath}`, 409)
        }
        await this.library.move(path, newPath)
        this.library.closeFile(path)
    }

    async createDirectory(path) {
        this._assertSafe(path)
        await this.library.createDirectory(path)
    }

    async deleteDirectory(path) {
        this._assertSafe(path)
        if (jetpack.exists(join(this.basePath, path)) !== "dir") {
            throw httpError(`Directory not found: ${path}`, 404)
        }
        if (!(await this.library.isDirectoryEmpty(path))) {
            throw httpError(`Directory is not empty: ${path}`, 409)
        }
        await this.library.deleteDirectory(path)
    }

    async isDirectoryEmpty(path) {
        this._assertSafe(path)
        return await this.library.isDirectoryEmpty(path)
    }

    async getList() {
        return await this.library.getList()
    }

    async getDirectoryList() {
        return await this.library.getDirectoryList()
    }

    closeFile(path) {
        this.library.closeFile(path)
    }

    async saveImage({mime, data}) {
        return await this.library.saveImage({mime, data})
    }

    /** Absolute path of a stored image, or null when it doesn't exist. */
    imagePath(filename) {
        const safeName = validateImageFilename(filename)
        const fullPath = join(this.imagesBasePath, safeName)
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
            return null
        }
        return fullPath
    }

    get scratchFileName() {
        return SCRATCH_FILE_NAME
    }

    close() {
        this.library.close()
    }
}
