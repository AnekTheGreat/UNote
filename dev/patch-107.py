#!/usr/bin/env python3
"""UNote 1.0.7 - the beginning is a welcome, not a job.

The first thing UNote ever asked was a Vault PIN: a dialog with one button, "Choose my PIN", and
under it a warning that the PIN can never be recovered. Before writing a single word, someone had to
make a decision about a private space they had not been shown yet. And the note that then appeared
was a manual - four sections about links, tags, the Vault and export.

1.0.7 makes the start what the app is for: a welcome that says what this is, one button that starts a
note, and the Vault offered as a choice rather than demanded. The Vault itself is unchanged: it asks
for its PIN the first time you open it, which is the moment the PIN actually means something.

--check says whether the tree ALREADY carries the change.

    python3 dev/patch-107.py
    python3 dev/patch-107.py --check
"""

import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APP1 = "src/app1.js"
APP3 = "src/app3.js"
SW = "sw.js"
FEED = "updates.json"
GRADLE = "android/app/build.gradle"

V = "1.0.7"
OLD = "1.0.6"
CODE_OLD = "versionCode 1005"
CODE_NEW = "versionCode 1007"

ONBOARD_NEW = '''async function onboard() {
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

'''

WELCOME_NEW = '''function seedWelcome() {
  if (S.notes.length) return;
  const t = nowMs();
  S.notes.push({
    id: uid(), title: 'Welcome', folder: '', fav: true, created: t, updated: t, deleted: 0,
    body: 'This is a note. Tap it and type - that is the whole app.\\n\\n' +
      'Two things you can do as you go:\\n\\n' +
      '- Type [[another note]] and the two are linked, in both directions.\\n' +
      '- Type #idea anywhere and it shows up under Tags.\\n\\n' +
      'The lock on the left is the Vault: a private space for notes, behind a PIN you choose the first time you open it. Nothing else here needs setting up.\\n\\n' +
      '- [ ] Write something real\\n\\n#start',
  });
  saveNote(S.notes[0], { quiet: true });
}

'''

FEED_NOTES = [
    "The start is a welcome now: what UNote is, and one button that begins a note. It no longer opens by asking for a Vault PIN.",
    "The Vault is a choice, not a step. It asks for its PIN the first time you open it, which is when the PIN means something.",
    "The first note is short: tap it and type, how to link two notes, how to tag one, and where the Vault is.",
]


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def write(rel, text):
    with io.open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def swap(text, start_marker, end_marker, replacement, what):
    """Replace everything from start_marker up to end_marker with replacement."""
    i = text.find(start_marker)
    if i < 0:
        sys.exit("%s: the old %s is not there" % (what, what))
    j = text.find(end_marker, i)
    if j < 0:
        sys.exit("%s: the end of the old %s is not there" % (what, what))
    return text[:i] + replacement + text[j:]


def main():
    check = "--check" in sys.argv
    app1 = read(APP1)
    app3 = read(APP3)
    sw = read(SW)
    feed = read(FEED)
    gradle = read(GRADLE)
    touched = []

    if "async function onboard() {" in app3 and "Start writing" not in app3:
        app3 = swap(app3, "async function onboard() {", "function askNewPin(done) {", ONBOARD_NEW,
                    "welcome")
        touched.append("the welcome")

    if "function seedWelcome() {" in app3 and "Tap it and type" not in app3:
        app3 = swap(app3, "function seedWelcome() {", "function closeSide() {", WELCOME_NEW,
                    "first note")
        touched.append("the first note")

    ver_old = "const VERSION = '%s';" % OLD
    ver_new = "const VERSION = '%s';" % V
    if ver_new not in app1:
        if ver_old not in app1:
            sys.exit("src/app1.js does not name %s" % OLD)
        app1 = app1.replace(ver_old, ver_new, 1)
        touched.append("VERSION")

    cache_old = "const CACHE = 'unote-v%s';" % OLD
    cache_new = "const CACHE = 'unote-v%s';" % V
    if cache_new not in sw:
        if cache_old not in sw:
            sys.exit("sw.js does not cache under %s" % OLD)
        sw = sw.replace(cache_old, cache_new, 1)
        touched.append("the service worker cache")

    if ('"version": "%s"' % V) not in feed:
        if ('"version": "%s"' % OLD) not in feed:
            sys.exit("updates.json does not name %s" % OLD)
        d = json.loads(feed)
        d["version"] = V
        d["date"] = "2026-11-08"
        d["notes"] = FEED_NOTES
        d["history"] = ([{"version": V, "date": "2026-11-08",
                          "title": "A welcome, not a PIN", "notes": FEED_NOTES}]
                        + [h for h in d.get("history", []) if h.get("version") != V])
        feed = json.dumps(d, ensure_ascii=False, indent=2) + "\n"
        touched.append("updates.json")

    if CODE_NEW not in gradle:
        if CODE_OLD not in gradle:
            sys.exit("android/app/build.gradle does not carry %s" % CODE_OLD)
        gradle = gradle.replace(CODE_OLD, CODE_NEW, 1)
        touched.append("the Android version code")

    if check:
        if touched:
            sys.exit("the tree does not carry %s yet (%s)" % (V, ", ".join(touched)))
        fresh = subprocess.run([sys.executable, os.path.join(ROOT, "dev", "build.py"), "--check"],
                               cwd=ROOT, capture_output=True, text=True)
        if fresh.returncode != 0:
            sys.exit("index.html is stale - run dev/build.py")
        page_now = read("index.html")
    else:
        write(APP1, app1)
        write(APP3, app3)
        write(SW, sw)
        write(FEED, feed)
        write(GRADLE, gradle)
        built = subprocess.run([sys.executable, os.path.join(ROOT, "dev", "build.py")],
                               cwd=ROOT, capture_output=True, text=True)
        if built.returncode != 0:
            sys.exit("dev/build.py failed: " + (built.stderr or built.stdout))
        page_now = read("index.html")

    probes = [
        ("id=\"obGo\"" in page_now, "the welcome has no Start writing button"),
        ("Start writing" in page_now, "the welcome does not offer starting a note"),
        ("Choose my PIN" not in page_now, "the welcome still demands a PIN"),
        ("Set up the Vault" in page_now, "the Vault is not offered at the start"),
        ("Tap it and type" in page_now, "the first note is not the short one"),
        ("The lock on the left is the Vault" in page_now,
         "the first note does not say where the Vault is"),
        ("const VERSION = '%s';" % V in page_now, "the page does not say %s" % V),
        ('"version": "%s"' % V in read(FEED), "updates.json does not say %s" % V),
        (CODE_NEW in read(GRADLE), "the Android version code is not %s" % CODE_NEW.split()[1]),
        ("askNewPin" in page_now, "the Vault's PIN prompt is gone"),
        ("unote-v%s" % V in read(SW), "the service worker still caches the old name"),
    ]
    bad = [why for ok, why in probes if not ok]
    if bad:
        sys.exit("; ".join(bad))

    if check:
        print("all %d checks pass - the tree carries UNote %s" % (len(probes), V))
        return

    print("UNote %s written: src/app1.js, src/app3.js, sw.js, updates.json, build.gradle, "
          "and index.html rebuilt" % V)


if __name__ == "__main__":
    main()
