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
  importAfter = null;            // an import sheet that was closed was not an import
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
  S.vault.salt = salt; S.vault.key = key; S.vault.on = true;
  S.vault.verifier = { iv: verifier.iv, ct: verifier.ct };
  await kvSet('vault', { on: true, salt: salt, iter: KDF_ITER, verifier: S.vault.verifier });
  await decryptVault();
  onDone && onDone();
}

async function onboard() {
  /* 1.0.15 - the welcome counts as met the moment it is on the screen, not when its button is
     pressed, so a phone put down on the welcome does not open on it again tomorrow. */
  S.settings.onboarded = true;
  kvSet('settings', S.settings).catch(() => {});
  const d = dialog({
    body: '<div style="text-align:center;padding:6px 0 2px">' +
      '<div style="font-size:30px;font-weight:700;letter-spacing:-1px">U<b style="color:var(--accent)">Note</b></div>' +
      '<div class="sub" style="color:var(--dim);font-size:13px;margin-top:6px">A notebook that stays on this phone.</div></div>' +
      '<div class="hint" style="text-align:center;margin:18px 0 6px">Write in a note, and that is the whole app. A private Vault, behind a PIN, is there whenever you want one.</div>' +
      '<div class="hint" style="text-align:center;margin:0 0 6px">Coming from another phone? Import a backup first: everything comes across, and the Vault stays sealed with the PIN it had.</div>',
    foot: '<div class="grow"></div><button class="btn" id="obVault">Vault</button>' +
      '<button class="btn" id="obImport">Import a backup</button>' +
      '<button class="btn primary" id="obGo">Start writing</button>',
  });
  $('#obGo', d).addEventListener('click', () => { closeDialog(); finishOnboarding(); });
  $('#obVault', d).addEventListener('click', () => {
    closeDialog();
    askNewPin(function afterCreate() {
      finishOnboarding();
      S.view = 'vault';
      renderSide();
      toast('Vault created.');
    });
  });
  /* 1.0.20 - the welcome offers the import, so a new phone can start from the backup file before
     anything is written here. Whatever comes in is opened afterwards, and the welcome is finished. */
  $('#obImport', d).addEventListener('click', () => {
    closeDialog();
    importDialog(() => finishOnboarding());
  });
}

function finishOnboarding() {
  S.settings.onboarded = true;
  kvSet('settings', S.settings);
  seedWelcome();                       // a note list that came from a backup is left alone
  renderSide();
  const first = sortNotes(liveNotes()).find(n => !n.deleted);
  if (first) { S.current = first; renderDoc(); } else renderDoc();
}

/* ---------------- PIN entry with no keyboard ---------------- */

/* Two entries on the same number pad that unlocks the Vault. Nothing is typed into a text
   field, so no keyboard opens and the phone's password manager has nothing to offer. */
function askPinPair(o) {
  const step = first => {
    closeDialog();
    pinDialog({
      title: first ? 'Type the PIN once more' : o.title,
      sub: first ? 'The same digits, to be sure.' : o.sub,
      extra: first
        ? '<div class="hint" style="text-align:center;margin:10px 0 0">A PIN cannot be recovered.</div>'
        : '<div class="hint" style="text-align:center;margin:10px 0 0">Just the keypad - no keyboard, no password pop-up.</div>' +
          '<div style="text-align:center;margin-top:10px"><button class="btn ghost" id="pinPairCancel" style="font-size:12px;color:var(--dim2)">Not now</button></div>',
      onPin: (pin, ui) => {
        if (!first) { step(pin); return; }
        if (pin !== first) {
          closeDialog();
          toast('Those two did not match. Start again.', 3600);
          setTimeout(() => step(null), 420);
          return;
        }
        closeDialog();
        o.onPin(first);
      },
    });
    const c = document.getElementById('pinPairCancel');
    if (c) c.addEventListener('click', () => closeDialog());
  };
  step(null);
}

function askNewPin(done) {
  askPinPair({
    title: 'Create a Vault PIN',
    sub: '4 to 8 digits. It is the only key to the Vault.',
    onPin: async pin => {
      toast('Sealing the Vault...', 1800);
      try { await setupVaultPin(pin); done && done(); }
      catch (e) { toast('Could not create it: ' + e.message, 4200); }
    },
  });
}

async function unlockDialog(after) {
  const meta = await vaultMeta();
  if (!meta || !meta.on) {
    /* 1.0.16 - if sealed notes are already on this phone, a "new" Vault would bury them for good.
       Say so instead of quietly taking a new PIN over the top of them. */
    const sealed = (await dbAll('notes')).filter(r => r.vault).length;
    if (sealed) {
      dialog({
        title: 'These notes are still sealed',
        body: '<div class="hint" style="margin-top:0">This phone holds ' + sealed + ' sealed Vault note' + (sealed === 1 ? '' : 's') + ', but the record that checks the PIN is missing, so nothing here can open them.</div>' +
          '<div class="hint">Setting a new PIN now would leave them sealed for good. If you have a backup file, import that first: a backup brings its own PIN back with it.</div>',
        foot: '<div class="grow"></div><button class="btn" data-close="1">Leave them sealed</button>',
      });
      return;
    }
    askNewPin(after); return;
  }
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
        const kept = await flushVaultPending();
        closeDialog();
        toast(kept
          ? 'Vault open. ' + kept + (kept === 1 ? ' note you had written while it was locked is saved now.' : ' notes you had written while it was locked are saved now.')
          : 'Vault open. It locks itself when you leave.');
        if (after) after(); else { goVault(); }
      } catch (e) {
        const g = ((await kvGet('vaultguard')) || { tries: 0 });
        g.tries = (g.tries || 0) + 1;
        if (g.tries >= 5) { g.until = nowMs() + Math.min(120000, 15000 * (g.tries - 4)); g.tries = 0; }
        await kvSet('vaultguard', g);
        ui.bad(g.until ? 'Wrong PIN. Locked for a moment.' : 'Wrong PIN (' + (5 - (g.tries || 0)) + ' tries left)');
      }
    },
    extra: '<div style="text-align:center"><button class="btn ghost" id="vaultForgot" style="font-size:12px;color:var(--dim2)">Forgot the PIN? Reset the Vault</button></div>',
  });
  const f = $('#vaultForgot');
  if (f) f.addEventListener('click', () => { closeDialog(); resetVault(); });
}

