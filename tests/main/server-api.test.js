import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SCRATCH_FILE_NAME } from "../../src/common/constants.js"

/**
 * Integration tests for the sync server: boots the real Express app against a temporary
 * library directory and drives it over HTTP.
 */

let tmpDir = ""
let running = null

async function bootServer(env = {}) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heynote-server-"))

    process.env.HEYNOTE_SERVER_NO_AUTOSTART = "1"
    process.env.HEYNOTE_LIBRARY_PATH = tmpDir
    process.env.HEYNOTE_PASSWORD = ""
    process.env.HEYNOTE_SESSION_SECRET = "test-secret"
    process.env.HEYNOTE_STATIC_PATH = "none"
    for (const [key, value] of Object.entries(env)) {
        process.env[key] = value
    }

    vi.resetModules()
    const { createServer } = await import("../../server/index.js")
    const instance = createServer()

    await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve))
    const { port } = instance.server.address()

    running = {
        ...instance,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
    }
    return running
}

async function api(method, urlPath, {body, headers = {}, raw = false} = {}) {
    const init = {method, headers: {...headers}}
    if (body !== undefined && !raw) {
        init.headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(body)
    } else if (body !== undefined) {
        init.body = body
    }
    const response = await fetch(`${running.baseUrl}${urlPath}`, init)
    const text = await response.text()
    let json = null
    try {
        json = text ? JSON.parse(text) : null
    } catch {
        json = null
    }
    return {status: response.status, body: json, text, headers: response.headers}
}

afterEach(async () => {
    if (running) {
        running.hub.close()
        running.library.close()
        await new Promise((resolve) => running.server.close(resolve))
        running = null
    }
    if (tmpDir) {
        fs.rmSync(tmpDir, {recursive: true, force: true})
        tmpDir = ""
    }
})

describe("bootstrap", () => {
    beforeEach(async () => {
        await bootServer()
    })

    it("creates the scratch note on first boot", async () => {
        expect(fs.existsSync(path.join(tmpDir, SCRATCH_FILE_NAME))).toBe(true)
    })

    it("returns everything the bridge needs to boot in one request", async () => {
        const {status, body} = await api("GET", "/api/bootstrap")
        expect(status).toBe(200)
        expect(body.scratchFileName).toBe(SCRATCH_FILE_NAME)
        expect(body.notes[SCRATCH_FILE_NAME]).toBeDefined()
        expect(Array.isArray(body.directories)).toBe(true)
        // settings must be complete enough for settings-store.js to read synchronously
        expect(body.settings.keymap).toBe("default")
        expect(body.settings.tabSize).toBe(4)
        expect(body.settings.indentType).toBe("space")
    })

    it("omits desktop-only and device-local settings", async () => {
        const {body} = await api("GET", "/api/bootstrap")
        expect(body.settings.globalHotkey).toBeUndefined()
        expect(body.settings.autoUpdate).toBeUndefined()
        expect(body.settings.bufferPath).toBeUndefined()
        expect(body.settings.leftPanelWidth).toBeUndefined()
    })
})

