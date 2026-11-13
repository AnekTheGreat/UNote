'use strict';
/* UNote - part 4: handwriting. A note carries ink beside its text: strokes drawn with a finger, a
   stylus or a mouse, kept on the note and saved the way the words are, so a Vault note's ink is
   sealed with it and a backup carries it. */

const INK_COLOURS = ['ink', '#f5a524', '#e5484d', '#12a594', '#7c5cff', '#0091ff', '#ffffff'];
const INK = {
  c: 'ink',          // 'ink' follows the theme's own text colour, so a note is readable in both
  w: 3,              // pen width, in page units (before the page is scaled to the screen)
  er: false,         // eraser on
  down: false,
  cur: null,         // the stroke being drawn
  penAt: 0,          // when the stylus was last seen, so a palm can be told from a finger
  redo: [],
  wired: false,
  seg: 0,            // how much of the live stroke has been resampled and drawn already
};

function inkCanvas() { return document.getElementById('inkc'); }

/* A note's ink is { v, w: <page width it was drawn on>, s: [stroke] }; a stroke is
   { c: colour, w: width, p: [x, y, ...], q: [pressure, ...] } in page units, so a drawing looks the
   same on a phone and on a wide screen. */
function inkData(n) {
  if (!n) return null;
  if (!n.ink || typeof n.ink !== 'object' || !Array.isArray(n.ink.s)) n.ink = { v: 1, w: 0, s: [] };
  if (!n.ink.w) n.ink.w = 0;
  return n.ink;
}

function inkColour(stroke, cv, ink) {
  if (!stroke.c || stroke.c === 'ink') {
    if (ink) return ink;                       /* a picture is painted off-screen, where the page's
                                                  own colour cannot be asked for */
    try { return getComputedStyle(cv).color || '#111'; } catch (e) { return '#111'; }
  }
  return stroke.c;
}

/* 1.0.25 - a stroke used to be a run of straight pieces between the points the pen reported, and
   the line changed width in steps wherever the pressure did. The points are now read as the curve
   they describe: Catmull-Rom through them, sampled about every page unit, with the width eased from
   one sample to the next. A fast line curls instead of cornering, and a pressed line thickens
   smoothly. Nothing about how a stroke is stored has changed, so old drawings look better too. */
const INK_STEP = 1.4;                 // page units between drawn samples
const inkWeight = p => (isFinite(p) ? 0.55 + 0.85 * clamp(p, 0, 1) : 1);

function inkRawPoints(stroke) {
  const p = stroke && stroke.p, q = stroke && stroke.q;
  if (!p) return [];
  const out = [];
  for (let i = 0; i < p.length; i += 2) out.push({ x: p[i], y: p[i + 1], p: q ? Number(q[i / 2]) : NaN });
  return out;
}

/* One piece of the curve, from raw[i] to raw[i+1], close enough together that a straight line
   between two samples cannot be seen. */
function inkSegment(raw, i, out) {
  const p0 = raw[i - 1] || raw[i], p1 = raw[i], p2 = raw[i + 1], p3 = raw[i + 2] || raw[i + 1];
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const n = Math.max(1, Math.min(40, Math.ceil(d / INK_STEP)));
  for (let k = 1; k <= n; k++) {
    const t = k / n, t2 = t * t, t3 = t2 * t;
    out.push({
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      p: isFinite(p1.p) ? (isFinite(p2.p) ? p1.p + (p2.p - p1.p) * t : p1.p) : p2.p,
    });
  }
  return out;
}

function inkPaintPoints(g, stroke, sc, pts, ink) {
  const base = Math.max(0.6, (stroke.w || 3) * sc);
  g.strokeStyle = inkColour(stroke, g.canvas, ink);
  g.fillStyle = g.strokeStyle;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (pts.length === 1) {
    g.beginPath();
    g.arc(pts[0].x * sc, pts[0].y * sc, Math.max(0.7, base * inkWeight(pts[0].p) / 2), 0, Math.PI * 2);
    g.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    g.lineWidth = base * (inkWeight(a.p) + inkWeight(b.p)) / 2;
    g.beginPath();
    g.moveTo(a.x * sc, a.y * sc);
    g.lineTo(b.x * sc, b.y * sc);
    g.stroke();
  }
}

