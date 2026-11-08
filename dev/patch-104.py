#!/usr/bin/env python3
"""1.0.4: the mark fills the icon, and the black disc behind the dots is gone.

The note card now runs from 24dp to 84dp instead of sitting inside a black
circle at the bottom right: the two link dots rest on the card itself and part
along a hairline, so the drawing is full edge to edge with nothing heavy behind
it. The adaptive, round and monochrome icons, and the page icons, are all redrawn
by this payload, so the APK and the home-screen copy cannot drift apart.
"""
import io
import json
import re
import subprocess
import sys

V = '1.0.4'
PREV = '1.0.3'

CARD = 'M41,24h25l14,14v41a5,5 0 0 1 -5,5h-34a5,5 0 0 1 -5,-5v-50a5,5 0 0 1 5,-5z'
FOLD = 'M66,24l14,14h-14z'
L1 = 'M46,44h20a2,2 0 0 1 0,4h-20a2,2 0 0 1 0,-4z'
L2 = 'M46,55h20a2,2 0 0 1 0,4h-20a2,2 0 0 1 0,-4z'
L3 = 'M46,66h12a2,2 0 0 1 0,4h-12a2,2 0 0 1 0,-4z'
D1 = 'M63,74a4,4 0 1 1 8,0a4,4 0 1 1 -8,0z'
D2 = 'M70.5,74a4,4 0 1 1 8,0a4,4 0 1 1 -8,0z'
GAP = 'M70.2,69.4h0.9v9.2h-0.9z'

HEAD = ('<?xml version="1.0" encoding="utf-8"?>\n'
        '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:width="108dp"\n'
        '    android:height="108dp"\n'
        '    android:viewportWidth="108"\n'
        '    android:viewportHeight="108">\n')

FOREGROUND = (HEAD +
    '    <path android:fillColor="#7C5CFF" android:pathData="%s" />\n' % CARD +
    '    <path android:fillColor="#C9BCFF" android:pathData="%s" />\n' % FOLD +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % L1 +
    '    <path android:fillColor="#FFFFFF" android:fillAlpha="0.92" android:pathData="%s" />\n' % L2 +
    '    <path android:fillColor="#FFFFFF" android:fillAlpha="0.72" android:pathData="%s" />\n' % L3 +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % D1 +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % D2 +
    '    <path android:fillColor="#1B1633" android:fillAlpha="0.6" android:pathData="%s" />\n' % GAP +
    '</vector>\n')

BACKGROUND = ('<?xml version="1.0" encoding="utf-8"?>\n'
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
    '    xmlns:aapt="http://schemas.android.com/aapt"\n'
    '    android:width="108dp"\n'
    '    android:height="108dp"\n'
    '    android:viewportWidth="108"\n'
    '    android:viewportHeight="108">\n'
    '    <path android:pathData="M0,0h108v108h-108z">\n'
    '        <aapt:attr name="android:fillColor">\n'
    '            <gradient\n'
    '                android:startX="0" android:startY="0"\n'
    '                android:endX="108" android:endY="108"\n'
    '                android:type="linear">\n'
    '                <item android:offset="0" android:color="#FF2A2350" />\n'
    '                <item android:offset="1" android:color="#FF16112A" />\n'
    '            </gradient>\n'
    '        </aapt:attr>\n'
    '    </path>\n'
    '</vector>\n')

MONOCHROME = (HEAD +
    '    <path\n'
    '        android:fillColor="#FFFFFF"\n'
    '        android:fillType="evenOdd"\n'
    '        android:pathData="%s M46,44h20v4h-20z M46,55h20v4h-20z M46,66h12v4h-12z %s %s" />\n'
    % (CARD, D1, D2) +
    '</vector>\n')

FLAT = (HEAD +
    '    <path android:fillColor="#1B1633" android:pathData="M0,0h108v108h-108z" />\n' +
    '    <path android:fillColor="#7C5CFF" android:pathData="%s" />\n' % CARD +
    '    <path android:fillColor="#C9BCFF" android:pathData="%s" />\n' % FOLD +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % L1 +
    '    <path android:fillColor="#FFFFFF" android:fillAlpha="0.92" android:pathData="%s" />\n' % L2 +
    '    <path android:fillColor="#FFFFFF" android:fillAlpha="0.72" android:pathData="%s" />\n' % L3 +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % D1 +
    '    <path android:fillColor="#FFFFFF" android:pathData="%s" />\n' % D2 +
    '    <path android:fillColor="#1B1633" android:fillAlpha="0.6" android:pathData="%s" />\n' % GAP +
    '</vector>\n')

