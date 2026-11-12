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

function inkColour(stroke, cv) {
  if (!stroke.c || stroke.c === 'ink') {
    try { return getComputedStyle(cv).color || '#111'; } catch (e) { return '#111'; }
  }
  return stroke.c;
}

/* One stroke, scaled from page units by `sc`. A stylus reports how hard it is pressed and the line
   thickens where it does; a finger or a mouse reports nothing useful, so the line keeps its width. */
function inkDrawStroke(g, stroke, sc) {
  const p = stroke && stroke.p;
  if (!p || p.length < 2) return;
  const q = stroke.q || null;
  const base = Math.max(0.6, (stroke.w || 3) * sc);
  g.strokeStyle = inkColour(stroke, g.canvas);
  g.fillStyle = g.strokeStyle;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (p.length === 2) {
    g.beginPath();
    g.arc(p[0] * sc, p[1] * sc, Math.max(0.7, base / 2), 0, Math.PI * 2);
    g.fill();
    return;
  }
  for (let i = 2; i < p.length; i += 2) {
    const pr = q ? Number(q[i / 2]) : NaN;
    g.lineWidth = isFinite(pr) && pr > 0 ? base * (0.55 + 0.8 * Math.min(1, pr)) : base;
    g.beginPath();
    g.moveTo(p[i - 2] * sc, p[i - 1] * sc);
    g.lineTo(p[i] * sc, p[i + 1] * sc);
    g.stroke();
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
    const last = p.length;
    inkDrawStroke(g, { c: st.c, w: st.w, p: p.slice(last - 4), q: st.q ? st.q.slice(last / 2 - 2) : null }, sc);
  }
}

function inkEnd() {
  if (!INK.down) return;
  INK.down = false;
  const st = INK.cur;
  INK.cur = null;
  if (!st || !S.current) return;
  const d = inkData(S.current);
  if (st.p.length < 2) d.s.pop();
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
}

/* Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z work on the ink while the Draw pane is the one on screen. */
document.addEventListener('keydown', e => {
  if (document.body.dataset.mode !== 'draw') return;
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) inkRedo(); else inkUndo();
});

inkWire();
