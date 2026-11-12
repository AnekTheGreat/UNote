'use strict';
/* UNote - part 1: helpers, storage, crypto, markdown, rendering. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const VERSION = '1.0.24';
const APP = 'UNote';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const nowMs = () => Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms || 2400);
}
function debounce(fn, ms) { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; }
function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), diff = nowMs() - ts;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return Math.floor(diff / MIN) + ' min ago';
  if (diff < DAY && new Date().getDate() === d.getDate()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < DAY * 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
const dayKey = d => { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const words = s => (String(s || '').trim().match(/[^\s]+/g) || []).length;

/* ---------------- storage ---------------- */
const DB_NAME = 'unote', DB_VER = 2;
let db = null;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('notes')) {
        const s = d.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('updated', 'updated');
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('media')) {
        const ms = d.createObjectStore('media', { keyPath: 'id' });
        ms.createIndex('note', 'noteId');
      }
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}
const store = (n, mode) => db.transaction(n, mode || 'readonly').objectStore(n);
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbAll = n => req(store(n).getAll());
const dbPut = (n, v) => req(store(n, 'readwrite').put(v));
const dbDel = (n, k) => req(store(n, 'readwrite').delete(k));
const kvGet = async k => { const r = await req(store('kv').get(k)); return r ? r.v : undefined; };
const kvSet = (k, v) => dbPut('kv', { k: k, v: v });

/* ---------------- crypto (the Vault) ---------------- */
const te = new TextEncoder(), td = new TextDecoder();
const KDF_ITER = 200000;
function toB64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
async function deriveKey(pin, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations: iter || KDF_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesEnc(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, te.encode(String(text)));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function aesDec(key, ivB64, ctB64) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, fromB64(ctB64));
  return td.decode(pt);
}
const randSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

/* ---------------- state ---------------- */
const S = {
  notes: [],            // plain notes (vault:false)
  vault: { on: false, key: null, salt: '', verifier: null, notes: [], plain: [], pending: {}, tries: 0, until: 0 },
  settings: { theme: 'dark', accent: '#7c5cff', size: 16, mode: 'split', autolock: 2, onboarded: false, sort: 'updated' },
  current: null,
  folder: '',
  tag: '',
  view: 'notes',        // notes | fav | trash | vault | tags
  paletteQuery: '',
  right: 'links',
  dirty: false,
};

/* A record with ciphertext in it is a Vault note, whichever list a file happened to keep it in.
   Everything that reads or writes a backup asks this first, so a sealed note can never be left
   sitting in the plain list - or in its Trash - where no PIN could open it. */
