/* UNote - part 3: dialogs, the Vault, export/transfer, updates, boot. */
/* ---------------- dialog plumbing ---------------- */
let dlgOnClose = null;
function dialog(o) {
  const d = $('#dlg');
  d.className = o.cls || '';
  d.innerHTML = '<div id="dlgBody">' +
    (o.title ? '<div class="dlghead"><h3>' + esc(o.title) + '</h3><div class="grow"></div>' +
      '<button class="iconbtn" data-close="1" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' : '') +
    '<div class="dlgbody">' + (o.body || '') + '</div>' +
    (o.foot ? '<div class="dlgfoot">' + o.foot + '</div>' : '') + '</div>';
  $('#scrim').hidden = false;
  d.hidden = false;
  dlgOnClose = o.onClose || null;
  $$('[data-close]', d).forEach(b => b.addEventListener('click', closeDialog));
  return d;
}
function closeDialog() {
  $('#dlg').hidden = true;
  $('#scrim').hidden = true;
  $('#dlg').innerHTML = '';
  if (dlgOnClose) { const f = dlgOnClose; dlgOnClose = null; f(); }
}

/* ---------------- PIN pad ---------------- */
function pinDialog(o) {
  const d = dialog({
    cls: '',
    body: '<div class="vaulthero"><div class="lk"><svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.3"/></svg></div>' +
      '<h3>' + esc(o.title) + '</h3><p>' + esc(o.sub || '') + '</p></div>' +
      '<div class="pindots" id="pinDots"></div>' +
      '<div class="pinmsg" id="pinMsg"></div>' +
      '<div class="pinpad" id="pinPad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-d="' + n + '">' + n + '</button>').join('') +
      '<button data-d="del" style="font-size:14px">Delete</button><button data-d="0">0</button>' +
      '<button data-d="ok" style="font-size:14px;background:var(--accent);border-color:var(--accent);color:#fff">Enter</button>' +
      '</div>' +
      (o.extra || ''),
  });
  let pin = '';
  const dots = () => {
    $('#pinDots').innerHTML = [0, 1, 2, 3, 4, 5].map(i => '<i class="' + (i < pin.length ? 'f' : '') + '"></i>').join('');
  };
  const msg = (t, bad) => { const m = $('#pinMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
  dots();
  $('#pinPad').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const key = b.dataset.d;
    if (key === 'del') pin = pin.slice(0, -1);
    else if (key === 'ok') { if (pin.length >= 4) o.onPin(pin, { msg: msg, reset: () => { pin = ''; dots(); }, bad: t => { msg(t, true); $('#pinDots').classList.add('err'); setTimeout(() => { pin = ''; dots(); $('#pinDots').classList.remove('err'); }, 500); } }); }
    else if (pin.length < 8) pin += key;
    dots();
  });
  document.addEventListener('keydown', function onKey(e) {
    if ($('#dlg').hidden) { document.removeEventListener('keydown', onKey); return; }
    if (/^\d$/.test(e.key) && pin.length < 8) { pin += e.key; dots(); }
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); dots(); }
    else if (e.key === 'Enter' && pin.length >= 4) { o.onPin(pin, { msg: msg, reset: () => { pin = ''; dots(); }, bad: t => { msg(t, true); $('#pinDots').classList.add('err'); setTimeout(() => { pin = ''; dots(); $('#pinDots').classList.remove('err'); }, 500); } }); }
  });
  return d;
}

function vaultMeta() { return kvGet('vault').then(v => v || null); }

async function setupVaultPin(pin, ui, onDone) {
  const salt = randSalt();
  const key = await deriveKey(pin, salt, KDF_ITER);
  const verifier = await aesEnc(key, 'unote-vault-v1');
  S.vault.salt = salt; S.vault.key = key;
  S.vault.verifier = { iv: verifier.iv, ct: verifier.ct };
  await kvSet('vault', { on: true, salt: salt, iter: KDF_ITER, verifier: S.vault.verifier });
  await decryptVault();
  onDone && onDone();
}

async function onboard() {
  const d = dialog({
    body: '<div style="text-align:center;padding:6px 0 2px">' +
      '<div style="font-size:30px;font-weight:700;letter-spacing:-1px">U<b style="color:var(--accent)">Note</b></div>' +
      '<div class="sub" style="color:var(--dim);font-size:13px;margin-top:6px">A notebook that stays on this phone.</div></div>' +
      '<div class="hint" style="text-align:center;margin:18px 0 6px">Write in a note, and that is the whole app. A private Vault, behind a PIN, is there whenever you want one.</div>',
    foot: '<div class="grow"></div><button class="btn" id="obPin">Set up the Vault</button><button class="btn primary" id="obGo">Start writing</button>',
  });
  const done = () => {
    S.settings.onboarded = true;
    kvSet('settings', S.settings);
    seedWelcome();
    renderSide();
    const first = sortNotes(liveNotes()).find(n => !n.deleted);
    if (first) { S.current = first; renderDoc(); } else renderDoc();
  };
  $('#obGo', d).addEventListener('click', () => { closeDialog(); done(); });
  $('#obPin', d).addEventListener('click', () => {
    closeDialog();
    askNewPin(function afterCreate() {
      done();
      S.view = 'vault';
      renderSide();
      toast('Vault created.');
    });
  });
}

function askNewPin(done) {
  const d = dialog({
    body: '<div class="vaulthero"><div class="lk"><svg viewBox="0 0 24 24"><rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.3"/></svg></div>' +
      '<h3>Create a Vault PIN</h3><p>4 to 8 digits. It is the only key to the Vault.</p></div>' +
      '<label class="field"><span>PIN</span><input id="vp1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="4 to 8 digits"></label>' +
      '<label class="field"><span>Type it once more</span><input id="vp2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>' +
      '<div class="pinmsg" id="vpMsg"></div>' +
      '<div class="hint" style="text-align:center;margin:0">A PIN cannot be recovered. If you forget it, the Vault can only be emptied.</div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Not now</button><button class="btn primary" id="vpGo">Create the Vault</button>',
  });
  const msg = t => { const m = $('#vpMsg', d); m.textContent = t || ''; m.classList.toggle('bad', !!t); };
  const go = async () => {
    const p1 = ($('#vp1', d).value || '').trim();
    const p2 = ($('#vp2', d).value || '').trim();
    if (!/^[0-9]{4,8}$/.test(p1)) return msg('The PIN has to be 4 to 8 digits.');
    if (p1 !== p2) return msg('Those two did not match.');
    const btn = $('#vpGo', d);
    btn.disabled = true; btn.textContent = 'Sealing...';
    try {
      await setupVaultPin(p1);
      closeDialog();
      done && done();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Create the Vault';
      msg('Could not create it: ' + e.message);
    }
  };
  $('#vpGo', d).addEventListener('click', go);
  $('#vp1', d).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#vp2', d).focus(); } });
  $('#vp2', d).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { const f = $('#vp1', d); if (f) f.focus(); }, 60);
}