async function decryptVault() {
  if (!S.vault.key) { S.vault.plain = []; return; }
  const recs = await dbAll('notes');
  const vrecs = recs.filter(r => r.vault);
  const out = [];
  for (const r of vrecs) {
    try {
      const j = JSON.parse(await aesDec(S.vault.key, r.iv, r.ct));
      out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: !!j.fav, ink: j.ink || null, created: r.created, updated: r.updated, deleted: 0 });
    } catch (e) { /* a record this key cannot read stays sealed */ }
  }
  S.vault.notes = vrecs;
  S.vault.plain = out.sort((a, b) => b.updated - a.updated);
}

/* 1.0.16 - anything written while the Vault was locked lands here once it opens again. Nothing is
   ever written over a newer copy: the newest text wins, and a note that only exists in the holding
   pen is created. */
async function flushVaultPending() {
  const pend = Object.assign({}, S.vault.pending || (await kvGet('vaultpending')) || {});
  const ids = Object.keys(pend);
  if (!ids.length) { S.vault.pending = {}; return 0; }
  S.vault.pending = {};
  await kvSet('vaultpending', null).catch(() => {});
  let wrote = 0;
  for (const id of ids) {
    const p = pend[id] || {};
    const here = S.vault.plain.find(n => n.id === id);
    if (here) {
      if ((p.updated || 0) < (here.updated || 0)) continue;
      here.title = p.title || ''; here.body = p.body || ''; here.folder = p.folder || '';
      here.ink = p.ink || null;
      await saveNote(here, { quiet: true });
    } else {
      const n = {
        id: id, vault: true, title: p.title || '', body: p.body || '', folder: p.folder || '', fav: !!p.fav,
        ink: p.ink || null,
        created: p.created || p.updated || nowMs(), updated: p.updated || nowMs(), deleted: 0,
      };
      S.vault.plain.unshift(n);
      await saveNote(n, { quiet: true });
    }
    wrote++;
  }
  if (wrote) { renderSide(); renderDoc(); }
  return wrote;
}

function goVault() {
  if (!S.vault.key) { S.view = 'vault'; renderSide(); unlockDialog(() => { S.view = 'vault'; renderSide(); }); return; }
  S.view = 'vault'; S.folder = ''; S.tag = '';
  renderSide();
}

async function lockVault(quiet) {
  if (!S.vault.key) return;
  /* 1.0.16 - the open note is written before the key goes, so locking can never be the reason a
     sentence just typed is gone. */
  if (S.current && S.current.vault) {
    try { await saveNote(S.current, { quiet: true }); } catch (e) { /* the holding pen has it */ }
  }
  S.vault.key = null;
  S.vault.plain = [];
  if (S.current && S.current.vault) { S.current = null; renderDoc(); }
  if (S.view === 'vault') { S.view = 'notes'; S.folder = ''; S.tag = ''; }
  const gw = $('#graphwrap');
  if (gw && !gw.hidden) closeGraph();
  mediaRevokeAll();
  renderSide();
  if (!quiet) toast('Vault closed. Everything inside is locked away.');
}

async function resetVault() {
  const unlocked = !!S.vault.key;
  const d = dialog({
    title: 'Reset the Vault',
    body: '<div class="hint" style="margin-top:0">A reset takes the PIN off the Vault and empties it. Your other notes are not touched, and nothing outside the Vault changes.</div>' +
      '<div class="hint">The PIN is the only key to what is inside. Nobody - not this app, not anyone - can read those notes without it, so a reset cannot keep them' + (unlocked ? '.' : ' - that is what makes the Vault private.') + '</div>' +
      (unlocked ? '<button class="listrow" id="rvSave" style="margin-top:10px"><span class="grow"><span class="lr-t">Save the Vault notes first</span><span class="lr-s">One plain text file, so you can keep them.</span></span><span class="chev">\u203a</span></button>' : '') +
      '<label class="field" style="margin-top:12px"><span>Type RESET to confirm</span><input id="rvWord" autocomplete="off" placeholder="RESET"></label>' +
      '<div class="pinmsg" id="rvMsg"></div>',
    foot: '<div class="grow"></div><button class="btn" data-close="1">Keep the Vault</button><button class="btn danger" id="rvGo" disabled>Reset the Vault</button>',
  });
  const input = $('#rvWord', d), go = $('#rvGo', d);
  input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'RESET'; });
  const save = $('#rvSave', d);
  if (save) save.addEventListener('click', () => saveVaultText());
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = 'Resetting...';
    await wipeVault();
    closeDialog();
    toast('Vault reset. Set a new PIN when you are ready.');
    askNewPin(() => { lockVault(true); toast('New PIN set. The Vault starts empty.'); });
  });
  setTimeout(() => { const f = $('#rvWord', d); if (f) f.focus(); }, 60);
}

