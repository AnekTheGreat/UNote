#!/usr/bin/env python3
"""UNote 1.0.11 - updates that actually arrive on the installed app.

    python3 dev/patch-1011.py          # apply
    python3 dev/patch-1011.py --check  # say whether the tree already carries 1.0.11

The installed app could never update itself, for two reasons that had nothing to do with the
site: the APK asked for no INTERNET permission, and the page looked for updates.json next to
itself - inside the APK - so the answer was always the version already installed. The site
published 1.0.10 correctly and the app could not hear it.

Now the app asks its own site. The page checks https://anekthegreat.github.io/UNote/updates.json,
and when the site is newer it fetches that page, keeps it in the app's private storage, and
MainActivity serves that copy in place of the one inside the APK from then on. No store, no
installer, no APK to download. Settings gains one row that throws the fetched page away and goes
back to the copy that came in the APK, so an update can never be a one-way door.

Network use is only ever that: one small JSON on launch, and the page itself when you take an
update. Notes, the Vault, backups and attachments stay on the phone.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.11'
JAVA = 'android/app/src/main/java/app/unote/MainActivity.java'
MANIFEST = 'android/app/src/main/AndroidManifest.xml'


def path(rel):
    return os.path.join(ROOT, *rel.split('/'))


def read(rel):
    return io.open(path(rel), encoding='utf-8').read()


def write(rel, text):
    io.open(path(rel), 'w', encoding='utf-8').write(text)


def cut(rel, pattern, replacement, flags=re.S):
    text = read(rel)
    new, n = re.subn(pattern, lambda m: replacement, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit('%s: could not find the block to replace (%r)' % (rel, pattern[:50]))
    write(rel, new)


UPDATE_JS = r'''/* ---------------- updates (over the air) ---------------- */

/* The browser copy updates through its service worker. The installed app has no service worker
   and no download manager, so it asks this same site for the update file and keeps the newest
   page it finds in the app's own storage; MainActivity serves that copy instead of the one
   built into the APK. Nothing to install, nothing to tap twice. */
const OTA_HOME = 'https://anekthegreat.github.io/UNote/';

function otaBase() {
  const nf = nativeFiles();
  return (nf && typeof nf.savePage === 'function') ? OTA_HOME : '';
}

async function checkUpdate(manual) {
  try {
    const r = await fetch(otaBase() + 'updates.json?t=' + nowMs(), { cache: 'no-store' });
    if (!r.ok) throw new Error('no updates file');
    const j = await r.json();
    if (cmpVer(j.version, VERSION) > 0) {
      const chip = $('#updChip');
      chip.hidden = false;
      chip.textContent = 'Update ' + j.version + ' ready';
      chip.onclick = () => applyUpdate(j);
      if (manual) toast('Version ' + j.version + ' is ready. Tap the chip to take it.', 4200);
      return 'Version ' + j.version + ' is ready. Tap the chip at the bottom to take it.';
    }
    $('#updChip').hidden = true;
    return 'You are on the newest version (' + VERSION + ').';
  } catch (e) {
    if (manual) toast(otaBase() ? 'Could not reach the update server.' : 'Could not check for updates.', 4000);
    return 'Could not check for updates right now.';
  }
}

async function applyUpdate(j) {
  const want = (j && j.version) ? j.version : 'the newest version';
  const nf = nativeFiles();
  if (nf && typeof nf.savePage === 'function') {
    toast('Fetching ' + want + '...', 3000);
    try {
      const r = await fetch(OTA_HOME + 'index.html?t=' + nowMs(), { cache: 'no-store' });
      if (!r.ok) throw new Error('the page did not come back');
      const page = await r.text();
      if (page.length < 40000 || page.indexOf("const VERSION = '") < 0) throw new Error('that did not look like UNote');
      nf.savePage(page);
      toast('Update ' + want + ' is in. Reopening...', 2800);
      setTimeout(() => location.replace(location.pathname + '?updated=' + nowMs()), 900);
      return;
    } catch (e) {
      toast('Could not fetch the update: ' + e.message, 4800);
      return;
    }
  }
  toast('Updating to ' + want + '...', 3000);
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        await reg.update();
        setTimeout(() => location.reload(), 700);
        return;
      }
    }
    location.reload();
  } catch (e) { location.reload(); }
}

/* The way back: drop the fetched page and use the one that came inside the APK. */
function resetBuiltInPage() {
  const nf = nativeFiles();
  if (!nf || typeof nf.resetPage !== 'function') return;
  nf.resetPage();
  closeDialog();
  toast('Back to the built-in version. Reopening...', 2800);
  setTimeout(() => location.replace(location.pathname + '?builtin=' + nowMs()), 900);
}

'''

SETTINGS_ROW_OLD = ("      '<div id=\"setUpdMsg\" class=\"hint\" style=\"margin:8px 0 0\">Last checked when this screen opened.</div></div>' +")

SETTINGS_ROW_NEW = (
    "      '<div id=\"setUpdMsg\" class=\"hint\" style=\"margin:8px 0 0\">Last checked when this screen opened.</div>' +\n"
    "      (nativeFiles() && typeof nativeFiles().resetPage === 'function'\n"
    "        ? '<button class=\"listrow\" style=\"margin-top:8px\" onclick=\"resetBuiltInPage()\"><span class=\"grow\"><span class=\"lr-t\">Go back to the built-in version</span><span class=\"lr-s\">Throw away any page this app fetched over the air and use the copy that came inside the APK.</span></span><span class=\"chev\">\\u203a</span></button>'\n"
    "        : '') + '</div>' +"
)

MAIN_ACTIVITY = r'''package app.unote;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The whole app is one page. It is bundled in assets/www and served from
 * https://appassets.androidplatform.net, not file://, because WebView refuses
 * IndexedDB and service workers on file:// - and the notes live in IndexedDB.
 *
 * Two things a WebView cannot do on its own live here. Backups: the page calls into
 * window.UNoteFile and this activity opens the phone's own save dialog and file
 * picker. Updates: the page fetches the newest copy of itself from the app's site and
 * leaves it in the app's private storage, and this activity serves that copy in place
 * of the bundled one. Nothing leaves the phone except those requests.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final String PAGE_PATH = "/assets/www/index.html";
    private static final int REQ_SAVE = 41;
    private static final int REQ_PICK = 42;

    private WebView web;
    private String pendingText;
    private String pendingName;
    private File otaFile;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        otaFile = new File(new File(getFilesDir(), "ota"), "index.html");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setTextZoom(100);
        web.setBackgroundColor(0xFF0D0B14);
        web.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String p = request.getUrl().getPath();
                if (p != null && p.endsWith(PAGE_PATH)) {
                    WebResourceResponse fetched = fetchedPage();
                    if (fetched != null) {
                        return fetched;             // the copy an update left behind
                    }
                }
                return loader.shouldInterceptRequest(request.getUrl());
            }
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri u = request.getUrl();
                    String host = (u == null || u.getHost() == null) ? "" : u.getHost();
                    if (host.equals("appassets.androidplatform.net")) {
                        return false;                       // the page itself stays in the app
                    }
                    try {                                   // anything else belongs to the phone
                        startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } catch (Exception ignored) {
                        // no browser and no store: the tap does nothing rather than breaking the page
                    }
                    return true;
                }
        });
        web.addJavascriptInterface(new Files(), "UNoteFile");

        setContentView(web);
        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(HOME);
        }
    }

    /** The fetched page, if there is one that still looks like UNote. */
    private WebResourceResponse fetchedPage() {
        if (otaFile == null || !otaFile.isFile()) {
            return null;
        }
        try {
            byte[] bytes = readFile(otaFile);
            String head = new String(bytes, StandardCharsets.UTF_8);
            if (bytes.length < 20000 || !head.contains("const VERSION = '")) {
                return null;                    // a half-written file must never take the app down
            }
            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return null;
        }
    }

    /** What window.UNoteFile exposes to the page. */
    private class Files {

        @JavascriptInterface
        public boolean ready() {
            return true;
        }

        @JavascriptInterface
        public boolean hasPage() {
            return otaFile != null && otaFile.isFile();
        }

        @JavascriptInterface
        public void savePage(final String html) {
            if (html == null || html.length() < 20000 || !html.contains("const VERSION = '")) {
                tell("window.UNoteSaved && window.UNoteSaved(false)");
                return;
            }
            new Thread(new Runnable() {
                @Override
                public void run() {
                    boolean ok = false;
                    File dir = otaFile.getParentFile();
                    File tmp = new File(dir, "index.html.tmp");
                    try {
                        if (dir != null && !dir.isDirectory()) {
                            dir.mkdirs();
                        }
                        FileOutputStream out = new FileOutputStream(tmp);
                        out.write(html.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        out.close();
                        ok = tmp.renameTo(otaFile) || (otaFile.delete() && tmp.renameTo(otaFile));
                    } catch (Exception e) {
                        ok = false;
                    }
                    tell(ok ? "window.UNoteSaved && window.UNoteSaved(true)"
                            : "window.UNoteSaved && window.UNoteSaved(false)");
                }
            }).start();
        }

        @JavascriptInterface
        public void resetPage() {
            try {
                if (otaFile != null && otaFile.exists()) {
                    otaFile.delete();
                }
                File tmp = new File(otaFile.getParentFile(), "index.html.tmp");
                if (tmp.exists()) {
                    tmp.delete();
                }
            } catch (Exception ignored) {
                // nothing to remove
            }
        }

        @JavascriptInterface
        public void saveBackup(final String name, final String text) {
            pendingName = name;
            pendingText = text;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/json");
                    if (name != null && name.length() > 0) {
                        i.putExtra(Intent.EXTRA_TITLE, name);
                    }
                    try {
                        startActivityForResult(i, REQ_SAVE);
                    } catch (Exception e) {
                        pendingText = null;
                        tell("window.UNoteSaved && window.UNoteSaved(false)");
                    }
                }
            });
        }

        @JavascriptInterface
        public void pickBackup() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    // */* on purpose: a .json the phone labelled octet-stream must still be pickable.
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    try {
                        startActivityForResult(i, REQ_PICK);
                    } catch (Exception e) {
                        tell("window.UNotePicked && window.UNotePicked(false)");
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        Uri uri = (res == RESULT_OK && data != null) ? data.getData() : null;
        if (req == REQ_SAVE) {
            final String text = pendingText;
            pendingText = null;
            if (uri == null || text == null) {
                tell("window.UNoteSaved && window.UNoteSaved(false)");
                return;
            }
            writeInBackground(uri, text);
        } else if (req == REQ_PICK) {
            if (uri == null) {
                tell("window.UNotePicked && window.UNotePicked(false)");
                return;
            }
            readInBackground(uri);
        }
    }

    private void writeInBackground(final Uri uri, final String text) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
                    if (os != null) {
                        os.write(text.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        ok = true;
                    }
                } catch (Exception e) {
                    ok = false;
                }
                tell(ok ? "window.UNoteSaved && window.UNoteSaved(true)"
                        : "window.UNoteSaved && window.UNoteSaved(false)");
            }
        }).start();
    }

    private void readInBackground(final Uri uri) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String text = null;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in != null) {
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            bo.write(buf, 0, n);
                        }
                        text = new String(bo.toByteArray(), StandardCharsets.UTF_8);
                    }
                } catch (Exception e) {
                    text = null;
                }
                if (text == null) {
                    tell("window.UNotePicked && window.UNotePicked(false)");
                    return;
                }
                // A whole backup is too long for one evaluateJavascript call, so it goes in pieces.
                final int chunk = 120000;
                for (int i = 0; i < text.length(); i += chunk) {
                    String piece = text.substring(i, Math.min(text.length(), i + chunk));
                    tell("window.UNotePickChunk && window.UNotePickChunk(" + jsonStr(piece) + ")");
                }
                tell("window.UNotePicked && window.UNotePicked(true)");
            }
        }).start();
    }

    private static byte[] readFile(File f) throws Exception {
        FileInputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
            }
            return bo.toByteArray();
        } finally {
            in.close();
        }
    }

    private void tell(final String js) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) {
                    web.evaluateJavascript(js, null);
                }
            }
        });
    }

    private static String jsonStr(String s) {
        if (s == null) {
            return "null";
        }
        StringBuilder b = new StringBuilder(s.length() + 32);
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
            }
        }
        b.append('"');
        return b.toString();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) {
            web.saveState(out);
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
'''

PERMISSION_OLD = '    <!-- No INTERNET permission on purpose: the page needs nothing from the network. -->'
PERMISSION_NEW = ('    <!-- Only for updates: one small JSON on launch, and the page itself when you take an\n'
                  '         update. Notes, the Vault, backups and attachments never leave the phone. -->\n'
                  '    <uses-permission android:name="android.permission.INTERNET" />')

UPDATES_NOTES = [
    'The installed app updates itself now. It asks the UNote site once at launch, and when there '
    'is a newer version a chip says so: one tap fetches it, keeps it inside the app and reopens '
    'on it. No store, no APK to download, nothing to install.',
    'The app asks the network for exactly two things: that update file, and the page when you take '
    'an update. Notes, the Vault, backups and attachments still never leave the phone.',
    'Settings has one way back: "Go back to the built-in version" throws away a fetched page and '
    'returns to the copy that came inside the APK.',
    'This is the one version that still has to be installed by hand - the version before it had no '
    'way to hear about updates. After this, the fixes arrive on their own.',
]


def applied():
    try:
        app3 = read('src/app3.js')
        java = read(JAVA)
        manifest = read(MANIFEST)
        app1 = read('src/app1.js')
    except IOError:
        return False
    return ('OTA_HOME' in app3 and 'savePage' in java and 'resetPage' in java and
            'INTERNET' in manifest and ("const VERSION = '%s'" % V) in app1)


def main():
    if '--check' in sys.argv:
        if applied():
            print('the tree already carries %s' % V)
            return 0
        print('the tree does not carry %s yet' % V)
        return 1
    if applied():
        print('already applied - nothing to do')
        return 0

    cut('src/app3.js', r"async function checkUpdate\(manual\) \{.*?\n\}\n\n/\* -+ small dialogs",
        UPDATE_JS + '/* ---------------- small dialogs')

    app3 = read('src/app3.js')
    if SETTINGS_ROW_OLD not in app3:
        raise SystemExit('src/app3.js: the updates section is not what 1.0.11 expects')
    write('src/app3.js', app3.replace(SETTINGS_ROW_OLD, SETTINGS_ROW_NEW, 1))

    write(JAVA, MAIN_ACTIVITY)

    manifest = read(MANIFEST)
    if PERMISSION_OLD not in manifest:
        raise SystemExit('AndroidManifest.xml: the permission comment is not what 1.0.11 expects')
    write(MANIFEST, manifest.replace(PERMISSION_OLD, PERMISSION_NEW, 1))

    cut('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V, flags=0)
    cut('sw.js', r'unote-v[0-9.]+', 'unote-v%s' % V, flags=0)
    cut('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V, flags=0)
    cut('android/app/build.gradle', r'versionCode \d+', 'versionCode 1011', flags=0)

    data = json.load(io.open(path('updates.json'), encoding='utf-8'))
    data['version'] = V
    data['date'] = '2026-11-08'
    data['notes'] = UPDATES_NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {
        'version': V,
        'date': '2026-11-08',
        'title': 'Updates that arrive on their own',
        'notes': UPDATES_NOTES,
    })
    data['history'] = hist
    io.open(path('updates.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