async function unlockDialog(after) {
  const meta = await vaultMeta();
  if (!meta || !meta.on) { askNewPin(after); return; }
  const guard = (await kvGet('vaultguard')) || { tries: 0, until: 0 };
  const waitLeft = Math.max(0, (guard.until || 0) - nowMs());
  if (waitLeft > 0) {
    toast('Too many tries. Wait ' + Math.ceil(waitLeft / 1000) + 's.');
    return;
  }
  pinDialog({
    title: 'Open the Vault',
    sub: 'Enter your PIN',
    onPin: async (pin, ui) => {
      try {
        const key = await deriveKey(pin, meta.salt, meta.iter || KDF_ITER);
        await aesDec(key, meta.verifier.iv, meta.verifier.ct);
        S.vault.key = key; S.vault.salt = meta.salt; S.vault.verifier = meta.verifier;
        await kvSet('vaultguard', { tries: 0, until: 0 });
        await decryptVault();
        closeDialog();
        toast('Vault open. It locks itself when you leave.');
        if (after) after(); else { goVault(); }
      } catch (e) {
        const g = ((await kvGet('vaultguard')) || { tries: 0 });
        g.tries = (g.tries || 0) + 1;
        if (g.tries >= 5) { g.until = nowMs() + Math.min(120000, 15000 * (g.tries - 4)); g.tries = 0; }
        await kvSet('vaultguard', g);
        ui.bad(g.until ? 'Wrong PIN. Locked for a moment.' : 'Wrong PIN (' + (5 - (g.tries || 0)) + ' tries left)');
      }
    },
    extra: '<div style="text-align:center"><button class="btn ghost" id="vaultForgot" style="font-size:12px;color:var(--dim2)">I forgot my PIN</button></div>',
  });
  const f = $('#vaultForgot');
  if (f) f.addEventListener('click', () => { closeDialog(); forgotPin(); });
}

async function decryptVault() {
  if (!S.vault.key) { S.vault.plain = []; return; }
  const recs = await dbAll('notes');
  const vrecs = recs.filter(r => r.vault);
  const out = [];
  for (const r of vrecs) {
    try {
      const j = JSON.parse(await aesDec(S.vault.key, r.iv, r.ct));
      out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: false, created: r.created, updated: r.updated, deleted: 0 });
    } catch (e) { /* a record this key cannot read stays sealed */ }
  }
  S.vault.notes = vrecs;
  S.vault.plain = out.sort((a, b) => b.updated - a.updated);
}

function goVault() {
  if (!S.vault.key) { S.view = 'vault'; renderSide(); unlockDialog(() => { S.view = 'vault'; renderSide(); }); return; }
  S.view = 'vault'; S.folder = ''; S.tag = '';
  renderSide();
}

function lockVault(quiet) {
  if (!S.vault.key) return;
  S.vault.key = null;
  S.vault.plain = [];
  if (S.current && S.current.vault) { S.current = null; renderDoc(); }
  if (S.view === 'vault') { S.view = 'notes'; }
  renderSide();
  if (!quiet) toast('Vault locked.');
}

async function forgotPin() {
  const d = dialog({
    title: 'Open the Vault without the PIN',
    body: '<div class="hint" style="margin-top:0">The Vault is sealed with a key made from your PIN. Without it, what is inside cannot be read - not by this app, not by anyone.</div>' +
      '<div class="hint">The only way forward is to empty the Vault and set a new PIN. Everything outside the Vault is untouched.</div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Keep it locked</button><button class="btn danger" id="wipeVault">Empty the Vault</button>',
  });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', closeDialog));
  $('#wipeVault', d).addEventListener('click', async () => {
    await wipeVault();
    closeDialog();
    toast('Vault emptied. Set a new PIN when you open it.');
  });
}

async function wipeVault() {
  const recs = await dbAll('notes');
  for (const r of recs) if (r.vault) await dbDel('notes', r.id);
  await kvSet('vault', null);
  await kvSet('vaultguard', { tries: 0, until: 0 });
  S.vault = { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], tries: 0, until: 0 };
  if (S.view === 'vault') S.view = 'notes';
  renderSide(); renderDoc();
}

function vaultActivity() {
  clearTimeout(vaultActivity._t);
  const mins = Number(S.settings.autolock || 0);
  if (!mins || !S.vault.key) return;
  vaultActivity._t = setTimeout(() => { lockVault(); toast('Vault locked after ' + mins + ' min.'); }, mins * MIN);
}
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => document.addEventListener(ev, vaultActivity, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.vault.key && Number(S.settings.autolock || 0) > 0) vaultActivity();
});