describe("notes", () => {
    beforeEach(async () => {
        await bootServer()
    })

    it("reads a note with a version", async () => {
        const {status, body} = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        expect(status).toBe(200)
        expect(typeof body.content).toBe("string")
        expect(body.version).toMatch(/^[a-f0-9]{64}$/)
    })

    it("saves a note when baseVersion matches and bumps the version", async () => {
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        const newContent = read.body.content + "\nhello from the test"

        const write = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: newContent, baseVersion: read.body.version},
        })
        expect(write.status).toBe(200)
        expect(write.body.version).not.toBe(read.body.version)

        expect(fs.readFileSync(path.join(tmpDir, SCRATCH_FILE_NAME), "utf8")).toBe(newContent)
    })

    it("rejects a stale write with 409 and returns the server's copy", async () => {
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)

        // someone else saves first
        const winner = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: read.body.content + "\nfrom browser A", baseVersion: read.body.version},
        })
        expect(winner.status).toBe(200)

        // our write is still based on the old version
        const loser = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: read.body.content + "\nfrom browser B", baseVersion: read.body.version},
        })
        expect(loser.status).toBe(409)
        expect(loser.body.serverVersion).toBe(winner.body.version)
        expect(loser.body.serverContent).toContain("from browser A")
    })

    it("treats a null baseVersion as a forced overwrite", async () => {
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: "∞∞∞text\nA", baseVersion: read.body.version},
        })
        const forced = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: "∞∞∞text\nB", baseVersion: null},
        })
        expect(forced.status).toBe(200)
        expect(fs.readFileSync(path.join(tmpDir, SCRATCH_FILE_NAME), "utf8")).toBe("∞∞∞text\nB")
    })

    it("reports an unchanged save without rewriting the file", async () => {
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        const write = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: read.body.content, baseVersion: read.body.version},
        })
        expect(write.status).toBe(200)
        expect(write.body.version).toBe(read.body.version)
    })

    it("creates, moves and deletes notes", async () => {
        const created = await api("POST", "/api/notes", {
            body: {path: "work/todo.txt", content: '{"name":"Todo"}\n∞∞∞text\nbuy milk'},
        })
        expect(created.status).toBe(200)
        expect(fs.existsSync(path.join(tmpDir, "work/todo.txt"))).toBe(true)

        const duplicate = await api("POST", "/api/notes", {
            body: {path: "work/todo.txt", content: "x"},
        })
        expect(duplicate.status).toBe(409)

        const moved = await api("POST", "/api/notes/move", {
            body: {path: "work/todo.txt", newPath: "work/done.txt"},
        })
        expect(moved.status).toBe(200)
        expect(fs.existsSync(path.join(tmpDir, "work/done.txt"))).toBe(true)
        expect(fs.existsSync(path.join(tmpDir, "work/todo.txt"))).toBe(false)

        const deleted = await api("DELETE", "/api/notes?path=work/done.txt")
        expect(deleted.status).toBe(200)
        expect(fs.existsSync(path.join(tmpDir, "work/done.txt"))).toBe(false)
    })

    it("refuses to delete the scratch note", async () => {
        const {status} = await api("DELETE", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        expect(status).toBe(403)
        expect(fs.existsSync(path.join(tmpDir, SCRATCH_FILE_NAME))).toBe(true)
    })

    it("returns 404 for a note that does not exist", async () => {
        expect((await api("GET", "/api/notes?path=nope.txt")).status).toBe(404)
        expect((await api("DELETE", "/api/notes?path=nope.txt")).status).toBe(404)
        const write = await api("PUT", "/api/notes", {
            body: {path: "nope.txt", content: "x", baseVersion: null},
        })
        expect(write.status).toBe(404)
    })

    it("rejects traversal attempts at the API boundary", async () => {
        const read = await api("GET", "/api/notes?path=../../../etc/passwd.txt")
        expect(read.status).toBe(400)

        const write = await api("PUT", "/api/notes", {
            body: {path: "../escape.txt", content: "nope", baseVersion: null},
        })
        expect(write.status).toBe(400)
        expect(fs.existsSync(path.join(tmpDir, "..", "escape.txt"))).toBe(false)

        const hidden = await api("POST", "/api/notes", {
            body: {path: ".images/evil.txt", content: "nope"},
        })
        expect(hidden.status).toBe(400)
    })

    it("rejects a non-string body", async () => {
        const {status} = await api("PUT", "/api/notes", {
            body: {path: SCRATCH_FILE_NAME, content: {not: "a string"}, baseVersion: null},
        })
        expect(status).toBe(400)
    })

    it("flushes several notes at once for sendBeacon", async () => {
        await api("POST", "/api/notes", {body: {path: "a.txt", content: "∞∞∞text\na"}})
        await api("POST", "/api/notes", {body: {path: "b.txt", content: "∞∞∞text\nb"}})

        const {status, body} = await api("POST", "/api/notes/flush", {
            body: {contents: [["a.txt", "∞∞∞text\nA!"], ["b.txt", "∞∞∞text\nB!"]]},
        })
        expect(status).toBe(200)
        expect(body.saved.sort()).toEqual(["a.txt", "b.txt"])
        expect(fs.readFileSync(path.join(tmpDir, "a.txt"), "utf8")).toBe("∞∞∞text\nA!")
        expect(fs.readFileSync(path.join(tmpDir, "b.txt"), "utf8")).toBe("∞∞∞text\nB!")
    })

    it("skips invalid entries in a flush without failing the whole batch", async () => {
        await api("POST", "/api/notes", {body: {path: "a.txt", content: "∞∞∞text\na"}})
        const {status, body} = await api("POST", "/api/notes/flush", {
            body: {contents: [["../evil.txt", "x"], ["a.txt", "∞∞∞text\nok"]]},
        })
        expect(status).toBe(200)
        expect(body.saved).toEqual(["a.txt"])
    })
})

