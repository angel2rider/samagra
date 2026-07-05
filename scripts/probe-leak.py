#!/usr/bin/env python3
"""Probe whether the live /api/textbooks endpoint is leaking cross-medium subjects.

For English / Class 1, we expect ~5-15 subjects that genuinely belong to
English-medium Class 1 (Maths, English, ICT, EVS, etc.). If we get back German,
Urdu, Malayalam II (a separate subject), etc. — that's the bug.

Also probe alternative Kerala endpoints in case there's a getSubjects or a
medium-strict endpoint that filters properly."""

import json
import urllib.request
import urllib.error

API = "https://samagra.kite.kerala.gov.in/v2/api/public"
HDRS = {"User-Agent": "Mozilla/5.0"}

# 1. Live books endpoint
for path in ("/getSubjectTextbooks/2/1", "/getSubjectTextbooks/2/6", "/getSubjectTextbooks/2/12"):
    url = f"{API}{path}"
    print(f"\n=== {path} ===")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HDRS), timeout=20) as r:
            body = json.loads(r.read())
    except Exception as e:
        print(f"  ERROR: {e}")
        continue
    sd = body["data"].get("subjectData", [])
    td = body["data"].get("textbookData", [])
    print(f"  subjects returned: {len(sd)}   textbooks returned: {len(td)}")
    print(f"  ALL subject names:")
    for s in sd:
        print(f"    - id={s['id']:>4}  name={s['subjectName']!r}  group={s.get('subjectGroupId')}")
    print(f"  textbook chapterNames + subjects:")
    for t in td:
        # Resolve subjectName from subjects list
        sub = next((s for s in sd if s["id"] == t["subjectId"]), None)
        sub_name = sub["subjectName"] if sub else "?"
        print(f"    - id={t['id']:>4}  subj={t['subjectId']:>3}({sub_name:>20})  "
              f"chapter={t['chapterName']!r:>40}  pdf={t['chapterPdfUrl']}")

# 2. Probe alternative endpoints
print("\n=== Probe alternative Kerala endpoints ===")
candidate_paths = [
    "/getSubjects",
    "/getSubjects/2/1",
    "/getSubjects/2",
    "/getMedium",
    "/getClasses",
    "/getMediums",
    "/getClassSubjects/2/1",
    "/getTextbooks/2/1",
    "/getTextbooks/2",
    "/getMediumTextbooks/2/1",
]
for p in candidate_paths:
    url = f"{API}{p}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HDRS), timeout=8) as r:
            ct = r.headers.get("content-type", "")
            body = r.read()
            body_text = body[:400] if ct.startswith("application/json") else body[:200]
            try:
                parsed = json.loads(body.decode("utf-8", errors="ignore"))
                keys = list(parsed.keys()) if isinstance(parsed, dict) else f"list({len(parsed)})"
                print(f"  {p:>40}  HTTP 200  ct={ct}  keys={keys}")
            except Exception:
                print(f"  {p:>40}  HTTP 200  ct={ct}  body[:200]={body_text!r}")
    except urllib.error.HTTPError as e:
        print(f"  {p:>40}  HTTP {e.code}")
    except Exception as e:
        print(f"  {p:>40}  err: {e}")

# 3. HEAD a few PDFs across different prefixes to check reachability
print("\n=== HEAD reachability of one PDF per URL prefix ===")
prefixes_to_test = [
    ("/eng/1/3/Maths_Eng_VolII_1761394278572_226097260.pdf", "eng"),
    ("/mal/1/3/Maths_Mal_VolII_1762607221210_176000226.pdf", "mal"),
    ("/tam/1/3/Maths_Tam_VolII_1762791162288_516000226.pdf", "tam"),
    ("/kan/1/3/Maths_Kan_VolII_1762707221210_834000226.pdf", "kan"),
]
U2 = "https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads2/tbookscmq"
U1 = "https://samagra.kite.kerala.gov.in/files/samagra-resource/uploads/tbookscmq"
for relpath, label in prefixes_to_test:
    for base in (U2, U1):
        url = f"{base}{relpath}"
        try:
            req = urllib.request.Request(url, method="HEAD", headers=HDRS)
            with urllib.request.urlopen(req, timeout=8) as r:
                print(f"  {label:>5}  {r.status}  ct={r.headers.get('content-type','?')}  url={url}")
                break
        except urllib.error.HTTPError as e:
            print(f"  {label:>5}  HTTP {e.code}  url={url}")
        except Exception as e:
            print(f"  {label:>5}  err: {e}")