function saveVaultText() {
  const notes = S.vault.plain.slice();
  if (!notes.length) { toast('The Vault is empty - there is nothing to save.'); return; }
  const text = notes.map(n => '# ' + noteTitle(n) + '\n\n' + (n.body || '')).join('\n\n---\n\n');
  downloadText('unote-vault-' + dayKey() + '.txt', text, 'text/plain');
  toast(notes.length + (notes.length === 1 ? ' note' : ' notes') + ' from the Vault saved as a text file.', 4200);
}

async function wipeVault() {
  const recs = await dbAll('notes');
  for (const r of recs) if (r.vault) await dbDel('notes', r.id);
  await kvSet('vault', null);
  await kvSet('vaultguard', { tries: 0, until: 0 });
  await kvSet('vaultpending', null);
  S.vault = { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], pending: {}, tries: 0, until: 0 };
  if (S.view === 'vault') S.view = 'notes';
  renderSide(); renderDoc();
}

function vaultActivity() {
  clearTimeout(vaultActivity._t);
  const mins = Number(S.settings.autolock || 0);
  if (!mins || !S.vault.key) return;
  vaultActivity._t = setTimeout(() => {
    /* 1.0.16 - never shut the door on somebody who is still writing: the timer waits while a Vault
       note is open. The Vault still locks the moment you leave it, or when you tap lock. */
    if (S.current && S.current.vault) { vaultActivity(); return; }
    lockVault();
    toast('Vault locked after ' + mins + ' min.');
  }, mins * MIN);
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
      '<button class="listrow" id="setResetVault" style="margin-top:8px;border-color:rgba(248,113,113,.35)"><span class="grow"><span class="lr-t" style="color:var(--err)">Reset the Vault</span><span class="lr-s">Take the PIN off and start the Vault again, empty. Notes outside it are not touched.</span></span><span class="chev">\u203a</span></button>' +
      '<div class="hint" style="margin:8px 0 0">A forgotten PIN cannot be read back. A reset is the way in: it removes the PIN, empties the Vault, and lets you set a new one.</div></div>' +

      '<div class="setsec"><h4>Your data</h4><div class="sub">Nothing leaves this device unless you carry it out yourself.</div>' +
      '<button class="listrow" data-x="export"><span class="grow"><span class="lr-t">Export everything</span><span class="lr-s">One file: notes, folders, tags, settings and the sealed Vault.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="transfer"><span class="grow"><span class="lr-t">Transfer to another device</span><span class="lr-s">Copy a code, paste it on the other phone.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="import"><span class="grow"><span class="lr-t">Import a backup</span><span class="lr-s">From a file or a pasted code.</span></span><span class="chev">›</span></button>' +
      '<button class="listrow" data-x="wipeall" style="border-color:rgba(248,113,113,.35)"><span class="grow"><span class="lr-t" style="color:var(--err)">Delete everything</span><span class="lr-s">Notes, folders and the Vault, from this device.</span></span><span class="chev">›</span></button></div>' +

      '<div class="setsec"><h4>Updates</h4><div class="sub">UNote updates itself over the air. Nothing to install.</div>' +
      '<div class="rowset"><span class="grow">Version <b id="setVer">' + VERSION + '</b></span>' +
      '<button class="btn" id="setCheck" style="padding:7px 12px;font-size:12px">Check now</button></div>' +
      '<button class="listrow" data-whatsnew="1" style="margin-top:8px"><span class="grow"><span class="lr-t">Patch notes</span><span class="lr-s">What changed in every version, this one first.</span></span><span class="chev">\u203a</span></button>' +
      '<div id="setUpdMsg" class="hint" style="margin:8px 0 0">' + otaSummary() + '</div>' +
      (otaSourceSummary() ? '<div class="hint" style="margin:4px 0 0">' + otaSourceSummary() + '</div>' : '') +
      (nativeFiles() && typeof nativeFiles().resetPage === 'function'
        ? '<button class="listrow" style="margin-top:8px" onclick="resetBuiltInPage()"><span class="grow"><span class="lr-t">Go back to the built-in version</span><span class="lr-s">Throw away any page this app fetched over the air and use the copy that came inside the APK.</span></span><span class="chev">\u203a</span></button>'
        : '') + '</div>' +

      '<div class="setsec"><h4>About</h4><div class="sub">UNote - a notebook that links itself, with a vault that asks for a PIN. Made to be used for everything.</div>' +
              '<button class="listrow" data-apps="1" style="margin-top:10px"><span class="grow"><span class="lr-t">Other apps</span><span class="lr-s">FamTM, SideCut, MeasureT, My Hub and UJournal - the rest of the shelf.</span></span><span class="chev">›</span></button>' +
              '<a class="listrow" href="https://anekthegreat.github.io/UNote/privacy.html" target="_blank" rel="noopener" style="margin-top:8px;text-decoration:none"><span class="grow"><span class="lr-t">Privacy policy</span><span class="lr-s">What stays on this phone, and the one request the app makes.</span></span><span class="chev">›</span></a>' +
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
  $('#setResetVault', dlg).addEventListener('click', () => { closeDialog(); resetVault(); });
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
  askPinPair({
    title: 'Change the Vault PIN',
    sub: 'Pick a new 4 to 8 digit PIN. Everything in the Vault is resealed with it.',
    onPin: async p1 => {
      toast('Resealing the Vault...', 2000);
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
        toast('PIN changed. ' + plain.length + ' vault note' + (plain.length === 1 ? '' : 's') + ' resealed.', 4000);
      } catch (e) {
        toast('Could not change it: ' + e.message, 4200);
      }
    },
  });
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
    for (const m of await dbAll('media')) await dbDel('media', m.id);
    await kvSet('settings', { onboarded: false });
    location.reload();
  });
}

/* ---------------- the phone's own file picker ---------------- */

/* The installed app hands the page a small bridge, window.UNoteFile. Without it (the browser
   copy) everything falls back to a plain download and a file input, as before. */
