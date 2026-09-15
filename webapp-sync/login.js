import { apiFetch } from "./api.js"

/**
 * Minimal password gate, rendered before the Vue app boots.
 *
 * There are no user accounts — the server has one shared password (HEYNOTE_PASSWORD) and hands
 * back a signed session cookie. When the server runs without a password this resolves instantly.
 */

const STYLE = `
.heynote-login {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: "Open Sans", system-ui, sans-serif;
    background: #f5f5f5;
    color: #222;
}
@media (prefers-color-scheme: dark) {
    .heynote-login { background: #262B37; color: #eee; }
    .heynote-login input { background: #1b1c1d; color: #eee; border-color: #444; }
}
.heynote-login form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 260px;
}
.heynote-login h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
.heynote-login input, .heynote-login button {
    font: inherit;
    padding: 8px 10px;
    border-radius: 4px;
    border: 1px solid #ccc;
}
.heynote-login button { cursor: pointer; border: none; background: #2f6fed; color: #fff; }
.heynote-login .error { color: #d33; font-size: 13px; min-height: 18px; }
`

function renderLoginForm() {
    return new Promise((resolve) => {
        const style = document.createElement("style")
        style.textContent = STYLE
        document.head.appendChild(style)

        const container = document.createElement("div")
        container.className = "heynote-login"
        container.innerHTML = `
            <form>
                <h1>Heynote</h1>
                <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
                <div class="error"></div>
                <button type="submit">Unlock</button>
            </form>
        `
        document.body.appendChild(container)

        const form = container.querySelector("form")
        const input = container.querySelector("input")
        const error = container.querySelector(".error")
        const button = container.querySelector("button")

        form.addEventListener("submit", async (event) => {
            event.preventDefault()
            error.textContent = ""
            button.disabled = true
            try {
                await apiFetch("/login", {method: "POST", body: {password: input.value}})
                container.remove()
                style.remove()
                resolve()
            } catch (err) {
                error.textContent = err.status === 401 ? "Incorrect password" : err.message
                input.select()
            } finally {
                button.disabled = false
            }
        })

        input.focus()
    })
}

/** Resolves once the browser holds a valid session (or the server needs none). */
export async function ensureAuthenticated() {
    const session = await apiFetch("/session")
    if (!session.authEnabled || session.authenticated) {
        return
    }
    await renderLoginForm()
}
