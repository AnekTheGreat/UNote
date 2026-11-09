#!/usr/bin/env python3
"""UNote 1.0.15 - What's new opens once, and only for a version that is really newer.

    python3 dev/patch-1015.py          # apply
    python3 dev/patch-1015.py --check  # say whether the tree already carries 1.0.15

The sheet that says what changed opened by itself whenever the page's version merely differed from
the one recorded last time. Two ordinary things made that mean "on every launch":

  * a screen that went back to an earlier copy - the app serving the page it downloaded last time,
    then the page from the APK - differed in both directions, so each way round asked again;
  * a sheet still on screen when the app was closed counted as never read, because the mark was
    written when Done was tapped, not when the sheet appeared.

Now the mark is written as the sheet appears and it only ever moves forwards, so only a version
that is really newer opens it, and it opens once. The welcome is remembered the same way. The notes
themselves are still one tap away: What's new in the footer, and Patch notes in Settings.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.15'
DATE = '2026-11-09'
CODE = V.replace('.', '')

BOOT_OLD = """  if (S.settings.seen && S.settings.seen !== VERSION) setTimeout(() => patchNotesDialog(true), 1100);
  if (S.settings.seen !== VERSION) { S.settings.seen = VERSION; kvSet('settings', S.settings).catch(() => {}); }
"""

BOOT_NEW = """  /* 1.0.15 - once per version, and only for a version that is really newer. The old test asked
     whenever the page's version merely differed, so a screen that went back to an earlier copy
     asked again, and closing the app on the sheet without tapping Done asked again on the next
     launch. The mark is written as the sheet appears and it never moves backwards, so a copy that
     is already on this phone cannot bring the sheet back by itself. */
  const seenTop = (await kvGet('seenTop')) || S.settings.seen || '';
  if (!seenTop) {
    await kvSet('seenTop', VERSION).catch(() => {});
  } else if (cmpVer(VERSION, seenTop) > 0) {
    await kvSet('seenTop', VERSION).catch(() => {});
    setTimeout(() => patchNotesDialog(true), 1100);
  }
"""

ONBOARD_OLD = """async function onboard() {
  const d = dialog({
"""

ONBOARD_NEW = """async function onboard() {
  /* 1.0.15 - the welcome counts as met the moment it is on the screen, not when its button is
     pressed, so a phone put down on the welcome does not open on it again tomorrow. */
  S.settings.onboarded = true;
  kvSet('settings', S.settings).catch(() => {});
  const d = dialog({
"""

NOTES = [
    "What's new no longer opens by itself on every launch. It opens once, and only for a version "
    "that is really newer than the last one this phone showed you.",
    "Two everyday things used to bring it back: the app serving an older page than the one inside "
    "the APK, which made the version differ in both directions, and closing the app while the "
    "sheet was open, which counted as never having read it. The mark is written the moment the "
    "sheet appears, and it never moves backwards.",
    "The welcome screen is remembered the same way, so it cannot return for the same reason.",
    "The notes are still one tap away: What's new in the footer, and Patch notes in Settings.",
]

TITLE = "What's new stops coming back"


def path(p):
    return os.path.join(ROOT, p)


def read(p):
    return io.open(path(p), encoding='utf-8').read()


def write(p, s):
    io.open(path(p), 'w', encoding='utf-8').write(s)


def rep(p, old, new):
    s = read(p)
    n = s.count(old)
    if n != 1:
        sys.exit('%s: the text to replace appears %d times, expected once' % (p, n))
    write(p, s.replace(old, new))


def resub(p, pattern, repl):
    s = read(p)
    new, n = re.subn(pattern, repl, s)
    if n != 1:
        sys.exit('%s: pattern %r matched %d times, expected once' % (p, pattern, n))
    write(p, new)


def applied():
    return "const VERSION = '%s';" % V in read('src/app1.js')


def check():
    page = read('src/app3.js')
    data = json.loads(read('updates.json'))
    probes = [
        ("const VERSION = '%s';" % V in read('src/app1.js'), 'app1.js does not say %s' % V),
        ('unote-v%s' % V in read('sw.js'), 'sw.js does not cache %s' % V),
        ("def appVersion = '%s'" % V in read('android/app/build.gradle'),
         'build.gradle does not carry %s' % V),
        ('versionCode %s' % CODE in read('android/app/build.gradle'),
         'versionCode is not %s' % CODE),
        ("kvGet('seenTop')" in page, 'there is no marker that only moves forwards'),
        ('cmpVer(VERSION, seenTop) > 0' in page, 'an older page is not compared as older'),
        ('S.settings.seen !== VERSION' not in page, 'the old "merely different" test is still there'),
        ("S.settings.onboarded = true;\n  kvSet('settings', S.settings)" in page,
         'the welcome is still marked only when its button is pressed'),
        (data.get('version') == V, 'updates.json does not say %s' % V),
        (any(h.get('version') == V for h in data.get('history', [])),
         'updates.json has no history entry for %s' % V),
    ]
    bad = [why for ok, why in probes if not ok]
    if bad:
        sys.exit('; '.join(bad))


def main():
    check_only = '--check' in sys.argv

    if check_only:
        check()
        print('%s is on the page' % V)
        return 0

    if applied():
        check()
        print('already applied - nothing to do')
        return 0

    # ---- the sheet opens once, for a version that is really newer ------------
    rep('src/app3.js', BOOT_OLD, BOOT_NEW)

    # ---- and the welcome cannot come back either ----------------------------
    rep('src/app3.js', ONBOARD_OLD, ONBOARD_NEW)

    # ---- version ------------------------------------------------------------
    resub('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V)
    write('sw.js', re.sub(r'unote-v[0-9.]+', 'unote-v%s' % V, read('sw.js')))
    resub('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V)
    resub('android/app/build.gradle', r'versionCode \d+', 'versionCode %s' % CODE)

    data = json.loads(read('updates.json'))
    data['version'] = V
    data['date'] = DATE
    data['notes'] = NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': DATE, 'title': TITLE, 'notes': NOTES})
    data['history'] = hist
    write('updates.json', json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    check()
    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
