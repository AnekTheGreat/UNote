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
      'Vault<span class="n">' + (vault ? 'Lock' : S.vault.key ? 'open' : 'locked') + '</span></button>';
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
      '<span class="grow"><span class="lr-t">Vault is locked</span><span class="lr-s" style="display:block">' +
      (S.vault.notes.length
        ? S.vault.notes.length + (S.vault.notes.length === 1 ? ' note sealed here' : ' notes sealed here') + ' - tap to enter your PIN'
        : 'Tap to enter your PIN') +
      '</span></span></button></div>';
  } else if (!list.length) {
    h += '<div class="emptyhint">' + (S.view === 'trash' ? 'Nothing in the trash.'
      : S.view === 'vault' ? 'The Vault is empty. Tap + to write the first note that only your PIN can open.'
      : 'No notes here yet.') + '</div>';
  } else {
    list.forEach(n => {
      const picked = !!S.sel[n.id];
      const on = S.selMode ? picked : (S.current && S.current.id === n.id);
      h += '<button class="noteitem' + (on ? ' on' : '') + (S.selMode ? ' selecting' : '') + '" data-note="' + n.id + '">' +
        (S.selMode ? '<span class="chk' + (picked ? ' on' : '') + '"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' : '') +
        (n.fav ? '<span class="st">★</span>' : '') +
        (n.ink && n.ink.s && n.ink.s.length ? '<span class="st" title="Handwriting">✎</span>' : '') +
        '<span class="t">' + esc(noteTitle(n)) + '</span>' +
        '<span class="f">' + fmtWhen(n.updated).replace(/^just now$/, 'now') + '</span></button>';
    });
  }
  body.innerHTML = h;
  renderSelBar();
  updateBack();
}

/* ---------------- going back ---------------- */
/* 1.0.23 - one idea of "back", shared by the arrow in the top bar and by the phone's own back
   key: close what is on top first (a sheet, the search, the graph, the drawer), then undo a
   filter or leave the Vault, and only then is there nowhere left to go. */
function backTarget() {
  const gw = $('#graphwrap');
  if (gw && !gw.hidden) return 'graph';
  const d = $('#dlg');
  if (d && !d.hidden) return 'dialog';
  if (S.selMode) return 'select';
  const side = $('#side');
  if (side && side.classList.contains('open')) return 'side';
  /* 1.0.25 - a note is somewhere you went, so back leaves it for the page before it. Clearing a
     folder filter from inside a note changed nothing anyone could see, and with no filter at all
     there was nothing to go back to and the system took the press as "close the app". */
  if (S.current) return 'note';
  if (S.folder || S.tag) return 'filter';
  if (S.view && S.view !== 'notes') return 'view';
  return '';
}
function updateBack() {
  /* 1.0.34 - the back key is permanent. It used to appear in the top bar only when there was
     somewhere to go, which meant a screen with no header arrow had no visible way back at all.
     Now the key is always drawn, and only its weight changes: full when back will do
     something, dimmed when you are already home. */
  const b = $('#railBack');
  const show = !!backTarget();
  if (b) { b.hidden = false; b.classList.toggle('dim', !show); }
}
function goBack() {
  const t = backTarget();
  if (!t) {
    /* 1.0.34 - on the home screen the key still answers: it puts the library back the way it
       opens, rather than doing nothing under a finger that expects it to act. */
    if (S.vault.key) lockVault(true);
    S.view = 'notes'; S.folder = ''; S.tag = ''; S.current = null;
    try { renderDoc(); } catch (_e0) {}
    renderSide(); updateBack();
    return true;
  }
  if (t === 'graph') closeGraph();
  else if (t === 'dialog') closeDialog();
  else if (t === 'select') selExit();
  else if (t === 'side') closeSide();
  else if (t === 'note') { S.current = null; renderDoc(); renderSide(); }
  else {
    if (S.vault.key) lockVault(true);
    S.view = 'notes'; S.folder = ''; S.tag = '';
    renderSide();
  }
  updateBack();
  return true;
}