/* ---------------- settings ---------------- */
const ACCENTS = ['#7c5cff', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#a855f7'];

function setTheme(t) {
  S.settings.theme = t;
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0e1016' : '#f5f6fb');
  kvSet('settings', S.settings);
  if (S.current) renderDoc();
}
function setAccent(c) {
  S.settings.accent = c;
  document.documentElement.style.setProperty('--accent', c);
  document.documentElement.style.setProperty('--accent-soft', hexA(c, 0.16));
  kvSet('settings', S.settings);
}
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

/* ---------------- the other apps ---------------- */
/* One page that says what else this person made, with a single door per app. Every link leaves for the
   phone's own browser or the Play Store: the app holds no network of its own, so a link that opened
   inside it would be a blank screen, and this way the note you were reading is still behind you. */
const OTHER_APPS = [
  ['FamTM', 'The family tree in your pocket: people, birthdays and photos, kept on the phone.', 'https://github.com/AnekTheGreat/FamTM/releases/latest', 'F'],
  ['SideCut', 'A music player with its own equaliser and its own way of filing a library.', 'https://play.google.com/store/apps/details?id=com.SideCut.myapp', 'S'],
  ['MeasureT', 'Elevation, location, a level and a converter, all on one screen.', 'https://anekthegreat.github.io/Compass-EDC/', 'M'],
  ['My Hub', 'One screen that launches these apps and holds the update for each in one place.', 'https://github.com/AnekTheGreat/My-Hub/releases/latest', 'H'],
  ['UJournal', 'A journal for the days you bother to write down, from the same hand as the tree.', 'https://github.com/AnekTheGreat/Journal/releases/latest', 'J'],
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

function patchNotesDialog(justUpdated) {
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

function settingsDialog() {
  const dlg = dialog({
    cls: 'wide',
    title: 'Settings',
    body:
      '<div class="setsec"><h4>Appearance</h4><div class="sub">The page follows this on every device you use.</div>' +
      '<div class="rowset"><span class="grow">Theme</span><div class="seg" id="setTheme">' +
      '<button data-t="dark"' + (S.settings.theme === 'dark' ? ' class="on"' : '') + '>Dark</button>' +
      '<button data-t="light"' + (S.settings.theme === 'light' ? ' class="on"' : '') + '>Light</button></div></div>' +
      '<div class="rowset"><span class="grow">Accent</span><div class="swatches" id="setAccent">' +
      ACCENTS.map(c => '<button class="swatch' + (S.settings.accent === c ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>').join('') +
      '</div></div>' +
      '<div class="rowset"><span class="grow">Text size</span><div class="seg" id="setSize">' +
      [14, 16, 18, 20].map(s => '<button data-s="' + s + '"' + (Number(S.settings.size) === s ? ' class="on"' : '') + '>' + s + '</button>').join('') +
      '</div></div></div>' +

      '<div class="setsec"><h4>The Vault</h4><div class="sub">' + (S.vault.key ? 'Open right now.' : 'Locked.') + ' Notes inside are sealed with your PIN.</div>' +
      '<div class="rowset"><span class="grow">Lock after</span><div class="seg" id="setLock">' +
      [[0, 'Never'], [1, '1 min'], [2, '2 min'], [5, '5 min'], [15, '15 min']].map(([v, l]) =>
        '<button data-v="' + v + '"' + (Number(S.settings.autolock) === v ? ' class="on"' : '') + '>' + l + '</button>').join('') +
      '</div></div>' +
      '<div class="rowset"><span class="grow">PIN</span>' +
      '<button class="btn" id="setChangePin" style="padding:7px 12px;font-size:12px">Change PIN</button>' +
      '<button class="btn" id="setLockNow" style="padding:7px 12px;font-size:12px">Lock now</button></div>' +
      '<div class="hint" style="margin:8px 0 0">A forgotten PIN cannot be recovered, only emptied.</div></div>' +

      '<div class="setsec"><h4>Your data</h4><div class="sub">Nothing leaves this device unless you carry it out yourself.</div>' +
      '<button class="listrow" data-x="export"><span class="grow"><span class="lr-t">Export everything</span><span class="lr-s">One file: notes, folders, tags, settings and the sealed Vault.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="transfer"><span class="grow"><span class="lr-t">Transfer to another device</span><span class="lr-s">Copy a code, paste it on the other phone.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="import"><span class="grow"><span class="lr-t">Import a backup</span><span class="lr-s">From a file or a pasted code.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="wipeall" style="border-color:rgba(248,113,113,.35)"><span class="grow"><span class="lr-t" style="color:var(--err)">Delete everything</span><span class="lr-s">Notes, folders and the Vault, from this device.</span></span><span class="chev">›</span></button></div>' +

      '<div class="setsec"><h4>Updates</h4><div class="sub">UNote updates itself over the air. Nothing to install.</div>' +
      '<div class="rowset"><span class="grow">Version <b id="setVer">' + VERSION + '</b></span>' +
      '<button class="btn" id="setCheck" style="padding:7px 12px;font-size:12px">Check now</button></div>' +
      '<button class="listrow" data-whatsnew="1" style="margin-top:8px"><span class="grow"><span class="lr-t">Patch notes</span><span class="lr-s">What changed in every version, this one first.</span></span><span class="chev">\u203a</span></button>' +
      '<div id="setUpdMsg" class="hint" style="margin:8px 0 0">Last checked when this screen opened.</div></div>' +

      '<div class="setsec"><h4>About</h4><div class="sub">UNote - a notebook that links itself, with a vault that asks for a PIN. Made to be used for everything.</div>' +
              '<button class="listrow" data-apps="1" style="margin-top:10px"><span class="grow"><span class="lr-t">Other apps</span><span class="lr-s">FamTM, SideCut, MeasureT, My Hub and UJournal - the rest of the shelf.</span></span><span class="chev">›</span></button>' +
        '<div class="hint" style="margin:0">Version ' + VERSION + ' · ' + APP + ' · works offline · no account, no tracking, no server.</div></div>',
  });
  $('#setTheme', dlg).addEventListener('click', e => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    setTheme(b.dataset.t);
    $$('#setTheme button', dlg).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#setAccent', dlg).addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    setAccent(b.dataset.c);
    $$('#setAccent .swatch', dlg).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#setSize', dlg).addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    S.settings.size = Number(b.dataset.s);
    document.documentElement.style.setProperty('--size', S.settings.size + 'px');
    kvSet('settings', S.settings);
    $$('#setSize button', dlg).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#setLock', dlg).addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    S.settings.autolock = Number(b.dataset.v);
    kvSet('settings', S.settings); vaultActivity();
    $$('#setLock button', dlg).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#setLockNow', dlg).addEventListener('click', () => { closeDialog(); lockVault(); });
  $('#setChangePin', dlg).addEventListener('click', () => { closeDialog(); changePin(); });
  $('#setCheck', dlg).addEventListener('click', async () => {
    const m = await checkUpdate(true);
    const el = $('#setUpdMsg');
    if (el) el.textContent = m || 'You are on the newest version.';
  });
  dlg.addEventListener('click', e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const x = b.dataset.x;
    closeDialog();
    if (x === 'export') exportAll();
    else if (x === 'transfer') transferDialog();
    else if (x === 'import') importDialog();
    else if (x === 'wipeall') wipeAll();
  });
}

async function changePin() {
  const meta = await vaultMeta();
  if (!meta || !meta.on) { askNewPin(() => toast('Vault PIN set.')); return; }
  if (!S.vault.key) { unlockDialog(() => changePin()); return; }
  const d = dialog({
    title: 'Change the Vault PIN',
    body: '<label class="field"><span>New PIN</span><input id="cp1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" placeholder="4 to 8 digits"></label>' +
      '<label class="field"><span>New PIN again</span><input id="cp2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"></label>' +
      '<div class="pinmsg" id="cpMsg"></div>' +
      '<div class="hint" style="margin:0">Every note in the Vault is resealed with the new PIN, and the old one stops working.</div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Cancel</button><button class="btn primary" id="cpGo">Change it</button>',
  });
  const msg = t => { const m = $('#cpMsg', d); m.textContent = t || ''; m.classList.toggle('bad', !!t); };
  const go = async () => {
    const p1 = ($('#cp1', d).value || '').trim();
    const p2 = ($('#cp2', d).value || '').trim();
    if (!/^[0-9]{4,8}$/.test(p1)) return msg('The PIN has to be 4 to 8 digits.');
    if (p1 !== p2) return msg('Those two did not match.');
    const btn = $('#cpGo', d);
    btn.disabled = true; btn.textContent = 'Resealing...';
    try {
      const plain = S.vault.plain.slice();
      const salt = randSalt();
      const key = await deriveKey(p1, salt, KDF_ITER);
      const verifier = await aesEnc(key, 'unote-vault-v1');
      for (const n of plain) {
        const box = await aesEnc(key, JSON.stringify({ title: n.title, body: n.body, folder: n.folder }));
        await dbPut('notes', { id: n.id, vault: true, created: n.created, updated: n.updated, iv: box.iv, ct: box.ct });
      }
      S.vault.key = key; S.vault.salt = salt;
      S.vault.verifier = { iv: verifier.iv, ct: verifier.ct };
      await kvSet('vault', { on: true, salt: salt, iter: KDF_ITER, verifier: S.vault.verifier });
      await decryptVault();
      closeDialog();
      toast('PIN changed. ' + plain.length + ' vault note' + (plain.length === 1 ? '' : 's') + ' resealed.');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Change it';
      msg('Could not change it: ' + e.message);
    }
  };
  $('#cpGo', d).addEventListener('click', go);
  $('#cp2', d).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { const f = $('#cp1', d); if (f) f.focus(); }, 60);
}

async function wipeAll() {
  const d = dialog({
    title: 'Delete everything',
    body: '<div class="hint" style="margin-top:0">This empties every note, every folder and the whole Vault on this device. It cannot be undone unless you exported a backup.</div>' +
      '<label class="field"><span>Type DELETE to confirm</span><input id="wipeWord" autocomplete="off"></label>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Keep my notes</button><button class="btn danger" id="wipeGo" disabled>Delete everything</button>',
  });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', closeDialog));
  const input = $('#wipeWord', d), go = $('#wipeGo', d);
  input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'DELETE'; });
  go.addEventListener('click', async () => {
    for (const n of S.notes) await dbDel('notes', n.id);
    for (const r of S.vault.notes) await dbDel('notes', r.id);
    await kvSet('vault', null);
    await kvSet('settings', { onboarded: false });
    location.reload();
  });
}

/* ---------------- export / transfer / import ---------------- */
async function buildBundle() {
  const meta = (await vaultMeta()) || null;
  const recs = await dbAll('notes');
  return {
    app: APP, kind: 'backup', version: VERSION, at: new Date().toISOString(),
    settings: { theme: S.settings.theme, accent: S.settings.accent, size: S.settings.size, mode: S.settings.mode, autolock: S.settings.autolock, sort: S.settings.sort },
    notes: recs.filter(r => !r.vault),
    vault: meta && meta.on ? { on: true, salt: meta.salt, iter: meta.iter, verifier: meta.verifier, notes: recs.filter(r => r.vault) } : { on: false },
  };
}

async function exportAll() {
  try {
    const bundle = await buildBundle();
    const name = 'unote-' + dayKey() + '.unote.json';
    const blob = new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const msg = bundle.notes.length + ' note' + (bundle.notes.length === 1 ? '' : 's') +
      (bundle.vault.on ? ' + ' + bundle.vault.notes.length + ' sealed in the Vault' : '');
    toast('Exported ' + msg + ' to ' + name, 4200);
  } catch (e) { toast('Export failed: ' + e.message); }
}

async function pack(str) {
  const bytes = new TextEncoder().encode(str);
  if (typeof CompressionStream === 'undefined') return toB64(bytes);
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(cs).arrayBuffer();
  return 'gz:' + toB64(buf);
}
async function unpack(code) {
  const t = String(code || '').trim().replace(/^UNOTE1:/i, '');
  if (t.startsWith('gz:')) {
    const raw = fromB64(t.slice(3));
    const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await new Response(ds).arrayBuffer());
  }
  return new TextDecoder().decode(fromB64(t));
}

async function transferDialog() {
  const bundle = await buildBundle();
  const code = 'UNOTE1:' + await pack(JSON.stringify(bundle));
  const sizeKb = Math.round(code.length / 1024);
  const d = dialog({
    cls: 'wide',
    title: 'Transfer to another device',
    body: '<div class="hint" style="margin-top:0">Everything, in one code (' + sizeKb + ' KB). On the other phone: Settings → Your data → Import a backup → paste it.</div>' +
      '<label class="field"><span>The code</span><textarea id="trCode" rows="6" style="font-family:var(--mono);font-size:11px" readonly></textarea></label>' +
      (sizeKb > 1800 ? '<div class="hint">That is a lot of text for one clipboard. A file is safer: use Export everything.</div>' : '') +
      '<div class="hint" id="trMsg">The Vault inside is still sealed with your PIN.</div>',
    foot: '<div class="grow"></div><button class="btn" id="trFile">Save as a file instead</button><button class="btn primary" id="trCopy">Copy the code</button>',
  });
  $('#trCode', d).value = code;
  $('#trCopy', d).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      $('#trMsg', d).textContent = 'Copied. Paste it into Import on the other phone.';
    } catch (e) {
      $('#trCode', d).select();
      $('#trMsg', d).textContent = 'Select all of the text above and copy it.';
    }
  });
  $('#trFile', d).addEventListener('click', () => { closeDialog(); exportAll(); });
}

