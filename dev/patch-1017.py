#!/usr/bin/env python3
"""UNote 1.0.17 - handwriting, drawn on the note itself.

A note gains a Draw pane: a page you write on with a finger, a stylus or a mouse, in seven colours
and three widths, with an eraser, undo and redo. A stylus draws thicker where it presses harder,
and a hand resting on the screen is ignored while the pen is out.

The ink is part of the note - saved the same way the words are, sealed with a Vault note, carried
in a backup, and marked with a pen in the list.

    python3 dev/patch-1017.py          # apply
    python3 dev/patch-1017.py --check  # say whether the tree already carries 1.0.17

The drawing engine itself lives in dev/ink-1017.js.txt and is copied to src/app4.js, so the code
that runs is a file of its own rather than a Python string.
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.17'
OLD = '1.0.16'
DATE = '2026-11-12'

NOTES = json.loads(io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'notes-1017.json'), encoding='utf-8').read())


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


BUILD_OLD = "PARTS = [os.path.join(ROOT, 'src', 'app%d.js' % i) for i in (1, 2, 3)]"
BUILD_NEW = "PARTS = [os.path.join(ROOT, 'src', 'app%d.js' % i) for i in (1, 2, 3, 4)]"

MODES_OLD = """        <button data-mode="read">Read</button>"""
MODES_NEW = """        <button data-mode="read">Read</button>
        <button data-mode="draw">Draw</button>"""

PANES_OLD = """        <div id="pv" class="md"></div>
      </div>
    </section>"""
PANES_NEW = """        <div id="pv" class="md"></div>
      </div>
      <div id="inkwrap">
        <div id="inkbar">
          <button class="sw" data-inkc="ink" title="The note's own text colour" style="background:currentColor"></button>
          <button class="sw" data-inkc="#f5a524" title="Amber" style="background:#f5a524"></button>
          <button class="sw" data-inkc="#e5484d" title="Red" style="background:#e5484d"></button>
          <button class="sw" data-inkc="#12a594" title="Green" style="background:#12a594"></button>
          <button class="sw" data-inkc="#7c5cff" title="Violet" style="background:#7c5cff"></button>
          <button class="sw" data-inkc="#0091ff" title="Blue" style="background:#0091ff"></button>
          <button class="sw" data-inkc="#ffffff" title="White" style="background:#ffffff"></button>
          <span class="inksep"></span>
          <button class="wbtn" data-inkw="2" title="Thin"><i style="width:3px;height:3px"></i></button>
          <button class="wbtn" data-inkw="3" title="Medium"><i style="width:6px;height:6px"></i></button>
          <button class="wbtn" data-inkw="6" title="Thick"><i style="width:10px;height:10px"></i></button>
          <span class="grow"></span>
          <button class="btn" id="inkErase" title="Erase whole strokes">Eraser</button>
          <button class="btn" id="inkUndo" title="Undo the last stroke">Undo</button>
          <button class="btn" id="inkClear" title="Empty the page">Clear</button>
        </div>
        <canvas id="inkc"></canvas>
        <div class="inkhint">Write with a finger, a stylus or a mouse. A stylus draws thicker where you press harder, and a hand resting on the screen is ignored while the pen is out.</div>
      </div>
    </section>"""

CSS_OLD = """body[data-mode="read"] #panes{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr)}
"""
CSS_NEW = """body[data-mode="read"] #panes{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr)}
/* 1.0.17 - the Draw pane: a page under the title, the pens above it. */
#inkwrap{display:none;flex:1;flex-direction:column;gap:10px;min-height:0;padding-bottom:18px}
body[data-mode="draw"] #panes{display:none}
body[data-mode="draw"] #inkwrap{display:flex}
#inkbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
#inkbar .sw{width:26px;height:26px;border-radius:9px;border:1px solid var(--line2);padding:0;cursor:pointer}
#inkbar .sw.on{outline:2px solid var(--accent);outline-offset:2px}
#inkbar .wbtn{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;border:1px solid var(--line2);background:none;cursor:pointer}
#inkbar .wbtn i{display:block;border-radius:50%;background:currentColor}
#inkbar .wbtn.on{border-color:var(--accent);color:var(--accent)}
#inkbar .inksep{width:1px;height:22px;background:var(--line2);margin:0 3px}
#inkbar .btn.on{border-color:var(--accent);color:var(--accent)}
#inkbar .btn[disabled]{opacity:.4}
#inkc{flex:1;width:100%;min-height:220px;border:1px solid var(--line);border-radius:16px;background:var(--panel2);touch-action:none;cursor:crosshair;overscroll-behavior:contain}
.inkhint{font-size:11.5px;color:var(--dim2);line-height:1.5}
"""

VAULT_OLD = "JSON.stringify({ title: note.title, body: note.body, folder: note.folder, fav: !!note.fav })"
VAULT_NEW = "JSON.stringify({ title: note.title, body: note.body, folder: note.folder, fav: !!note.fav, ink: note.ink || null })"

PEND_OLD = """        created: note.created || note.updated, updated: note.updated, fav: !!note.fav,"""
PEND_NEW = """        created: note.created || note.updated, updated: note.updated, fav: !!note.fav,
        ink: note.ink || null,"""

META_OLD = """    tags.slice(0, 6).map(t => '<span class="pill">#' + esc(t) + '</span>').join('') +"""
META_NEW = """    (n.ink && n.ink.s && n.ink.s.length ? '<span class="pill acc">Handwriting</span>' : '') +
    tags.slice(0, 6).map(t => '<span class="pill">#' + esc(t) + '</span>').join('') +"""

DOC_END_OLD = """  $('#sWords').textContent = words(n.body) + ' words';
  renderRight();
}"""
DOC_END_NEW = """  $('#sWords').textContent = words(n.body) + ' words';
  renderRight();
  if (typeof inkSync === 'function') inkSync();
}"""

MODE_OLD = """  if (mode !== 'edit') showReading();      // switching to Read always renders the note"""
MODE_NEW = """  if (mode !== 'edit') showReading();      // switching to Read always renders the note
  if (mode === 'draw' && typeof inkSync === 'function') inkSync();"""

