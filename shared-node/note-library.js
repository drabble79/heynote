import fs from "fs"
import os from "node:os"
import { join, basename, sep } from "path"

// fs-jetpack and mime-types are CommonJS: default imports are the only form that interops
// correctly across all three bundle targets (Electron CJS, browser ESM, server ESM).
import jetpack from "fs-jetpack";
import mimetypes from "mime-types"

import { SCRATCH_FILE_NAME, IMAGE_MIME_TYPES } from "@/src/common/constants"
import { getImgReferences } from "./ripgrep.js"

/**
 * Platform-agnostic note storage. Contains no Electron (or browser) dependencies so that
 * both the Electron main process and the sync server can drive the same on-disk library
 * format.
 *
 * Electron-specific concerns (IPC handlers, window events, app.quit) live in
 * electron/main/file-library.js, which subclasses NoteLibrary.
 */

export const untildify = (pathWithTilde) => {
    const homeDir = os.homedir()
    return homeDir ? pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDir) : pathWithTilde
}

export async function readNoteMetadata(filePath) {
    const chunks = []
    for await (let chunk of fs.createReadStream(filePath, { start: 0, end:4000 })) {
        chunks.push(chunk)
    }
    const headContent = Buffer.concat(chunks).toString("utf8")
    const firstSeparator = headContent.indexOf("\n∞∞∞")
    if (firstSeparator === -1) {
        return null
    }
    try {
        const metadata = JSON.parse(headContent.slice(0, firstSeparator).trim())
        return {"name": metadata.name, "tags": metadata.tags}
    } catch (e) {
        return {}
    }
}


export class NoteLibrary {
    /**
     * @param {object} options
     * @param {string} options.basePath Library root. `~` is expanded. Must already exist.
     * @param {string} options.initialContent Content written to scratch.txt when it's missing.
     * @param {(path: string, content: string) => void} [options.onChange] Called when a file
     *        is changed outside of this process (see setupWatcher).
     * @param {(changedPath: string) => void} [options.onLibraryChange] Called for any watched
     *        filesystem change, so callers can refresh their note/directory listing.
     */
    constructor({basePath, initialContent, onChange = null, onLibraryChange = null}) {
        basePath = untildify(basePath)
        if (jetpack.exists(basePath) !== "dir") {
            throw new Error(`Path directory does not exist: ${basePath}`)
        }
        this.basePath = fs.realpathSync(basePath)
        this.imagesBasePath = join(this.basePath, ".images")
        this.jetpack = jetpack.cwd(this.basePath)
        this.files = {};
        this.watcher = null;
        this.onChange = onChange
        this.onLibraryChange = onLibraryChange

        // create scratch.txt if it doesn't exist
        if (!this.jetpack.exists(SCRATCH_FILE_NAME)) {
            this.jetpack.write(SCRATCH_FILE_NAME, initialContent)
        }

        // garbage collect stale images
        this.removeUnreferencedImages().catch((err) => {
            console.error(err)
        })
    }

    async exists(path) {
        return this.jetpack.exists(path) === "file"
    }

    async load(path) {
        if (this.files[path]) {
            return this.files[path].load()
        }
        const fullPath = fs.realpathSync(join(this.basePath, path))
        this.files[path] = new NoteBuffer({fullPath, library:this})
        return await this.files[path].load()
    }

    async save(path, content) {
        if (!this.files[path]) {
            throw new Error(`File not loaded: ${path}`)
        }
        return await this.files[path].save(content)
    }

    async create(path, content) {
        if (await this.exists(path)) {
            throw new Error(`File already exists: ${path}`)
        }
        const fullPath = join(this.basePath, path)
        await this.jetpack.writeAsync(fullPath, content)
    }

    async createDirectory(path) {
        if (!path) {
            throw new Error("Directory path is empty")
        }
        const fullPath = join(this.basePath, path)
        if (this.jetpack.exists(fullPath) === "file") {
            throw new Error(`A file already exists at path: ${path}`)
        }
        await this.jetpack.dirAsync(fullPath)
    }

    async move(path, newPath) {
        if (await this.exists(newPath)) {
            throw new Error(`File already exists: ${newPath}`)
        }
        const fullOldPath = join(this.basePath, path)
        const fullNewPath = join(this.basePath, newPath)
        await this.jetpack.moveAsync(fullOldPath, fullNewPath)
    }

    async delete(path) {
        if (path === SCRATCH_FILE_NAME) {
            throw new Error("Can't delete scratch file")
        }
        const fullPath = join(this.basePath, path)
        await this.jetpack.removeAsync(fullPath)
    }

    async isDirectoryEmpty(path) {
        if (!path) {
            return false
        }
        const fullPath = join(this.basePath, path)
        if (this.jetpack.exists(fullPath) !== "dir") {
            return false
        }
        const entries = await fs.promises.readdir(fullPath)
        return entries.length === 0
    }

    async deleteDirectory(path) {
        if (!path) {
            throw new Error("Can't delete root directory")
        }
        const fullPath = join(this.basePath, path)
        if (this.jetpack.exists(fullPath) !== "dir") {
            throw new Error(`Directory does not exist: ${path}`)
        }
        if (!(await this.isDirectoryEmpty(path))) {
            throw new Error(`Directory is not empty: ${path}`)
        }
        await this.jetpack.removeAsync(fullPath)
    }

