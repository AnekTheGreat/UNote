#!/usr/bin/env python3
"""UNote 1.0.6 - the same five apps, at addresses that answer.

The Other apps sheet had the right five apps and two wrong ways of reaching them: My Hub went to the
releases index of its repository and UJournal to the repository root, while every other app in the
family sent those two to Play. Neither is on Play yet either - but the release a build installs from
is, and that is what a row opens now.

It is the same five rows, in the same order and with the same lines the rest of the family carries.

    python3 dev/patch-106.py            # apply, then rebuild index.html
    python3 dev/patch-106.py --check    # verify only, writes nothing
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APP3 = "src/app3.js"
APP1 = "src/app1.js"
SHELL = "src/shell.html"
SW = "sw.js"
FEED = "updates.json"

V = "1.0.6"
OLD = "1.0.5"

OTHER_NEW = r"""const OTHER_APPS = [
  ['FamTM', 'The family tree in your pocket: people, birthdays and photos, kept on the phone.', 'https://github.com/AnekTheGreat/FamTM/releases/latest', 'F'],
  ['SideCut', 'A music player with its own equaliser and its own way of filing a library.', 'https://play.google.com/store/apps/details?id=com.SideCut.myapp', 'S'],
  ['MeasureT', 'Elevation, location, a level and a converter, all on one screen.', 'https://anekthegreat.github.io/Compass-EDC/', 'M'],
  ['My Hub', 'One screen that launches these apps and holds the update for each in one place.', 'https://github.com/AnekTheGreat/My-Hub/releases/latest', 'H'],
  ['UJournal', 'A journal for the days you bother to write down, from the same hand as the tree.', 'https://github.com/AnekTheGreat/Journal/releases/latest', 'J'],
];"""

HISTORY = {
    "version": V,
    "date": "2026-11-08",
    "title": "All five rows answer",
    "notes": [
        "Other apps still lists the same five apps, in the same order, with the same lines.",
        "My Hub and UJournal pointed at a repository page rather than the release a build installs "
        "from. Both now open the release, and MeasureT opens its page.",
        "SideCut keeps its Play listing, which is the only listing in the family that is live.",
    ],
}


def read(rel):
    with io.open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def write(rel, text):
    with io.open(os.path.join(ROOT, rel), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def build():
    shell = read(SHELL)
    js = "\n".join(read("src/app%d.js" % i) for i in (1, 2, 3))
    return shell.replace("/*__APP_JS__*/", js)


def main():
    check = "--check" in sys.argv
    app3 = read(APP3)
    app1 = read(APP1)
    sw = read(SW)
    feed = json.loads(read(FEED))
    touched = []

    if OTHER_NEW not in app3:
        if "const OTHER_APPS = [" not in app3:
            sys.exit("app3.js has no OTHER_APPS list")
        i = app3.index("const OTHER_APPS = [")
        j = app3.index("];", i) + 2
        app3 = app3[:i] + OTHER_NEW + app3[j:]
        touched.append("the other apps list")

    if ("const VERSION = '%s'" % V) not in app1:
        if ("const VERSION = '%s'" % OLD) not in app1:
            sys.exit("app1.js does not name %s" % OLD)
        app1 = app1.replace("const VERSION = '%s'" % OLD, "const VERSION = '%s'" % V, 1)
        touched.append("VERSION")

    if ("'unote-v%s'" % V) not in sw:
        if ("'unote-v%s'" % OLD) not in sw:
            sys.exit("sw.js does not cache unote-v%s" % OLD)
        sw = sw.replace("'unote-v%s'" % OLD, "'unote-v%s'" % V, 1)
        touched.append("the cache name")

    if feed.get("version") != V:
        feed["version"] = V
        feed["date"] = HISTORY["date"]
        feed["notes"] = HISTORY["notes"]
        hist = feed.get("history") or []
        hist = [h for h in hist if h.get("version") != V]
        feed["history"] = [HISTORY] + hist
        touched.append("updates.json")

    if not check:
        write(APP3, app3)
        write(APP1, app1)
        write(SW, sw)
        write(FEED, json.dumps(feed, ensure_ascii=False, indent=2) + "\n")
        write("index.html", build())
        print("UNote %s written to src/, sw.js, updates.json and index.html" % V)

    page = read("index.html") if not check else build()
    listed = app3.split("const OTHER_APPS = [")[1].split("];")[0]
    probes = [
        (OTHER_NEW in app3, "the five rows are not in app3.js"),
        ("My Hub" in listed and "UJournal" in listed, "a row is missing"),
        (listed.count("https://play.google.com/store/apps/details?id=") == 1,
         "a row still points at a Play listing that is not there"),
        ("github.com/AnekTheGreat/My-Hub/releases/latest" in listed, "My Hub has no address"),
        ("github.com/AnekTheGreat/Journal/releases/latest" in listed, "UJournal has no address"),
        ("anekthegreat.github.io/Compass-EDC/" in listed, "MeasureT has no address"),
        ("github.com/AnekTheGreat/My-Hub/releases'" not in listed, "My Hub still opens the repo"),
        ("const VERSION = '%s'" % V in app1, "app1.js does not say %s" % V),
        ("'unote-v%s'" % V in sw, "sw.js does not cache unote-v%s" % V),
        (feed.get("version") == V, "updates.json does not say %s" % V),
        (OTHER_NEW in page, "index.html was not rebuilt"),
        ("const VERSION = '%s'" % V in page, "index.html does not say %s" % V),
        ("otherAppsDialog" in page, "the page lost its sheet"),
    ]
    bad = [why for ok, why in probes if not ok]
    if bad:
        sys.exit("; ".join(bad))

    if check:
        print("all %d checks pass - the tree carries UNote %s" % (len(probes), V))
        print("untouched this run" if not touched else "applied: " + ", ".join(touched))
        return

    print("next: apk.yml rebuilds the APK from the same page")


if __name__ == "__main__":
    main()
