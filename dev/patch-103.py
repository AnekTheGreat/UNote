#!/usr/bin/env python3
"""1.0.3: patch notes, and a what's-new sheet that opens after an update.

The page gains a Patch notes button in the footer and a row in Settings, a sheet
that lists every version newest first, and - the part that matters after an OTA
update - it opens by itself the first time the app runs a version it has not run
before. updates.json carries the history, so the notes travel with the build.

The icon and the Android manifest arrive as files in the same release; this
payload only touches the page.
"""
import io
import json
import re
import subprocess
import sys

V = '1.0.3'
PREV = '1.0.2'

HISTORY = [
    {
        'version': '1.0.3',
        'date': 'November 8, 2026',
        'title': 'Patch notes, and an icon with some thought in it',
        'notes': [
            'Patch notes: a What\'s new button sits in the footer, and Settings has a row for it. Every version is listed, newest first.',
            'After an over-the-air update the sheet opens once by itself, so a new version says what changed instead of just being newer.',
            'A new launcher icon: a note card with a folded corner on a violet field, with an adaptive, a round and a themed version for Android.',
        ],
    },
    {
        'version': '1.0.2',
        'date': 'November 7, 2026',
        'title': 'The line above the note keeps up',
        'notes': [
            'The title line above a note follows the title, the word count and the reading time as you type.',
        ],
    },
    {
        'version': '1.0.1',
        'date': 'November 7, 2026',
        'title': 'Creating the Vault is one form',
        'notes': [
            'Creating the Vault is one form: type the PIN, type it again, done, instead of two dialogs in a row that could lose the second half.',
        ],
    },
    {
        'version': '1.0.0',
        'date': 'November 7, 2026',
        'title': 'The first release',
        'notes': [
            'Notes with markdown, folders, tags, [[links]] with backlinks, a graph, and search on Ctrl+K.',
            'A Vault behind a PIN you choose, encrypted on the device, that locks itself and can change its PIN.',
            'Export everything to one file, carry it as a code, import it back.',
            'Offline first, and it can be installed to a home screen.',
        ],
    },
]

WHATS_ROW = ("      '<button class=\"listrow\" data-whatsnew=\"1\" style=\"margin-top:8px\">"
             "<span class=\"grow\"><span class=\"lr-t\">Patch notes</span>"
             "<span class=\"lr-s\">What changed in every version, this one first.</span></span>"
             "<span class=\"chev\">\\u203a</span></button>' +\n")

FOOT_BUTTON = ('      <button class="btn" id="btnWhats" title="What changed in each version" '
               'style="padding:4px 10px;font-size:11px">What\'s new</button>\n')

NOTES_FN = r'''function patchNotesDialog(justUpdated) {
  const d = dialog({
    cls: 'wide',
    title: justUpdated ? 'What\'s new in ' + VERSION : 'Patch notes',
    body: '<div id="pnBody"><div class="hint">Reading the notes…</div></div>',
    foot: '<div class="grow"></div><button class="btn primary" data-close="1">Done</button>',
  });
  const body = $('#pnBody', d);
  fetch('updates.json?t=' + nowMs())
    .then(r => { if (!r.ok) throw new Error('no notes'); return r.json(); })
    .then(data => {
      const hist = (data.history || []).slice().sort((a, b) => cmpVer(b.version, a.version));
      if (!hist.length) throw new Error('no notes');
      body.innerHTML = hist.map(h => {
        const here = h.version === VERSION;
        return '<div class="setsec">' +
          '<h4>' + esc(h.version) + (here ? ' <span class="pill acc" style="font-size:10px">you are here</span>' : '') + '</h4>' +
          '<div class="sub">' + esc(h.title || '') + (h.date ? ' · ' + esc(h.date) : '') + '</div>' +
          '<ul style="margin:8px 0 0 18px;padding:0">' +
          (h.notes || []).map(n => '<li style="margin:5px 0;font-size:13px;line-height:1.45">' + esc(n) + '</li>').join('') +
          '</ul></div>';
      }).join('');
    })
    .catch(() => { body.innerHTML = '<div class="hint">The notes could not be read right now. They live in updates.json next to the app.</div>'; });
}

function settingsDialog() {'''

