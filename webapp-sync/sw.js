/**
 * Service worker for the installable web app.
 *
 * Two jobs: make Heynote installable as a standalone app, and let it open when the server (or
 * the network) isn't there — the editor comes up, the status bar says it's offline, and queued
 * saves go out once the connection is back.
 *
 * Notes and images are deliberately *not* cached. They're the user's private content, they're
 * already synced through the API, and a stale copy in a shared HTTP cache would be both a
 * privacy problem and a source of confusing conflicts.
 */

// The registration URL carries the app version, so a new build gets a new cache and the old one
// is dropped on activation.
const VERSION = new URL(self.location).searchParams.get("v") || "dev"
const CACHE = `heynote-shell-${VERSION}`

const APP_SHELL = "/"

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.add(APP_SHELL)).catch(() => {
            // a failed precache shouldn't block installation; the fetch handler will fill it in
        })
    )
})

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys()
        await Promise.all(
            names
                .filter((name) => name.startsWith("heynote-shell-") && name !== CACHE)
                .map((name) => caches.delete(name))
        )
        await self.clients.claim()
    })())
})

self.addEventListener("message", (event) => {
    // lets the page apply an update without waiting for every tab to close
    if (event.data === "skip-waiting") {
        self.skipWaiting()
    }
})

self.addEventListener("fetch", (event) => {
    const request = event.request
    if (request.method !== "GET") {
        return
    }

    const url = new URL(request.url)
    if (url.origin !== self.location.origin) {
        return
    }
    // the API and the sync socket must always go to the network
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
        return
    }

    if (request.mode === "navigate") {
        event.respondWith(navigationHandler(request))
        return
    }

    // built assets carry a content hash in their name, so they never change under a given URL
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(cacheFirst(request))
        return
    }

    event.respondWith(staleWhileRevalidate(request))
})

async function navigationHandler(request) {
    try {
        const response = await fetch(request)
        if (response.ok) {
            const cache = await caches.open(CACHE)
            cache.put(APP_SHELL, response.clone())
        }
        return response
    } catch (error) {
        const cached = await caches.match(APP_SHELL)
        if (cached) {
            return cached
        }
        throw error
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request)
    if (cached) {
        return cached
    }
    const response = await fetch(request)
    if (response.ok) {
        const cache = await caches.open(CACHE)
        cache.put(request, response.clone())
    }
    return response
}

async function staleWhileRevalidate(request) {
    const cached = await caches.match(request)
    const network = fetch(request).then(async (response) => {
        if (response.ok) {
            const cache = await caches.open(CACHE)
            cache.put(request, response.clone())
        }
        return response
    }).catch(() => cached)

    return cached || network
}