async function importDialog() {
  const d = dialog({
    cls: 'wide',
    title: 'Import a backup',
    body: '<div class="hint" style="margin-top:0">Pick the .unote.json file, or paste a transfer code.</div>' +
      '<button class="listrow" id="impPick"><span class="grow"><span class="lr-t">Choose a file</span><span class="lr-s">A UNote backup from this or another device.</span></span><span class="chev">›</span></button>' +
      '<label class="field" style="margin-top:12px"><span>Or paste a transfer code</span><textarea id="impCode" rows="5" style="font-family:var(--mono);font-size:11px" placeholder="UNOTE1:…"></textarea></label>' +
      '<div class="rowset"><span class="grow">How to bring it in</span><div class="seg" id="impMode">' +
      '<button data-m="merge" class="on">Merge</button><button data-m="replace">Replace everything</button></div></div>' +
      '<div class="hint">Merge keeps what is here and adds anything newer from the backup. Replace clears this device first.</div>' +
      '<input type="file" id="impFile" accept=".json,.unote,application/json" hidden>',
    foot: '<div class="grow"></div><button class="btn primary" id="impGo">Import</button>',
  });
  let mode = 'merge';
  const pick = () => $('#impFile', d).click();
  $('#impPick', d).addEventListener('click', pick);
  $('#impFile', d).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    await runImport(text, mode);
  });
  $('#impMode', d).addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    mode = b.dataset.m; $$('#impMode button', d).forEach(x => x.classList.toggle('on', x === b));
  });
  $('#impGo', d).addEventListener('click', async () => {
    const code = $('#impCode', d).value.trim();
    if (!code) { pick(); return; }
    await runImport(code, mode);
  });
}

