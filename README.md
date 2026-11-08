# UNote

Notes that link themselves, with a Vault behind a PIN.

- **App:** https://anekthegreat.github.io/UNote/
- **APK:** https://github.com/AnekTheGreat/UNote/releases/latest/download/UNote.apk

The two are the same build. The page runs in any browser and installs to a home
screen; the APK is the same page in an Android app, bundled inside so it needs no
network at all. Notes stay with whichever one you use - they are kept by the app on
the device, not in this repository.

## What it is

One self-contained page: no framework, no dependencies, no network calls.
Your notes live in the browser's storage on your device and nowhere else.

- Markdown notes: headings, lists, ticks, tables, quotes, code, tags
- Folders, favourites, trash, a daily note
- `[[links]]` between notes, a backlink pane, and a graph of how notes join up
- Search and a command palette on Ctrl+K / Cmd+K
- A **Vault**: a separate note space behind a PIN you choose on first launch.
  Vault notes are encrypted on the device (AES-GCM, key from PBKDF2-SHA256 of the
  PIN, 200,000 rounds, random salt). The PIN is never stored, only a sealed
  verifier, and five wrong tries lock it briefly. Forgetting the PIN can only
  empty the Vault, never the rest of your notes.
- Export everything to one file, carry it as a text code, import it back
- Installs to the home screen, works offline, updates over the air

## Files

| path | what it is |
| --- | --- |
| `index.html` | the whole app, built from `src/` |
| `src/shell.html` | markup and styles, `/*__APP_JS__*/` where the script goes |
| `src/app1.js` | helpers, storage, the Vault's crypto |
| `src/app2.js` | sidebar, document, backlinks, graph, search |
| `src/app3.js` | dialogs, onboarding, locking, export/transfer/import, updates, boot |
| `sw.js` | service worker: offline shell and the update check |
| `updates.json` | the newest version and what changed |
| `manifest.webmanifest` | how it installs to a home screen |
| `dev/build.py` | joins `src/` into `index.html` |
| `android/` | the APK: a WebView that serves `index.html` from assets |

## Working on it

```sh
python3 dev/build.py          # rebuild index.html after editing src/
python3 dev/build.py --check  # what the checks run: is index.html up to date?
python3 -m http.server 3000   # open http://localhost:3000
```

Edit `src/`, never `index.html` by hand. The service worker serves the cached
page first, so after a change bump the version (below) or unregister it.

## Releasing

The app checks `updates.json` shortly after launch and offers the update; the APK
is rebuilt by **APK** on every push that touches the page or `android/`.

1. `src/app1.js`: bump `const VERSION = 'x.y.z';`
2. `sw.js`: bump the cache name `unote-vx.y.z` - this is what makes an
   installed copy take the new build
3. `updates.json`: set `version`, `date`, and the notes people will read
4. `android/app/build.gradle`: bump `versionCode` (and `appVersion`)
5. `python3 dev/build.py`, then publish
6. Run **Sync the published build** so this repository matches what is live

## Signing the APK

The APK workflow signs with the upload keystore when these repository secrets are
set, and otherwise publishes a debug-signed build that still installs:

| secret | what it is |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the `.jks`, base64 encoded |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_PASSWORD` | the key password |
| `ANDROID_KEY_ALIAS` | the key alias |

No keystore material belongs in this repository.

## Where else it appears

In the Other apps lists of SideCut, My Hub, FamTM and MeasureT.