    async getList() {
        //console.log("Listing notes")
        const notes = {}
        const files = await this.jetpack.findAsync(".", {
            matching: "*.txt",
            recursive: true,
        })
        const promises = []
        for (const file of files) {
            promises.push(readNoteMetadata(join(this.basePath, file)))
        }
        const metadataList = await Promise.all(promises)
        metadataList.forEach((metadata, i) => {
            const path = files[i]
            notes[path] = metadata
        })
        return notes
    }

    /**
     * @returns {Array<string>} List of path to all directories, but not the root directory.
     */
    async getDirectoryList() {
         const directories = await this.jetpack.findAsync("", {
            files: false,
            directories: true,
            recursive: true,
         })
         return directories
    }

    setupWatcher() {
        if (!this.watcher) {
            this.watcher = fs.watch(
                this.basePath,
                {
                    persistent: true,
                    recursive: true,
                    encoding: "utf8",
                },
                async (eventType, changedPath) => {
                    //console.log("File changed", eventType, changedPath)
                    const normalizedChangedPath = changedPath?.split(sep).join("/")
                    for (const [path, buffer] of Object.entries(this.files)) {
                        // recursive fs.watch reports paths relative to basePath, but not on every
                        // platform - fall back to matching on the file name alone
                        if (normalizedChangedPath === path || changedPath === basename(path)) {
                            const content = await buffer.loadIfChanged()
                            if (content !== null) {
                                this.notifyChange(path, content)
                            }
                        }
                    }
                    this.onLibraryChange?.(normalizedChangedPath)
                }
            )
        }
    }

    /**
     * fs.watch() is unreliable in some cases, e.g. OneDrive on Windows. Callers can poll all
     * open buffer files for changes at a moment when it's cheap to do so (e.g. window focus).
     */
    async checkOpenFilesForChanges() {
        for (const [path, buffer] of Object.entries(this.files)) {
            const content = await buffer.loadIfChanged()
            if (content !== null) {
                this.notifyChange(path, content)
            }
        }
    }

    notifyChange(path, content) {
        this.onChange?.(path, content)
    }

    closeFile(path) {
        if (this.files[path]) {
            delete this.files[path]
        }
    }

    close() {
        for (const buffer of Object.values(this.files)) {
            this.closeFile(buffer.filePath)
        }
        this.stopWatcher()
    }

    stopWatcher() {
        if (this.watcher) {
            this.watcher.close()
            this.watcher = null
        }
    }

    async saveImage({mime, data}) {
        if (!IMAGE_MIME_TYPES.includes(mime)) {
            return
        }
        const fileExtension = mimetypes.extension(mime)
        const filename = (new Date()).toISOString().replace(/:/g, ".") + "." + fileExtension

        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
        const buf = Buffer.from(u8)
        //console.log("saveImage", filename, mime, buf.length)
        await this.jetpack.writeAsync(join(this.imagesBasePath, filename), buf)
        return filename
    }

    async removeUnreferencedImages() {
        if (!jetpack.exists(this.imagesBasePath)) {
            console.log(`${this.imagesBasePath} does not exist, so no cleanup needed`)
            return
        }

        let referencedImages = []
        try {
            referencedImages = await getImgReferences(this.basePath)
        } catch (err) {
            console.error(err)
        }

        const jp = jetpack.cwd(this.imagesBasePath)
        if (!jetpack.exists(this.imagesBasePath)) {
            return
        }
        const files = await jp.findAsync("", {
            matching: "*",
            recursive: false,
        })
        let referencedImageFound = false
        const filesToDelete = []
        for (const filename of files) {
            if (referencedImages.includes(filename)) {
                //console.log("File is referenced, skipping:", filename)
                referencedImageFound = true
                continue
            }
            const fileInfo = await jp.inspectAsync(filename, {times: true})
            if (!fileInfo || !fileInfo.modifyTime) {
                continue
            }
            if ((new Date() - fileInfo.modifyTime) > 1000 * 3600 * 24) {
                //console.log("deleting file:", filename)
                filesToDelete.push(filename)
            }
        }

        if (!referencedImageFound) {
            console.log(`No referenced images found, so as a precaution, we won't do any removal of unreferenced images`)
            return
        }

        for (const filename of filesToDelete) {
            await jp.removeAsync(filename)
        }
        console.log(`Removed ${filesToDelete.length} unreferenced image files`)
    }
}


export class NoteBuffer {
    constructor({fullPath, library}) {
        this.fullPath = fullPath
        this._lastKnownContent = null
        this.library = library
    }

    async read() {
        return await this.library.jetpack.read(this.fullPath, 'utf8')
    }

    /**
     * load() assumes that the actual note buffer is actually updated with the new content, otherwise
     * _lastKnownContent will be out of sync. If you just want to read the content, use read() instead.
     */
    async load() {
        const content = await this.read()
        this._lastKnownContent = content
        return content
    }

    /**
     * loadIfChanged() will only return the content if it has changed since the last time it was loaded.
     * If content is returned, the note buffer must be updated with the new content in order to keep the
     * _lastKnownContent in sync.
     */
    async loadIfChanged() {
        const content = await this.read()
        // if the file was removed (e.g. during an atomic save) the content will be undefined
        if (content !== undefined && this._lastKnownContent !== content) {
            this._lastKnownContent = content
            return content
        }
        return null
    }

    async save(content) {
        this._lastKnownContent = content
        const saveResult = await this.library.jetpack.write(this.fullPath, content, {
            atomic: true,
            mode: '600',
        })
        return saveResult
    }

    exists() {
        return jetpack.exists(this.fullPath) === "file"
    }
}
