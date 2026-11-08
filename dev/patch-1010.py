#!/usr/bin/env python3
"""UNote 1.0.10 - the applier, under the name the release workflow derives from the version.

    python3 dev/patch-1010.py          # apply
    python3 dev/patch-1010.py --check  # say whether the tree already carries 1.0.10

patch.yml drops the dots from the version, so 1.0.10 asks for dev/patch-1010.py. The applier
itself is dev/patch-110.py, which is the file that was tested; this runs it unchanged rather
than keeping a second copy that could drift.
"""
import os
import runpy

HERE = os.path.dirname(os.path.abspath(__file__))
runpy.run_path(os.path.join(HERE, 'patch-110.py'), run_name='__main__')