function nativeFiles() {
  return (typeof window !== 'undefined' && window.UNoteFile &&
    typeof window.UNoteFile.saveBackup === 'function') ? window.UNoteFile : null;
}

let pickBuf = '';
let pickMode = 'merge';
let importAfter = null;      // run once the import that is on screen has finished
if (typeof window !== 'undefined') {
  window.UNotePickChunk = s => { pickBuf += s; };
  window.UNotePicked = ok => {
    const text = ok ? pickBuf : '';
    pickBuf = '';
    if (!text) { toast('That file came through empty. Try another one.', 4200); return; }
    runImport(text, pickMode);
  };
  window.UNoteSaved = ok => toast(ok ? 'Backup saved.' : 'Could not save the backup.', 3800);
}

/* ---------------- export / transfer / import ---------------- */
async function buildBundle() {
  const meta = (await vaultMeta()) || null;
  const recs = await dbAll('notes');
  /* 1.0.20 - the Vault is part of the backup, always: every sealed record goes in, and the salt
     and verifier go with them so the same PIN opens them where the file is brought back. Notes
     written while the Vault was locked wait in a holding pen, and that pen travels too - it used
     to be the one place a backup left behind. */
  const sealed = recs.filter(r => isSealed(r));
  const plain = recs.filter(r => !isSealed(r)).map(r => { const n = Object.assign({}, r); delete n.vault; return n; });
  const pend = Object.assign({}, S.vault.pending || (await kvGet('vaultpending')) || {});
  const vault = { on: !!(meta && meta.on), notes: sealed, pending: pend };
  if (meta && meta.on) { vault.salt = meta.salt; vault.iter = meta.iter; vault.verifier = meta.verifier; }
  return {
    app: APP, kind: 'backup', version: VERSION, at: new Date().toISOString(),
    settings: { theme: S.settings.theme, accent: S.settings.accent, size: S.settings.size, mode: S.settings.mode, autolock: S.settings.autolock, sort: S.settings.sort },
    notes: plain,
    media: await bundleMedia(),
    vault: vault,
  };
}