LIST_OLD = """        (n.fav ? '<span class="st">★</span>' : '') +"""
LIST_NEW = """        (n.fav ? '<span class="st">★</span>' : '') +
        (n.ink && n.ink.s && n.ink.s.length ? '<span class="st" title="Handwriting">✎</span>' : '') +"""

DEC_OLD = "out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: !!j.fav, created: r.created, updated: r.updated, deleted: 0 });"
DEC_NEW = "out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: !!j.fav, ink: j.ink || null, created: r.created, updated: r.updated, deleted: 0 });"

FLUSH_OLD = """      here.title = p.title || ''; here.body = p.body || ''; here.folder = p.folder || '';"""
FLUSH_NEW = """      here.title = p.title || ''; here.body = p.body || ''; here.folder = p.folder || '';
      here.ink = p.ink || null;"""

NEWV_OLD = """        id: id, vault: true, title: p.title || '', body: p.body || '', folder: p.folder || '', fav: !!p.fav,"""
NEWV_NEW = """        id: id, vault: true, title: p.title || '', body: p.body || '', folder: p.folder || '', fav: !!p.fav,
        ink: p.ink || null,"""


def updates():
    d = json.loads(read('updates.json'))
    if d.get('version') == V:
        return False
    d['version'] = V
    d['date'] = DATE
    d['notes'] = NOTES
    hist = [h for h in d.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': DATE, 'title': 'Handwriting: draw on a note with a pen or a stylus', 'notes': NOTES})
    d['history'] = hist
    write('updates.json', json.dumps(d, indent=2, ensure_ascii=False) + '\n')
    return True


def main():
    done = (read('src/app1.js').count("const VERSION = '%s';" % V) == 1
            and os.path.exists(path('src/app4.js'))
            and 'id="inkwrap"' in read('src/shell.html'))
    if done:
        print('already on the page')
        return 0
    if '--check' in sys.argv:
        print('not applied yet')
        return 1

    engine = read('dev/ink-1017.js.txt')
    write('src/app4.js', engine)

    rep('dev/build.py', BUILD_OLD, BUILD_NEW, 'the list of page parts')
    rep('src/shell.html', MODES_OLD, MODES_NEW, 'the mode buttons')
    rep('src/shell.html', PANES_OLD, PANES_NEW, 'the document panes')
    rep('src/shell.html', CSS_OLD, CSS_NEW, 'the pane styles')

    rep('src/app1.js', "const VERSION = '%s';" % OLD, "const VERSION = '%s';" % V, 'the version')
    rep('src/app1.js', VAULT_OLD, VAULT_NEW, 'what a Vault note seals')
    rep('src/app1.js', PEND_OLD, PEND_NEW, 'the holding pen for a locked Vault')

    rep('src/app2.js', META_OLD, META_NEW, 'the tag above the page')
    rep('src/app2.js', DOC_END_OLD, DOC_END_NEW, 'the end of renderDoc')
    rep('src/app2.js', MODE_OLD, MODE_NEW, 'setMode')
    rep('src/app2.js', LIST_OLD, LIST_NEW, 'the note list')

    rep('src/app3.js', DEC_OLD, DEC_NEW, 'what a Vault note gives back')
    rep('src/app3.js', FLUSH_OLD, FLUSH_NEW, 'the Vault holding pen')
    rep('src/app3.js', NEWV_OLD, NEWV_NEW, 'a note made from the holding pen')

    rep('sw.js', "CACHE = 'unote-v%s'" % OLD, "CACHE = 'unote-v%s'" % V, 'the worker cache')
    updates()
    print('UNote %s: the Draw pane, the pen, and the ink on the note' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