/* ---------------- rendering: document ---------------- */
function renderDoc() {
  const n = S.current;
  const doc = $('#doc'), empty = $('#empty');
  if (!n) {
    doc.hidden = true; empty.hidden = false;
    document.body.classList.add('nonote');   // the note's own controls have nothing to act on here
    $('#pv').innerHTML = '';
    $('#crumbs').innerHTML = '<b>UNote</b>';
    $('#rbody').innerHTML = '<div class="panehint">Open a note to see what links to it.</div>';
    $('#sWords').textContent = '0 words';
    renderHome();
    return;
  }
  doc.hidden = false; empty.hidden = true;
  document.body.classList.remove('nonote');
  if (document.activeElement !== $('#title')) $('#title').value = n.title || '';
  if (document.activeElement !== $('#ed')) $('#ed').value = n.body || '';
  showReading();

  const tags = tagOf(n.body);
  $('#crumbs').innerHTML = (n.vault ? 'Vault' : 'Notes') +
    (n.folder ? ' / <b>' + esc(n.folder) + '</b>' : '') + ' / <b>' + esc(noteTitle(n)) + '</b>';
  $('#docmeta').innerHTML =
    (n.vault ? '<span class="pill acc">In the Vault</span>' : '') +
    (n.folder ? '<span class="pill">' + esc(n.folder) + '</span>' : '') +
    (n.ink && n.ink.s && n.ink.s.length ? '<span class="pill acc">Handwriting</span>' : '') +
    tags.slice(0, 6).map(t => '<span class="pill">#' + esc(t) + '</span>').join('') +
    '<span class="pill">' + fmtWhen(n.updated) + '</span>' +
    '<span class="pill">' + words(n.body) + ' words · ' + Math.max(1, Math.round(words(n.body) / 220)) + ' min read</span>';
  $('#btnFav').classList.toggle('on', !!n.fav);
  $('#sWords').textContent = words(n.body) + ' words';
  renderRight();
  if (typeof inkSync === 'function') inkSync();
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
  renderDoc(); renderSide(); updateBack();
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
  renderDoc(); renderSide(); updateBack();
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
  if (mode === 'draw' && typeof inkSync === 'function') inkSync();
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
  updateBack();
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
  updateBack();
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
    body: '<div class="palhead">' +
      '<button class="iconbtn" id="palBack" aria-label="Back" title="Back">' +
        '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<input class="palinput" id="palQ" placeholder="' +
      (palMode === 'search' ? 'Search every note…' : 'Jump to a note, or type a command…') + '" autocomplete="off"></div>' +
      '<div class="pallist" id="palList"></div>',
    foot: '<span class="hint" style="margin:0">↑ ↓ to move · Enter to open · Esc to close</span>',
  });
  $('#palBack', d).addEventListener('click', closeDialog);
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


/* ---------------- more than one note at a time ---------------- */
/* 1.0.25 - every action took the note you had open, so putting five notes into the Vault meant
   opening five notes. A hold on a row now starts a selection: taps add and remove notes from it,
   and one bar acts on all of them - star them, file them, seal them, bin them - in a single go. */
const SEL_HOLD_MS = 2000;          /* the hold the gesture asks for, with a ring drawn while it runs */
const selIds = () => Object.keys(S.sel).filter(id => S.sel[id]);
const selNoteCount = () => selIds().length;

function selReset() { S.sel = {}; }

function selEnter(id) {
  if (!S.selMode) { S.selMode = true; selReset(); }
  if (id) S.sel[id] = 1;
  renderSide();
  updateBack();
}

function selExit() {
  if (!S.selMode) return;
  S.selMode = false;
  selReset();
  renderSide();
  updateBack();
}

function selToggle(id) {
  if (S.sel[id]) delete S.sel[id]; else S.sel[id] = 1;
  if (!selNoteCount()) { selExit(); return; }
  renderSide();
}

