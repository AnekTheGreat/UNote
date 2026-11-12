#!/usr/bin/env python3
"""UNote 1.0.19 - the build a store will take.

Four things stood between the bundle and Play:

  * the APK called itself 1.0.16 while the page had moved on twice, because the version was
    typed into gradle and the page's version lives in updates.json. It is read from there now,
    and the version code is computed from it, three digits a part, so it can only go up.
  * targetSdk 34. From 31 August 2026 a new listing has to target 36, which means AGP 8.12.3
    and Gradle 8.13 rather than 8.5.2 and 8.7.
  * Android 15 forces apps targeting 35 or later to draw behind the status and navigation bars.
    This page was written to sit between them, so the bars' heights go back on as padding.
  * nothing else: signing, minSdk, the package name and the launcher are already what Play asks.

    python3 dev/patch-1019.py          # apply
    python3 dev/patch-1019.py --check  # say whether the tree already carries 1.0.19
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.19'
OLD = '1.0.18'
DATE = '2026-11-12'

NOTES = [
    "The version on the app and the version on the page are the same number now. It was typed twice - 1.0.16 in the build, whatever the page said in updates.json - so the APK could call itself a release the notebook had already moved past. The build reads the page's own number, and the version code is worked out from it: 1.0.19 is 1000019, and it can only go up.",
    "The app targets Android 16 now, which is what a new listing on Play has to do from 31 August 2026. Nothing about the notebook changes because of it.",
    "On Android 15 and later the phone draws apps behind the status bar and the row of navigation buttons, and this page was written to sit between them - so the first line of the screen and the buttons at the bottom would have slipped underneath. Where the phone insists, the heights of those two bars are added back as space, and the keyboard's height with them.",
    "The release itself is a bundle now as well as an APK, both signed with the same upload key, both built from the same commit. Nothing to install differently: the APK is still the one for a phone.",
]


def path(p):
    return os.path.join(ROOT, p)


def read(p):
    return io.open(path(p), encoding='utf-8').read()


def write(p, s):
    io.open(path(p), 'w', encoding='utf-8', newline='').write(s)


def rep(p, old, new, what):
    s = read(p)
    n = s.count(old)
    if n != 1:
        sys.exit('%s: %s appears %d times, expected once' % (p, what, n))
    write(p, s.replace(old, new))


GRADLE = 'android/app/build.gradle'
MAIN = 'android/app/src/main/java/app/unote/MainActivity.java'
WF = '.github/workflows/apk.yml'


def main():
    if read('src/app1.js').count("const VERSION = '%s';" % V) == 1:
        print('already on the page')
        return 0
    if '--check' in sys.argv:
        print('not applied yet')
        return 1

    # 1. The version, once.
    rep(GRADLE, "def appVersion = '1.0.16'",
        "// Read from the page's own updates.json: a release number typed twice is a release number\n"
        "// that drifts, and this one had (the build said 1.0.16 while the page said 1.0.18).\n"
        "def appVersion = new groovy.json.JsonSlurper().parseText(rootProject.file('../updates.json').text).version",
        'the version')
    rep(GRADLE, "    targetSdk 34\n        versionCode 1016\n        versionName appVersion",
        "    // 36 is what a new listing on Play has to target from 31 August 2026.\n"
        "        targetSdk 36\n"
        "        // Three digits a part, so 1.0.19 is 1000019 and the code only ever goes up.\n"
        "        versionCode appVersion.tokenize('.').collect { it.padLeft(3, '0') }.join('').toInteger()\n"
        "        versionName appVersion",
        'targetSdk and the version code')
    rep(GRADLE, "    compileSdk 34", "    compileSdk 36", 'compileSdk')
    rep(GRADLE, "    implementation 'androidx.webkit:webkit:1.11.0'",
        "    implementation 'androidx.webkit:webkit:1.11.0'\n"
        "    // For the window insets on Android 15 and later, where the page would otherwise draw\n"
        "    // under the status bar.\n"
        "    implementation 'androidx.core:core:1.13.1'",
        'the androidx core dependency')

    # 2. The build tools that can target 36.
    rep('android/build.gradle', "id 'com.android.application' version '8.5.2' apply false",
        "id 'com.android.application' version '8.12.3' apply false", 'the Android Gradle Plugin')
    rep(WF, "gradle-version: '8.7'", "gradle-version: '8.13'", 'the Gradle version')

    # 3. The bars, back where they were.
    rep(MAIN, "import android.os.Bundle;", "import android.os.Build;\nimport android.os.Bundle;", 'the Build import')
    rep(MAIN, "import androidx.webkit.WebViewAssetLoader;",
        "import androidx.core.graphics.Insets;\n"
        "import androidx.core.view.ViewCompat;\n"
        "import androidx.core.view.WindowInsetsCompat;\n"
        "import androidx.webkit.WebViewAssetLoader;", 'the insets imports')
    rep(MAIN, "        setContentView(web);",
        "        setContentView(web);\n"
        "\n"
        "        // Android 15 draws every app targeting 35 or later behind the status bar and the row of\n"
        "        // navigation buttons, and this page was written to sit between them. Where the phone\n"
        "        // insists, the heights of those bars go back on as padding - the layout every earlier\n"
        "        // version had - and the keyboard's height is included, so the bottom of the page still\n"
        "        // rises above it while it is open.\n"
        "        if (Build.VERSION.SDK_INT >= 35) {\n"
        "            final int padL = web.getPaddingLeft(), padT = web.getPaddingTop();\n"
        "            final int padR = web.getPaddingRight(), padB = web.getPaddingBottom();\n"
        "            ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {\n"
        "                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()\n"
        "                        | WindowInsetsCompat.Type.displayCutout()\n"
        "                        | WindowInsetsCompat.Type.ime());\n"
        "                v.setPadding(padL + bars.left, padT + bars.top, padR + bars.right, padB + bars.bottom);\n"
        "                return insets;\n"
        "            });\n"
        "            ViewCompat.requestApplyInsets(web);\n"
        "        }",
        'the window after setContentView')

    # 4. The page's own number.
    rep('src/app1.js', "const VERSION = '%s';" % OLD, "const VERSION = '%s';" % V, 'the page version')
    rep('sw.js', "CACHE = 'unote-v%s'" % OLD, "CACHE = 'unote-v%s'" % V, 'the worker cache')

    d = json.loads(read('updates.json'))
    d['version'] = V
    d['date'] = DATE
    d['notes'] = NOTES
    hist = [h for h in d.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': DATE, 'title': 'A build a store will take, and the bars back in place', 'notes': NOTES})
    d['history'] = hist
    write('updates.json', json.dumps(d, indent=2, ensure_ascii=False) + '\n')

    print('UNote %s: version from updates.json, targetSdk 36, AGP 8.12.3, bars padded' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