def read(p):
    return io.open(p, encoding='utf-8').read()


def write(p, s):
    io.open(p, 'w', encoding='utf-8').write(s)


def applied():
    try:
        return "const VERSION = '%s';" % V in read('src/app1.js') and 'id="btnWhats"' in read('src/shell.html')
    except IOError:
        return False


if applied():
    print('%s is already on the page - nothing to do' % V)
    sys.exit(0)
if '--check' in sys.argv:
    print('%s is not on the page yet' % V)
    sys.exit(1)

# 1. the version, in the page and in the service worker's cache name
a1 = read('src/app1.js')
if a1.count("const VERSION = '%s';" % PREV) != 1:
    sys.exit('app1.js is not on %s' % PREV)
write('src/app1.js', a1.replace("const VERSION = '%s';" % PREV, "const VERSION = '%s';" % V))

sw = read('sw.js')
if 'unote-v%s' % PREV not in sw:
    sys.exit('sw.js does not carry the %s cache' % PREV)
write('sw.js', sw.replace('unote-v%s' % PREV, 'unote-v%s' % V))

# 2. the notes, with their history, so every update can say what changed
upd = {
    'app': 'UNote',
    'version': V,
    'date': 'November 8, 2026',
    'notes': HISTORY[0]['notes'],
    'history': HISTORY,
}
write('updates.json', json.dumps(upd, indent=2, ensure_ascii=False) + '\n')

# 3. the button in the footer
shell = read('src/shell.html')
anchor = '      <button id="updChip" hidden></button>\n'
if shell.count(anchor) != 1:
    sys.exit('the footer is not where it was')
write('src/shell.html', shell.replace(anchor, FOOT_BUTTON + anchor, 1))

# 4. the sheet, the button's wiring, and the notes opening after an update
a3 = read('src/app3.js')
if 'function settingsDialog() {' in a3:
    a3 = a3.replace('function settingsDialog() {', NOTES_FN, 1)
else:
    sys.exit('settingsDialog is not where it was')

lines = a3.split('\n')
out = []
placed_row = False
for line in lines:
    out.append(line)
    if not placed_row and 'id="setCheck"' in line and line.rstrip().endswith('+'):
        out.append(WHATS_ROW.rstrip('\n'))
        placed_row = True
if not placed_row:
    sys.exit('the updates row in Settings is not where it was')
a3 = '\n'.join(out)

boot_anchor = '  setTimeout(() => checkUpdate(false), 1200);'
if a3.count(boot_anchor) != 1:
    sys.exit('the boot update check is not where it was')
boot_add = (
    "  document.addEventListener('click', e => {\n"
    "    const b = e.target.closest('#btnWhats, [data-whatsnew]');\n"
    "    if (b) { e.preventDefault(); e.stopPropagation(); patchNotesDialog(false); }\n"
    "  });\n"
    "  if (S.settings.seen && S.settings.seen !== VERSION) setTimeout(() => patchNotesDialog(true), 1100);\n"
    "  if (S.settings.seen !== VERSION) { S.settings.seen = VERSION; kvSet('settings', S.settings).catch(() => {}); }\n"
)
a3 = a3.replace(boot_anchor, boot_add + boot_anchor, 1)
write('src/app3.js', a3)

# 5. the APK carries the same number, so an installed copy offers the update
g = read('android/app/build.gradle')
parts = V.split('.')
code = 1000 + int(parts[1]) * 100 + int(parts[2])
if ("def appVersion = '%s'" % PREV) not in g:
    sys.exit('build.gradle is not on %s' % PREV)
g = g.replace("def appVersion = '%s'" % PREV, "def appVersion = '%s'" % V, 1)
g = re.sub(r'versionCode \d+', 'versionCode %d' % code, g, count=1)
write('android/app/build.gradle', g)

# 7. the page itself
subprocess.check_call(['python3', 'dev/build.py'])
print('1.0.3 written: patch notes, the what\'s-new sheet, and the number')
