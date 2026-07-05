#!/usr/bin/env python3
"""Verify the post-refresh D1 mirror by hitting the deployed /api/textbooks endpoint."""

import json
import urllib.request
import sys

BASE = "https://samagra-textbooks.pages.dev"
SAMPLES = [
    (2, 1, "English / Class 1 — was the bug case"),
    (1, 1, "Malayalam / Class 1 — should NOT contain Arabic (was mis-labeled before)"),
    (2, 12, "English / Class 12 — biggest catalog"),
    (1, 5, "Malayalam / Class 5 — quick correctness"),
    (3, 1, "Tamil / Class 1"),
]

hdr = {"User-Agent": "verify-d1.py"}
for medium, cls, label in SAMPLES:
    url = f"{BASE}/api/textbooks?medium={medium}&class={cls}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=20) as r:
        d = json.loads(r.read())
    print(f"\n=== medium={medium} class={cls}  ({label}) ===")
    print(f"  subjects: {len(d['subjects'])}   textbooks: {d['total']}")
    print(f"  subject names (first 8): {[s['subjectName'] for s in d['subjects'][:8]]}")
    print(f"  books:")
    for b in d["textbooks"][:6]:
        print(
            f"    - id={b['id']:>4}  src_subj={b['subjectId']:>3}  "
            f"subj={b['subjectName']!r:>30}  cls={b['classId']}  med={b['mediumId']}  "
            f"pdf={b['pdfUrl']!r}  dlState={b.get('downloadState')}"
        )

# Stats endpoint
try:
    with urllib.request.urlopen(f"{BASE}/api/stats", timeout=10) as r:
        stats = json.loads(r.read())
    print(f"\n=== /api/stats ===\n  {stats}")
except Exception as e:
    print(f"\n=== /api/stats error: {e}", file=sys.stderr)

# Cross-medium contamination check: English/Class 1 books must all have mediumId=2
url = f"{BASE}/api/textbooks?medium=2&class=1"
with urllib.request.urlopen(url, timeout=20) as r:
    d = json.loads(r.read())
bad = [b for b in d["textbooks"] if b["mediumId"] != 2]
print(f"\n=== Medium-contamination check (eng/1) ===")
print(f"  total books returned: {len(d['textbooks'])}")
print(f"  mis-classified (medium!=2): {len(bad)}")
if bad:
    print(f"  offenders (first 3): {[b['chapterName'] for b in bad[:3]]}")
else:
    print(f"  PASS - every English/Class-1 book has mediumId=2.")