function inkDrawStroke(g, stroke, sc, ink) {
  const raw = inkRawPoints(stroke);
  if (!raw.length) return;
  if (raw.length < 2) { inkPaintPoints(g, stroke, sc, raw, ink); return; }
  const pts = [{ x: raw[0].x, y: raw[0].y, p: raw[0].p }];
  for (let i = 0; i < raw.length - 1; i++) inkSegment(raw, i, pts);
  inkPaintPoints(g, stroke, sc, pts, ink);
}

/* While the pen is moving only the new piece is resampled and drawn, so the screen keeps up with a
   fast hand and the finished stroke looks the same as the one being drawn. */
function inkDrawTail(g, stroke, sc) {
  const raw = inkRawPoints(stroke);
  while (INK.seg < raw.length - 1) {
    const pts = inkSegment(raw, INK.seg, [{ x: raw[INK.seg].x, y: raw[INK.seg].y, p: raw[INK.seg].p }]);
    inkPaintPoints(g, stroke, sc, pts);
    INK.seg++;
  }
}

function inkPaintAll() {
  const cv = inkCanvas();
  if (!cv) return;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;                       // the pane is not on screen yet
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const d = inkData(S.current);
  if (!d) return;
  const sc = d.w ? w / d.w : 1;
  for (const st of d.s) inkDrawStroke(g, st, sc);
}

/* Repainted rather than stretched: the canvas is only ever as large as the pane it sits in. */
function inkSync() {
  inkWire();
  inkBarState();
  requestAnimationFrame(inkPaintAll);
}

function inkBarState() {
  const d = S.current ? inkData(S.current) : null;
  $$('#inkbar .sw').forEach(b => b.classList.toggle('on', b.dataset.inkc === INK.c));
  $$('#inkbar .wbtn').forEach(b => b.classList.toggle('on', Number(b.dataset.inkw) === INK.w));
  const er = document.getElementById('inkErase');
  if (er) er.classList.toggle('on', INK.er);
  const undo = document.getElementById('inkUndo');
  if (undo) undo.disabled = !(d && d.s.length);
  const clear = document.getElementById('inkClear');
  if (clear) clear.disabled = !(d && d.s.length);
}

function inkPoint(e, cv, d) {
  const r = cv.getBoundingClientRect();
  const w = cv.clientWidth || 1;
  if (!d.w) d.w = w;                          // the page the first stroke is drawn on
  const sc = d.w ? w / d.w : 1;
  return [(e.clientX - r.left) / sc, (e.clientY - r.top) / sc,
    e.pointerType === 'pen' && typeof e.pressure === 'number' ? Math.max(0.02, e.pressure) : NaN];
}

function inkHit(stroke, x, y, r) {
  const p = stroke.p || [];
  const rr = r * r;
  for (let i = 0; i < p.length; i += 2) {
    const dx = p[i] - x, dy = p[i + 1] - y;
    if (dx * dx + dy * dy <= rr) return true;
  }
  return false;
}

function inkEraseAt(cv, d, e) {
  const [x, y] = inkPoint(e, cv, d);
  const r = Math.max(14, INK.w * 4);
  const before = d.s.length;
  d.s = d.s.filter(st => !inkHit(st, x, y, r + (st.w || 3) / 2));
  if (d.s.length !== before) {
    inkDirty();
    inkPaintAll();
  }
}