async function runImport(text, mode) {
  let bundle;
  try {
    let raw = String(text || '').trim();
    if (!raw) throw new Error('Nothing to import');
    if (/^UNOTE1:/i.test(raw)) raw = await unpack(raw);
    bundle = JSON.parse(raw);
    if (bundle.app !== APP || !Array.isArray(bundle.notes)) throw new Error('That is not a UNote backup');
  } catch (e) { toast('Could not read that: ' + e.message, 4000); return; }

  let added = 0, updated = 0;
  if (mode === 'replace') {
    for (const n of S.notes) await dbDel('notes', n.id);
    for (const r of S.vault.notes) await dbDel('notes', r.id);
    S.notes = []; S.vault.notes = []; S.vault.plain = [];
  }
  for (const n of bundle.notes) {
    const old = S.notes.find(x => x.id === n.id);
    if (old && (old.updated || 0) >= (n.updated || 0)) continue;
    if (old) updated++; else added++;
    await dbPut('notes', n);
  }
  S.notes = (await dbAll('notes')).filter(r => !r.vault);

  if (bundle.vault && bundle.vault.on) {
    const meta = await vaultMeta();
    if (!meta || !meta.on) {
      await kvSet('vault', { on: true, salt: bundle.vault.salt, iter: bundle.vault.iter || KDF_ITER, verifier: bundle.vault.verifier });
      for (const r of bundle.vault.notes || []) await dbPut('notes', r);
      S.vault.key = null;
    } else if (JSON.stringify(meta.verifier) === JSON.stringify(bundle.vault.verifier)) {
      for (const r of bundle.vault.notes || []) await dbPut('notes', r);
    } else {
      toast('Vault skipped: the backup was sealed with a different PIN.', 4600);
    }
  }
  if (bundle.settings) {
    Object.assign(S.settings, bundle.settings);
    kvSet('settings', S.settings);
    setTheme(S.settings.theme); setAccent(S.settings.accent);
    document.documentElement.style.setProperty('--size', (S.settings.size || 16) + 'px');
  }
  if (S.vault.key) await decryptVault();
  closeDialog();
  renderSide(); renderDoc();
  toast('Imported: ' + added + ' new, ' + updated + ' updated.', 3600);
}