function selAll() {
  const list = visibleNotes();
  const had = selNoteCount();
  const all = had && had >= list.length;
  selReset();
  if (!all) list.forEach(n => { S.sel[n.id] = 1; });
  renderSide();
}

/* The bar says only what can be done to the notes in front of you: no Folder or Star in the Trash,
   no Vault button while the Vault is what you are looking at. */
function renderSelBar() {
  const bar = $('#selbar');
  if (!bar) return;
  bar.hidden = !S.selMode;
  if (!S.selMode) return;
  const n = selNoteCount();
  const c = $('#selCount');
  if (c) c.textContent = n === 1 ? '1 note' : n + ' notes';
  const all = $('#selAll');
  const total = visibleNotes().length;
  if (all) all.textContent = (n && n >= total) ? 'None' : 'All';
  const bin = S.view === 'trash';
  const show = (key, on) => {
    const b = bar.querySelector('[data-sel="' + key + '"]');
    if (b) b.hidden = !on;
  };
  show('fav', !bin);
  show('folder', !bin);
  show('vault', !bin && S.view !== 'vault');
  show('trash', !bin);
  show('restore', bin);
}

async function selDo(action) {
  const notes = selIds().map(findNote).filter(Boolean);
  if (!notes.length) { selExit(); return; }
  const many = notes.length === 1 ? '1 note' : notes.length + ' notes';

  if (action === 'folder') { selFolder(notes); return; }

  if (action === 'vault') {
    const plain = notes.filter(n => !n.vault);
    if (!plain.length) { toast('Those notes are already in the Vault.'); selExit(); return; }
    if (!S.vault.key) { unlockDialog(() => selVault(plain)); return; }
    selVault(plain);
    return;
  }

  if (action === 'fav') {
    const want = !notes.every(n => n.fav);
    for (const n of notes) { n.fav = want; await saveNote(n, { quiet: true }); }
    selExit(); renderSide();
    if (S.current) renderDoc();
    toast(want ? 'Pinned ' + many + ' to favourites.' : 'Took ' + many + ' out of favourites.');
    return;
  }

  if (action === 'trash') {
    const at = nowMs();
    for (const n of notes) { n.deleted = at; await saveNote(n, { quiet: true }); }
    if (notes.some(n => S.current && S.current.id === n.id)) { S.current = null; }
    selExit(); renderSide(); renderDoc();
    toast('Moved ' + many + ' to the trash.');
    return;
  }

  if (action === 'restore') {
    for (const n of notes) { n.deleted = 0; await saveNote(n, { quiet: true }); }
    selExit(); renderSide(); renderDoc();
    toast('Restored ' + many + '.');
  }
}

/* Several notes are sealed one after another and the Vault is read back once at the end: doing it
   per note meant decrypting the whole Vault again for every note in the selection. */
async function selVault(notes) {
  if (!S.vault.key) return;
  let done = 0;
  for (const n of notes) {
    const v = Object.assign({}, n, { vault: true, updated: nowMs(), deleted: 0 });
    try { await saveNote(v, { quiet: true }); } catch (e) { continue; }
    S.notes = S.notes.filter(x => x.id !== n.id);
    if (S.current && S.current.id === n.id) S.current = v;
    done++;
  }
  await decryptVault();
  if (S.current && S.current.vault) S.current = findNote(S.current.id) || S.current;
  selExit(); renderSide(); renderDoc();
  toast(done ? 'Moved ' + (done === 1 ? '1 note' : done + ' notes') + ' into the Vault.'
    : 'Nothing could be sealed - the Vault is closed.');
}