function downloadText(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportAll() {
  try {
    const bundle = await buildBundle();
    const name = 'unote-' + dayKey() + '.unote.json';
    const json = JSON.stringify(bundle, null, 1);
    const sealedCount = (bundle.vault && bundle.vault.notes) ? bundle.vault.notes.length : 0;
    const msg = bundle.notes.length + ' note' + (bundle.notes.length === 1 ? '' : 's') +
      (sealedCount ? ' + ' + sealedCount + ' sealed in the Vault' : '');
    const nf = nativeFiles();
    if (nf) {
      nf.saveBackup(name, json);
      toast('Exported ' + msg + '. Pick where to keep ' + name + '.', 4600);
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Exported ' + msg + ' to ' + name, 4600);
  } catch (e) { toast('Export failed: ' + e.message, 4200); }
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
  const mediaCount = (await dbAll('media')).length;
  if (mediaCount) {
    const d = dialog({
      title: 'Transfer with photos and recordings',
      body: '<div class="hint" style="margin-top:0">This notebook has ' + mediaCount +
        ' ' + (mediaCount === 1 ? 'attachment' : 'attachments') +
        ' in it. A pasteable code cannot carry those, so use the file.</div>' +
        '<div class="hint">Save the file, then on the other phone: Settings - Your data - ' +
        'Import a backup - Choose a file. A Vault that comes across stays sealed with the PIN it had.</div>',
      foot: '<div class="grow"></div><button class="btn" data-close="1">Not now</button>' +
        '<button class="btn primary" id="trfSave">Save the file</button>',
    });
    $('#trfSave', d).addEventListener('click', () => { closeDialog(); exportAll(); });
    return;
  }
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

async function importDialog(then) {
  importAfter = then || null;       // the welcome uses this to finish once the file is in
  const d = dialog({
    cls: 'wide',
    title: 'Import a backup',
    body: '<div class="hint" style="margin-top:0">Pick the .unote.json file, or paste a transfer code.</div>' +
      '<button class="listrow" id="impPick"><span class="grow"><span class="lr-t">Choose a file</span><span class="lr-s">A UNote backup from this or another device.</span></span><span class="chev">&#8250;</span></button>' +
      '<label class="field" style="margin-top:12px"><span>Or paste a transfer code</span><textarea id="impCode" rows="5" style="font-family:var(--mono);font-size:11px" placeholder="UNOTE1:..."></textarea></label>' +
      '<div class="rowset"><span class="grow">How to bring it in</span><div class="seg" id="impMode">' +
      '<button data-m="merge" class="on">Merge</button><button data-m="replace">Replace everything</button></div></div>' +
      '<div class="hint">Merge keeps what is here and adds anything newer from the backup. Replace clears this device first.</div>' +
      '<div class="hint">A Vault in the backup comes across sealed: its notes wait inside the Vault, and the PIN they were sealed with opens them here.</div>' +
      '<input type="file" id="impFile" accept="*/*" hidden>',
    foot: '<div class="grow"></div><button class="btn primary" id="impGo">Import</button>',
  });
  let mode = 'merge';
  const nf = nativeFiles();
  const pick = () => {
    if (nf) { pickMode = mode; pickBuf = ''; nf.pickBackup(); return; }
    $('#impFile', d).click();
  };
  $('#impPick', d).addEventListener('click', pick);
  $('#impFile', d).addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    let text = '';
    try { text = await f.text(); } catch (err) { toast('Could not read that file.', 4000); return; }
    if (!text) { toast('That file came through empty. Try another one.', 4200); return; }
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
  const after = importAfter;            // the welcome's hand-off, used once at the very end
  importAfter = null;
  let bundle;
  try {
    let raw = String(text || '').trim();
    if (!raw) throw new Error('Nothing to import');
    if (/^UNOTE1:/i.test(raw)) raw = await unpack(raw);
    bundle = JSON.parse(raw);
    if (bundle.app !== APP || !Array.isArray(bundle.notes)) throw new Error('That is not a UNote backup');
  } catch (e) {
    /* A file that cannot be read leaves everything as it was, and the sheet open, so another one
       can be picked without losing the place the import was started from. */
    importAfter = after;
    toast('Could not read that: ' + e.message, 4000);
    return;
  }

  /* 1.0.20 - anything sealed is a Vault note, whichever list the file kept it in. Backups from
     earlier versions carried the Vault's sealed records among the plain notes, and those were the
     notes that came back as untitled strays - some of them in the Trash - with no PIN anywhere
     that could open them. They are sorted out here, before a single record is written. */
  const sealed = [];
  const keepSealed = r => {
    if (!r || !r.id || !isSealed(r)) return;
    if (sealed.some(x => x.id === r.id)) return;
    sealed.push(Object.assign({}, r, { vault: true }));
  };
  (bundle.notes || []).forEach(keepSealed);
  ((bundle.vault && bundle.vault.notes) || []).forEach(keepSealed);
  const plain = (bundle.notes || [])
    .filter(n => n && n.id && !isSealed(n))
    .map(n => { const copy = Object.assign({}, n); delete copy.vault; return copy; });   // a plain note is never sealed

  let added = 0, updated = 0;
  if (mode === 'replace') {
    for (const r of await dbAll('notes')) await dbDel('notes', r.id);
    S.notes = []; S.vault.notes = []; S.vault.plain = [];
    S.current = null;
  }
  for (const n of plain) {
    const old = S.notes.find(x => x.id === n.id);
    if (old && (old.updated || 0) >= (n.updated || 0)) continue;
    if (old) updated++; else added++;
    await dbPut('notes', n);
  }
  S.notes = (await dbAll('notes')).filter(r => !isSealed(r));

  /* The Vault travels with the salt and the verifier it was sealed under, so the PIN it had is
     the PIN that opens it here - the notes wait inside the Vault, locked, exactly as they were.
     It is only kept out when this phone already has a Vault of its own, with a different PIN and
     notes inside it: then nothing on either side is thrown away. */
  let vaultIn = 0, vaultKept = false;
  if (sealed.length) {
    const meta = await vaultMeta();
    const same = !!(meta && meta.on && bundle.vault && bundle.vault.verifier &&
      JSON.stringify(meta.verifier) === JSON.stringify(bundle.vault.verifier));
    const mine = (await dbAll('notes')).filter(r => isSealed(r)).length;
    const adopt = same || !meta || !meta.on || !mine;
    if (adopt) {
      if (!same && bundle.vault && bundle.vault.salt && bundle.vault.verifier) {
        S.vault.salt = bundle.vault.salt;
        S.vault.verifier = bundle.vault.verifier;
        S.vault.key = null;             // it is locked again until that PIN is typed
        await kvSet('vault', { on: true, salt: bundle.vault.salt, iter: bundle.vault.iter || KDF_ITER, verifier: bundle.vault.verifier });
      }
      for (const r of sealed) {
        const have = await req(store('notes').get(r.id));
        if (have && (have.updated || 0) > (r.updated || 0)) { vaultIn++; continue; }
        await dbPut('notes', r);
        vaultIn++;
      }
    } else {
      vaultKept = true;
    }
  }

  /* Anything written while the Vault was locked waits in the holding pen, and comes in with the
     rest of the backup so a backup is never missing the last thing somebody typed. */
  const pend = (bundle.vault && bundle.vault.pending) ? bundle.vault.pending : null;
  if (pend && Object.keys(pend).length) {
    S.vault.pending = Object.assign({}, pend, S.vault.pending || {});
    await kvSet('vaultpending', S.vault.pending).catch(() => {});
  }

  if (bundle.media && bundle.media.length) await pullInMedia(bundle.media);
  if (bundle.settings) {
    Object.assign(S.settings, bundle.settings);
    kvSet('settings', S.settings);
    setTheme(S.settings.theme); setAccent(S.settings.accent);
    document.documentElement.style.setProperty('--size', (S.settings.size || 16) + 'px');
  }
  const meta2 = await vaultMeta();
  S.vault.on = !!(meta2 && meta2.on);
  if (S.vault.key) await decryptVault();
  else { S.vault.notes = (await dbAll('notes')).filter(r => isSealed(r)); S.vault.plain = []; }
  if (!S.current) {
    const first = sortNotes(liveNotes()).find(n => !n.deleted);   // something to open, never a blank page
    if (first) S.current = first;
  }
  closeDialog();
  renderSide(); renderDoc();
  let tail = '';
  if (vaultIn) {
    tail = S.vault.key
      ? ' ' + vaultIn + ' Vault note' + (vaultIn === 1 ? '' : 's') + ' came across and opened with this phone\'s PIN.'
      : ' ' + vaultIn + ' Vault note' + (vaultIn === 1 ? ' is' : 's are') + ' waiting in the Vault - the PIN they were sealed with opens them.';
  }
  if (vaultKept) {
    tail += ' The Vault in that backup is sealed with a different PIN, and this phone already has a Vault with notes in it, so it was left as it was: reset the Vault first if you would rather have the backup\'s.';
  }
  toast('Imported: ' + added + ' new, ' + updated + ' updated.' + tail, (vaultIn || vaultKept) ? 7600 : 5200);
  if (after) after();
}

/* ---------------- updates (over the air) ---------------- */

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

/* Which page is on screen: the one that came inside the APK, or one fetched over the air. Shown in
   Settings so a page that shadows a newer app is visible instead of looking like a mystery. */
function otaSourceSummary() {
  const nf = nativeFiles();
  if (!nf || typeof nf.pageSource !== 'function') return '';
  let s = '';
  try { s = String(nf.pageSource() || ''); } catch (e) { return ''; }
  if (s.indexOf('fetched') === 0) {
    return 'This screen is a page fetched earlier (' + s.replace('fetched ', '') + '), not the copy inside the app.';
  }
  return 'This screen is the page that came inside the app' + (s.indexOf('built-in ') === 0 && s.length > 10 ? ' (' + s.slice(10) + ')' : '') + '.';
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
  /* 1.0.16 - the sealed record is written once, with its words already in it. The old code wrote a
     record with no ciphertext first, and a note interrupted in that moment could never be read
     again. Now a failure leaves the plain note exactly where it was. */
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

  /* 1.0.21 - the page keeps clear of the phone's own bars. A browser hands their heights over as
     env(safe-area-inset-*); an Android WebView reports nothing at all, which is why the top of the
     screen ended up under the clock in the app. The app hands over the same heights, in the same
     unit, so both copies lay themselves out the same way on every phone. */
  (function () {
    const nf = nativeFiles();
    if (!nf || typeof nf.safeTop !== 'function') return;
    const put = (name, v) => {
      if (typeof v === 'number' && v >= 0) document.documentElement.style.setProperty(name, v + 'px');
    };
    try { put('--safe-t', nf.safeTop()); } catch (e) {}
    try { put('--safe-b', nf.safeBottom()); } catch (e) {}
    try { put('--safe-l', nf.safeLeft()); } catch (e) {}
    try { put('--safe-r', nf.safeRight()); } catch (e) {}
  })();

  document.documentElement.dataset.theme = S.settings.theme || 'dark';
  setAccent(S.settings.accent || '#7c5cff');
  document.documentElement.style.setProperty('--size', (S.settings.size || 16) + 'px');
  /* 1.0.22 - the width the drawer gives way at is 600, so a folded foldable or a small tablet
     opens in Split instead of squeezing two panes into a phone's reading mode. */
  setMode(saved && saved.mode ? saved.mode : (window.innerWidth < 600 ? 'read' : 'split'));
  $('#sVer').textContent = 'UNote ' + VERSION;

  const recs = await dbAll('notes');
  /* A sealed record is a Vault note even when an older import forgot to say so. It is marked here
     once, so a stray sealed note can never sit in the plain list - or in its Trash - again. */
  for (const r of recs) if (isSealed(r) && r.vault !== true) { r.vault = true; await dbPut('notes', r); }
  S.notes = recs.filter(r => !isSealed(r));
  S.vault.notes = recs.filter(r => isSealed(r));
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
  /* 1.0.15 - once per version, and only for a version that is really newer. The old test asked
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
  watchForUpdates();

  // rail
  $$('#rail .rbtn[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'notes') { if (S.vault.key) lockVault(true); S.view = 'notes'; S.folder = ''; S.tag = ''; $('#side').classList.add('open'); renderSide(); }
    if (go === 'search') palette('search');
    if (go === 'graph') openGraph();
    if (go === 'tags') { if (S.vault.key) lockVault(true); S.view = 'tags'; S.folder = ''; renderSide(); }
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
      if (v === 'vault') { if (S.view === 'vault' && S.vault.key) { lockVault(); return; } goVault(); return; }
      if (S.vault.key) lockVault(true);
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
    if (document.body.dataset.mode !== 'edit') {
      $('#pv').innerHTML = md(ed.value);
      hydrateMedia($('#pv'));
    }
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
  setupAttachments();
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
  const items = sortNotes(allNotes().filter(n => !n.deleted))
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


/* ---------------- attachments: photos, video, audio, voice memos ---------------- */
const MEDIA = { urls: {} };

function mediaKind(mime, name) {
  const m = String(mime || '');
  if (m.indexOf('image/') === 0) return 'image';
  if (m.indexOf('video/') === 0) return 'video';
  if (m.indexOf('audio/') === 0) return 'audio';
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'avif'].indexOf(ext) >= 0) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', '3gp'].indexOf(ext) >= 0) return 'video';
  if (['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'opus', 'amr', 'weba'].indexOf(ext) >= 0) return 'audio';
  return 'file';
}

async function mediaEncrypt(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function mediaDecrypt(key, ivB64, ctB64) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
}

async function saveAttachment(file, note) {
  const bytes = await file.arrayBuffer();
  const rec = {
    id: 'm' + uid(), noteId: note.id, kind: mediaKind(file.type, file.name),
    mime: file.type || '', name: file.name || 'Attachment', size: bytes.byteLength, at: nowMs(),
  };
  if (note.vault) {
    if (!S.vault.key) throw new Error('the Vault is closed');
    const box = await mediaEncrypt(S.vault.key, bytes);
    rec.enc = true; rec.iv = box.iv; rec.ct = box.ct;
  } else {
    rec.blob = new Blob([bytes], { type: rec.mime || 'application/octet-stream' });
  }
  await dbPut('media', rec);
  return rec;
}

async function mediaObjectUrl(id) {
  if (MEDIA.urls[id]) return MEDIA.urls[id];
  const rec = await req(store('media').get(id));
  if (!rec) return null;
  let blob = rec.blob;
  if (!blob) {
    if (!S.vault.key) return null;
    try {
      blob = new Blob([await mediaDecrypt(S.vault.key, rec.iv, rec.ct)],
        { type: rec.mime || 'application/octet-stream' });
    } catch (e) { return null; }
  }
  const url = URL.createObjectURL(blob);
  MEDIA.urls[id] = url;
  return url;
}

function mediaRevokeAll() {
  Object.keys(MEDIA.urls).forEach(k => { try { URL.revokeObjectURL(MEDIA.urls[k]); } catch (e) {} });
  MEDIA.urls = {};
}

async function hydrateMedia(root) {
  if (!root) return;
  const imgs = $$('img[src^="unote-media:"]', root);
  for (const el of imgs) {
    const id = el.getAttribute('src').slice('unote-media:'.length);
    const url = await mediaObjectUrl(id);
    if (url) el.src = url; else el.remove();
  }
  const links = $$('a[href^="unote-media:"]', root);
  for (const a of links) {
    const id = a.getAttribute('href').slice('unote-media:'.length);
    const rec = await req(store('media').get(id));
    if (!rec) { a.removeAttribute('href'); a.classList.add('missing'); continue; }
    const url = await mediaObjectUrl(id);
    if (!url) {
      const box = document.createElement('div');
      box.className = 'media';
      box.innerHTML = '<div class="cap">In the Vault - open it to play this.</div>';
      a.replaceWith(box);
      continue;
    }
    if (rec.kind === 'audio' || rec.kind === 'video') {
      const box = document.createElement('div');
      box.className = 'media';
      const player = document.createElement(rec.kind);
      player.controls = true; player.preload = 'metadata'; player.src = url;
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = (rec.name || (rec.kind === 'audio' ? 'Recording' : 'Video')) +
        (rec.size ? ' · ' + Math.max(1, Math.round(rec.size / 1024)) + ' KB' : '');
      box.appendChild(player); box.appendChild(cap);
      a.replaceWith(box);
    } else {
      a.href = url; a.download = rec.name || 'file';
      a.textContent = (rec.name || 'Attachment') + ' · ' +
        (rec.size > 1048576 ? (rec.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((rec.size || 0) / 1024)) + ' KB');
    }
  }
}

async function addFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const note = S.current;
  if (!note) { toast('Open a note first, then add to it.'); return; }
  if (note.vault && !S.vault.key) { unlockDialog(() => addFiles(list)); return; }
  let done = 0;
  for (const f of list) {
    try {
      const rec = await saveAttachment(f, note);
      const token = rec.kind === 'image'
        ? '![](unote-media:' + rec.id + ')'
        : '[' + String(rec.name || 'Attachment').replace(/[\[\]]/g, '') + '](unote-media:' + rec.id + ')';
      const body = String(note.body || '').replace(/\s+$/, '');
      note.body = (body ? body + '\n\n' : '') + token + '\n';
      done++;
    } catch (e) {
      toast('Could not add ' + (f.name || 'that file') + (e && e.message ? ': ' + e.message : '.'));
    }
  }
  if (!done) return;
  await saveNote(note);
  if ($('#ed')) $('#ed').value = note.body;
  if ($('#pv')) { $('#pv').innerHTML = md(note.body); hydrateMedia($('#pv')); }
  toast(done === 1 ? 'Added to the note.' : 'Added ' + done + ' to the note.');
}

/* A picture on the clipboard arrives three different ways depending on the phone: as a file
   item, as an <img src="data:..."> inside text/html, or as a bare data: URL in text/plain.
   All three are turned into a normal File, so everything after this point is the same. */
function fileFromDataUrl(url, fallbackName) {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(String(url || ''));
  if (!m) return null;
  try {
    const bin = m[2] ? atob(m[3].replace(/\s+/g, '')) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg');
    const name = fallbackName || ('Pasted ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext);
    return new File([bytes], name, { type: m[1] });
  } catch (e) {
    return null;
  }
}

function filesFromHtml(html) {
  const out = [];
  const re = /<img[^>]+src=["'](data:image\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const f = fileFromDataUrl(m[1]);
    if (f) out.push(f);
  }
  return out;
}

function clipboardFiles(dt) {
  const files = [];
  Array.from(dt.files || []).forEach(f => files.push(f));
  Array.from(dt.items || []).forEach(it => {
    if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
  });
  const html = dt.getData ? dt.getData('text/html') : '';
  if (html) filesFromHtml(html).forEach(f => files.push(f));
  const plain = dt.getData ? dt.getData('text/plain') : '';
  if (plain && /^data:image\//i.test(plain.trim())) {
    const f = fileFromDataUrl(plain.trim());
    if (f) files.push(f);
  }
  return files;
}

function mediaPaste(e) {
  const dt = e.clipboardData;
  if (!dt) return;
  const files = clipboardFiles(dt);
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
}

/* The attach sheet's "Paste from the clipboard": for a picture copied from another app that
   does not reach the page as a paste event. */
async function pasteFromClipboard() {
  closeDialog();
  if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    toast('This phone will not hand over its clipboard here. Long-press in the note and choose Paste instead.', 5200);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      for (const type of it.types) {
        if (type.indexOf('image/') !== 0) continue;
        const blob = await it.getType(type);
        const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        files.push(new File([blob],
          'Pasted ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + ext,
          { type: type }));
      }
    }
    if (!files.length) { toast('There is no picture in the clipboard.'); return; }
    await addFiles(files);
  } catch (e) {
    toast('Could not read the clipboard (' + (e && e.message ? e.message : 'blocked') +
      '). Long-press in the note and choose Paste instead.', 5200);
  }
}

function attachDialog() {
  if (!S.current) { toast('Open a note first, then add to it.'); return; }
  const d = dialog({
    title: 'Add to this note',
    body: '<div class="hint" style="margin-top:0">A photo, a video, an audio file or a voice memo. It stays on this phone, inside the note.' +
        (S.current.vault ? ' This note is in the Vault, so anything added is sealed with your PIN.' : '') + '</div>' +
      '<button class="listrow" data-att="media"><span class="grow"><span class="lr-t">Photo or video</span><span class="lr-s">Pick one from this phone.</span></span><span class="chev">\u203a</span></button>' +
      '<button class="listrow" data-att="audio"><span class="grow"><span class="lr-t">Audio file</span><span class="lr-s">A recording you already have.</span></span><span class="chev">\u203a</span></button>' +
      '<button class="listrow" data-att="any"><span class="grow"><span class="lr-t">Any file</span><span class="lr-s">A PDF, a document, whatever it is.</span></span><span class="chev">\u203a</span></button>' +
      '<button class="listrow" data-att="paste"><span class="grow"><span class="lr-t">Paste from the clipboard</span><span class="lr-s">A picture you just copied.</span></span><span class="chev">\u203a</span></button>' +
      '<button class="listrow" data-att="voice"><span class="grow"><span class="lr-t">Voice memo</span><span class="lr-s">Record it here and it goes into the note.</span></span><span class="chev">\u203a</span></button>' +
      '<div class="hint" style="margin:10px 0 0">Pasting a photo or a file straight into a note works too.</div>' +
      '<input type="file" id="attPhoto" accept="image/*,video/*" hidden multiple>' +
      '<input type="file" id="attAudio" accept="audio/*" hidden multiple>' +
      '<input type="file" id="attAny" accept="*/*" hidden multiple>',
  });
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-att]'); if (!b) return;
    if (b.dataset.att === 'media') { $('#attPhoto', d).click(); return; }
    if (b.dataset.att === 'audio') { $('#attAudio', d).click(); return; }
    if (b.dataset.att === 'any') { $('#attAny', d).click(); return; }
    if (b.dataset.att === 'paste') { pasteFromClipboard(); return; }
    recordVoiceMemo();
  });
  $$('#attPhoto,#attAudio,#attAny', d).forEach(inp => inp.addEventListener('change', e => {
    const files = e.target.files;
    closeDialog();
    addFiles(files);
  }));
}