/* ---------------- updates (over the air) ---------------- */
function cmpVer(a, b) {
  const x = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const y = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
async function checkUpdate(manual) {
  try {
    const r = await fetch('updates.json?t=' + nowMs(), { cache: 'no-store' });
    if (!r.ok) throw new Error('no updates file');
    const j = await r.json();
    if (cmpVer(j.version, VERSION) > 0) {
      const chip = $('#updChip');
      chip.hidden = false;
      chip.textContent = 'Update ' + j.version + ' ready';
      chip.onclick = () => applyUpdate(j);
      if (manual) toast('Version ' + j.version + ' is ready. Tap the chip to install it.', 4000);
      return 'Version ' + j.version + ' is ready. Tap the chip at the bottom to install it.';
    }
    $('#updChip').hidden = true;
    return 'You are on the newest version (' + VERSION + ').';
  } catch (e) {
    if (manual) toast('Could not check for updates.');
    return 'Could not check for updates right now.';
  }
}
async function applyUpdate(j) {
  toast('Updating to ' + (j && j.version ? j.version : 'the newest version') + '…', 3000);
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

/* ---------------- small dialogs ---------------- */
function folderDialog() {
  const d = dialog({
    title: 'New folder',
    body: '<label class="field"><span>Name</span><input id="foldName" placeholder="e.g. Work, Ideas, Recipes" maxlength="40"></label>' +
      '<div class="hint">Folders are one level. A note can sit in one folder and carry as many #tags as you like.</div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Cancel</button><button class="btn primary" id="foldGo">Create</button>',
  });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', closeDialog));
  const go = async () => {
    const name = $('#foldName', d).value.trim();
    if (!name) return;
    S.folder = name; S.tag = '';
    closeDialog();
    await createNote({ folder: name });
    S.current.title = '';
    renderSide();
    toast('Folder "' + name + '" is ready - this note is the first in it.');
  };
  $('#foldGo', d).addEventListener('click', go);
  $('#foldName', d).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  setTimeout(() => $('#foldName').focus(), 40);
}

async function dailyNote() {
  const title = 'Daily ' + dayKey();
  const hit = findTitle(title);
  if (hit) { closeSide(); openNote(hit.id); return; }
  const n = await createNote({});
  n.title = title;
  n.body = '## ' + new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '\n\n- [ ] \n\n#daily\n';
  await saveNote(n);
  closeSide();
  openNote(n.id);
}

function noteMenu() {
  const n = S.current; if (!n) return;
  const d = dialog({
    title: noteTitle(n),
    body: (n.deleted ? '' : '<label class="field"><span>Folder</span><input id="nmFolder" value="' + esc(n.folder || '') + '" placeholder="No folder" maxlength="40"></label>') +
      '<button class="listrow" data-a="fav"><span class="grow"><span class="lr-t">' + (n.fav ? 'Remove from favourites' : 'Pin to favourites') + '</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-a="copy"><span class="grow"><span class="lr-t">Copy as markdown</span><span class="lr-s">The whole note, formatted.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-a="md"><span class="grow"><span class="lr-t">Save as a .md file</span></span><span class="chev">›</span></button>' +
      (n.vault ? '' : '<button class="listrow" data-a="vault"><span class="grow"><span class="lr-t">Move into the Vault</span><span class="lr-s">Sealed with your PIN, out of the plain note list.</span></span><span class="chev">›</span></button>') +
      (n.deleted
        ? '<button class="listrow" data-a="restore"><span class="grow"><span class="lr-t">Restore this note</span></span><span class="chev">›</span></button>' +
          '<button class="listrow" data-a="purge" style="border-color:rgba(248,113,113,.35)"><span class="grow"><span class="lr-t" style="color:var(--err)">Delete for ever</span></span><span class="chev">›</span></button>'
        : '<button class="listrow" data-a="trash" style="border-color:rgba(248,113,113,.35)"><span class="grow"><span class="lr-t" style="color:var(--err)">Move to trash</span></span><span class="chev">›</span></button>'),
    foot: '<div class="grow"></div><button class="btn primary" id="nmDone">Done</button>',
  });
  $('#nmDone', d).addEventListener('click', async () => {
    const f = $('#nmFolder', d);
    if (f) { n.folder = f.value.trim(); await saveNote(n); renderSide(); renderDoc(); }
    closeDialog();
  });
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    closeDialog();
    if (a === 'fav') { n.fav = !n.fav; await saveNote(n); renderDoc(); renderSide(); }
    if (a === 'copy') {
      try { await navigator.clipboard.writeText('# ' + noteTitle(n) + '\n\n' + (n.body || '')); toast('Copied.'); }
      catch (err) { toast('Could not reach the clipboard.'); }
    }
    if (a === 'md') {
      const blob = new Blob(['# ' + noteTitle(n) + '\n\n' + (n.body || '')], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url; a2.download = noteTitle(n).replace(/[^\w\- ]+/g, '') + '.md';
      document.body.appendChild(a2); a2.click(); a2.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
    if (a === 'trash') { n.deleted = nowMs(); await saveNote(n); S.current = null; renderDoc(); renderSide(); toast('Moved to trash.'); }
    if (a === 'restore') { n.deleted = 0; await saveNote(n); renderDoc(); renderSide(); toast('Restored.'); }
    if (a === 'purge') {
      await dbDel('notes', n.id);
      S.notes = S.notes.filter(x => x.id !== n.id);
      S.vault.plain = S.vault.plain.filter(x => x.id !== n.id);
      S.vault.notes = S.vault.notes.filter(x => x.id !== n.id);
      S.current = null; renderDoc(); renderSide(); toast('Deleted for good.');
    }
    if (a === 'vault') {
      if (!S.vault.key) { unlockDialog(() => moveToVault(n)); return; }
      moveToVault(n);
    }
  });
}
async function moveToVault(n) {
  if (!S.vault.key) return;
  const v = { id: n.id, vault: true, title: n.title, body: n.body, folder: n.folder, created: n.created, updated: nowMs(), deleted: 0 };
  await dbPut('notes', { id: n.id, vault: true, created: v.created, updated: v.updated, iv: null, ct: null });
  await saveNote(v);
  S.notes = S.notes.filter(x => x.id !== n.id);
  S.vault.plain.unshift(v);
  S.current = v; S.view = 'vault';
  await decryptVault();
  S.current = findNote(v.id) || v;
  renderSide(); renderDoc();
  toast('Moved into the Vault.');
}

/* ---------------- boot + wiring ---------------- */
function seedWelcome() {
  if (S.notes.length) return;
  const t = nowMs();
  S.notes.push({
    id: uid(), title: 'Welcome', folder: '', fav: true, created: t, updated: t, deleted: 0,
    body: 'This is a note. Tap it and type - that is the whole app.\n\n' +
      'Two things you can do as you go:\n\n' +
      '- Type [[another note]] and the two are linked, in both directions.\n' +
      '- Type #idea anywhere and it shows up under Tags.\n\n' +
      'The lock on the left is the Vault: a private space for notes, behind a PIN you choose the first time you open it. Nothing else here needs setting up.\n\n' +
      '- [ ] Write something real\n\n#start',
  });
  saveNote(S.notes[0], { quiet: true });
}

function closeSide() { $('#side').classList.remove('open'); }

async function boot() {
  await openDB();
  const saved = await kvGet('settings');
  if (saved) Object.assign(S.settings, saved);
  const meta = await vaultMeta();
  if (meta && meta.on) { S.vault.on = true; S.vault.salt = meta.salt; S.vault.verifier = meta.verifier; }

  document.documentElement.dataset.theme = S.settings.theme || 'dark';
  setAccent(S.settings.accent || '#7c5cff');
  document.documentElement.style.setProperty('--size', (S.settings.size || 16) + 'px');
  setMode(S.settings.mode || 'split');
  $('#sVer').textContent = 'UNote ' + VERSION;

  const recs = await dbAll('notes');
  S.notes = recs.filter(r => !r.vault);
  S.vault.notes = recs.filter(r => r.vault);
  S.vault.plain = [];

  renderSide();
  if (!S.settings.onboarded) { onboard(); }
  else {
    const first = sortNotes(liveNotes()).find(n => !n.deleted);
    if (first) { S.current = first; renderDoc(); } else renderDoc();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('#btnWhats, [data-whatsnew]');
    if (b) { e.preventDefault(); e.stopPropagation(); patchNotesDialog(false); }
  });
  if (S.settings.seen && S.settings.seen !== VERSION) setTimeout(() => patchNotesDialog(true), 1100);
  if (S.settings.seen !== VERSION) { S.settings.seen = VERSION; kvSet('settings', S.settings).catch(() => {}); }
  setTimeout(() => checkUpdate(false), 1200);

  // rail
  $$('#rail .rbtn[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'notes') { S.view = 'notes'; S.folder = ''; S.tag = ''; $('#side').classList.add('open'); renderSide(); }
    if (go === 'search') palette('search');
    if (go === 'graph') openGraph();
    if (go === 'tags') { S.view = 'tags'; S.folder = ''; renderSide(); }
    if (go === 'vault') goVault();
    if (go === 'settings') settingsDialog();
  }));
  $('#menuBtn').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#sideClose').addEventListener('click', closeSide);

  // sidebar delegation
  $('#sideBody').addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const v = nav.dataset.nav;
      if (v === 'vault') { goVault(); return; }
      S.view = v; S.folder = ''; S.tag = ''; renderSide(); return;
    }
    const note = e.target.closest('[data-note]');
    if (note) { openNote(note.dataset.note); return; }
    const fold = e.target.closest('[data-folder]');
    if (fold) { S.folder = fold.dataset.folder || ''; S.tag = ''; renderSide(); return; }
    const tag = e.target.closest('[data-tag]');
    if (tag) { S.tag = S.tag === tag.dataset.tag ? '' : tag.dataset.tag; renderSide(); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'folder') folderDialog();
      if (act.dataset.act === 'sort') { S.settings.sort = S.settings.sort === 'title' ? 'updated' : 'title'; kvSet('settings', S.settings); renderSide(); }
      if (act.dataset.act === 'unlock') unlockDialog(() => { S.view = 'vault'; renderSide(); });
    }
  });

  $('#qNew').addEventListener('click', () => { closeSide(); createNote({}); });
  $('#qFolder').addEventListener('click', folderDialog);
  $('#qDaily').addEventListener('click', dailyNote);
  $('#btnPalette').addEventListener('click', () => palette('command'));
  $('#emptyNew').addEventListener('click', () => createNote({}));

  // modes
  $$('#modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // title + body
  $('#title').addEventListener('input', () => {
    if (!S.current) return;
    S.current.title = $('#title').value;
    queueSave();
    renderSide();
    refreshDocMeta();
  });
  $('#title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#ed').focus(); } });

  const ed = $('#ed');
  ed.addEventListener('input', () => {
    if (!S.current) return;
    S.current.body = ed.value;
    if (document.body.dataset.mode !== 'edit') $('#pv').innerHTML = md(ed.value);
    queueSave();
    $('#sWords').textContent = words(ed.value) + ' words';
    refreshDocMeta();
    suggestClose();
  });
  ed.addEventListener('keydown', e => editorKey(e, ed));

  // preview clicks
  $('#pv').addEventListener('click', e => {
    const wl = e.target.closest('[data-w]');
    if (wl) { const hit = findTitle(wl.dataset.w); if (hit) openNote(hit.id); else createMissing(wl.dataset.w); return; }
    const tag = e.target.closest('[data-tag]');
    if (tag) { S.tag = tag.dataset.tag; S.view = 'notes'; renderSide(); return; }
    const a = e.target.closest('a[href^="http"]');
    if (a) { a.target = '_blank'; }
  });

  // right pane
  $('#rbody').addEventListener('click', async e => {
    const n = e.target.closest('[data-note]'); if (n) { openNote(n.dataset.note); return; }
    const mk = e.target.closest('[data-make]'); if (mk) { createMissing(mk.dataset.make); return; }
    const tag = e.target.closest('[data-tag]'); if (tag) { S.tag = tag.dataset.tag; S.view = 'notes'; renderSide(); return; }
    const j = e.target.closest('[data-jump]');
    if (j) {
      const t = j.dataset.jump.toLowerCase();
      const lines = String(S.current.body || '').split('\n');
      const i = lines.findIndex(l => l.replace(/^#+\s*/, '').trim().toLowerCase() === t);
      if (i >= 0) {
        if (document.body.dataset.mode === 'read') {
          const heads = $$('#pv h1,#pv h2,#pv h3,#pv h4');
          const hit = heads.find(h => h.textContent.trim().toLowerCase() === t);
          if (hit) hit.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          const pos = lines.slice(0, i).join('\n').length;
          ed.focus(); ed.setSelectionRange(pos, pos);
        }
      }
      e.preventDefault();
    }
  });
  $$('.rtabs button').forEach(b => b.addEventListener('click', () => {
    S.right = b.dataset.rt;
    $$('.rtabs button').forEach(x => x.classList.toggle('on', x === b));
    renderRight();
  }));

  $('#btnFav').addEventListener('click', async () => {
    if (!S.current) return;
    S.current.fav = !S.current.fav;
    await saveNote(S.current);
    renderDoc(); renderSide();
    toast(S.current.fav ? 'Pinned to favourites.' : 'Removed from favourites.');
  });
  $('#btnMore').addEventListener('click', noteMenu);
  $('#updChip').addEventListener('click', () => checkUpdate(true).then(() => { const c = $('#updChip'); if (!c.hidden) c.onclick(); }));

  // dialogs close on backdrop / Esc
  $('#scrim').addEventListener('click', closeDialog);
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); palette('command'); }
    else if (mod && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); palette('search'); }
    else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (S.current) saveNote(S.current).then(() => toast('Saved.')); }
    else if (mod && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); setMode(document.body.dataset.mode === 'read' ? 'split' : 'read'); }
    else if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); lockVault(); }
    else if (e.key === 'Escape') {
      if (!$('#graphwrap').hidden) closeGraph();
      else if (!$('#dlg').hidden) closeDialog();
      else if ($('#side').classList.contains('open')) closeSide();
      else suggestClose();
    }
  });

  // graph gestures
  const gc = $('#graph');
  gc.addEventListener('pointerdown', e => {
    const r = gc.getBoundingClientRect();
    const hit = graphHit(e.clientX - r.left, e.clientY - r.top);
    G.drag = { node: hit || null, x: e.clientX, y: e.clientY, moved: false, tx: G.tx, ty: G.ty };
    gc.classList.add('drag');
  });
  gc.addEventListener('pointermove', e => {
    if (!G.drag) return;
    const dx = e.clientX - G.drag.x, dy = e.clientY - G.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) G.drag.moved = true;
    if (G.drag.node) {
      const r = gc.getBoundingClientRect();
      G.drag.node.x = (e.clientX - r.left - G.tx) / G.scale;
      G.drag.node.y = (e.clientY - r.top - G.ty) / G.scale;
    } else { G.tx = G.drag.tx + dx; G.ty = G.drag.ty + dy; }
  });
  window.addEventListener('pointerup', () => {
    if (G.drag && !G.drag.moved && G.drag.node) { const id = G.drag.node.id; closeGraph(); openNote(id); }
    G.drag = null; gc.classList.remove('drag');
  });
  gc.addEventListener('wheel', e => {
    if ($('#graphwrap').hidden) return;
    e.preventDefault();
    const r = gc.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.12 : 0.89;
    const ns = clamp(G.scale * k, 0.35, 3);
    G.tx = mx - (mx - G.tx) * (ns / G.scale);
    G.ty = my - (my - G.ty) * (ns / G.scale);
    G.scale = ns;
  }, { passive: false });
  $('#graphClose').addEventListener('click', closeGraph);
  window.addEventListener('resize', () => { if (!$('#graphwrap').hidden) sizeGraph(); });

  // keep the vault closed when the app is put away for a while
  window.addEventListener('beforeunload', () => { if (S.current && S.dirty) saveNote(S.current); });
}