describe("library and directories", () => {
    beforeEach(async () => {
        await bootServer()
    })

    it("lists notes with their metadata name", async () => {
        await api("POST", "/api/notes", {
            body: {path: "work/report.txt", content: '{"name":"Report"}\n∞∞∞text\nbody'},
        })
        const {body} = await api("GET", "/api/library")
        expect(body.notes["work/report.txt"].name).toBe("Report")
        expect(body.directories).toContain("work")
    })

    it("creates and deletes directories, refusing non-empty ones", async () => {
        expect((await api("POST", "/api/directories", {body: {path: "projects"}})).status).toBe(200)
        expect(fs.existsSync(path.join(tmpDir, "projects"))).toBe(true)

        expect((await api("GET", "/api/directories/empty?path=projects")).body.empty).toBe(true)

        await api("POST", "/api/notes", {body: {path: "projects/x.txt", content: "∞∞∞text\n"}})
        expect((await api("GET", "/api/directories/empty?path=projects")).body.empty).toBe(false)
        expect((await api("DELETE", "/api/directories?path=projects")).status).toBe(409)

        await api("DELETE", "/api/notes?path=projects/x.txt")
        expect((await api("DELETE", "/api/directories?path=projects")).status).toBe(200)
        expect(fs.existsSync(path.join(tmpDir, "projects"))).toBe(false)
    })
})

describe("settings", () => {
    beforeEach(async () => {
        await bootServer()
    })

    it("persists synced settings and drops the rest", async () => {
        const {status, body} = await api("PUT", "/api/settings", {
            body: {
                settings: {
                    keymap: "emacs",
                    tabSize: 2,
                    globalHotkey: "CmdOrCtrl+Shift+X", // desktop only
                    leftPanelWidth: 999, // device local
                },
            },
        })
        expect(status).toBe(200)
        expect(body.settings.keymap).toBe("emacs")
        expect(body.settings.tabSize).toBe(2)
        expect(body.settings.globalHotkey).toBeUndefined()
        expect(body.settings.leftPanelWidth).toBeUndefined()

        const reread = await api("GET", "/api/settings")
        expect(reread.body.settings.keymap).toBe("emacs")
    })

    it("survives a server restart", async () => {
        await api("PUT", "/api/settings", {body: {settings: {keymap: "emacs", tabSize: 8}}})
        const libraryPath = tmpDir

        running.hub.close()
        running.library.close()
        await new Promise((resolve) => running.server.close(resolve))
        running = null

        // boot again against the same directory
        process.env.HEYNOTE_LIBRARY_PATH = libraryPath
        vi.resetModules()
        const { createServer } = await import("../../server/index.js")
        const instance = createServer()
        await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve))
        running = {...instance, port: instance.server.address().port, baseUrl: `http://127.0.0.1:${instance.server.address().port}`}

        const {body} = await api("GET", "/api/settings")
        expect(body.settings.keymap).toBe("emacs")
        expect(body.settings.tabSize).toBe(8)
    })

    it("rejects a non-object settings payload", async () => {
        expect((await api("PUT", "/api/settings", {body: {settings: "nope"}})).status).toBe(400)
    })
})

describe("authentication", () => {
    it("is disabled when no password is configured", async () => {
        await bootServer()
        const {body} = await api("GET", "/api/session")
        expect(body.authEnabled).toBe(false)
        expect((await api("GET", "/api/bootstrap")).status).toBe(200)
    })

    it("guards the API when a password is configured", async () => {
        await bootServer({HEYNOTE_PASSWORD: "hunter2"})

        expect((await api("GET", "/api/session")).body.authEnabled).toBe(true)
        expect((await api("GET", "/api/bootstrap")).status).toBe(401)
        expect((await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)).status).toBe(401)

        const bad = await api("POST", "/api/login", {body: {password: "wrong"}})
        expect(bad.status).toBe(401)

        const good = await api("POST", "/api/login", {body: {password: "hunter2"}})
        expect(good.status).toBe(200)
        const cookie = good.headers.get("set-cookie").split(";")[0]
        expect(cookie).toMatch(/^heynote_session=/)

        const authed = await api("GET", "/api/bootstrap", {headers: {Cookie: cookie}})
        expect(authed.status).toBe(200)
    })

    it("rejects a tampered session cookie", async () => {
        await bootServer({HEYNOTE_PASSWORD: "hunter2"})
        const forged = "heynote_session=eyJpYXQiOjE3MDAwMDAwMDAwMDB9.not-a-valid-signature"
        expect((await api("GET", "/api/bootstrap", {headers: {Cookie: forged}})).status).toBe(401)
    })
})
