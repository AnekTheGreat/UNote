#!/usr/bin/env python3
"""UNote 1.0.12 - the update check actually tries, and says what happened.

    python3 dev/patch-1012.py          # apply
    python3 dev/patch-1012.py --check  # say whether the tree already carries 1.0.12

1.0.11 gave the installed app a way to fetch a newer page, but it asked once - 1.2 seconds after
the app opened - and if that one attempt failed (the radio still waking, no signal yet, the app
opened offline) it never tried again, and it said nothing. From the outside that is identical to
"it is not working".

Now: it tries at 1.2s, again at 6s and again at 20s until one attempt gets through, and it checks
again every time the app comes back to the front. When it reaches the site and there is nothing
newer, the chip shows "Up to date" for a few seconds, so success is visible instead of silent.
Settings' Updates section reports the last attempt in words: when, whether it got through, and
which version the site is offering - or the reason it did not. A failed check says so rather than
looking like a hung app.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.12'


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
        raise SystemExit('%s: could not find the block to replace (%r)' % (rel, pattern[:60]))
    write(rel, new)


UPDATE_JS = r'''/* ---------------- updates (over the air) ---------------- */

/* The browser copy updates through its service worker. The installed app has no service worker
   and no download manager, so it asks this site for the update file and keeps the newest page
   it finds in the app's own storage; MainActivity serves that copy instead of the one built
   into the APK. */
const OTA_HOME = 'https://anekthegreat.github.io/UNote/';

/* What the last attempt did, so Settings can say it in words instead of guessing. */
let otaState = { at: 0, ok: false, site: '', note: '', tries: 0 };

function cmpVer(a, b) {
  const x = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function otaBase() {
  const nf = nativeFiles();
  return (nf && typeof nf.savePage === 'function') ? OTA_HOME : '';
}

function otaSummary() {
  if (!otaState.at) return 'Not checked yet in this session.';
  const when = new Date(otaState.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!otaState.ok) {
    return 'Last try at ' + when + ' did not get through (' + otaState.note + '). It tries again by itself, and whenever you reopen the app.';
  }
  const newer = cmpVer(otaState.site, VERSION) > 0;
  return 'Last check at ' + when + ': reached the site, which offers ' + (otaState.site || VERSION) +
    (newer ? ' - newer than this one.' : ' - so this is the newest.');
}

/* A quiet "Up to date" for a few seconds: proof the check ran, without a pop-up. */
function flashUpToDate() {
  const chip = $('#updChip');
  if (!chip || !chip.hidden) return;
  chip.hidden = false;
  chip.textContent = 'Up to date \u00b7 ' + VERSION;
  setTimeout(() => {
    if (chip.textContent.indexOf('Up to date') === 0) {
      chip.hidden = true;
      chip.textContent = '';
    }
  }, 5000);
}

async function checkUpdate(manual) {
  try {
    const r = await fetch(otaBase() + 'updates.json?t=' + nowMs(), { cache: 'no-store' });
    if (!r.ok) throw new Error('the server answered ' + r.status);
    const j = await r.json();
    otaState = { at: Date.now(), ok: true, site: j.version || '', note: '', tries: otaState.tries + 1 };
    if (cmpVer(j.version, VERSION) > 0) {
      const chip = $('#updChip');
      chip.hidden = false;
      chip.textContent = 'Update ' + j.version + ' ready';
      chip.onclick = () => applyUpdate(j);
      if (manual) toast('Version ' + j.version + ' is ready. Tap the chip to take it.', 4200);
      return 'Version ' + j.version + ' is ready. Tap the chip at the bottom to take it.';
    }
    const chip = $('#updChip');
    chip.hidden = true;
    chip.textContent = '';
    if (otaBase()) flashUpToDate();   // in the installed app only: visible proof the check ran
    return 'You are on the newest version (' + VERSION + '), and the site agrees (' + j.version + ').';
  } catch (e) {
    otaState = { at: Date.now(), ok: false, site: '', note: e.message || 'no answer', tries: otaState.tries + 1 };
    if (manual) toast('Could not check for updates: ' + (e.message || 'no answer'), 4600);
    return 'Could not check for updates: ' + (e.message || 'no answer');
  }
}

/* The boot check could not be one silent attempt: on a real phone the first second after launch
   is often too early for the network. Try again a few times, then again whenever the app comes
   back to the front. */
function watchForUpdates() {
  const delays = [1200, 6000, 20000];
  const attempt = i => {
    if (i >= delays.length) return;
    setTimeout(async () => {
      if (otaState.ok) return;
      await checkUpdate(false);
      if (!otaState.ok) attempt(i + 1);
    }, delays[i]);
  };
  attempt(0);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkUpdate(false);
  });
}

async function applyUpdate(j) {
  const want = (j && j.version) ? j.version : 'the newest version';
  const nf = nativeFiles();
  if (nf && typeof nf.savePage === 'function') {
    toast('Fetching ' + want + '...', 3000);
    try {
      const r = await fetch(OTA_HOME + 'index.html?t=' + nowMs(), { cache: 'no-store' });
      if (!r.ok) throw new Error('the page did not come back (' + r.status + ')');
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

UPDATES_NOTES = [
    'The update check tries again instead of giving up. It used to ask once, a second after the '
    'app opened - often before the phone had a signal - and say nothing if that failed.',
    'It now retries a few times, and checks again every time you come back to the app.',
    'When there is nothing newer, a quiet "Up to date" shows for a few seconds, so you can see '
    'the check ran instead of hoping it did.',
    'Settings reports the last check in words: the time, whether it got through, which version '
    'the site offers - or why it did not get through.',
]


def applied():
    try:
        app3 = read('src/app3.js')
        app1 = read('src/app1.js')
    except IOError:
        return False
    return ('watchForUpdates' in app3 and 'otaSummary' in app3 and
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

    cut('src/app3.js', r"/\* -+ updates \(over the air\) -+ \*/.*?\n/\* -+ small dialogs",
        UPDATE_JS + '/* ---------------- small dialogs')

    cut('src/app3.js', r"setTimeout\(\(\) => checkUpdate\(false\), 1200\);", 'watchForUpdates();', flags=0)

    cut('src/app3.js',
        r"'<div id=\"setUpdMsg\" class=\"hint\" style=\"margin:8px 0 0\">Last checked when this screen opened\.</div>'",
        "'<div id=\"setUpdMsg\" class=\"hint\" style=\"margin:8px 0 0\">' + otaSummary() + '</div>'",
        flags=0)

    cut('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V, flags=0)
    cut('sw.js', r'unote-v[0-9.]+', 'unote-v%s' % V, flags=0)
    cut('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V, flags=0)
    cut('android/app/build.gradle', r'versionCode \d+', 'versionCode 1012', flags=0)

    data = json.load(io.open(path('updates.json'), encoding='utf-8'))
    data['version'] = V
    data['date'] = '2026-11-08'
    data['notes'] = UPDATES_NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {
        'version': V,
        'date': '2026-11-08',
        'title': 'The update check tries, and says what it did',
        'notes': UPDATES_NOTES,
    })
    data['history'] = hist
    io.open(path('updates.json'), 'w', encoding='utf-8').write(
        json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
