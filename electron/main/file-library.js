import { join } from "path"

import * as jetpack from "fs-jetpack";
import { app, ipcMain, dialog } from "electron"

import CONFIG from "../config"
import { SCRATCH_FILE_NAME } from "../../src/common/constants"
import { NoteFormat } from "../../src/common/note-format"
import { isDev } from '../detect-platform';
import { initialContent, initialDevContent } from '../initial-content'
import { NoteLibrary, NoteBuffer, readNoteMetadata } from "../../shared-node/note-library.js"

export const NOTES_DIR_NAME = isDev ? "notes-dev" : "notes"

export { NoteBuffer }

/**@type {FileLibrary}*/
let library


/**
 * The Electron-facing note library: the platform-agnostic storage lives in
 * shared-node/note-library.js, this adds renderer notification and window-focus polling.
 */
export class FileLibrary extends NoteLibrary {
    constructor(basePath, win) {
        super({
            basePath,
            initialContent: isDev ? initialDevContent : initialContent,
        })
        this.win = win
        this.contentSaved = false
        this._onWindowFocus = null
        this.onChange = (path, content) => this.win?.webContents.send("buffer:change", path, content)
    }

    setupWatcher() {
        const hadWatcher = !!this.watcher
        super.setupWatcher()
        if (!hadWatcher) {
            // fs.watch() is unreliable in some cases, e.g. OneDrive on Windows. Therefor we'll load the
            // open buffer files and check for changes when the window gets focus.
            this._onWindowFocus = async () => {
                await this.checkOpenFilesForChanges()
            }
            this.win.on("focus", this._onWindowFocus)
        }
    }

    stopWatcher() {
        super.stopWatcher()
        if (this._onWindowFocus) {
            this.win.off("focus", this._onWindowFocus)
            this._onWindowFocus = null
        }
    }
}


export function setCurrentFileLibrary(lib) {
    library = lib
}

export function setupFileLibraryEventHandlers() {
    ipcMain.handle('buffer:load', async (event, path) => {
        //console.log("buffer:load", path)
        return await library.load(path)
    });


    ipcMain.handle('buffer:save', async (event, path, content) => {
        return await library.save(path, content)
    });

    ipcMain.handle('buffer:create', async (event, path, content) => {
        return await library.create(path, content)
    });

    ipcMain.handle('buffer:createDirectory', async (event, path) => {
        return await library.createDirectory(path)
    });

    ipcMain.handle('buffer:getList', async (event) => {
        return await library.getList()
    });

    ipcMain.handle('buffer:getDirectoryList', async (event) => {
        return await library.getDirectoryList()
    });

    ipcMain.handle('buffer:exists', async (event, path) => {
        return await library.exists(path)
    });

    ipcMain.handle('buffer:close', async (event, path) => {
        return await library.closeFile(path)
    });

    ipcMain.handle('buffer:saveAndQuit', async (event, contents) => {
        library.stopWatcher()
        for (const [path, content] of contents) {
            await library.save(path, content)
        }
        library.contentSaved = true
        app.quit()
    })

    ipcMain.handle('buffer:move', async (event, path, newPath) => {
        return await library.move(path, newPath)
    });

    ipcMain.handle('buffer:delete', async (event, path) => {
        return await library.delete(path)
    });

    ipcMain.handle('buffer:isDirectoryEmpty', async (event, path) => {
        return await library.isDirectoryEmpty(path)
    });

    ipcMain.handle('buffer:deleteDirectory', async (event, path) => {
        return await library.deleteDirectory(path)
    });

    ipcMain.handle("library:selectLocation", async () => {
        let result = await dialog.showOpenDialog({
            title: "Select directory to store buffer",
            properties: [
                "openDirectory",
                "createDirectory",
                "noResolveAliases",
            ],
        })
        if (result.canceled) {
            return
        }
        const filePath = result.filePaths[0]
        return filePath
    })

    ipcMain.handle("library:saveImage", async (event, blob) => {
        return await library.saveImage(blob)
    })
}


export async function migrateBufferFileToLibrary(app) {
    async function ensureBufferFileMetadata(filePath) {
        const metadata = await readNoteMetadata(filePath)
        //console.log("Metadata", metadata)
        if (!metadata || !metadata.name) {
            console.log("Adding metadata to", filePath)
            const note = NoteFormat.load(jetpack.read(filePath))
            note.metadata.name = "Scratch"
            jetpack.write(filePath, note.serialize())
        } else {
            console.log("Metadata already exists for", filePath)
        }
    }

    function getBackupFile(filePath) {
        // Get a backup file path by adding a .bak suffix. If the file already exists, add a number suffix.
        let backupFile = filePath + ".bak";
        for (let i = 1; i < 1000; i++) {
            if (jetpack.exists(backupFile) !== "file") {
                return backupFile;
            }
            backupFile = `${filePath}.bak.${i}`;
        }
        throw new Error(`Unable to find an available file path after 1000 attempts for base path: ${filePath}`);
    }

    const defaultLibraryPath = join(app.getPath("userData"), NOTES_DIR_NAME)
    const customBufferPath = CONFIG.get("settings.bufferPath")
    const oldBufferFile = isDev ? "buffer-dev.txt" : "buffer.txt"
    if (customBufferPath) {
        // if the new buffer file exists, no need to migrate
        if (jetpack.exists(join(customBufferPath, SCRATCH_FILE_NAME)) === "file") {
            return
        }
        const oldBufferFileFullPath = join(customBufferPath, oldBufferFile)
        const backupFile = getBackupFile(oldBufferFileFullPath)
        if (jetpack.exists(oldBufferFileFullPath) === "file") {
            // make a backup copy of the old buffer file
            console.log(`Taking backup of ${oldBufferFileFullPath} to ${backupFile}`)
            jetpack.copy(oldBufferFileFullPath, backupFile)

            // rename buffer file to scratch.txt
            const newFileFullPath = join(customBufferPath, SCRATCH_FILE_NAME);
            console.log(`Migrating file ${oldBufferFileFullPath} to ${newFileFullPath}`)
            jetpack.move(oldBufferFileFullPath, newFileFullPath)
            // add metadata to scratch.txt (just to be sure, we'll double check that it's needed first)
            await ensureBufferFileMetadata(newFileFullPath)
        }
    } else {
        // if the new buffer file exists, no need to migrate
        if (jetpack.exists(join(defaultLibraryPath, SCRATCH_FILE_NAME)) === "file") {
            return
        }
        // check if the old buffer file exists, while the default *library* path doesn't exist
        const oldBufferFileFullPath = join(app.getPath("userData"), oldBufferFile)
        const backupFile = getBackupFile(oldBufferFileFullPath)
        if (jetpack.exists(oldBufferFileFullPath) === "file" && jetpack.exists(defaultLibraryPath) !== "dir") {
            // make a backup copy of the old buffer file
            console.log(`Taking backup of ${oldBufferFileFullPath} to ${backupFile}`)
            jetpack.copy(oldBufferFileFullPath, backupFile)

            const newFileFullPath = join(defaultLibraryPath, SCRATCH_FILE_NAME);
            console.log(`Migrating buffer file ${oldBufferFileFullPath} to ${newFileFullPath}`)
            // create the default library path
            jetpack.dir(defaultLibraryPath)
            // move the buffer file to the library path
            jetpack.move(oldBufferFileFullPath, newFileFullPath)
            // add metadata to scratch.txt
            await ensureBufferFileMetadata(newFileFullPath)
        }
    }
}
