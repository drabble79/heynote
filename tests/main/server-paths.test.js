import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
    InvalidPathError,
    assertWithinLibrary,
    validateDirectoryPath,
    validateImageFilename,
    validateNotePath,
} from "../../server/paths.js"

describe("validateNotePath", () => {
    it("accepts plain and nested note paths", () => {
        expect(validateNotePath("scratch.txt")).toBe("scratch.txt")
        expect(validateNotePath("work/meeting.txt")).toBe("work/meeting.txt")
        expect(validateNotePath("a/b/c/deep.txt")).toBe("a/b/c/deep.txt")
    })

    it("normalizes redundant separators", () => {
        expect(validateNotePath("work//notes.txt")).toBe("work/notes.txt")
        expect(validateNotePath("./work/notes.txt")).toBe("work/notes.txt")
    })

    it("rejects traversal", () => {
        for (const bad of [
            "../outside.txt",
            "work/../../outside.txt",
            "..",
            "work/../../../etc/passwd.txt",
        ]) {
            expect(() => validateNotePath(bad), bad).toThrow(InvalidPathError)
        }
    })

    it("rejects absolute paths", () => {
        expect(() => validateNotePath("/etc/passwd.txt")).toThrow(InvalidPathError)
        expect(() => validateNotePath("/scratch.txt")).toThrow(InvalidPathError)
    })

    it("rejects backslashes so Windows-style paths can't slip through", () => {
        expect(() => validateNotePath("work\\notes.txt")).toThrow(InvalidPathError)
        expect(() => validateNotePath("..\\outside.txt")).toThrow(InvalidPathError)
    })

    it("rejects hidden segments, protecting .images and server metadata", () => {
        expect(() => validateNotePath(".images/evil.txt")).toThrow(InvalidPathError)
        expect(() => validateNotePath(".heynote-settings.json")).toThrow(InvalidPathError)
        expect(() => validateNotePath("work/.hidden/note.txt")).toThrow(InvalidPathError)
    })

    it("rejects non-txt files", () => {
        expect(() => validateNotePath("note.md")).toThrow(InvalidPathError)
        expect(() => validateNotePath("script.sh")).toThrow(InvalidPathError)
        expect(() => validateNotePath("note.txt.bak")).toThrow(InvalidPathError)
    })

    it("rejects an empty file name", () => {
        expect(() => validateNotePath(".txt")).toThrow(InvalidPathError)
        expect(() => validateNotePath("work/.txt")).toThrow(InvalidPathError)
    })

    it("rejects null bytes and non-strings", () => {
        expect(() => validateNotePath("note\0.txt")).toThrow(InvalidPathError)
        expect(() => validateNotePath(undefined)).toThrow(InvalidPathError)
        expect(() => validateNotePath(42)).toThrow(InvalidPathError)
        expect(() => validateNotePath("")).toThrow(InvalidPathError)
    })
})

describe("validateDirectoryPath", () => {
    it("accepts nested directories", () => {
        expect(validateDirectoryPath("work")).toBe("work")
        expect(validateDirectoryPath("work/2026")).toBe("work/2026")
    })

    it("applies the same traversal rules as note paths", () => {
        expect(() => validateDirectoryPath("../outside")).toThrow(InvalidPathError)
        expect(() => validateDirectoryPath("/abs")).toThrow(InvalidPathError)
        expect(() => validateDirectoryPath(".images")).toThrow(InvalidPathError)
    })
})

describe("validateImageFilename", () => {
    it("accepts generated image names", () => {
        const name = "2026-01-15T21.46.39.824Z.png"
        expect(validateImageFilename(name)).toBe(name)
    })

    it("rejects paths and traversal", () => {
        for (const bad of ["../secret.png", "dir/img.png", "..", ".hidden.png", "img", ""]) {
            expect(() => validateImageFilename(bad), bad).toThrow(InvalidPathError)
        }
    })
})

describe("assertWithinLibrary", () => {
    let tmpDir = ""

    beforeEach(() => {
        tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heynote-paths-")))
    })

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true})
    })

    it("allows paths inside the library", () => {
        fs.mkdirSync(path.join(tmpDir, "work"))
        expect(assertWithinLibrary(tmpDir, "work/note.txt")).toBe(path.join(tmpDir, "work/note.txt"))
    })

    it("allows paths that don't exist yet", () => {
        expect(assertWithinLibrary(tmpDir, "brand/new/note.txt")).toBe(
            path.join(tmpDir, "brand/new/note.txt")
        )
    })

    it("rejects a symlinked directory escaping the library", () => {
        const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heynote-outside-")))
        try {
            fs.symlinkSync(outside, path.join(tmpDir, "escape"))
            // no traversal syntax at all, yet it resolves outside the root
            expect(() => assertWithinLibrary(tmpDir, "escape/note.txt")).toThrow(InvalidPathError)
        } finally {
            fs.rmSync(outside, {recursive: true, force: true})
        }
    })
})
