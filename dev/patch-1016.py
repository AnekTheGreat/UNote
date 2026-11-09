#!/usr/bin/env python3
"""UNote 1.0.16 - the Vault stops losing notes.

    python3 dev/patch-1016.py          # apply
    python3 dev/patch-1016.py --check  # say whether the tree already carries 1.0.16

Four ways a Vault note could go missing, all closed here:

  * a save that could not be encrypted was thrown away in silence - which is exactly what happens
    when the Vault locks itself while somebody is still writing, so the tail of a note vanished;
  * locking dropped the key without first writing the open note;
  * moving a note into the Vault wrote an empty sealed record before sealing it, so a note
    interrupted in that moment could never be read again;
  * a favourite mark on a Vault note was never stored, so it came back unfavourited.
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '1.0.16'
DATE = '2026-11-09'
CODE = V.replace('.', '')


def path(p):
    return os.path.join(ROOT, p)


def read(p):
    return io.open(path(p), encoding='utf-8').read()


def write(p, s):
    io.open(path(p), 'w', encoding='utf-8').write(s)


def rep(p, old, new):
    s = read(p)
    n = s.count(old)
    if n != 1:
        sys.exit('%s: the text to replace appears %d times, expected once' % (p, n))
    write(p, s.replace(old, new))


def resub(p, pattern, repl):
    s = read(p)
    new, n = re.subn(pattern, repl, s)
    if n != 1:
        sys.exit('%s: pattern %r matched %d times, expected once' % (p, pattern, n))
    write(p, new)


STATE_OLD = "  vault: { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], tries: 0, until: 0 },"
STATE_NEW = "  vault: { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], pending: {}, tries: 0, until: 0 },"

SAVE_OLD = """  if (note.vault) {
    if (!S.vault.key) return;
    const box = await aesEnc(S.vault.key, JSON.stringify({ title: note.title, body: note.body, folder: note.folder }));
"""

SAVE_NEW = """  if (note.vault) {
    if (!S.vault.key) {
      /* 1.0.16 - a save that cannot happen must not throw the words away. They wait in a holding
         pen on this phone and go in the moment the PIN is back. */
      (S.vault.pending = S.vault.pending || {})[note.id] = {
        id: note.id, title: note.title || '', body: note.body || '', folder: note.folder || '',
        created: note.created || note.updated, updated: note.updated, fav: !!note.fav,
      };
      kvSet('vaultpending', S.vault.pending).catch(() => {});
      return;
    }
    const box = await aesEnc(S.vault.key, JSON.stringify({ title: note.title, body: note.body, folder: note.folder, fav: !!note.fav }));
"""

DEC_OLD = "      out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: false, created: r.created, updated: r.updated, deleted: 0 });"
DEC_NEW = "      out.push({ id: r.id, vault: true, title: j.title || '', body: j.body || '', folder: j.folder || '', fav: !!j.fav, created: r.created, updated: r.updated, deleted: 0 });"

FLUSH_OLD = """  S.vault.notes = vrecs;
  S.vault.plain = out.sort((a, b) => b.updated - a.updated);
}
"""

FLUSH_NEW = """  S.vault.notes = vrecs;
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
      await saveNote(here, { quiet: true });
    } else {
      const n = {
        id: id, vault: true, title: p.title || '', body: p.body || '', folder: p.folder || '', fav: !!p.fav,
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
"""

LOCK_OLD = """function lockVault(quiet) {
  if (!S.vault.key) return;
  S.vault.key = null;
"""
LOCK_NEW = """async function lockVault(quiet) {
  if (!S.vault.key) return;
  /* 1.0.16 - the open note is written before the key goes, so locking can never be the reason a
     sentence just typed is gone. */
  if (S.current && S.current.vault) {
    try { await saveNote(S.current, { quiet: true }); } catch (e) { /* the holding pen has it */ }
  }
  S.vault.key = null;
"""

AUTO_OLD = "  vaultActivity._t = setTimeout(() => { lockVault(); toast('Vault locked after ' + mins + ' min.'); }, mins * MIN);"
AUTO_NEW = """  vaultActivity._t = setTimeout(() => {
    /* 1.0.16 - never shut the door on somebody who is still writing: the timer waits while a Vault
       note is open. The Vault still locks the moment you leave it, or when you tap lock. */
    if (S.current && S.current.vault) { vaultActivity(); return; }
    lockVault();
    toast('Vault locked after ' + mins + ' min.');
  }, mins * MIN);"""

UNLOCK_OLD = """        await decryptVault();
        closeDialog();
        toast('Vault open. It locks itself when you leave.');
"""
UNLOCK_NEW = """        await decryptVault();
        const kept = await flushVaultPending();
        closeDialog();
        toast(kept
          ? 'Vault open. ' + kept + (kept === 1 ? ' note you had written while it was locked is saved now.' : ' notes you had written while it was locked are saved now.')
          : 'Vault open. It locks itself when you leave.');
"""

META_OLD = """  const meta = await vaultMeta();
  if (!meta || !meta.on) { askNewPin(after); return; }
"""
META_NEW = """  const meta = await vaultMeta();
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
"""

WIPE_OLD = """  await kvSet('vaultguard', { tries: 0, until: 0 });
  S.vault = { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], tries: 0, until: 0 };
"""
WIPE_NEW = """  await kvSet('vaultguard', { tries: 0, until: 0 });
  await kvSet('vaultpending', null);
  S.vault = { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], pending: {}, tries: 0, until: 0 };
"""

MOVE_OLD = """  await dbPut('notes', { id: n.id, vault: true, created: v.created, updated: v.updated, iv: null, ct: null });
  await saveNote(v);
"""
MOVE_NEW = """  /* 1.0.16 - the sealed record is written once, with its words already in it. The old code wrote a
     record with no ciphertext first, and a note interrupted in that moment could never be read
     again. Now a failure leaves the plain note exactly where it was. */
  await saveNote(v);
"""

NAV_OLD = "      'Vault<span class=\"n\">' + (vault ? 'close' : S.vault.key ? 'open' : 'locked') + '</span></button>';"
NAV_NEW = "      'Vault<span class=\"n\">' + (vault ? 'Lock' : S.vault.key ? 'open' : 'locked') + '</span></button>';"

SEALED_ROW_OLD = "      '<span class=\"grow\"><span class=\"lr-t\">Vault is locked</span><span class=\"lr-s\" style=\"display:block\">Tap to enter your PIN</span></span></button></div>';"
SEALED_ROW_NEW = """      '<span class="grow"><span class="lr-t">Vault is locked</span><span class="lr-s" style="display:block">' +
      (S.vault.notes.length
        ? S.vault.notes.length + (S.vault.notes.length === 1 ? ' note sealed here' : ' notes sealed here') + ' - tap to enter your PIN'
        : 'Tap to enter your PIN') +
      '</span></span></button></div>';"""

EMPTY_OLD = "    h += '<div class=\"emptyhint\">' + (S.view === 'trash' ? 'Nothing in the trash.' : 'No notes here yet.') + '</div>';"
EMPTY_NEW = """    h += '<div class="emptyhint">' + (S.view === 'trash' ? 'Nothing in the trash.'
      : S.view === 'vault' ? 'The Vault is empty. Tap + to write the first note that only your PIN can open.'
      : 'No notes here yet.') + '</div>';"""

NOTES = [
    "The Vault no longer loses a note to locking. When it locks, the note you had open is written "
    "first, so the last thing you typed is still there when you come back.",
    "Words typed while the Vault was locked are kept. A save that could not be encrypted used to be "
    "dropped in silence, which is how the end of a note could vanish after the automatic lock. It "
    "now waits on the phone and is saved the moment your PIN is back.",
    "Moving a note into the Vault writes it once, complete. The old code wrote an empty sealed "
    "record first, and a note caught in that moment could never be read again.",
    "A star on a Vault note now survives a lock, like every other note.",
    "If sealed notes are on this phone but the record that checks the PIN is missing, the app says "
    "so instead of offering a new PIN that would bury them for good.",
    "Less nagging: the Vault no longer shuts itself while a Vault note is open, and the side bar "
    "says how many notes are sealed behind the lock.",
]

TITLE = "The Vault stops losing notes"


def applied():
    return "const VERSION = '%s';" % V in read('src/app1.js')


def check():
    a1 = read('src/app1.js')
    a3 = read('src/app3.js')
    a2 = read('src/app2.js')
    data = json.loads(read('updates.json'))
    probes = [
        ("const VERSION = '%s';" % V in a1, 'app1.js does not say %s' % V),
        ('unote-v%s' % V in read('sw.js'), 'sw.js does not cache %s' % V),
        ("def appVersion = '%s'" % V in read('android/app/build.gradle'), 'build.gradle does not carry %s' % V),
        ('versionCode %s' % CODE in read('android/app/build.gradle'), 'versionCode is not %s' % CODE),
        ('vaultpending' in a1, 'a save that cannot be encrypted is still dropped'),
        ('async function flushVaultPending' in a3, 'there is no holding pen to empty'),
        ('await flushVaultPending()' in a3, 'the holding pen is never emptied when the Vault opens'),
        ('async function lockVault' in a3, 'locking still drops the key without writing the open note'),
        ('iv: null, ct: null' not in a3, 'moving a note into the Vault still writes an empty record'),
        ('if (S.current && S.current.vault) { vaultActivity(); return; }' in a3,
         'the automatic lock can still interrupt a Vault note'),
        ('These notes are still sealed' in a3, 'a missing PIN record can still bury sealed notes'),
        ('pending: {}' in a1 and 'pending: {}' in a3, 'the holding pen is not part of the state'),
        ('fav: !!j.fav' in a3, 'the star on a Vault note is still not stored'),
        ("(vault ? 'close' :" not in a2, 'the Vault row still says close instead of Lock'),
        ('note sealed here' in a2, 'the side bar does not say how many notes are sealed'),
        (data.get('version') == V, 'updates.json does not say %s' % V),
        (any(h.get('version') == V for h in data.get('history', [])), 'updates.json has no history entry for %s' % V),
    ]
    bad = [why for ok, why in probes if not ok]
    if bad:
        sys.exit('; '.join(bad))


def main():
    check_only = '--check' in sys.argv

    if check_only:
        check()
        print('%s is on the page' % V)
        return 0

    if applied():
        check()
        print('already applied - nothing to do')
        return 0

    rep('src/app1.js', STATE_OLD, STATE_NEW)
    rep('src/app1.js', SAVE_OLD, SAVE_NEW)
    rep('src/app3.js', DEC_OLD, DEC_NEW)
    rep('src/app3.js', FLUSH_OLD, FLUSH_NEW)
    rep('src/app3.js', LOCK_OLD, LOCK_NEW)
    rep('src/app3.js', AUTO_OLD, AUTO_NEW)
    rep('src/app3.js', UNLOCK_OLD, UNLOCK_NEW)
    rep('src/app3.js', META_OLD, META_NEW)
    rep('src/app3.js', WIPE_OLD, WIPE_NEW)
    rep('src/app3.js', MOVE_OLD, MOVE_NEW)
    rep('src/app2.js', NAV_OLD, NAV_NEW)
    rep('src/app2.js', SEALED_ROW_OLD, SEALED_ROW_NEW)
    rep('src/app2.js', EMPTY_OLD, EMPTY_NEW)

    resub('src/app1.js', r"const VERSION = '[0-9.]+';", "const VERSION = '%s';" % V)
    write('sw.js', re.sub(r'unote-v[0-9.]+', 'unote-v%s' % V, read('sw.js')))
    resub('android/app/build.gradle', r"def appVersion = '[0-9.]+'", "def appVersion = '%s'" % V)
    resub('android/app/build.gradle', r'versionCode \d+', 'versionCode %s' % CODE)

    data = json.loads(read('updates.json'))
    data['version'] = V
    data['date'] = DATE
    data['notes'] = NOTES
    hist = [h for h in data.get('history', []) if h.get('version') != V]
    hist.insert(0, {'version': V, 'date': DATE, 'title': TITLE, 'notes': NOTES})
    data['history'] = hist
    write('updates.json', json.dumps(data, indent=2, ensure_ascii=False) + '\n')

    check()
    print('applied %s' % V)
    return 0


if __name__ == '__main__':
    sys.exit(main())
