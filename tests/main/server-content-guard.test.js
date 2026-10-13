import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SCRATCH_FILE_NAME } from "../../src/common/constants.js"

/**
 * The storage-level guard against a client destroying a note.
 *
 * A client that fails to parse a note ends up with an empty document and then saves it. One such
 * save replaces the note with nothing; because the next load can't find a block delimiter either,
 * every save after that prepends another metadata header until the file is only headers.
 */

let tmpDir = ""
let running = null

async function bootServer() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heynote-guard-"))
    process.env.HEYNOTE_SERVER_NO_AUTOSTART = "1"
    process.env.HEYNOTE_LIBRARY_PATH = tmpDir
    process.env.HEYNOTE_PASSWORD = ""
    process.env.HEYNOTE_STATIC_PATH = "none"

    vi.resetModules()
    const { createServer } = await import("../../server/index.js")
    const instance = createServer()
    await new Promise((resolve) => instance.server.listen(0, "127.0.0.1", resolve))
    running = {...instance, baseUrl: `http://127.0.0.1:${instance.server.address().port}`}
}

async function api(method, urlPath, body) {
    const init = {method}
    if (body !== undefined) {
        init.headers = {"Content-Type": "application/json"}
        init.body = JSON.stringify(body)
    }
    const response = await fetch(`${running.baseUrl}${urlPath}`, init)
    const text = await response.text()
    return {status: response.status, body: text ? JSON.parse(text) : null}
}

const readNote = (name = SCRATCH_FILE_NAME) =>
    fs.readFileSync(path.join(tmpDir, name), "utf8")

beforeEach(bootServer)

afterEach(async () => {
    running.hub.close()
    running.library.close()
    await new Promise((resolve) => running.server.close(resolve))
    running = null
    fs.rmSync(tmpDir, {recursive: true, force: true})
})

describe("blockless write guard", () => {
    it("refuses content with no block delimiter and leaves the note intact", async () => {
        const before = readNote()
        expect(before).toContain("∞∞∞")

        const {status} = await api("PUT", "/api/notes", {
            path: SCRATCH_FILE_NAME,
            content: '{"formatVersion":"2.0.0","name":"Scratch"}',
            baseVersion: null,
        })

        expect(status).toBe(422)
        expect(readNote()).toBe(before)
    })

    it("refuses an empty document", async () => {
        const before = readNote()
        const {status} = await api("PUT", "/api/notes", {
            path: SCRATCH_FILE_NAME, content: "", baseVersion: null,
        })
        expect(status).toBe(422)
        expect(readNote()).toBe(before)
    })

    it("still accepts an ordinary edit", async () => {
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        const edited = `${read.body.content}\nstill fine`

        const {status} = await api("PUT", "/api/notes", {
            path: SCRATCH_FILE_NAME, content: edited, baseVersion: read.body.version,
        })

        expect(status).toBe(200)
        expect(readNote()).toContain("still fine")
    })

    it("accepts a note that is only a delimiter and nothing else", async () => {
        // emptying a note's text is legitimate; losing its block structure is not
        const read = await api("GET", `/api/notes?path=${SCRATCH_FILE_NAME}`)
        const emptied = '{"formatVersion":"2.0.0","name":"Scratch"}\n∞∞∞text\n'

        const {status} = await api("PUT", "/api/notes", {
            path: SCRATCH_FILE_NAME, content: emptied, baseVersion: read.body.version,
        })

        expect(status).toBe(200)
        expect(readNote()).toBe(emptied)
    })

    it("guards the sendBeacon flush path too", async () => {
        const before = readNote()
        const {status} = await api("POST", "/api/notes/flush", {
            contents: [[SCRATCH_FILE_NAME, "no delimiter here"]],
        })

        // the beacon can't read a response, so it reports ok - but the note must survive
        expect(status).toBe(200)
        expect(readNote()).toBe(before)
    })
})