async function recordVoiceMemo() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('This phone will not record from inside the app. Use Audio file instead.'); return;
  }
  let stream = null, rec = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('No access to the microphone. Use Audio file instead.'); return; }
  const chunks = [];
  try { rec = new MediaRecorder(stream); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); toast('This phone will not record from inside the app.'); return; }
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const type = rec.mimeType || 'audio/webm';
    const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    await addFiles([new File(chunks, 'Voice memo ' + stamp + '.webm', { type: type })]);
  };
  rec.start();
  const d = dialog({
    title: 'Voice memo',
    body: '<div class="vaulthero"><div class="lk"><div class="rec-dot"></div></div>' +
      '<h3>Recording</h3><p>Speak, then stop. It goes into this note.</p></div>',
    foot: '<div class="grow"></div><button class="btn primary" id="recStop">Stop and keep it</button>',
  });
  $('#recStop', d).addEventListener('click', () => {
    closeDialog();
    try { rec.stop(); } catch (e) {}
    toast('Keeping the recording…');
  });
  dlgOnClose = () => { try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {} };
}

function setupAttachments() {
  const top = $('#top');
  if (top && !$('#btnAttach')) {
    const b = document.createElement('button');
    b.className = 'iconbtn';
    b.id = 'btnAttach';
    b.title = 'Add a photo, video or voice memo';
    b.setAttribute('aria-label', 'Add to this note');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.5 7.5l-6.4 6.4a2.5 2.5 0 0 0 3.5 3.5l6.4-6.4a4.5 4.5 0 0 0-6.4-6.4L6 11a6.5 6.5 0 0 0 9.2 9.2"/></svg>';
    b.addEventListener('click', attachDialog);
    const fav = $('#btnFav');
    if (fav) top.insertBefore(b, fav); else top.appendChild(b);
  }
  const ed = $('#ed'), title = $('#title');
  if (ed && !ed.dataset.att) { ed.dataset.att = '1'; ed.addEventListener('paste', mediaPaste); }
  if (title && !title.dataset.att) { title.dataset.att = '1'; title.addEventListener('paste', mediaPaste); }
  window.addEventListener('pagehide', mediaRevokeAll);
}