const isSealed = r => !!(r && (r.vault === true || (r.iv && r.ct)));
const allNotes = () => (S.view === 'vault' ? S.vault.plain : S.notes);
/* The Vault is a room, not a filter: while it is closed its notes are not in hand at all. */
function vaultList() { return (S.vault.key && S.view === 'vault') ? S.vault.plain : []; }
const findNote = id => S.notes.find(n => n.id === id) || S.vault.plain.find(n => n.id === id) || null;
const findTitle = t => {
  const k = String(t || '').trim().toLowerCase();
  if (!k) return null;
  return allNotes().find(n => (n.title || '').trim().toLowerCase() === k) || null;
};
const tagOf = body => {
  const out = new Set();
  String(body || '').replace(/(^|[\s(])#([A-Za-z0-9][\w\/-]{0,40})/g, (m, a, t) => { out.add(t); return m; });
  return Array.from(out);
};
const wikiOut = body => {
  const out = [];
  String(body || '').replace(/\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g, (m, t) => { const v = t.trim(); if (v && out.indexOf(v) < 0) out.push(v); return m; });
  return out;
};

/* ---------------- markdown ---------------- */
function inlineMd(src, noteById) {
  const look = typeof noteById === 'function' ? noteById : t => findTitle(t);
  let s = esc(src);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => '<img alt="' + alt + '" src="' + url + '">');
  s = s.replace(/\[([^\]]+)\]\(((?:https?|unote-media):[^)\s]+)\)/g, (m, t, url) => '<a href="' + url + '" target="_blank" rel="noopener">' + t + '</a>');
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, label) => {
    const t = target.trim();
    const hit = look(t);
    return '<a class="wl' + (hit ? '' : ' miss') + '" data-w="' + esc(t) + '">' + esc(label || t) + '</a>';
  });
  s = s.replace(/(^|[\s(])#([A-Za-z0-9][\w\/-]{0,40})/g,
    (m, pre, tag) => pre + '<span class="inline-tag" data-tag="' + tag + '">#' + tag + '</span>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, m => /<a /.test(m) ? m : '<a href="' + m + '" target="_blank" rel="noopener">' + m + '</a>');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + codes[+i] + '</code>');
  return s;
}

function md(src) {
  const byTitle = t => findTitle(t);
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let out = '', i = 0, inList = false, listType = '';
  const closeList = () => { if (inList) { out += '</' + listType + '>'; inList = false; } };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      closeList();
      out += '<pre><code data-lang="' + esc(lang) + '">' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeList();
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      let body = '';
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        body += '<tr>' + cells(lines[i]).map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>';
        i++;
      }
      out += '<table><thead><tr>' + head.map(h => '<th>' + inlineMd(h) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lv = Math.min(h[1].length, 4);
      out += '<h' + lv + '>' + inlineMd(h[2]) + '</h' + lv + '>';
      i++; continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { closeList(); out += '<hr>'; i++; continue; }

    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += '<blockquote>' + md(buf.join('\n')) + '</blockquote>';
      continue;
    }

    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      if (!inList || listType !== 'ul') { closeList(); out += '<ul>'; inList = true; listType = 'ul'; }
      const done = task[1].toLowerCase() === 'x';
      out += '<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" disabled' + (done ? ' checked' : '') + '><span>' + inlineMd(task[2]) + '</span></li>';
      i++; continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (!inList || listType !== 'ul') { closeList(); out += '<ul>'; inList = true; listType = 'ul'; }
      out += '<li>' + inlineMd(ul[1]) + '</li>';
      i++; continue;
    }

    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) {
      if (!inList || listType !== 'ol') { closeList(); out += '<ol>'; inList = true; listType = 'ol'; }
      out += '<li>' + inlineMd(ol[2]) + '</li>';
      i++; continue;
    }

    if (!line.trim()) { closeList(); i++; continue; }

    closeList();
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    out += '<p>' + inlineMd(buf.join('\n')).replace(/\n/g, '<br>') + '</p>';
  }
  closeList();
  return out;
}

/* ---------------- note objects ---------------- */
function newNote(extra) {
  const t = new Date();
  const n = Object.assign({
    id: uid(), title: '', body: '', folder: '', fav: false, created: nowMs(), updated: nowMs(), deleted: 0,
  }, extra || {});
  return n;
}

async function saveNote(note, opts) {
  if (!note) return;
  note.updated = nowMs();
  if (note.vault) {
    if (!S.vault.key) {
      /* 1.0.16 - a save that cannot happen must not throw the words away. They wait in a holding
         pen on this phone and go in the moment the PIN is back. */
      (S.vault.pending = S.vault.pending || {})[note.id] = {
        id: note.id, title: note.title || '', body: note.body || '', folder: note.folder || '',
        created: note.created || note.updated, updated: note.updated, fav: !!note.fav,
        ink: note.ink || null,
      };
      kvSet('vaultpending', S.vault.pending).catch(() => {});
      return;
    }
    const box = await aesEnc(S.vault.key, JSON.stringify({ title: note.title, body: note.body, folder: note.folder, fav: !!note.fav, ink: note.ink || null }));
    const rec = { id: note.id, vault: true, created: note.created, updated: note.updated, iv: box.iv, ct: box.ct };
    const idx = S.vault.notes.findIndex(r => r.id === note.id);
    if (idx >= 0) S.vault.notes[idx] = rec; else S.vault.notes.push(rec);
    await dbPut('notes', rec);
  } else {
    await dbPut('notes', note);
  }
  if (!opts || !opts.quiet) setSaved();
}

let savedTimer = null;
function setSaved() {
  const el = $('#sSaved');
  el.textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = 'Saved on this device'; }, 1600);
}