SVG_HEAD = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">\n'
    '  <defs>\n'
    '    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">\n'
    '      <stop offset="0" stop-color="#2A2350"/>\n'
    '      <stop offset="1" stop-color="#16112A"/>\n'
    '    </linearGradient>\n'
    '  </defs>\n'
    '  <rect width="108" height="108" fill="url(#bg)"/>\n')

SVG_ART = ('  <path fill="#7C5CFF" d="%s"/>\n' % CARD +
    '  <path fill="#C9BCFF" d="%s"/>\n' % FOLD +
    '  <path fill="#FFFFFF" d="%s"/>\n' % L1 +
    '  <path fill="#FFFFFF" fill-opacity=".92" d="%s"/>\n' % L2 +
    '  <path fill="#FFFFFF" fill-opacity=".72" d="%s"/>\n' % L3 +
    '  <path fill="#FFFFFF" d="%s"/>\n' % D1 +
    '  <path fill="#FFFFFF" d="%s"/>\n' % D2 +
    '  <path fill="#1B1633" fill-opacity=".6" d="%s"/>\n' % GAP)

ICONS = {
    'android/app/src/main/res/drawable/ic_launcher_foreground.xml': FOREGROUND,
    'android/app/src/main/res/drawable/ic_launcher_background.xml': BACKGROUND,
    'android/app/src/main/res/drawable/ic_launcher_monochrome.xml': MONOCHROME,
    'android/app/src/main/res/drawable/ic_launcher.xml': FLAT,
    'android/app/src/main/res/mipmap/ic_launcher.xml': FLAT,
    'android/app/src/main/res/mipmap/ic_launcher_round.xml': FLAT,
    'icon.svg': SVG_HEAD + SVG_ART + '</svg>\n',
    'icon-maskable.svg': SVG_HEAD + '  <g transform="translate(54 54) scale(0.82) translate(-54 -54)">\n' + SVG_ART + '  </g>\n</svg>\n',
}

ENTRY = {
    'version': V,
    'date': 'November 8, 2026',
    'title': 'A fuller mark, and no black disc',
    'notes': [
        'The icon is redrawn: the note card now fills the icon instead of sitting inside a black circle at the bottom right.',
        'The two link dots rest on the card and part along a hairline, so the only dark line left is a hair thin one.',
        'Adaptive, round, themed and home-screen icons are redrawn together, so the APK and the installed page match.',
    ],
}


def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)


def applied():
    try:
        return ("const VERSION = '%s';" % V in read('src/app1.js')
                and D1 in read('android/app/src/main/res/drawable/ic_launcher_foreground.xml'))
    except IOError:
        return False


if applied():
    print('%s is already on the page - nothing to do' % V)
    sys.exit(0)
if '--check' in sys.argv:
    print('%s is not on the page yet' % V)
    sys.exit(1)

# 1. the icon, everywhere it is drawn
for path, body in ICONS.items():
    write(path, body)

# 2. the version, in the page and in the service worker's cache name
a1 = read('src/app1.js')
if a1.count("const VERSION = '%s';" % PREV) != 1:
    sys.exit('app1.js is not on %s' % PREV)
write('src/app1.js', a1.replace("const VERSION = '%s';" % PREV, "const VERSION = '%s';" % V))

sw = read('sw.js')
if 'unote-v%s' % PREV not in sw:
    sys.exit('sw.js does not carry the %s cache' % PREV)
write('sw.js', sw.replace('unote-v%s' % PREV, 'unote-v%s' % V))

# 3. the notes: this release goes on top of the history already there
cur = json.loads(read('updates.json'))
hist = [h for h in cur.get('history', []) if h.get('version') != V]
hist.insert(0, ENTRY)
upd = {'app': 'UNote', 'version': V, 'date': ENTRY['date'], 'notes': ENTRY['notes'], 'history': hist}
write('updates.json', json.dumps(upd, indent=2, ensure_ascii=False) + '\n')

# 4. the APK carries the same number
g = read('android/app/build.gradle')
parts = V.split('.')
code = 1000 + int(parts[1]) * 100 + int(parts[2])
if ("def appVersion = '%s'" % PREV) not in g:
    sys.exit('build.gradle is not on %s' % PREV)
g = g.replace("def appVersion = '%s'" % PREV, "def appVersion = '%s'" % V, 1)
g = re.sub(r'versionCode \d+', 'versionCode %d' % code, g, count=1)
write('android/app/build.gradle', g)

# 5. the page itself
subprocess.check_call(['python3', 'dev/build.py'])
print('%s written: a full mark, and the notes to go with it' % V)