function inkStart(e) {
  const cv = inkCanvas(), n = S.current;
  if (!cv || !n) return;
  if (e.pointerType === 'pen') INK.penAt = Date.now();
  /* A palm is not a pen: within 1.5s of the stylus, a finger is a hand resting on the screen. */
  else if (e.pointerType === 'touch' && Date.now() - INK.penAt < 1500) return;
  const d = inkData(n);
  if (INK.er || e.pointerType === 'eraser') { inkEraseAt(cv, d, e); INK.down = true; return; }
  e.preventDefault();
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  const [x, y, pr] = inkPoint(e, cv, d);
  const st = { c: INK.c, w: INK.w, p: [x, y] };
  if (isFinite(pr)) st.q = [pr];
  d.s.push(st);
  d.v = 1;
  INK.cur = st;
  INK.down = true;
  INK.redo = [];
  INK.seg = 0;
  inkDrawStroke(cv.getContext('2d'), st, cv.clientWidth / (d.w || cv.clientWidth));
  inkBarState();
}

function inkMove(e) {
  if (!INK.down) return;
  const cv = inkCanvas(), n = S.current;
  if (!cv || !n) return;
  const d = inkData(n);
  if (INK.er || e.pointerType === 'eraser') { inkEraseAt(cv, d, e); return; }
  const st = INK.cur;
  if (!st) return;
  e.preventDefault();
  /* Every position a stylus reported between two frames is kept, so a fast line curves. */
  const list = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length)
    ? e.getCoalescedEvents() : [e];
  const g = cv.getContext('2d');
  const sc = cv.clientWidth / (d.w || cv.clientWidth);
  for (const ev of list) {
    const [x, y, pr] = inkPoint(ev, cv, d);
    const p = st.p;
    if (Math.abs(p[p.length - 2] - x) < 0.4 && Math.abs(p[p.length - 1] - y) < 0.4) continue;
    p.push(x, y);
    if (st.q) st.q.push(isFinite(pr) ? pr : 0.5);
  }
  inkDrawTail(g, st, sc);
}

function inkEnd() {
  if (!INK.down) return;
  INK.down = false;
  const st = INK.cur;
  INK.cur = null;
  if (!st || !S.current) return;
  const d = inkData(S.current);
  if (st.p.length < 2) d.s.pop();
  inkPaintAll();                 /* the settled curve, drawn once through every point */
  inkDirty();
  inkBarState();
}

/* A stroke is a change to the note like any other: it is queued for saving, and the two places that
   say what a note holds - the tag above the page and the pen beside its name in the list - are drawn
   again, so the pen appears the moment the first stroke is finished. */
function inkDirty() {
  if (!S.current) return;
  if (typeof queueSave === 'function') queueSave();
  if (typeof renderSide === 'function') renderSide();
  if (typeof renderDoc === 'function') renderDoc();
}

function inkUndo() {
  const d = S.current ? inkData(S.current) : null;
  if (!d || !d.s.length) return;
  INK.redo.push(d.s.pop());
  inkDirty();
  inkPaintAll();
  inkBarState();
}

function inkRedo() {
  const d = S.current ? inkData(S.current) : null;
  if (!d || !INK.redo.length) return;
  d.s.push(INK.redo.pop());
  inkDirty();
  inkPaintAll();
  inkBarState();
}

/* Clear asks twice - the second tap empties the page - because clearing cannot be undone. */
let inkClearAt = 0;
function inkClear() {
  const d = S.current ? inkData(S.current) : null;
  if (!d || !d.s.length) return;
  const btn = document.getElementById('inkClear');
  if (Date.now() - inkClearAt > 2600) {
    inkClearAt = Date.now();
    if (btn) { btn.textContent = 'Tap again to clear'; setTimeout(() => { btn.textContent = 'Clear'; }, 2600); }
    return;
  }
  inkClearAt = 0;
  INK.redo = d.s.slice();
  d.s = [];
  if (btn) btn.textContent = 'Clear';
  inkDirty();
  inkPaintAll();
  inkBarState();
}

