#!/usr/bin/env python3
"""UNote 1.0.18 - a privacy policy of its own, and a door to it.

Play asks for a policy address for every app; UNote had none, at any address, in any form.

    python3 dev/patch-1018.py          # apply
    python3 dev/patch-1018.py --check  # say whether the tree already carries 1.0.18

The page itself lives in dev/privacy-1018.html.txt and is copied to privacy.html, which is
published beside the page by the same Pages job that publishes index.html. Settings, under
About, gains one row that opens it in the phone's browser.
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.18'
OLD = '1.0.17'
DATE = '2026-11-12'
HERE = os.path.dirname(os.path.abspath(__file__))

NOTES = json.loads(io.open(os.path.join(HERE, 'notes-1018.json'), encoding='utf-8').read())

ABOUT_OLD = """              '<button class="listrow" data-apps="1" style="margin-top:10px"><span class="grow"><span class="lr-t">Other apps</span><span class="lr-s">FamTM, SideCut, MeasureT, My Hub and UJournal - the rest of the shelf.</span></span><span class="chev">\u203a</span></button>' +"""

ABOUT_NEW = ABOUT_OLD + """
              '<a class="listrow" href="https://anekthegreat.github.io/UNote/privacy.html" target="_blank" rel="noopener" style="margin-top:8px;text-decoration:none"><span class="grow"><span class="lr-t">Privacy policy</span><span class="lr-s">What stays on this phone, and the one request the app makes.</span></span><span class="chev">\u203a</span></a>' +"""


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


def updates():
    d = json.loads(read('updates.json'))
    if d.get('version') == V:
        return False
    d['version'] = V
    d['date'] = DATE
    d['notes'] = NOTES
    hist = [h for h in d.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': DATE, 'title': 'A privacy policy of its own, linked from Settings', 'notes': NOTES})
    d['history'] = hist
    write('updates.json', json.dumps(d, indent=2, ensure_ascii=False) + '\n')
    return True


def main():
    done = (read('src/app1.js').count("const VERSION = '%s';" % V) == 1
            and os.path.exists(path('privacy.html'))
            and 'privacy.html' in read('src/app3.js'))
    if done:
        print('already on the page')
        return 0
    if '--check' in sys.argv:
        print('not applied yet')
        return 1

    write('privacy.html', read('dev/privacy-1018.html.txt'))
    rep('src/app3.js', ABOUT_OLD, ABOUT_NEW, 'the About rows in Settings')
    rep('src/app1.js', "const VERSION = '%s';" % OLD, "const VERSION = '%s';" % V, 'the version')
    rep('sw.js', "CACHE = 'unote-v%s'" % OLD, "CACHE = 'unote-v%s'" % V, 'the worker cache')
    updates()
    print('UNote %s: privacy.html published, and one row in Settings that opens it' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