function selFolder(notes) {
  const folders = Array.from(new Set(liveNotes().map(n => n.folder).filter(Boolean))).sort();
  const d = dialog({
    title: (notes.length === 1 ? '1 note' : notes.length + ' notes') + ' into a folder',
    body: '<label class="field"><span>Folder</span><input id="sfName" placeholder="e.g. Work, Ideas, Recipes" maxlength="40"></label>' +
      (folders.length
        ? '<div class="hint" style="margin:-2px 0 8px">Or pick one of these:</div><div>' +
          folders.map(f => '<button class="tagchip" data-sf="' + esc(f) + '">' + esc(f) + '</button>').join('') +
          '<button class="tagchip" data-sf="">No folder</button></div>'
        : '') +
      '<div class="hint" style="margin:10px 0 0">Folders are one level, the same as everywhere else in the app.</div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Cancel</button><button class="btn primary" id="sfGo">Move</button>',
  });
  const apply = async name => {
    for (const n of notes) { n.folder = name; await saveNote(n, { quiet: true }); }
    closeDialog(); selExit(); renderSide();
    if (S.current) renderDoc();
    toast('Moved ' + (notes.length === 1 ? '1 note' : notes.length + ' notes') +
      (name ? ' into ' + name : ' out of their folder') + '.');
  };
  $('#sfGo', d).addEventListener('click', () => apply($('#sfName', d).value.trim()));
  $('#sfName', d).addEventListener('keydown', e => { if (e.key === 'Enter') apply($('#sfName', d).value.trim()); });
  d.addEventListener('click', e => {
    const chip = e.target.closest('[data-sf]');
    if (chip) apply(chip.dataset.sf);
  });
  setTimeout(() => { const i = $('#sfName'); if (i) i.focus(); }, 40);
}

/* A hold, not a tap: two seconds with a ring drawn on the row, so nothing is ever selected by
   accident while scrolling. A finger that travels before the ring closes was a scroll, and lets go. */
let selTimer = 0, selRow = null, selAt = { x: 0, y: 0 }, selSuppress = false;