async function bundleMedia() {
  const out = [];
  for (const m of await dbAll('media')) {
    const base = { id: m.id, noteId: m.noteId, kind: m.kind, mime: m.mime, name: m.name, size: m.size, at: m.at };
    if (m.enc) { base.enc = true; base.iv = m.iv; base.ct = m.ct; out.push(base); }
    else if (m.blob) { base.data = toB64(await m.blob.arrayBuffer()); out.push(base); }
  }
  return out;
}

async function pullInMedia(list) {
  let added = 0;
  for (const m of (list || [])) {
    if (!m || !m.id) continue;
    const have = await req(store('media').get(m.id));
    if (have) continue;
    const rec = { id: m.id, noteId: m.noteId, kind: m.kind || 'file', mime: m.mime || '', name: m.name || 'Attachment', size: m.size || 0, at: m.at || nowMs() };
    if (m.enc) { rec.enc = true; rec.iv = m.iv; rec.ct = m.ct; }
    else if (m.data) rec.blob = new Blob([fromB64(m.data)], { type: rec.mime || 'application/octet-stream' });
    else continue;
    await dbPut('media', rec);
    added++;
  }
  return added;
}

/* start */
document.addEventListener('DOMContentLoaded', () => {
  boot().catch(err => {
    document.body.innerHTML = '<div style="padding:40px;font:15px system-ui;color:#e9ecf4">' +
      'UNote could not start.<br><br><code style="opacity:.7">' + esc(err && err.message) + '</code></div>';
  });
});
