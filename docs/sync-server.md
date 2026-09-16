# Heynote sync server

Runs Heynote as a web app whose notes live on a server, so any browser you sign in from sees the
same content. Built for a single user with a shared password — there are no accounts.

The desktop (Electron) build is unaffected and still works exactly as before.

## Running it

```sh
npm install
npm run sync:build        # builds the web app and the server
HEYNOTE_LIBRARY_PATH=~/heynote-notes npm run server
```

Then open http://127.0.0.1:3333.

For development, run the API and the Vite dev server separately:

```sh
HEYNOTE_LIBRARY_PATH=~/heynote-notes HEYNOTE_STATIC_PATH=none npm run server:dev
npm run webapp-sync:dev   # http://localhost:5173, proxies /api and /ws to the server
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HEYNOTE_LIBRARY_PATH` | `~/.heynote-server/notes` | Where the `.txt` notes live. Created if missing. |
| `HEYNOTE_HOST` | `127.0.0.1` | Set to `0.0.0.0` to accept connections from other machines. |
| `HEYNOTE_PORT` | `3333` | |
| `HEYNOTE_PASSWORD` | *(unset)* | Shared password. **Required for any non-localhost deployment.** |
| `HEYNOTE_SESSION_SECRET` | random per boot | Signs session cookies. Set it to keep sessions valid across restarts. |
| `HEYNOTE_SESSION_DAYS` | `90` | Session lifetime. |
| `HEYNOTE_SECURE_COOKIES` | `0` | Set to `1` behind HTTPS so the session cookie gets `Secure`. |
| `HEYNOTE_STATIC_PATH` | the built web app | Path to static files, or `none` for an API-only server. |
| `HEYNOTE_MAX_NOTE_BYTES` | `10485760` | Largest accepted note. |
| `HEYNOTE_MAX_IMAGE_BYTES` | `20971520` | Largest accepted image upload. |

## Exposing it beyond localhost

Put it behind a reverse proxy that terminates TLS. **HTTPS is not optional in practice**: without
a secure context the browser disables the clipboard API that Heynote's lossless block copy/paste
relies on, and a PWA can't be installed.

Set `HEYNOTE_PASSWORD` and `HEYNOTE_SECURE_COOKIES=1`, and keep the server itself bound to
localhost so only the proxy can reach it. The server prints a warning at startup if it is
listening on a non-local address without a password.

Caddy:

```
notes.example.com {
    reverse_proxy 127.0.0.1:3333
}
```

nginx — note the upgrade headers, without which sync silently degrades to "changes only appear
after a reload":

```nginx
location / {
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## Installing it as an app

Heynote ships a web app manifest and a service worker, so browsers can install it as a
standalone app: its own window, its own icon in the launcher or dock, no address bar. Installed,
it also starts without the server being reachable — the editor opens, the status bar says it's
offline, and queued saves go out when the connection comes back.

**This requires a secure context.** Browsers only register service workers, and only offer
installation, over HTTPS or on `localhost`. Over plain `http://192.168.x.x:3333` nothing here
works — and the same restriction is what breaks copy and paste.

The quickest way to get one, with no certificates involved, is to reach the server through an
SSH tunnel, because `localhost` counts as secure:

```sh
ssh -N -L 3333:127.0.0.1:3333 you@your-server
```

Then open http://localhost:3333 and install from there. For a setup you don't have to start by
hand, put it behind a reverse proxy with a real certificate as described above.

To install: Chrome and Edge show an install icon at the right-hand side of the address bar, and
also offer it under the ⋮ menu → *Cast, save and share* → *Install page as app*. Heynote's own
main menu (the ⋮ button, visible when the sidebar is collapsed) has an **Install as app…** entry
whenever the browser is willing. On iOS Safari use *Share* → *Add to Home Screen*.

Installing has a second benefit: `Cmd/Ctrl` + `N`, `T` and `W` are reserved by the browser in a
normal tab, but reach the app in a standalone window, so Heynote's own shortcuts for new
buffer, new tab and close tab start working.

## How syncing works

Notes are stored as ordinary `.txt` files in Heynote's existing format, so the library can be
backed up with git or rsync, edited on the server, and opened by the desktop app (point its
buffer location at the same directory).

A note's version is the SHA-256 of its content. Saves carry the version they were based on; if
it no longer matches, the server returns the current copy and the browser attempts a three-way
merge. Edits to different lines reconcile silently, edits to the same lines raise a dialog asking
which version to keep. Saves that fail because the server is unreachable are queued and retried,
and the status bar says so.

Cursor position and code folding are kept per-browser in `localStorage` rather than in the note,
because Heynote stores them inside the note's metadata header and rewrites them on every save —
two browsers with the same note merely *open* would otherwise collide every two seconds.

## Differences from the desktop app

Gone, because browsers have no equivalent: the global hotkey, tray icon, always-on-top, auto
update, open-at-login, window management, the custom title bar, the native menu bar and the
spellchecker language picker. The notes directory is a server setting rather than a preference.

Different:

- **Shortcuts.** `Cmd/Ctrl` + `N`, `T`, `W`, `Shift-T` and `Ctrl-Tab` never reach a web page, so
  the web build adds `Alt-N`, `Alt-W`, `Alt-Shift-T`, `Mod-Alt-←/→` and `Mod-Alt-1…9`. Installing
  Heynote as a PWA frees up most of the originals.
- **Context menus.** The sidebar, tabs and main menu use HTML menus. Inside the editor the
  browser's own menu is left alone, because it offers working Cut/Copy/Paste and spellcheck
  suggestions that a scripted menu cannot.
- **Settings** are stored on the server and follow you between browsers, except for the ones that
  describe the local window — sidebar width, open folders, theme and which tabs are open — which
  stay per device.