function wireNotePress() {
  const body = $('#sideBody');
  if (!body || body.dataset.press) return;
  body.dataset.press = '1';
  const stop = () => {
    clearTimeout(selTimer); selTimer = 0;
    if (selRow) selRow.classList.remove('holding');
    selRow = null;
  };
  body.addEventListener('pointerdown', e => {
    const row = e.target.closest('[data-note]');
    if (!row) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    selSuppress = false;
    if (S.selMode) return;                 /* already selecting: a tap toggles, nothing to hold */
    stop();
    selRow = row; selAt = { x: e.clientX, y: e.clientY };
    row.classList.add('holding');
    selTimer = setTimeout(() => {
      selTimer = 0;
      const held = selRow ? selRow.dataset.note : '';
      if (selRow) selRow.classList.remove('holding');
      selRow = null;
      selSuppress = true;
      try { if (navigator.vibrate) navigator.vibrate(14); } catch (err) {}
      selEnter(held);
      toast('Tap notes to add them, then pick an action.', 2600);
    }, SEL_HOLD_MS);
  });
  body.addEventListener('pointermove', e => {
    if (!selTimer) return;
    if (Math.abs(e.clientX - selAt.x) + Math.abs(e.clientY - selAt.y) > 10) stop();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => body.addEventListener(ev, stop));
  body.addEventListener('scroll', stop, { passive: true });

  const bar = $('#selbar');
  if (bar) {
    bar.addEventListener('click', e => {
      if (e.target.closest('#selDone')) { selExit(); return; }
      if (e.target.closest('#selAll')) { selAll(); return; }
      const b = e.target.closest('[data-sel]');
      if (b) selDo(b.dataset.sel);
    });
  }
}

/* ---------------- the page the app opens on ---------------- */
/* 1.0.25 - launch used to open the most recently changed note, which meant it opened whatever was
   last touched whether or not that was what you wanted. The app now lands on a page: who you are
   writing as, how much you have written, a way in to a new note or today's, the notes you were last
   in and the ones you pinned. Nothing is open until you open it. */
function renderHome() {
  const box = $('#empty');
  if (!box) return;
  const live = sortNotes(liveNotes());
  const recent = live.slice(0, 4);
  const favs = live.filter(n => n.fav).slice(0, 8);
  const hour = new Date().getHours();
  const hi = hour < 5 ? 'Still awake' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const vaultN = S.vault.on ? (S.vault.key ? S.vault.plain.length : S.vault.notes.length) : 0;
  const bits = [live.length + (live.length === 1 ? ' note' : ' notes')];
  if (vaultN) bits.push(vaultN + ' in the Vault');
  if (recent[0]) bits.push('last written ' + fmtWhen(recent[0].updated).toLowerCase());

  /* A card is a line of the note, not the note: markdown noise and an attachment's address read
     as damage on a page that is meant to look settled, so the words are what is shown. */
  const snippet = n => {
    const raw = String(n.body || '');
    const text = raw
      .replace(/!\[[^\]]*\]\(unote-media:[^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\(unote-media:[^)]*\)/g, '$1')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 110);
    if (/!\[[^\]]*\]\(unote-media:/.test(raw)) return 'A drawing';
    if (/unote-media:/.test(raw)) return 'An attachment';
    return 'Empty note';
  };
  const card = n => '<button class="homecard" data-note="' + n.id + '">' +
    '<span class="hc-t">' + esc(noteTitle(n)) + '</span>' +
    '<span class="hc-s">' + esc(snippet(n)) + '</span>' +
    '<span class="hc-w">' + esc(fmtWhen(n.updated)) + '</span></button>';

  box.dataset.home = '1';
  box.innerHTML =
    '<div class="home">' +
      '<div class="home-hello"><h2>' + hi + '</h2><p>' + esc(bits.join(' \u00b7 ')) + '</p></div>' +
      '<div class="home-acts">' +
        '<button class="home-btn primary" data-home="new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>New note</button>' +
        '<button class="home-btn" data-home="daily"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>Today</button>' +
        '<button class="home-btn" data-home="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></svg>Search</button>' +
      '</div>' +
      (recent.length ? '<div class="home-sec">Pick up where you left off</div><div class="home-list">' + recent.map(card).join('') + '</div>' : '') +
      (favs.length ? '<div class="home-sec">Favourites</div><div class="home-chips">' +
        favs.map(n => '<button class="tagchip" data-note="' + n.id + '">' + esc(noteTitle(n)) + '</button>').join('') + '</div>' : '') +
      /* 1.0.32 - the next reminder is on the page you land on, because a reminder you have to go
         looking for is a reminder that arrives late. */
      (typeof remNext === 'function' && remNext() ? '<div class="home-sec">Reminders</div>' +
        '<button class="listrow" data-home="remind"><span class="grow">' +
        '<span class="lr-t">' + esc(remNext().text) + '</span>' +
        '<span class="lr-s">' + esc(remWhen(remNext().at)) + (remPending().length > 1 ? ' \u00b7 ' + (remPending().length - 1) + ' more' : '') + '</span></span>' +
        '<span class="chev">\u203a</span></button>' : '') +
      /* 1.0.29 - the paragraph that walked through the long press is gone: three lines of small
         print at the foot of the page, where the list already says what it needs to. In its place
         is the shelf, which is a door rather than a lecture. */
      '<button class="listrow home-apps" data-apps="1"><span class="grow">' +
        '<span class="lr-t">Other apps</span>' +
        '<span class="lr-s">FamTM, SideCut, MeasureT, My Hub and UJournal</span></span>' +
        '<span class="chev">\u203a</span></button>' +
    '</div>';

  box.onclick = e => {
    /* #empty itself carries data-home as a flag for the stylesheet, so this has to mean the real
       buttons: closest('[data-home]') matched the page and swallowed every card tap. */
    const h = e.target.closest('button[data-home]');
    if (h) {
      if (h.dataset.home === 'new') { closeSide(); createNote({}); }
      else if (h.dataset.home === 'daily') dailyNote();
      else if (h.dataset.home === 'search') palette('search');
      else if (h.dataset.home === 'remind') remindersDialog();
      return;
    }
    const n = e.target.closest('[data-note]');
    if (n) openNote(n.dataset.note);
  };
}
