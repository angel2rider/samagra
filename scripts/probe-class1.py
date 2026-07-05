#!/usr/bin/env python3
"""Diagnostic probe: medium_id is being mis-stamped because Kerala's API
returns the same textbookData shape regardless of medium parameter.
List, for each (medium, class=1) request, what the URL path[0] actually
contains so we can derive the *real* medium from the URL prefix."""

import json
import urllib.request
from collections import Counter

API = "https://samagra.kite.kerala.gov.in/v2/api/public/getSubjectTextbooks"

for med in (1, 2, 3, 4):
    url = f"{API}/{med}/1"
    with urllib.request.urlopen(url, timeout=20) as r:
        body = json.loads(r.read())
    td = body["data"]["textbookData"]
    sd = body["data"]["subjectData"]
    print(f"\n=== medium request param={med} / class=1 ===")
    print(f"  subjects returned: {len(sd)}")
    print(f"  textbooks returned: {len(td)}")
    print(f"  distinct subjectIds in textbookData: {sorted(set(t['subjectId'] for t in td))}")

    prefixes = Counter()
    for t in td:
        seg = (t['chapterPdfUrl'] or '').lstrip('/').split('/')[0]
        prefixes[seg] += 1
    print(f"  URL path[0] distribution: {dict(prefixes)}")

    dupes = {k: v for k, v in Counter(t['id'] for t in td).items() if v > 1}
    print(f"  duplicate source_ids within endpoint: {dupes or 'None'}")

    print(f"  first 10 books:")
    for t in td[:10]:
        print(
            f"    - id={t['id']:>4}  sub={t['subjectId']:>3}  "
            f"name={t['chapterName']!r:>40}  pdf={t['chapterPdfUrl']}"
        )

# Cross-medium check: is the same source_id appearing under multiple medium requests?
print(f"\n=== Cross-medium source-id overlap (class=1) ===")
all_ids = {}
for med in (1, 2, 3, 4):
    url = f"{API}/{med}/1"
    with urllib.request.urlopen(url, timeout=20) as r:
        body = json.loads(r.read())
    for t in body["data"]["textbookData"]:
        all_ids.setdefault(t["id"], []).append(med)
multi = {k: v for k, v in all_ids.items() if len(v) > 1}
print(f"  total unique source_ids across all 4 mediums: {len(all_ids)}")
print(f"  source_ids appearing under >=2 mediums: {len(multi)}")
if multi:
    samples = list(multi.items())[:8]
    for sid, meds in samples:
        print(f"    - id={sid}  appears under mediums: {meds}")
