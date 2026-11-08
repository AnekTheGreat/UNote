#!/usr/bin/env python3
"""UNote 1.0.13 - attachments open the phone's own picker, and read mode always shows the text.

    python3 dev/patch-1013.py          # apply
    python3 dev/patch-1013.py --check  # say whether the tree already carries 1.0.13

Two separate things were broken, and neither was the page's own doing.

Attachments. The page asks for a photo, a video or an audio file with a normal
`<input type="file">`, which a browser opens by itself. A WebView does not: unless the app
implements `onShowFileChooser` and hands the picker's answer back, tapping "Photo or video"
does nothing whatsoever - no dialog, no error, nothing. The microphone had the same cause
(`onPermissionRequest` was never implemented, and RECORD_AUDIO was never in the manifest), so a
voice memo could never start either. Now the app opens the real Android picker, accepts several
files at once, allows `content://` results, and grants the microphone only when the phone's
permission has been given. Pasting a picture works through the clipboard API and through
`<img src="data:...">` clipboard content, with a "Paste from the clipboard" row in the attach
sheet.

Read mode. The preview pane was sized by its own content inside an `auto` grid row, so it could
collapse to nothing depending on the note and the screen - the text was in the page, just not on
screen. The pane now fills its row and scrolls inside it, switching to Read re-renders the note,
and if the markdown renderer ever fails, the plain text is shown instead of an empty pane.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.13'


def path(rel):
    return os.path.join(ROOT, *rel.split('/'))


def read(rel):
    return io.open(path(rel), encoding='utf-8').read()


def write(rel, text):
    io.open(path(rel), 'w', encoding='utf-8').write(text)


def rep(rel, old, new, count=1):
    text = read(rel)
    if new in text:
        return
    if old not in text:
        raise SystemExit('%s: could not find %r' % (rel, old[:70]))
    write(rel, text.replace(old, new, count))


def resub(rel, pattern, repl):
    text = read(rel)
    new, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        raise SystemExit('%s: could not find /%s/' % (rel, pattern))
    write(rel, new)


JAVA_IMPORTS = '''import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
'''

JAVA_FIELDS = '''    private static final int REQ_FILES = 43;
    private static final int REQ_MIC = 44;

    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest micRequest;

'''

JAVA_CHROME = '''        /* A WebView will not open a file picker by itself: without onShowFileChooser, the page's
           "photo or video" button does nothing at all. The microphone is refused for the same
           reason, so a voice memo could never start. Both are answered here. */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = cb;
                Intent i = null;
                try {
                    i = params.createIntent();
                } catch (Exception ignored) {
                    i = null;
                }
                if (i == null) {
                    i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                }
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, REQ_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    cb.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        boolean wantsMic = false;
                        for (String r : request.getResources()) {
                            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                                wantsMic = true;
                            }
                        }
                        if (!wantsMic) {
                            request.deny();
                            return;
                        }
                        if (hasMic()) {
                            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                            return;
                        }
                        micRequest = request;
                        try {
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                        } catch (Exception e) {
                            micRequest = null;
                            request.deny();
                        }
                    }
                });
            }
        });

'''

JAVA_METHODS = '''    private boolean hasMic() {
        try {
            return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] granted) {
        super.onRequestPermissionsResult(req, perms, granted);
        if (req != REQ_MIC) {
            return;
        }
        boolean ok = granted.length > 0 && granted[0] == PackageManager.PERMISSION_GRANTED;
        PermissionRequest waiting = micRequest;
        micRequest = null;
        if (waiting == null) {
            return;
        }
        if (ok) {
            waiting.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            waiting.deny();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        super.onDestroy();
    }

'''

PASTE_JS = r'''/* A picture on the clipboard arrives three different ways depending on the phone: as a file
   item, as an <img src="data:..."> inside text/html, or as a bare data: URL in text/plain.
   All three are turned into a normal File, so everything after this point is the same. */
function fileFromDataUrl(url, fallbackName) {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(String(url || ''));
  if (!m) return null;
  try {
    const bin = m[2] ? atob(m[3].replace(/\s+/g, '')) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = fallbackName || ('Pasted ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext);
    return new File([bytes], name, { type: m[1] });
  } catch (e) {
    return null;
  }
}

function filesFromHtml(html) {
  const out = [];
  const re = /<img[^>]+src=["'](data:image\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const f = fileFromDataUrl(m[1]);
    if (f) out.push(f);
  }
  return out;
}

function clipboardFiles(dt) {
  const files = [];
  Array.from(dt.files || []).forEach(f => files.push(f));
  Array.from(dt.items || []).forEach(it => {
    if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  });
  const html = dt.getData ? dt.getData('text/html') : '';
  if (html) filesFromHtml(html).forEach(f => files.push(f));
  const plain = dt.getData ? dt.getData('text/plain') : '';
  if (plain && /^data:image\//i.test(plain.trim())) {
    const f = fileFromDataUrl(plain.trim());
    if (f) files.push(f);
  }
  return files;
}

function mediaPaste(e) {
  const dt = e.clipboardData;
  if (!dt) return;
  const files = clipboardFiles(dt);
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
}

/* The attach sheet's "Paste from the clipboard": for a picture copied from another app that
   does not reach the page as a paste event. */
async function pasteFromClipboard() {
  closeDialog();
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    toast('This phone will not hand over its clipboard here. Long-press in the note and choose Paste instead.', 5200);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      for (const type of it.types) {
        if (type.indexOf('image/') !== 0) continue;
        const blob = await it.getType(type);
        const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        files.push(new File([blob],
          'Pasted ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext,
          { type: type }));
      }
    }
    if (!files.length) { toast('There is no picture in the clipboard.'); return; }
    await addFiles(files);
  } catch (e) {
    toast('Could not read the clipboard (' + (e && e.message ? e.message : 'blocked') +
      '). Long-press in the note and choose Paste instead.', 5200);
  }
}
'''

ATTACH_BODY_OLD = """      '<button class="listrow" data-att="audio"><span class="grow"><span class="lr-t">Audio file</span><span class="lr-s">A recording you already have.</span></span><span class="chev">\\u203a</span></button>' +"""
ATTACH_BODY_NEW = ATTACH_BODY_OLD + """
      '<button class="listrow" data-att="any"><span class="grow"><span class="lr-t">Any file</span><span class="lr-s">A PDF, a document, whatever it is.</span></span><span class="chev">\\u203a</span></button>' +
      '<button class="listrow" data-att="paste"><span class="grow"><span class="lr-t">Paste from the clipboard</span><span class="lr-s">A picture you just copied.</span></span><span class="chev">\\u203a</span></button>' +"""

UPDATES_NOTES = [
    'Photos, videos and audio files now open the phone\'s own picker. The app was asking the page '
    'for a file but never opening anything, so tapping the attachment button did nothing at all.',
    'A voice memo can start: the microphone request is answered by the app, and the permission is '
    'in the manifest.',
    'Pictures can be pasted straight into a note, including a picture copied as an image in another app.',
    'There is an "Any file" row for documents and PDFs, and several files can be picked at once.',
    'Read mode shows the note: the reading pane now fills its row instead of collapsing to nothing, '
    're-renders when you switch to it, and falls back to plain text rather than showing an empty page.',
]


def applied():
    try:
        java = read('android/app/src/main/java/app/unote/MainActivity.java')
        app1 = read('src/app1.js')
    except IOError:
        return False
    return ('onShowFileChooser' in java and 'pasteFromClipboard' in read('src/app3.js') and
            ("const VERSION = '%s'" % V) in app1)


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

    # ---- Android: open the real picker, answer the microphone ----------------
    rep('android/app/src/main/AndroidManifest.xml',
        '    <uses-permission android:name="android.permission.INTERNET" />',
        '    <uses-permission android:name="android.permission.INTERNET" />\n\n'
        '    <!-- Only for a voice memo recorded inside a note. The app asks the phone first, and\n'
        '         the recording stays in the note. -->\n'
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />')

    rep('android/app/src/main/java/app/unote/MainActivity.java',
        'import android.app.Activity;', 'import android.app.Activity;\n' + JAVA_IMPORTS)
    rep('android/app/src/main/java/app/unote/MainActivity.java',
        '    private File otaFile;\n', '    private File otaFile;\n' + JAVA_FIELDS)
    rep('android/app/src/main/java/app/unote/MainActivity.java',
        '        settings.setAllowContentAccess(false);',
        '        settings.setAllowContentAccess(true);    // the picker hands files back as content://\n'
        '        settings.setMediaPlaybackRequiresUserGesture(false);')
    rep('android/app/src/main/java/app/unote/MainActivity.java',
        '        web.addJavascriptInterface(new Files(), "UNoteFile");\n',
        '        web.addJavascriptInterface(new Files(), "UNoteFile");\n\n' + JAVA_CHROME)
    rep('android/app/src/main/java/app/unote/MainActivity.java',
        '        } else if (req == REQ_PICK) {',
        '        } else if (req == REQ_FILES) {\n'
        '            ValueCallback<Uri[]> cb = fileCallback;\n'
        '            fileCallback = null;\n'
        '            if (cb != null) {\n'
        '                cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));\n'
        '            }\n'
        '        } else if (req == REQ_PICK) {')
    rep('android/app/src/main/java/app/unote/MainActivity.java',
        '    private static byte[] readFile(File f) throws Exception {',
        JAVA_METHODS + '    private static byte[] readFile(File f) throws Exception {')

    # ---- the page: paste, the extra attach rows, read mode -------------------
    old_paste = """function mediaPaste(e) {
  const dt = e.clipboardData;
  if (!dt) return;
  const files = [];
  Array.from(dt.items || []).forEach(it => {
    if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  });
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
}
"""
    rep('src/app3.js', old_paste, PASTE_JS)

    rep('src/app3.js', ATTACH_BODY_OLD, ATTACH_BODY_NEW)
    rep('src/app3.js',
        '      \'<input type="file" id="attAudio" accept="audio/*" hidden multiple>\',',
        '      \'<input type="file" id="attAudio" accept="audio/*" hidden multiple>\' +\n'
        '      \'<input type="file" id="attAny" accept="*/*" hidden multiple>\',')
    rep('src/app3.js',
        "    if (b.dataset.att === 'audio') { $('#attAudio', d).click(); return; }",
        "    if (b.dataset.att === 'audio') { $('#attAudio', d).click(); return; }\n"
        "    if (b.dataset.att === 'any') { $('#attAny', d).click(); return; }\n"
        "    if (b.dataset.att === 'paste') { pasteFromClipboard(); return; }")
    rep('src/app3.js',
        "$$('#attPhoto,#attAudio', d).forEach(inp => inp.addEventListener('change', e => {",
        "$$('#attPhoto,#attAudio,#attAny', d).forEach(inp => inp.addEventListener('change', e => {")

    # read mode: fill the row, scroll inside, re-render on switch, never blank
    rep('src/shell.html',
        '#panes{flex:1;display:grid;grid-template-columns:1fr;gap:18px;min-height:0;padding-bottom:20px}',
        '#panes{flex:1;display:grid;grid-template-columns:1fr;grid-auto-rows:minmax(0,1fr);gap:18px;min-height:0;padding-bottom:20px}')
    rep('src/shell.html',
        '#pv{overflow:auto;min-height:0;padding-right:4px}',
        '#pv{overflow:auto;min-height:0;height:100%;padding-right:4px}')
    rep('src/shell.html',
        'body[data-mode="read"] #panes{grid-template-columns:1fr}',
        'body[data-mode="read"] #panes{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr)}')

    rep('src/app2.js',
        "  $('#pv').innerHTML = md(n.body || '');\n  hydrateMedia($('#pv'));",
        "  showReading();")
    rep('src/app2.js',
        "function refreshDocMeta() {",
        """/* One place that fills the reading pane, so Read mode can never come up blank: if the markdown
   renderer ever fails, the note's own text is shown instead of an empty pane. */
function showReading() {
  const pv = $('#pv');
  if (!pv || !S.current) return;
  try {
    pv.innerHTML = md(S.current.body || '');
    hydrateMedia(pv);
  } catch (e) {
    pv.textContent = S.current.body || '';
  }
}

function refreshDocMeta() {""")
    rep('src/app2.js',
        "  $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));\n  kvSet('settings', S.settings);",
        "  $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));\n"
        "  if (mode !== 'edit') showReading();      // switching to Read always renders the note\n"
        "  kvSet('settings', S.settings);")

    # ---- version -------------------------------------------------------------
    resub('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V)
    write('sw.js', re.sub(r'unote-v[0-9.]+', 'unote-v%s' % V, read('sw.js')))
    resub('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V)
    write('android/app/build.gradle',
          re.sub(r'versionCode \d+', 'versionCode 1013', read('android/app/build.gradle')))

    data = json.load(io.open(path('updates.json'), encoding='utf-8'))
    data['version'] = V
    data['date'] = '2026-11-08'
    data['notes'] = UPDATES_NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': '2026-11-08',
                    'title': 'Attachments open, read mode shows the note',
                    'notes': UPDATES_NOTES})
    data['history'] = hist
    io.open(path('updates.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
