/**
 * Install-as-an-app support for the web builds.
 *
 * Chromium fires `beforeinstallprompt` when the app meets the installability criteria and lets
 * the page hold on to the event and trigger the prompt later. Browsers put their own install
 * affordance in the address bar, which is easy to miss — and invisible once the app is already
 * running standalone — so Heynote offers it in the main menu too.
 *
 * Nothing here does anything in Electron, or in a browser that doesn't support installation.
 */

let deferredPrompt = null
const listeners = new Set()

function notify() {
    for (const listener of listeners) {
        listener(canInstall())
    }
}

/** Called from the web entry point once the browser offers the prompt. */
export function setInstallPrompt(event) {
    deferredPrompt = event
    notify()
}

export function canInstall() {
    return deferredPrompt !== null
}

/** True when running as an installed app rather than in a browser tab. */
export function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
}

/**
 * The document title to use for a given buffer name.
 *
 * A browser tab shows nothing but the document title, so it has to carry the app name. An
 * installed app's window already has the app name in its title bar, and appending it again
 * produces "Heynote - Work - Heynote".
 */
export function documentTitleFor(bufferName) {
    return isStandalone() ? bufferName : `${bufferName} - Heynote`
}

export function onInstallAvailabilityChange(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/**
 * Shows the browser's install prompt. The event can only be used once, so it's dropped either
 * way; the browser will offer a new one later if the user dismissed it.
 */
export async function promptInstall() {
    if (!deferredPrompt) {
        return false
    }
    const prompt = deferredPrompt
    deferredPrompt = null
    notify()

    try {
        prompt.prompt()
        const {outcome} = await prompt.userChoice
        return outcome === "accepted"
    } catch (error) {
        console.error("Install prompt failed:", error)
        return false
    }
}