/* ---------------- editor behaviour ---------------- */
let sugg = null, suggItems = [], suggSel = 0;
function suggestClose() { if (sugg) { sugg.remove(); sugg = null; suggItems = []; } }
function suggestUpdate(el) {
  const pos = el.selectionStart;
  const before = el.value.slice(Math.max(0, pos - 60), pos);
  const m = before.match(/\[\[([^\]\n]*)$/);
  if (!m) { suggestClose(); return; }
  const q = m[1].toLowerCase();
  const items = sortNotes(liveNotes().concat(S.vault.plain))
    .filter(n => noteTitle(n).toLowerCase().includes(q))
    .slice(0, 6);
  if (!items.length) { suggestClose(); return; }
  suggItems = items; suggSel = 0;
  if (!sugg) {
    sugg = document.createElement('div');
    sugg.style.cssText = 'position:fixed;z-index:45;background:var(--panel);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow);padding:6px;min-width:220px;max-width:80vw';
    document.body.appendChild(sugg);
  }
  const r = el.getBoundingClientRect();
  sugg.style.left = Math.min(r.left + 20, window.innerWidth - 260) + 'px';
  sugg.style.top = Math.min(r.top + 90, window.innerHeight - 240) + 'px';
  sugg.innerHTML = suggItems.map((n, i) =>
    '<button class="palitem' + (i === suggSel ? ' on' : '') + '" data-sg="' + i + '" style="width:100%">' +
    '<span class="pi-t">' + esc(noteTitle(n)) + '</span><span class="pi-k">' + (n.vault ? 'Vault' : 'Note') + '</span></button>').join('');
  $$('#noop').length;
  Array.from(sugg.children).forEach(b => b.addEventListener('mousedown', ev => {
    ev.preventDefault();
    insertSuggestion(el, suggItems[+b.dataset.sg]);
  }));
}
function insertSuggestion(el, note) {
  const pos = el.selectionStart;
  const before = el.value.slice(0, pos), after = el.value.slice(pos);
  const m = before.match(/\[\[([^\]\n]*)$/);
  if (!m) return;
  const start = before.length - m[0].length;
  const title = noteTitle(note);
  el.value = before.slice(0, start) + '[[' + title + ']]' + after;
  const caret = start + title.length + 4;
  el.setSelectionRange(caret, caret);
  S.current.body = el.value;
  $('#pv').innerHTML = md(el.value);
  queueSave();
  suggestClose();
}
function wrapSel(el, pre, post) {
  const a = el.selectionStart, b = el.selectionEnd;
  const v = el.value;
  el.value = v.slice(0, a) + pre + v.slice(a, b) + post + v.slice(b);
  el.setSelectionRange(a + pre.length, b + pre.length);
  el.dispatchEvent(new Event('input'));
}
function editorKey(e, el) {
  if (sugg && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    suggSel = clamp(suggSel + (e.key === 'ArrowDown' ? 1 : -1), 0, suggItems.length - 1);
    Array.from(sugg.children).forEach((b, i) => b.classList.toggle('on', i === suggSel));
    return;
  }
  if (sugg && e.key === 'Enter') { e.preventDefault(); insertSuggestion(el, suggItems[suggSel]); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); wrapSel(el, '**', '**'); return; }
  if (mod && (e.key === 'i' || e.key === 'I') && !e.shiftKey) { e.preventDefault(); wrapSel(el, '*', '*'); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const a = el.selectionStart;
    el.value = el.value.slice(0, a) + '  ' + el.value.slice(el.selectionEnd);
    el.setSelectionRange(a + 2, a + 2);
    el.dispatchEvent(new Event('input'));
    return;
  }
  if (e.key === 'Enter') {
    const pos = el.selectionStart;
    const line = el.value.slice(el.value.lastIndexOf('\n', pos - 1) + 1, pos);
    const m = line.match(/^(\s*)([-*+]\s(\[[ xX]\]\s)?|\d+[.)]\s)(.*)$/);
    if (m && !m[4].trim()) { e.preventDefault(); el.value = el.value.slice(0, pos) + '\n' + m[1] + el.value.slice(el.selectionEnd); el.setSelectionRange(pos + 1 + m[1].length, pos + 1 + m[1].length); el.dispatchEvent(new Event('input')); return; }
    if (m) {
      e.preventDefault();
      let bullet = m[2];
      if (/^\d/.test(bullet)) bullet = (parseInt(bullet, 10) + 1) + '. ';
      const ins = '\n' + m[1] + bullet;
      el.value = el.value.slice(0, pos) + ins + el.value.slice(el.selectionEnd);
      el.setSelectionRange(pos + ins.length, pos + ins.length);
      el.dispatchEvent(new Event('input'));
      return;
    }
  }
  setTimeout(() => suggestUpdate(el), 0);
}

/* start */
document.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    document.body.innerHTML = '<div style="padding:40px;font:15px system-ui;color:#e9ecf4">' +
      'UNote could not start.<br><br><code style="opacity:.7">' + esc(err && err.message) + '</code></div>';
  });
});
