#!/usr/bin/env python3
"""Join src/ into the single page the app ships as.

    python3 dev/build.py            writes index.html
    python3 dev/build.py --check    exits 1 if index.html is stale

src/shell.html holds everything except the script; /*__APP_JS__*/ is replaced
with src/app1.js, src/app2.js and src/app3.js, in that order, joined by a newline.
"""
import io, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELL = os.path.join(ROOT, 'src', 'shell.html')
PARTS = [os.path.join(ROOT, 'src', 'app%d.js' % i) for i in (1, 2, 3)]
OUT = os.path.join(ROOT, 'index.html')


def build():
    shell = io.open(SHELL, encoding='utf-8').read()
    js = '\n'.join(io.open(p, encoding='utf-8').read() for p in PARTS)
    return shell.replace('/*__APP_JS__*/', js)


def main():
    page = build()
    if '--check' in sys.argv:
        current = io.open(OUT, encoding='utf-8').read() if os.path.exists(OUT) else ''
        if current == page:
            print('index.html is up to date')
            return 0
        print('index.html is stale - run python3 dev/build.py')
        return 1
    io.open(OUT, 'w', encoding='utf-8').write(page)
    print('wrote index.html (%d bytes)' % len(page))
    return 0


if __name__ == '__main__':
    sys.exit(main())
