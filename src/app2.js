/* UNote - part 2: rendering, editor, links, graph, palette, dialogs, export, updates. */
/* ---------------- rendering: sidebar ---------------- */
function noteTitle(n) { return (n && String(n.title || '').trim()) || 'Untitled note'; }
function sortNotes(list) {
  const s = S.settings.sort;
  return list.slice().sort((a, b) => s === 'title'
    ? noteTitle(a).localeCompare(noteTitle(b))
    : (b.updated || 0) - (a.updated || 0));
}
function visibleNotes() {
  let list = allNotes().filter(n => (S.view === 'trash' ? !!n.deleted : !n.deleted));
  if (S.view === 'fav') list = list.filter(n => n.fav);
  if (S.folder) list = list.filter(n => (n.folder || '') === S.folder);
  if (S.tag) list = list.filter(n => tagOf(n.body).indexOf(S.tag) >= 0 || (n.tags || []).indexOf(S.tag) >= 0);
  return sortNotes(list);
}
const liveNotes = () => S.notes.filter(n => !n.deleted);

function renderSide() {
  const body = $('#sideBody');
  const vault = S.view === 'vault';
  const count = liveNotes().length;
  $('#countLine').textContent = vault
    ? (S.vault.key ? S.vault.plain.length + (S.vault.plain.length === 1 ? ' note in the Vault' : ' notes in the Vault') : 'The Vault is locked')
    : count + (count === 1 ? ' note' : ' notes');
  $('#vaultLine').textContent = vault
    ? (S.vault.key ? 'Vault · unlocked' : 'Vault · locked')
    : 'Your notes, on this device';

  let h = '';
  h += '<button class="navrow' + (!vault && S.view === 'notes' && !S.folder && !S.tag ? ' on' : '') + '" data-nav="notes">' +
    '<svg viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H17l3 3v12.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z"/></svg>' +
    'All notes<span class="n">' + liveNotes().length + '</span></button>';
  h += '<button class="navrow' + (!vault && S.view === 'fav' ? ' on' : '') + '" data-nav="fav">' +
    '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8z"/></svg>' +
    'Favourites<span class="n">' + S.notes.filter(n => n.fav && !n.deleted).length + '</span></button>';

  if (S.vault.on) {
    h += '<button class="navrow' + (vault ? ' on' : '') + '" data-nav="vault">' +
      '<svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>' +
      'Vault<span class="n">' + (vault ? 'close' : S.vault.key ? 'open' : 'locked') + '</span></button>';
  }
  h += '<button class="navrow' + (!vault && S.view === 'trash' ? ' on' : '') + '" data-nav="trash">' +
    '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
    'Trash<span class="n">' + S.notes.filter(n => n.deleted).length + '</span></button>';

  const folders = {};
  liveNotes().forEach(n => { const f = n.folder || ''; if (f) folders[f] = (folders[f] || 0) + 1; });
  const fnames = Object.keys(folders).sort();
  if (fnames.length || S.folder) {
    h += '<div class="sec">Folders<div class="grow"></div><button data-act="folder" title="New folder">+</button></div>';
    if (S.folder) h += '<button class="folderrow" data-folder=""><span class="tw">×</span>Show all folders</button>';
    fnames.forEach(f => {
      h += '<button class="folderrow' + (S.folder === f ? ' on' : '') + '" data-folder="' + esc(f) + '">' +
        '<span class="tw">' + (S.folder === f ? '▾' : '▸') + '</span>' + esc(f) + '<span class="c">' + folders[f] + '</span></button>';
    });
  }

  const tags = {};
  allNotes().filter(n => !n.deleted).forEach(n => tagOf(n.body).forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
  const tnames = Object.keys(tags).sort((a, b) => tags[b] - tags[a]).slice(0, 14);
  if (tnames.length) {
    h += '<div class="sec">Tags</div><div style="padding:0 6px 4px">';
    tnames.forEach(t => {
      h += '<button class="tagchip' + (S.tag === t ? ' on' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + ' <b style="opacity:.6">' + tags[t] + '</b></button>';
    });
    h += '</div>';
  }

  const list = visibleNotes();
  h += '<div class="sec">' + (S.view === 'trash' ? 'Trash' : S.view === 'fav' ? 'Favourites'
    : S.view === 'vault' ? (S.vault.key ? 'Vault notes' : 'Vault') : S.folder ? esc(S.folder) : S.tag ? '#' + esc(S.tag) : 'Recent') +
    '<div class="grow"></div><button data-act="sort" title="Sort">' + (S.settings.sort === 'title' ? 'A-Z' : 'New') + '</button></div>';

  if (S.view === 'vault' && !S.vault.key) {
    h += '<div style="padding:8px 6px"><button class="listrow" data-act="unlock" style="margin:0">' +
      '<svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--accent);fill:none;stroke-width:1.7"><rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>' +
      '<span class="grow"><span class="lr-t">Vault is locked</span><span class="lr-s" style="display:block">Tap to enter your PIN</span></span></button></div>';
  } else if (!list.length) {
    h += '<div class="emptyhint">' + (S.view === 'trash' ? 'Nothing in the trash.' : 'No notes here yet.') + '</div>';
  } else {
    list.forEach(n => {
      h += '<button class="noteitem' + (S.current && S.current.id === n.id ? ' on' : '') + '" data-note="' + n.id + '">' +
        (n.fav ? '<span class="st">★</span>' : '') +
        '<span class="t">' + esc(noteTitle(n)) + '</span>' +
        '<span class="f">' + fmtWhen(n.updated).replace(/^just now$/, 'now') + '</span></button>';
    });
  }
  body.innerHTML = h;
}

/* ---------------- rendering: document ---------------- */
function renderDoc() {
  const n = S.current;
  const doc = $('#doc'), empty = $('#empty');
  if (!n) {
    doc.hidden = true; empty.hidden = false;
    $('#pv').innerHTML = '';
    $('#crumbs').innerHTML = '<b>UNote</b>';
    $('#rbody').innerHTML = '<div class="panehint">Open a note to see what links to it.</div>';
    $('#sWords').textContent = '0 words';
    return;
  }
  doc.hidden = false; empty.hidden = true;
  if (document.activeElement !== $('#title')) $('#title').value = n.title || '';
  if (document.activeElement !== $('#ed')) $('#ed').value = n.body || '';
  showReading();

  const tags = tagOf(n.body);
  $('#crumbs').innerHTML = (n.vault ? 'Vault' : 'Notes') +
    (n.folder ? ' / <b>' + esc(n.folder) + '</b>' : '') + ' / <b>' + esc(noteTitle(n)) + '</b>';
  $('#docmeta').innerHTML =
    (n.vault ? '<span class="pill acc">In the Vault</span>' : '') +
    (n.folder ? '<span class="pill">' + esc(n.folder) + '</span>' : '') +
    tags.slice(0, 6).map(t => '<span class="pill">#' + esc(t) + '</span>').join('') +
    '<span class="pill">' + fmtWhen(n.updated) + '</span>' +
    '<span class="pill">' + words(n.body) + ' words · ' + Math.max(1, Math.round(words(n.body) / 220)) + ' min read</span>';
  $('#btnFav').classList.toggle('on', !!n.fav);
  $('#sWords').textContent = words(n.body) + ' words';
  renderRight();
}

/* One place that fills the reading pane, so Read mode can never come up blank: if the markdown
   renderer ever fails, the note's own text is shown instead of an empty pane. */
function showReading() {
  const pv = $('#pv');
  if (!pv || !S.current) return;
  try {
    pv.innerHTML = md(S.current.body || '');
    hydrateMedia(pv);
  } catch (e) {
    pv.textContent = S.current.body || '';
  }
}

function refreshDocMeta() {
  const n = S.current;
  if (!n) return;
  $('#crumbs').innerHTML = (n.vault ? 'Vault' : 'Notes') +
    (n.folder ? ' / <b>' + esc(n.folder) + '</b>' : '') + ' / <b>' + esc(noteTitle(n)) + '</b>';
  const pills = Array.from($('#docmeta').querySelectorAll('.pill'));
  const last = pills[pills.length - 1];
  if (last && /words/.test(last.textContent)) {
    const w = words(n.body);
    last.textContent = w + ' words \u00b7 ' + Math.max(1, Math.round(w / 220)) + ' min read';
  }
}

function renderRight() {
  const n = S.current, body = $('#rbody');
  if (!n) { body.innerHTML = '<div class="panehint">Open a note to see what links to it.</div>'; return; }
  if (S.right === 'outline') {
    const heads = [];
    String(n.body || '').replace(/^(#{1,3})\s+(.+)$/gm, (m, hashes, text) => { heads.push({ lvl: hashes.length, text: text.trim() }); return m; });
    body.innerHTML = heads.length
      ? '<div class="outline">' + heads.map(hd => '<a href="#" data-jump="' + esc(hd.text) + '" data-lvl="' + hd.lvl + '">' + esc(hd.text) + '</a>').join('') + '</div>'
      : '<div class="panehint">Add headings with # to build an outline here.</div>';
    return;
  }
  const title = noteTitle(n).toLowerCase();
  const back = allNotes().filter(o => o.id !== n.id && !o.deleted &&
    wikiOut(o.body).some(t => t.toLowerCase() === title));
  const out = wikiOut(n.body);
  let h = '<div class="sec" style="margin:0 0 8px">Linked from</div>';
  h += back.length ? back.map(o => '<button class="linkcard" data-note="' + o.id + '"><span class="lc-t">' + esc(noteTitle(o)) + '</span>' +
    '<span class="lc-s">' + esc(String(o.body || '').replace(/\s+/g, ' ').slice(0, 110)) + '</span></button>').join('')
    : '<div class="panehint">Nothing links here yet. Write [[' + esc(noteTitle(n)) + ']] in another note.</div>';
  h += '<div class="sec" style="margin:16px 0 8px">This note links to</div>';
  h += out.length ? out.map(t => {
    const hit = findTitle(t);
    return hit ? '<button class="linkcard" data-note="' + hit.id + '"><span class="lc-t">' + esc(noteTitle(hit)) + '</span></button>'
      : '<button class="linkcard miss" data-make="' + esc(t) + '"><span class="lc-t">' + esc(t) + '</span><span class="lc-s">Not written yet - tap to create it</span></button>';
  }).join('') : '<div class="panehint">Nothing yet. [[' + 'Another note' + ']] makes a link.</div>';
  h += '<div class="sec" style="margin:16px 0 8px">Tags here</div>';
  const tags = tagOf(n.body);
  h += tags.length ? tags.map(t => '<button class="tagchip" data-tag="' + esc(t) + '">#' + esc(t) + '</button>').join('') : '<div class="panehint">No tags in this note.</div>';
  body.innerHTML = h;
}

/* ---------------- opening, creating, saving ---------------- */
async function openNote(id) {
  const n = findNote(id);
  if (!n) return;
  if (n.vault && !S.vault.key) { unlockDialog(() => openNote(id)); return; }
  S.current = n;
  if (n.vault) S.view = 'vault';
  else if (S.view === 'vault') { lockVault(true); S.view = 'notes'; }
  closeSide();
  renderDoc(); renderSide();
}

async function createNote(opts) {
  const o = opts || {};
  const n = newNote({ folder: o.folder != null ? o.folder : S.folder, vault: S.view === 'vault' });
  if (n.vault) {
    if (!S.vault.key) { unlockDialog(); return; }
    S.vault.plain.unshift(n);
  } else S.notes.unshift(n);
  await saveNote(n, { quiet: true });
  S.current = n;
  renderDoc(); renderSide();
  $('#title').focus();
  return n;
}

async function createMissing(title) {
  const n = await createNote({});
  n.title = title;
  await saveNote(n);
  renderDoc(); renderSide();
  toast('Created "' + title + '"');
}

const queueSave = debounce(async () => {
  if (!S.current) return;
  await saveNote(S.current);
}, 400);

function setMode(mode) {
  S.settings.mode = mode;
  document.body.dataset.mode = mode;
  $('#panes').classList.toggle('split', mode === 'split');
  $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode !== 'edit') showReading();      // switching to Read always renders the note
  kvSet('settings', S.settings);
}

/* ---------------- graph ---------------- */
const G = { nodes: [], edges: [], raf: 0, scale: 1, tx: 0, ty: 0, drag: null, canvas: null, ctx: null, last: 0 };
function openGraph() {
  const wrap = $('#graphwrap');
  wrap.hidden = false;
  G.canvas = $('#graph');
  G.ctx = G.canvas.getContext('2d');
  const notes = allNotes().filter(n => !n.deleted);
  const byTitle = {};
  notes.forEach(n => { byTitle[noteTitle(n).toLowerCase()] = n; });
  const W = G.canvas.clientWidth || window.innerWidth, H = G.canvas.clientHeight || window.innerHeight;
  G.nodes = notes.map((n, i) => ({
    id: n.id, title: noteTitle(n), vault: !!n.vault,
    x: W / 2 + Math.cos(i * 2.399) * (60 + i * 9), y: H / 2 + Math.sin(i * 2.399) * (60 + i * 9),
    vx: 0, vy: 0, r: 5 + Math.min(9, wikiOut(n.body).length),
  }));
  const idx = {}; G.nodes.forEach((nd, i) => idx[nd.id] = i);
  G.edges = [];
  notes.forEach(n => wikiOut(n.body).forEach(t => {
    const hit = byTitle[t.toLowerCase()];
    if (hit && hit.id !== n.id) G.edges.push([idx[n.id], idx[hit.id]]);
  }));
  const legend = $('#graphlegend');
  legend.textContent = G.nodes.length + ' note' + (G.nodes.length === 1 ? '' : 's') + ' · ' +
    (G.edges.length
      ? G.edges.length + ' link' + (G.edges.length === 1 ? '' : 's') + ' · tap a dot to open it'
      : 'no links yet');
  const empty = $('#graphempty');
  if (empty) empty.hidden = G.edges.length > 0;
  G.scale = 1; G.tx = 0; G.ty = 0;
  sizeGraph();
  if (!G.raf) { G.last = performance.now(); G.raf = requestAnimationFrame(graphTick); }
}
function sizeGraph() {
  const c = G.canvas; if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
  G.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function closeGraph() {
  $('#graphwrap').hidden = true;
  cancelAnimationFrame(G.raf); G.raf = 0;
}
function graphTick(t) {
  const dt = Math.min(32, t - G.last) / 16.666; G.last = t;
  const c = G.ctx, W = G.canvas.clientWidth, H = G.canvas.clientHeight;
  if (!G.nodes.length) { G.raf = requestAnimationFrame(graphTick); return; }
  // forces
  for (let i = 0; i < G.nodes.length; i++) {
    const a = G.nodes[i];
    for (let j = i + 1; j < G.nodes.length; j++) {
      const b = G.nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 1;
      if (d2 > 90000) continue;
      const f = 1400 / d2;
      const d = Math.sqrt(d2);
      a.vx -= (dx / d) * f * dt; a.vy -= (dy / d) * f * dt;
      b.vx += (dx / d) * f * dt; b.vy += (dy / d) * f * dt;
    }
    // gentle pull to centre
    a.vx += (W / 2 - a.x) * 0.0016 * dt; a.vy += (H / 2 - a.y) * 0.0016 * dt;
  }
  G.edges.forEach(e => {
    const a = G.nodes[e[0]], b = G.nodes[e[1]];
    if (!a || !b) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, k = (d - 92) * 0.0055;
    a.vx += (dx / d) * k * dt; a.vy += (dy / d) * k * dt;
    b.vx -= (dx / d) * k * dt; b.vy -= (dy / d) * k * dt;
  });
  G.nodes.forEach(nd => {
    if (G.drag && G.drag.node === nd) { nd.vx = nd.vy = 0; return; }
    nd.vx *= 0.86; nd.vy *= 0.86;
    nd.x += nd.vx * dt; nd.y += nd.vy * dt;
    if (nd.x < 20) nd.x = 20; if (nd.x > W - 20) nd.x = W - 20;
    if (nd.y < 20) nd.y = 20; if (nd.y > H - 20) nd.y = H - 20;
  });
  // draw
  const cs = getComputedStyle(document.body);
  const line = cs.getPropertyValue('--line2').trim() || '#333';
  const ink = cs.getPropertyValue('--ink').trim() || '#fff';
  const acc = S.settings.accent;
  const hot = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(acc) ? acc : '#7c5cff';
  c.clearRect(0, 0, W, H);
  c.save(); c.translate(G.tx, G.ty); c.scale(G.scale, G.scale);
  c.strokeStyle = line; c.lineWidth = 1;
  G.edges.forEach(e => {
    const a = G.nodes[e[0]], b = G.nodes[e[1]];
    if (!a || !b) return;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  });
  G.nodes.forEach(nd => {
    c.beginPath(); c.arc(nd.x, nd.y, nd.r, 0, 6.2832);
    c.fillStyle = nd.vault ? '#fbbf24' : hot; c.globalAlpha = 0.9; c.fill(); c.globalAlpha = 1;
    c.fillStyle = ink; c.font = '11px -apple-system,Segoe UI,sans-serif'; c.textAlign = 'center';
    const label = nd.title.length > 18 ? nd.title.slice(0, 17) + '…' : nd.title;
    c.globalAlpha = 0.86; c.fillText(label, nd.x, nd.y + nd.r + 13); c.globalAlpha = 1;
  });
  c.restore();
  G.raf = requestAnimationFrame(graphTick);
}
function graphHit(mx, my) {
  const x = (mx - G.tx) / G.scale, y = (my - G.ty) / G.scale;
  for (let i = G.nodes.length - 1; i >= 0; i--) {
    const nd = G.nodes[i], d = Math.hypot(nd.x - x, nd.y - y);
    if (d < nd.r + 10) return nd;
  }
  return null;
}

/* ---------------- palette + search ---------------- */
const COMMANDS = [
  { k: 'New note', run: () => createNote({}) },
  { k: 'New folder', run: () => folderDialog() },
  { k: "Today's note", run: () => dailyNote() },
  { k: 'Search all notes', run: () => palette('search') },
  { k: 'Open graph', run: () => openGraph() },
  { k: 'Open the Vault', run: () => goVault() },
  { k: 'Lock the Vault', run: () => lockVault() },
  { k: 'Export everything', run: () => exportAll() },
  { k: 'Transfer to another device', run: () => transferDialog() },
  { k: 'Import a backup', run: () => importDialog() },
  { k: 'Toggle theme', run: () => setTheme(S.settings.theme === 'dark' ? 'light' : 'dark') },
  { k: 'Settings', run: () => settingsDialog() },
  { k: 'Check for updates', run: () => checkUpdate(true) },
];

let palMode = 'command', palItems = [], palSel = 0;
function palette(mode) {
  palMode = mode || 'command';
  palSel = 0;
  const d = dialog({
    cls: 'wide',
    body: '<input class="palinput" id="palQ" placeholder="' +
      (palMode === 'search' ? 'Search every note…' : 'Jump to a note, or type a command…') + '" autocomplete="off">' +
      '<div class="pallist" id="palList"></div>',
    foot: '<span class="hint" style="margin:0">↑ ↓ to move · Enter to open · Esc to close</span>',
  });
  const q = $('#palQ', d);
  q.addEventListener('input', () => { palSel = 0; drawPalette(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); drawPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); drawPalette(); e.preventDefault(); }
    else if (e.key === 'Enter') { const it = palItems[palSel]; if (it) it.run(); e.preventDefault(); }
  });
  drawPalette();
  setTimeout(() => q.focus(), 30);
}
function drawPalette() {
  const q = ($('#palQ') && $('#palQ').value || '').trim();
  const ql = q.toLowerCase();
  const list = $('#palList');
  if (!list) return;
  palItems = [];
  if (palMode === 'command') {
    COMMANDS.filter(c => !ql || c.k.toLowerCase().includes(ql))
      .forEach(c => palItems.push({ title: c.k, kind: 'Command', run: () => { closeDialog(); c.run(); } }));
    sortNotes(allNotes().filter(n => !n.deleted)).filter(n => !ql || noteTitle(n).toLowerCase().includes(ql))
      .slice(0, 40)
      .forEach(n => palItems.push({ title: noteTitle(n), kind: n.vault ? 'Vault' : 'Note', run: () => { closeDialog(); openNote(n.id); } }));
  } else {
    const hits = [];
    allNotes().forEach(n => {
      if (n.deleted) return;
      const t = noteTitle(n), b = String(n.body || '');
      const inT = t.toLowerCase().includes(ql), inB = ql && b.toLowerCase().includes(ql);
      if (!ql || inT || inB) {
        let snippet = '';
        if (inB) {
          const i = b.toLowerCase().indexOf(ql);
          snippet = (i > 40 ? '…' : '') + b.slice(Math.max(0, i - 40), i + 90).replace(/\s+/g, ' ');
        } else snippet = b.replace(/\s+/g, ' ').slice(0, 100);
        hits.push({ title: t, kind: n.vault ? 'Vault' : 'Note', snippet: snippet, run: () => { closeDialog(); openNote(n.id); } });
      }
    });
    palItems = hits.slice(0, 60);
  }
  list.innerHTML = palItems.length ? palItems.map((it, i) =>
    '<button class="palitem' + (i === palSel ? ' on' : '') + '" data-pal="' + i + '">' +
    '<span class="pi-t">' + esc(it.title) + (it.snippet ? '<span class="snippet" style="display:block">' + esc(it.snippet) + '</span>' : '') + '</span>' +
    '<span class="pi-k">' + esc(it.kind) + '</span></button>').join('')
    : '<div class="panehint">Nothing matched.</div>';
  $$('#palList .palitem').forEach(b => b.addEventListener('click', () => {
    const it = palItems[+b.dataset.pal]; if (it) it.run();
  }));
}
