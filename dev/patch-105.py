#!/usr/bin/env python3
"""UNote 1.0.5 - liquid glass, and a shelf of the other apps.

    python3 dev/patch-105.py           apply the release
    python3 dev/patch-105.py --check   exit 1 if the release is not in place

Every step looks for what it is about to write first, so a second run changes
nothing and a half-applied tree is finished rather than doubled.
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = '1.0.5'
DATE = 'November 8, 2026'
TITLE = 'Liquid glass, and the rest of the shelf'
NOTES = [
    'Liquid glass: every panel, card and sheet is now a pane with a soft edge, a blur behind it and a line of light along the top, so the app reads as one surface instead of a stack of boxes.',
    'Other apps: a new list - FamTM, SideCut, MeasureT, My Hub and UJournal - each with one honest line about it and one tap to open it. It sits in the footer and in Settings.',
    'Calmer controls: rounder buttons, softer rows, a clearer accent, and the text size and accent colour you pick are still yours.',
    'A link in that list opens in the phone browser or the Play Store and comes back to the note you were on; the app itself still asks the network for nothing.',
]

GLASS_MARK = '/* ---- liquid glass ---- */'
GLASS_CSS = '''  /* ---- liquid glass ---- */
  /* Every surface is a pane: a little light along the top edge, a blur of what is behind it, and the
     same radius everywhere, so the shelf of panels reads as one piece of glass rather than five boxes. */
  #app{
    background:
      radial-gradient(58% 48% at 10% -4%,rgba(139,108,255,.30),transparent 62%),
      radial-gradient(52% 44% at 94% 6%,rgba(62,224,166,.15),transparent 60%),
      radial-gradient(70% 60% at 50% 112%,rgba(88,120,255,.20),transparent 66%),
      var(--bg);
  }
  #rail{background:rgba(255,255,255,.045);border-right:1px solid var(--glass-line);backdrop-filter:blur(22px) saturate(150%)}
  #side,#right{background:var(--glass);border-color:var(--glass-line);backdrop-filter:blur(24px) saturate(155%)}
  #main{background:transparent}
  .rbtn{border-radius:14px}
  .rbtn.on{background:linear-gradient(180deg,rgba(139,108,255,.30),rgba(139,108,255,.14));box-shadow:inset 0 1px 0 rgba(255,255,255,.20)}
  .quick button,.btn,.listrow,.setsec,.pinpad button,.seg button,.modes,.navrow,.noteitem,.folderrow,.tagchip,.palitem{
    backdrop-filter:blur(14px) saturate(140%);
  }
  .btn,.listrow,.setsec,.pinpad button,.quick button{
    background:var(--panel2);border-color:var(--glass-line);
    box-shadow:inset 0 1px 0 var(--glass-hi),0 8px 22px rgba(0,0,0,.16);
  }
  .btn{border-radius:12px;padding:10px 15px}
  .btn:hover{background:rgba(255,255,255,.10);border-color:var(--accent);color:var(--accent)}
  .btn.primary{background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 76%,#000));border-color:var(--accent);color:#fff;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 10px 24px color-mix(in srgb,var(--accent) 32%,transparent)}
  .btn.primary:hover{filter:brightness(1.07);color:#fff}
  .btn.danger{background:rgba(255,128,128,.10);border-color:rgba(255,128,128,.38);color:var(--err);box-shadow:none}
  .btn.ghost{background:none;border-color:transparent;box-shadow:none}
  .listrow{border-radius:16px;margin-bottom:9px}
  .listrow:hover{background:rgba(255,255,255,.09);border-color:var(--accent)}
  .setsec{border-radius:18px}
  .tagchip{border-radius:20px}
  #dlg{
    background:color-mix(in srgb,var(--panel) 88%,transparent);
    border:1px solid var(--glass-line);border-radius:22px;
    backdrop-filter:blur(30px) saturate(160%);
    box-shadow:0 34px 80px rgba(0,0,0,.60),inset 0 1px 0 var(--glass-hi);
  }
  #dlg::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
    background:linear-gradient(155deg,rgba(255,255,255,.11),rgba(255,255,255,0) 44%)}
  #dlgBody{position:relative}
  #scrim{background:rgba(6,8,14,.55);backdrop-filter:blur(10px) saturate(120%)}
  .dlghead,.dlgfoot{border-color:var(--glass-line)}
  .dlgfoot{background:rgba(255,255,255,.045)}
  #toast{background-color:color-mix(in srgb,var(--panel) 90%,transparent);border-color:var(--glass-line);border-radius:16px;
    backdrop-filter:blur(18px) saturate(150%);box-shadow:0 18px 40px rgba(0,0,0,.42),inset 0 1px 0 var(--glass-hi)}
  .sidefoot{border-color:var(--glass-line)}
  .field input,.field select,.field textarea{background:rgba(255,255,255,.05);border-color:var(--glass-line);border-radius:12px}
  [data-theme="light"] .field input,[data-theme="light"] .field select,[data-theme="light"] .field textarea,
  [data-theme="light"] .btn,[data-theme="light"] .listrow,[data-theme="light"] .setsec{background:rgba(255,255,255,.78)}
  [data-theme="light"] #dlg{background:rgba(255,255,255,.82)}
  .md code,.md pre,.md th{background:var(--panel2)}
  /* the shelf itself: one card per app, a tile, a line, one door */
  .appcard{display:flex;align-items:center;gap:12px;padding:12px 13px;margin-bottom:9px;border-radius:18px;
    border:1px solid var(--glass-line);background:var(--panel2);
    box-shadow:inset 0 1px 0 var(--glass-hi),0 10px 26px rgba(0,0,0,.16);backdrop-filter:blur(14px) saturate(140%)}
  .appcard .tile{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;flex:none;
    font-weight:700;font-size:16px;color:#fff;background:linear-gradient(160deg,var(--accent),#4b34c9);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.36),0 8px 18px rgba(76,52,201,.32)}
  .appcard .grow{flex:1;min-width:0}
  .appcard b{display:block;font-size:13.5px;font-weight:650}
  .appcard small{display:block;font-size:11.5px;color:var(--dim2);line-height:1.4;margin-top:2px}
  .appcard .go{flex:none;text-decoration:none;border:1px solid var(--glass-line);border-radius:12px;padding:8px 13px;
    font-size:12.5px;font-weight:600;color:var(--ink);background:rgba(255,255,255,.07);box-shadow:inset 0 1px 0 var(--glass-hi)}
  .appcard .go:hover{border-color:var(--accent);color:var(--accent)}
'''

ROOT_VARS = '''  :root{
    --accent:#8b6cff; --accent-soft:rgba(139,108,255,.18); --accent-ink:#fff;
    --bg:#0b0d14; --panel:rgba(26,31,45,.62); --panel2:rgba(255,255,255,.06); --panel3:rgba(255,255,255,.10);
    --glass:rgba(255,255,255,.055); --glass-line:rgba(255,255,255,.10); --glass-hi:rgba(255,255,255,.20);
    --line:rgba(255,255,255,.09); --line2:rgba(255,255,255,.17);
    --ink:#eef1f8; --dim:#a8b1c7; --dim2:#7d869b;
    --ok:#3ee0a6; --warn:#ffc857; --err:#ff8080;
    --r:18px; --r-sm:13px; --shadow:0 28px 64px rgba(0,0,0,.55);
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --size:16px;
  }'''

LIGHT_VARS = '''  [data-theme="light"]{
    --bg:#eef1f9; --panel:rgba(255,255,255,.72); --panel2:rgba(255,255,255,.66); --panel3:rgba(255,255,255,.55);
    --glass:rgba(255,255,255,.62); --glass-line:rgba(18,24,42,.10); --glass-hi:rgba(255,255,255,.95);
    --line:rgba(18,24,42,.10); --line2:rgba(18,24,42,.17);
    --ink:#151922; --dim:#525b6e; --dim2:#7d8597;
    --accent-soft:rgba(124,92,255,.12);
    --shadow:0 24px 52px rgba(28,34,54,.18);
  }'''

OTHER_JS = '''/* ---------------- the other apps ---------------- */
/* One page that says what else this person made, with a single door per app. Every link leaves for the
   phone's own browser or the Play Store: the app holds no network of its own, so a link that opened
   inside it would be a blank screen, and this way the note you were reading is still behind you. */
const OTHER_APPS = [
  ['FamTM', 'The family tree in your pocket: people, birthdays and photos, kept on the phone.', 'https://play.google.com/store/apps/details?id=com.FamTM.app', 'F'],
  ['SideCut', 'A music player with its own equaliser and its own way of filing a library.', 'https://play.google.com/store/apps/details?id=com.SideCut.myapp', 'S'],
  ['MeasureT', 'Elevation, location, a level and a converter, all on one screen.', 'https://play.google.com/store/apps/details?id=com.CompassEDC.myapp', 'M'],
  ['My Hub', 'One screen that launches these apps and holds the update for each in one place.', 'https://github.com/AnekTheGreat/My-Hub/releases', 'H'],
  ['UJournal', 'A journal for the days you bother to write down, from the same hand as the tree.', 'https://github.com/AnekTheGreat/Journal', 'J'],
];
function otherAppsDialog() {
  const d = dialog({
    cls: 'wide',
    title: 'Other apps',
    body: '<div class="hint" style="margin:0 0 12px">Made by the same person who made UNote. Not one of them asks you to sign in, and none of them is watching.</div>' +
      OTHER_APPS.map(a =>
        '<div class="appcard"><div class="tile">' + esc(a[3] || a[0].charAt(0)) + '</div>' +
        '<span class="grow"><b>' + esc(a[0]) + '</b><small>' + esc(a[1]) + '</small></span>' +
        '<a class="go" href="' + esc(a[2]) + '" target="_blank" rel="noopener">Open</a></div>').join('') +
      '<div class="hint" style="margin:12px 0 0">A tap leaves for the browser or the Play Store and comes back to this note.</div>',
    foot: '<div class="grow"></div><button class="btn primary" data-close="1">Done</button>',
  });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', closeDialog));
}
/* Two doors, one listener: the footer button and the row in Settings both carry data-apps, so either one
   opens the same sheet and an older page with neither simply has no button to press. */
document.addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target.closest('[data-apps]') : null;
  if (!t) return;
  e.preventDefault();
  otherAppsDialog();
});

'''

SETTINGS_ROW = ('        \'<button class="listrow" data-apps="1" style="margin-top:10px"><span class="grow">'
                '<span class="lr-t">Other apps</span><span class="lr-s">FamTM, SideCut, MeasureT, My Hub and UJournal - the rest of the shelf.</span>'
                '</span><span class="chev">\u203a</span></button>\' +\n')

FOOTER_BTN = ('      <button class="btn" data-apps="1" title="The other apps made alongside this one" '
              'style="padding:4px 10px;font-size:11px">Apps</button>\n')

JAVA_OVERRIDE_BODY = [
    'public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {',
    '    Uri u = request.getUrl();',
    '    String host = (u == null || u.getHost() == null) ? "" : u.getHost();',
    '    if (host.equals("appassets.androidplatform.net")) {',
    '        return false;                       // the page itself stays in the app',
    '    }',
    '    try {                                   // anything else belongs to the phone',
    '        startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));',
    '    } catch (Exception ignored) {',
    '        // no browser and no store: the tap does nothing rather than breaking the page',
    '    }',
    '    return true;',
    '}',
]


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding='utf-8').read()


def write(rel, text):
    io.open(os.path.join(ROOT, rel), 'w', encoding='utf-8', newline='').write(text)


def block(text, opener, replacement):
    """Replace the CSS block that starts with `opener` and ends at its matching brace."""
    i = text.find(opener)
    if i < 0:
        raise SystemExit('could not find ' + opener)
    depth, j = 0, i
    while j < len(text):
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[:i] + replacement + text[j + 1:]


def java_with_links(java):
    """Let a link in the page leave for the phone's browser instead of loading a blank screen."""
    if 'shouldOverrideUrlLoading' in java:
        return java
    java = java.replace('import android.annotation.SuppressLint;',
                        'import android.annotation.SuppressLint;\nimport android.content.Intent;\nimport android.net.Uri;', 1)
    lines = java.split('\n')
    hit = [i for i, l in enumerate(lines) if 'loader.shouldInterceptRequest' in l]
    if not hit:
        raise SystemExit('the asset loader is not where it was')
    i = hit[0]
    close = i + 1
    while lines[close].strip() != '}':
        close += 1
    above = close - 1
    while '@Override' not in lines[above] and above > i:
        above -= 1
    base = ' ' * (len(lines[above]) - len(lines[above].lstrip()))
    add = [base + '@Override'] + [base + b for b in JAVA_OVERRIDE_BODY]
    return '\n'.join(lines[:close + 1] + add + lines[close + 1:])