function inkWire() {
  const cv = inkCanvas();
  if (!cv || INK.wired) return;
  INK.wired = true;
  cv.addEventListener('pointerdown', inkStart);
  cv.addEventListener('pointermove', inkMove);
  cv.addEventListener('pointerup', inkEnd);
  cv.addEventListener('pointercancel', inkEnd);
  cv.addEventListener('pointerleave', e => { if (INK.down) inkEnd(e); });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  /* A stylus that reports faster than the screen refreshes has more to say than pointermove hears:
     read its raw updates where the phone offers them, and the curve keeps the shape of the hand. */
  if ('onpointerrawupdate' in cv) cv.addEventListener('pointerrawupdate', e => { if (INK.down) inkMove(e); });
  try { new ResizeObserver(() => inkPaintAll()).observe(cv); } catch (e) { window.addEventListener('resize', inkPaintAll); }

  const bar = document.getElementById('inkbar');
  if (bar) {
    bar.addEventListener('click', e => {
      const sw = e.target.closest('[data-inkc]');
      const wb = e.target.closest('[data-inkw]');
      if (sw) { INK.c = sw.dataset.inkc; INK.er = false; inkBarState(); return; }
      if (wb) { INK.w = Number(wb.dataset.inkw) || 3; INK.er = false; inkBarState(); }
    });
  }
  const er = document.getElementById('inkErase');
  if (er) er.addEventListener('click', () => { INK.er = !INK.er; inkBarState(); });
  const un = document.getElementById('inkUndo');
  if (un) un.addEventListener('click', inkUndo);
  const cl = document.getElementById('inkClear');
  if (cl) cl.addEventListener('click', inkClear);
  const ins = document.getElementById('inkInsert');
  if (ins) ins.addEventListener('click', inkInsertIntoNote);
}

/* The drawing becomes part of the note: it is painted once onto a picture with the page's own
   colours behind it - so it reads in either theme, and it is sealed with the note when the note is
   in the Vault - written into the note's body like any other picture, and the page is cleared so
   the next drawing starts empty. Undo puts the strokes back. */
async function inkInsertIntoNote() {
  const n = S.current;
  if (!n) { toast('Open a note first.'); return; }
  const d = inkData(n);
  if (!d || !d.s.length) { toast('Draw something first, then add it to the note.'); return; }
  const cv = inkCanvas();
  const w = Math.max(1, Math.round(cv.clientWidth || 640));
  const h = Math.max(1, Math.round(cv.clientHeight || 480));
  const out = document.createElement('canvas');
  out.width = Math.round(w * 2);
  out.height = Math.round(h * 2);
  const page = getComputedStyle(document.body);
  const inkInk = page.color || '#eef1f8';          // 'ink' strokes follow the note's text colour
  const g = out.getContext('2d');
  g.fillStyle = page.backgroundColor || '#0b0d14';
  g.fillRect(0, 0, out.width, out.height);
  const sc = out.width / (d.w || w);
  for (const st of d.s) inkDrawStroke(g, st, sc, inkInk);

  let blob = null;
  try { blob = await new Promise(res => out.toBlob(res, 'image/png')); } catch (e) { blob = null; }
  if (!blob) { toast('Could not put the drawing in a picture.'); return; }

  const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  try {
    const rec = await saveAttachment(new File([blob], 'Handwriting ' + stamp + '.png', { type: 'image/png' }), n);
    const body = String(n.body || '').replace(/\s+$/, '');
    n.body = (body ? body + '\n\n' : '') + '![](unote-media:' + rec.id + ')\n';
    await saveNote(n);
    if ($('#ed')) $('#ed').value = n.body;
    if ($('#pv')) { $('#pv').innerHTML = md(n.body); hydrateMedia($('#pv')); }
    INK.redo = d.s.slice();
    d.s = [];
    inkPaintAll();
    inkBarState();
    renderSide();
    refreshDocMeta();
    if (document.body.dataset.mode === 'draw') setMode(window.innerWidth < 600 ? 'read' : 'split');
    toast('The handwriting is part of the note now.');
  } catch (e) {
    toast('Could not add it to the note' + (e && e.message ? ': ' + e.message : '.'));
  }
}

/* Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work on the ink while the Draw pane is the one on screen. */
document.addEventListener('keydown', e => {
  if (document.body.dataset.mode !== 'draw') return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) inkRedo(); else inkUndo();
});

inkWire();
