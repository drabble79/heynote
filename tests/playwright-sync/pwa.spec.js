import { expect, test } from "@playwright/test"

/**
 * Installability and offline start-up.
 *
 * Playwright serves the app over http://127.0.0.1, which counts as a secure context, so the
 * service worker behaves the same way it does over HTTPS.
 */

async function openApp(browser) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(`[${error.name}] ${error.message}`))
    await page.goto("/")
    await expect(page.locator(".cm-editor")).toBeVisible()
    return {context, page, errors}
}

async function waitForServiceWorker(page) {
    await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null ||
            navigator.serviceWorker.getRegistration().then((r) => !!r?.active),
        null,
        {timeout: 15000},
    )
}

test("the manifest describes an installable standalone app", async ({ page, request }) => {
    const response = await request.get("/site.webmanifest")
    expect(response.status()).toBe(200)

    const manifest = await response.json()
    expect(manifest.name).toBe("Heynote")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")

    // Chromium requires a 512px icon before it will offer installation
    const large = manifest.icons.find((icon) => icon.sizes === "512x512")
    expect(large).toBeTruthy()
    expect(large.type).toBe("image/png")

    const icon = await request.get(large.src)
    expect(icon.status()).toBe(200)
    expect(icon.headers()["content-type"]).toContain("image/png")
})

test("the service worker registers and takes control", async ({ browser }) => {
    const {context, page, errors} = await openApp(browser)

    await waitForServiceWorker(page)

    const scope = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return registration?.scope
    })
    // it has to control the whole origin, not just a subdirectory
    expect(scope).toMatch(/\/$/)

    expect(errors).toStrictEqual([])
    await context.close()
})

test("the app still opens when the server is unreachable", async ({ browser }) => {
    const {context, page} = await openApp(browser)
    await waitForServiceWorker(page)

    // one more load so the shell and its assets are definitely cached
    await page.reload()
    await expect(page.locator(".cm-editor")).toBeVisible()
    await page.waitForTimeout(500)

    // now pull the server out from under it
    await context.setOffline(true)
    await page.reload()

    // the page itself must still come up rather than showing the browser's error page
    await expect(page.locator("#app")).toBeAttached({timeout: 15000})
    const title = await page.title()
    expect(title).toContain("Heynote")

    await context.setOffline(false)
    await context.close()
})

test("the service worker never caches notes or images", async ({ browser }) => {
    const {context, page} = await openApp(browser)
    await waitForServiceWorker(page)

    await page.evaluate(() => fetch("/api/notes?path=scratch.txt").then((r) => r.json()))
    await page.waitForTimeout(300)

    const cachedUrls = await page.evaluate(async () => {
        const names = await caches.keys()
        const urls = []
        for (const name of names) {
            const cache = await caches.open(name)
            for (const request of await cache.keys()) {
                urls.push(request.url)
            }
        }
        return urls
    })

    // private content stays out of the cache; it's synced through the API instead
    expect(cachedUrls.filter((url) => url.includes("/api/"))).toStrictEqual([])

    await context.close()
})
