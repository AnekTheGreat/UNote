#!/usr/bin/env python3
"""UNote 1.0.14 - installing a newer APK actually takes effect.

    python3 dev/patch-1014.py          # apply
    python3 dev/patch-1014.py --check  # say whether the tree already carries 1.0.14

The app keeps the page it fetches from the site in its own storage and serves that copy instead of
the one bundled in the APK. That was meant for over-the-air updates, but it had no idea which copy
was newer: install a fresh APK over an older app and the old fetched page kept winning, so the new
build looked exactly like the old one - same version, same missing fixes. Installing the app was
the one thing that could not change the app.

Now the page that came inside the APK wins whenever it is newer than the stored one, and the stale
page is deleted so it cannot come back. Only a page fetched later than the app's own build is
served. Settings also says, in words, whether this screen is the page that came with the app or one
fetched earlier, so a shadowed page is visible instead of mysterious.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.14'

MAIN = 'android/app/src/main/java/app/unote/MainActivity.java'

FETCHED_OLD = '''    /** The fetched page, if there is one that still looks like UNote. */
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
'''

FETCHED_NEW = '''    /** The fetched page, if there is one that still looks like UNote - and only if it is newer than
     *  the page inside this APK. Installing a newer app used to leave an older fetched page in
     *  charge, which made the new APK look like it had changed nothing at all. */
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
            String fetched = pageVersion(head);
            String bundled = builtInVersion();
            boolean stale = fetched.isEmpty()
                    || (!bundled.isEmpty() && compareVersions(fetched, bundled) < 0);
            if (stale) {
                // The app on this phone is newer than the page an earlier update left behind:
                // the copy that came inside the APK wins, and the stale one is dropped.
                otaFile.delete();
                return null;
            }
            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            return null;
        }
    }
'''

VERSION_HELPERS = '''    /** The version of the page that came inside this APK, read once. */
    private String builtInVersion() {
        if (builtIn != null) {
            return builtIn;
        }
        builtIn = "";
        try (InputStream in = getAssets().open("www/index.html")) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
            }
            builtIn = pageVersion(new String(bo.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            builtIn = "";
        }
        return builtIn;
    }

    /** "1.0.14" out of the page's own `const VERSION = '...'` line. */
    private static String pageVersion(String html) {
        if (html == null) {
            return "";
        }
        String marker = "const VERSION = '";
        int at = html.indexOf(marker);
        if (at < 0) {
            return "";
        }
        int from = at + marker.length();
        int to = html.indexOf('\\'', from);
        if (to < 0 || to - from > 20) {
            return "";
        }
        return html.substring(from, to).trim();
    }

    private static int compareVersions(String a, String b) {
        String[] x = a.split("\\\.");
        String[] y = b.split("\\\.");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int xi = i < x.length ? versionPart(x[i]) : 0;
            int yi = i < y.length ? versionPart(y[i]) : 0;
            if (xi != yi) {
                return xi < yi ? -1 : 1;
            }
        }
        return 0;
    }

    private static int versionPart(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (Exception e) {
            return 0;
        }
    }

'''

PAGE_SOURCE_JS = '''        @JavascriptInterface
        public String pageSource() {
            if (otaFile == null || !otaFile.isFile()) {
                return "built-in " + builtInVersion();
            }
            try {
                String v = pageVersion(new String(readFile(otaFile), StandardCharsets.UTF_8));
                return "fetched " + (v.isEmpty() ? "unknown" : v);
            } catch (Exception e) {
                return "built-in " + builtInVersion();
            }
        }
'''

OTA_SOURCE_JS = '''
/* Which page is on screen: the one that came inside the APK, or one fetched over the air. Shown in
   Settings so a page that shadows a newer app is visible instead of looking like a mystery. */
function otaSourceSummary() {
  const nf = nativeFiles();
  if (!nf || typeof nf.pageSource !== 'function') return '';
  let s = '';
  try { s = String(nf.pageSource() || ''); } catch (e) { return ''; }
  if (s.indexOf('fetched') === 0) {
    return 'This screen is a page fetched earlier (' + s.replace('fetched ', '') + '), not the copy inside the app.';
  }
  return 'This screen is the page that came inside the app' + (s.indexOf('built-in ') === 0 && s.length > 10 ? ' (' + s.slice(10) + ')' : '') + '.';
}
'''

UPDATES_NOTES = [
    'Installing a newer APK now takes effect straight away. The app keeps the page it downloaded '
    'last time in its own storage and was serving that instead of the page inside the new APK, so a '
    'fresh install could keep opening the old version and look like nothing had changed.',
    'An out-of-date downloaded page is dropped automatically, and only a page newer than the app '
    'itself is ever served.',
    'Settings now says whether this screen is the page that came inside the app or one fetched '
    'earlier, so a shadowed page is visible instead of mysterious.',
]


def path(rel):
    return os.path.join(ROOT, *rel.split('/'))


def read(rel):
    return io.open(path(rel), encoding='utf-8').read()


def write(rel, text):
    io.open(path(rel), 'w', encoding='utf-8').write(text)


def rep(rel, old, new):
    text = read(rel)
    if new in text:
        return
    if old not in text:
        raise SystemExit('%s: could not find %r' % (rel, old[:70]))
    write(rel, text.replace(old, new, 1))


def resub(rel, pattern, repl):
    text = read(rel)
    new, n = re.subn(pattern, repl, text, count=1)
    if n != 1:
        raise SystemExit('%s: could not find /%s/' % (rel, pattern))
    write(rel, new)


def applied():
    try:
        java = read(MAIN)
        app1 = read('src/app1.js')
        app3 = read('src/app3.js')
    except IOError:
        return False
    return ('compareVersions' in java and 'otaSourceSummary' in app3 and
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

    # ---- the newer app wins over an older fetched page -----------------------
    rep(MAIN, '    private File otaFile;\n',
        '    private File otaFile;\n    private String builtIn;    // version of the page inside this APK, read once\n')
    rep(MAIN, FETCHED_OLD, FETCHED_NEW)
    rep(MAIN, '''        @JavascriptInterface
        public boolean hasPage() {
            return otaFile != null && otaFile.isFile();
        }
''', '''        @JavascriptInterface
        public boolean hasPage() {
            return otaFile != null && otaFile.isFile();
        }

''' + PAGE_SOURCE_JS)
    rep(MAIN, '    private boolean hasMic() {', VERSION_HELPERS + '    private boolean hasMic() {')

    # ---- Settings says which page is on screen -------------------------------
    rep('src/app3.js',
        '''  return 'Last check at ' + when + ': reached the site, which offers ' + (otaState.site || VERSION) +
    (newer ? ' - newer than this one.' : ' - so this is the newest.');
}
''',
        '''  return 'Last check at ' + when + ': reached the site, which offers ' + (otaState.site || VERSION) +
    (newer ? ' - newer than this one.' : ' - so this is the newest.');
}
''' + OTA_SOURCE_JS)
    rep('src/app3.js',
        '''      '<div id="setUpdMsg" class="hint" style="margin:8px 0 0">' + otaSummary() + '</div>' +''',
        '''      '<div id="setUpdMsg" class="hint" style="margin:8px 0 0">' + otaSummary() + '</div>' +
      (otaSourceSummary() ? '<div class="hint" style="margin:4px 0 0">' + otaSourceSummary() + '</div>' : '') +''')

    # ---- version -------------------------------------------------------------
    resub('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V)
    write('sw.js', re.sub(r'unote-v[0-9.]+', 'unote-v%s' % V, read('sw.js')))
    resub('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V)
    write('android/app/build.gradle',
          re.sub(r'versionCode \d+', 'versionCode 1014', read('android/app/build.gradle')))

    data = json.load(io.open(path('updates.json'), encoding='utf-8'))
    data['version'] = V
    data['date'] = '2026-11-08'
    data['notes'] = UPDATES_NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': '2026-11-08',
                    'title': 'A new build takes effect immediately',
                    'notes': UPDATES_NOTES})
    data['history'] = hist
    io.open(path('updates.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
