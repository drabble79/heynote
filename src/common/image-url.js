/**
 * Inline images are stored in the note text as `heynote-file://image/<name>` URLs.
 *
 * In Electron that scheme is served by a custom protocol handler (electron/main/protocol.js).
 * A browser has no such thing, so the web builds rewrite the URL to the server's image route at
 * display time only — the stored note text keeps the original scheme, which is what lets the
 * same library be opened by both the desktop app and the web app.
 */

export const IMAGE_URL_PREFIX = "heynote-file://image/"

/** Builds the URL that gets written into the note text. */
export function imageFileUrl(filename) {
    return IMAGE_URL_PREFIX + encodeURIComponent(filename)
}

/** Turns a stored image URL into something the current platform can actually load. */
export function resolveImageUrl(url) {
    if (typeof url !== "string" || !url.startsWith(IMAGE_URL_PREFIX)) {
        return url
    }
    if (!window.heynote?.platform?.isWebApp) {
        return url
    }
    return "/api/images/" + url.slice(IMAGE_URL_PREFIX.length)
}
