#!/usr/bin/env python3
"""UNote 1.0.10 - a PIN with no keyboard, backups that really land, and a graph that says what it is.

    python3 dev/patch-110.py          # apply
    python3 dev/patch-110.py --check  # say whether the tree already carries 1.0.10

Three complaints, three causes:

1. Setting the Vault PIN opened two fields of type=password and put the cursor in the first.
   That is exactly the signal Android's password manager listens for, so the keyboard came up
   with Google offering to fill or save a password over the PIN form. The PIN is entered on the
   same number pad that unlocks the Vault - twice - so no keyboard appears and nothing is
   offered. Changing the PIN goes through the same pad.

2. Backups did not move in the installed app. The page asked for a file with <input type=file>,
   but MainActivity had no WebChromeClient, so onShowFileChooser was never called and the picker
   never opened; and "Save the file" clicked a link with a blob: URL, which this WebView has no
   DownloadListener for, so nothing was written. MainActivity now carries a small bridge
   (window.UNoteFile): saving opens the phone's own "create document" dialog and writes the JSON
   there, importing opens the phone's file picker and hands the text back to the page in pieces.
   The browser copy of the page still falls back to a download and a file input, unchanged.
   The file input also no longer filters by MIME type, which used to hide a .json the phone had
   labelled application/octet-stream.

3. The graph had no explanation anywhere. It is titled what it shows now - "How your notes
   connect" - and when there are no links it says so and how to make one: [[another note's title]].
   With links, the legend says how many and that a tap opens the note.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.10'
JAVA = 'android/app/src/main/java/app/unote/MainActivity.java'


def path(rel):
    return os.path.join(ROOT, *rel.split('/'))


def read(rel):
    return io.open(path(rel), encoding='utf-8').read()


def write(rel, text):
    io.open(path(rel), 'w', encoding='utf-8').write(text)


def cut(rel, pattern, replacement, flags=re.S):
    """Replace the one block that matches, with literal text (no template escapes)."""
    text = read(rel)
    new, n = re.subn(pattern, lambda m: replacement, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit('%s: could not find the block to replace (%r)' % (rel, pattern[:50]))
    write(rel, new)


# ---------------------------------------------------------------- 1. the PIN pad

PIN_JS = r'''/* ---------------- PIN entry with no keyboard ---------------- */

/* Two entries on the same number pad that unlocks the Vault. Nothing is typed into a text
   field, so no keyboard opens and the phone's password manager has nothing to offer. */
function askPinPair(o) {
  const step = first => {
    closeDialog();
    pinDialog({
      title: first ? 'Type the PIN once more' : o.title,
      sub: first ? 'The same digits, to be sure.' : o.sub,
      extra: first
        ? '<div class="hint" style="text-align:center;margin:10px 0 0">A PIN cannot be recovered.</div>'
        : '<div class="hint" style="text-align:center;margin:10px 0 0">Just the keypad - no keyboard, no password pop-up.</div>' +
          '<div style="text-align:center;margin-top:10px"><button class="btn ghost" id="pinPairCancel" style="font-size:12px;color:var(--dim2)">Not now</button></div>',
      onPin: (pin, ui) => {
        if (!first) { step(pin); return; }
        if (pin !== first) {
          closeDialog();
          toast('Those two did not match. Start again.', 3600);
          setTimeout(() => step(null), 420);
          return;
        }
        closeDialog();
        o.onPin(first);
      },
    });
    const c = document.getElementById('pinPairCancel');
    if (c) c.addEventListener('click', () => closeDialog());
  };
  step(null);
}

function askNewPin(done) {
  askPinPair({
    title: 'Create a Vault PIN',
    sub: '4 to 8 digits. It is the only key to the Vault.',
    onPin: async pin => {
      toast('Sealing the Vault...', 1800);
      try { await setupVaultPin(pin); done && done(); }
      catch (e) { toast('Could not create it: ' + e.message, 4200); }
    },
  });
}
'''

CHANGE_PIN_JS = r'''async function changePin() {
  const meta = await vaultMeta();
  if (!meta || !meta.on) { askNewPin(() => toast('Vault PIN set.')); return; }
  if (!S.vault.key) { unlockDialog(() => changePin()); return; }
  askPinPair({
    title: 'Change the Vault PIN',
    sub: 'Pick a new 4 to 8 digit PIN. Everything in the Vault is resealed with it.',
    onPin: async p1 => {
      toast('Resealing the Vault...', 2000);
      try {
        const plain = S.vault.plain.slice();
        const salt = randSalt();
        const key = await deriveKey(p1, salt, KDF_ITER);
        const verifier = await aesEnc(key, 'unote-vault-v1');
        for (const n of plain) {
          const box = await aesEnc(key, JSON.stringify({ title: n.title, body: n.body, folder: n.folder }));
          await dbPut('notes', { id: n.id, vault: true, created: n.created, updated: n.updated, iv: box.iv, ct: box.ct });
        }
        S.vault.key = key; S.vault.salt = salt;
        S.vault.verifier = { iv: verifier.iv, ct: verifier.ct };
        await kvSet('vault', { on: true, salt: salt, iter: KDF_ITER, verifier: S.vault.verifier });
        await decryptVault();
        toast('PIN changed. ' + plain.length + ' vault note' + (plain.length === 1 ? '' : 's') + ' resealed.', 4000);
      } catch (e) {
        toast('Could not change it: ' + e.message, 4200);
      }
    },
  });
}
'''

# ------------------------------------------------- 2. real files, in and out of the phone

NATIVE_JS = r'''/* ---------------- the phone's own file picker ---------------- */

/* The installed app hands the page a small bridge, window.UNoteFile. Without it (the browser
   copy) everything falls back to a plain download and a file input, as before. */
function nativeFiles() {
  return (typeof window !== 'undefined' && window.UNoteFile &&
    typeof window.UNoteFile.saveBackup === 'function') ? window.UNoteFile : null;
}

let pickBuf = '';
let pickMode = 'merge';
if (typeof window !== 'undefined') {
  window.UNotePickChunk = s => { pickBuf += s; };
  window.UNotePicked = ok => {
    const text = ok ? pickBuf : '';
    pickBuf = '';
    if (!text) { toast('That file came through empty. Try another one.', 4200); return; }
    runImport(text, pickMode);
  };
  window.UNoteSaved = ok => toast(ok ? 'Backup saved.' : 'Could not save the backup.', 3800);
}

'''

EXPORT_JS = r'''async function exportAll() {
  try {
    const bundle = await buildBundle();
    const name = 'unote-' + dayKey() + '.unote.json';
    const json = JSON.stringify(bundle, null, 1);
    const msg = bundle.notes.length + ' note' + (bundle.notes.length === 1 ? '' : 's') +
      (bundle.vault.on ? ' + ' + bundle.vault.notes.length + ' sealed in the Vault' : '');
    const nf = nativeFiles();
    if (nf) {
      nf.saveBackup(name, json);
      toast('Exported ' + msg + '. Pick where to keep ' + name + '.', 4600);
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Exported ' + msg + ' to ' + name, 4600);
  } catch (e) { toast('Export failed: ' + e.message, 4200); }
}
'''

IMPORT_JS = r'''async function importDialog() {
  const d = dialog({
    cls: 'wide',
    title: 'Import a backup',
    body: '<div class="hint" style="margin-top:0">Pick the .unote.json file, or paste a transfer code.</div>' +
      '<button class="listrow" id="impPick"><span class="grow"><span class="lr-t">Choose a file</span><span class="lr-s">A UNote backup from this or another device.</span></span><span class="chev">&#8250;</span></button>' +
      '<label class="field" style="margin-top:12px"><span>Or paste a transfer code</span><textarea id="impCode" rows="5" style="font-family:var(--mono);font-size:11px" placeholder="UNOTE1:..."></textarea></label>' +
      '<div class="rowset"><span class="grow">How to bring it in</span><div class="seg" id="impMode">' +
      '<button data-m="merge" class="on">Merge</button><button data-m="replace">Replace everything</button></div></div>' +
      '<div class="hint">Merge keeps what is here and adds anything newer from the backup. Replace clears this device first.</div>' +
      '<input type="file" id="impFile" accept="*/*" hidden>',
    foot: '<div class="grow"></div><button class="btn primary" id="impGo">Import</button>',
  });
  let mode = 'merge';
  const nf = nativeFiles();
  const pick = () => {
    if (nf) { pickMode = mode; pickBuf = ''; nf.pickBackup(); return; }
    $('#impFile', d).click();
  };
  $('#impPick', d).addEventListener('click', pick);
  $('#impFile', d).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    let text = '';
    try { text = await f.text(); } catch (err) { toast('Could not read that file.', 4000); return; }
    if (!text) { toast('That file came through empty. Try another one.', 4200); return; }
    await runImport(text, mode);
  });
  $('#impMode', d).addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    mode = b.dataset.m; $$('#impMode button', d).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#impGo', d).addEventListener('click', async () => {
    const code = $('#impCode', d).value.trim();
    if (!code) { pick(); return; }
    await runImport(code, mode);
  });
}
'''

# ---------------------------------------------------------------- 3. the graph

GRAPH_JS = (
    "  const legend = $('#graphlegend');\n"
    "  legend.textContent = G.nodes.length + ' note' + (G.nodes.length === 1 ? '' : 's') + ' \u00b7 ' +\n"
    "    (G.edges.length\n"
    "      ? G.edges.length + ' link' + (G.edges.length === 1 ? '' : 's') + ' \u00b7 tap a dot to open it'\n"
    "      : 'no links yet');\n"
    "  const empty = $('#graphempty');\n"
    "  if (empty) empty.hidden = G.edges.length > 0;"
)

GRAPH_EMPTY = ('<canvas id="graph"></canvas>\n'
               '  <div id="graphempty" hidden><strong>No links yet</strong>When one note mentions another '
               'with [[its title]], a line joins the two here. Tap any dot to open that note.</div>')

GRAPH_CSS = ('#graph.drag{cursor:grabbing}\n'
             '#graphempty{position:absolute;left:24px;right:24px;bottom:72px;text-align:center;color:var(--dim);font-size:13px;line-height:1.55;pointer-events:none}\n'
             '#graphempty strong{display:block;color:var(--ink);font-size:14px;font-weight:600;margin-bottom:5px}')

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

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The whole app is one page. It is bundled in assets/www and served from
 * https://appassets.androidplatform.net, not file://, because WebView refuses
 * IndexedDB and service workers on file:// - and the notes live in IndexedDB.
 *
 * Backups are the one thing the page cannot do by itself: a WebView has no download
 * manager and no file chooser unless the app supplies one. So the page calls into
 * window.UNoteFile, and this activity opens the phone's own save dialog and file
 * picker and carries the text across. Nothing leaves the phone.
 */
public class MainActivity extends Activity {

    private static final String HOME = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int REQ_SAVE = 41;
    private static final int REQ_PICK = 42;

    private WebView web;
    private String pendingText;
    private String pendingName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

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

    /** What window.UNoteFile exposes to the page. */
    private class Files {

        @JavascriptInterface
        public boolean ready() {
            return true;
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

UPDATES_NOTES = [
    'Setting a Vault PIN uses the number pad now, the same one that unlocks it. No keyboard '
    'opens, so nothing offers to save or fill a password over the PIN.',
    'Backups work inside the app: saving one asks the phone where to keep it, and choosing one '
    'to import opens the phone file picker - which never opened before.',
    'A file the phone labels unknown is no longer hidden from the picker.',
    "The graph is titled what it shows, says how many notes and links it drew, and when there "
    "are none it says how to make one: write [[another note's title]].",
]


def applied():
    try:
        app3 = read('src/app3.js')
        shell = read('src/shell.html')
        java = read(JAVA)
        app1 = read('src/app1.js')
    except IOError:
        return False
    return ('function askPinPair' in app3 and 'function nativeFiles' in app3 and
            'graphempty' in shell and 'UNoteFile' in java and
            ("const VERSION = '%s'" % V) in app1)


def do_pin():
    app3 = read('src/app3.js')
    if 'function askPinPair' in app3:
        print('src/app3.js already has the keypad flow')
        return
    app3, n = re.subn(r"function askNewPin\(done\) \{.*?\n\}\n", lambda m: PIN_JS, app3,
                      count=1, flags=re.S)
    if n != 1:
        raise SystemExit('src/app3.js: askNewPin not found')
    app3, n = re.subn(r"async function changePin\(\) \{.*?\n\}\n", lambda m: CHANGE_PIN_JS, app3,
                      count=1, flags=re.S)
    if n != 1:
        raise SystemExit('src/app3.js: changePin not found')
    write('src/app3.js', app3)


def do_files():
    app3 = read('src/app3.js')
    if 'function nativeFiles' in app3:
        print('src/app3.js already has the file bridge')
        return
    app3, n = re.subn(r"/\* -+ export / transfer / import -+ \*/", lambda m: NATIVE_JS + m.group(0),
                      app3, count=1, flags=re.S)
    if n != 1:
        raise SystemExit('src/app3.js: export section marker not found')
    app3, n = re.subn(r"async function exportAll\(\) \{.*?\n\}\n", lambda m: EXPORT_JS, app3,
                      count=1, flags=re.S)
    if n != 1:
        raise SystemExit('src/app3.js: exportAll not found')
    app3, n = re.subn(r"async function importDialog\(\) \{.*?\n\}\n", lambda m: IMPORT_JS, app3,
                      count=1, flags=re.S)
    if n != 1:
        raise SystemExit('src/app3.js: importDialog not found')
    write('src/app3.js', app3)


def do_graph():
    app2 = read('src/app2.js')
    shell = read('src/shell.html')
    if 'graphempty' in app2 and 'graphempty' in shell:
        print('the graph already explains itself')
        return
    old = "  $('#graphlegend').textContent = G.nodes.length + ' notes \u00b7 ' + G.edges.length + ' links';"
    if old not in app2:
        raise SystemExit('src/app2.js: the legend line is not what 1.0.10 expects')
    write('src/app2.js', app2.replace(old, GRAPH_JS, 1))

    if '<strong style="font-size:13px">Graph</strong>' not in shell:
        raise SystemExit('src/shell.html: the graph title is not what 1.0.10 expects')
    shell = shell.replace('<strong style="font-size:13px">Graph</strong>',
                          '<strong style="font-size:13px">How your notes connect</strong>', 1)
    shell = shell.replace('<canvas id="graph"></canvas>', GRAPH_EMPTY, 1)
    shell = shell.replace('#graph.drag{cursor:grabbing}', GRAPH_CSS, 1)
    write('src/shell.html', shell)


def do_versions():
    cut('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V, flags=0)
    cut('sw.js', r'unote-v[0-9.]+', 'unote-v%s' % V, flags=0)
    cut('android/app/build.gradle', r"def appVersion = '[0-9.]+'",
        "def appVersion = '%s'" % V, flags=0)
    cut('android/app/build.gradle', r'versionCode \d+', 'versionCode 1010', flags=0)

    data = json.load(io.open(path('updates.json'), encoding='utf-8'))
    data['version'] = V
    data['date'] = '2026-11-08'
    data['notes'] = UPDATES_NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {
        'version': V,
        'date': '2026-11-08',
        'title': 'A PIN with no keyboard, and backups that land',
        'notes': UPDATES_NOTES,
    })
    data['history'] = hist
    io.open(path('updates.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n')


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
    do_pin()
    do_files()
    do_graph()
    write(JAVA, MAIN_ACTIVITY)
    do_versions()
    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