def changes():
    """Everything this release does, so --check and apply cannot drift apart."""
    shell = read('src/shell.html')
    if GLASS_MARK not in shell:
        shell = block(shell, ':root{', ROOT_VARS)
        shell = block(shell, '[data-theme="light"]{', LIGHT_VARS)
        shell = shell.replace('</style>', GLASS_CSS + '</style>', 1)
    if 'data-apps' not in shell:
        i = shell.find('id="btnWhats"')
        if i < 0:
            raise SystemExit('the footer has no What\'s new button to sit beside')
        j = shell.find('\n', shell.find('</button>', i)) + 1
        shell = shell[:j] + FOOTER_BTN + shell[j:]
    yield 'src/shell.html', shell

    app1 = read('src/app1.js')
    app1 = re.sub(r"(const VERSION\s*=\s*')[0-9.]+(')", r'\g<1>' + NEW + r'\g<2>', app1, count=1)
    yield 'src/app1.js', app1

    app3 = read('src/app3.js')
    if 'otherAppsDialog' not in app3:
        anchor = 'function patchNotesDialog('
        if anchor not in app3:
            raise SystemExit('no patchNotesDialog to put the shelf above')
        app3 = app3.replace(anchor, OTHER_JS + anchor, 1)
    if 'data-apps="1"' not in app3:
        needle = "'<div class=\"hint\" style=\"margin:0\">Version '"
        if needle not in app3:
            raise SystemExit('the About section of Settings is not where it was')
        app3 = app3.replace(needle, SETTINGS_ROW + '        ' + needle, 1)
    yield 'src/app3.js', app3

    yield ('android/app/src/main/java/app/unote/MainActivity.java',
           java_with_links(read('android/app/src/main/java/app/unote/MainActivity.java')))

    gradle = read('android/app/build.gradle')
    major, minor, patch = (int(x) for x in NEW.split('.'))
    gradle = re.sub(r'versionCode\s+\d+', 'versionCode %d' % (major * 1000 + minor * 100 + patch), gradle, count=1)
    gradle = re.sub(r"(appVersion\s*=\s*')[\d.]+(')", r'\g<1>' + NEW + r'\g<2>', gradle, count=1)
    yield 'android/app/build.gradle', gradle

    sw = read('sw.js')
    sw = re.sub(r"(CACHE\s*=\s*')unote-v[\d.]+(')", r'\g<1>unote-v' + NEW + r'\g<2>', sw, count=1)
    yield 'sw.js', sw

    notes = json.loads(read('updates.json'))
    notes['version'] = NEW
    notes['date'] = DATE
    notes['notes'] = NOTES
    hist = [h for h in notes.get('history', []) if h.get('version') != NEW]
    hist.insert(0, {'version': NEW, 'date': DATE, 'title': TITLE, 'notes': NOTES})
    notes['history'] = hist
    yield 'updates.json', json.dumps(notes, indent=2, ensure_ascii=False) + '\n'


def main():
    want = list(changes())
    if '--check' in sys.argv:
        bad = [rel for rel, text in want
               if io.open(os.path.join(ROOT, rel), encoding='utf-8').read().replace('\r\n', '\n') != text.replace('\r\n', '\n')]
        if not bad:
            print('%s is in place' % NEW)
            return 0
        print('not applied yet: ' + ', '.join(bad))
        return 1
    for rel, text in want:
        write(rel, text)
        print('wrote ' + rel)
    print('%s applied' % NEW)
    return 0


if __name__ == '__main__':
    sys.exit(main())
