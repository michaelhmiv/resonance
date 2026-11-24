#!/usr/bin/env python3
"""Clean staging_v3 -> staging_v4_clean. Conservative, fully logged.

Per file: strip PG boilerplate / CCEL front-matter, collapse blank runs,
drop page-number lines and garbage lines, then gate on: English stopword
density, post-clean symbol-soup ratio, stub size, exact-duplicate hash.
Rejected/quarantined files are listed in meta/clean-log.json, never deleted.
"""
import hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "corpus/staging_v3"
DST = ROOT / "corpus/staging_v4_clean"
STOP = {"the","of","and","to","in","is","you","that","it","he","was","for","on","are","with","his","they","i","at","be","this","have","from","or","one","had","by","word","but","not","what","all","were","we","when","your","can","said","there","use","an","each","which","she","do","how","their","will"}

def strip_pg(t: str) -> str:
    m = re.search(r"\*\*\* START OF (THE|THIS) PROJECT GUTENBERG.*?\*\*\*\s*", t, re.S)
    if m: t = t[m.end():]
    elif t.startswith("The Project Gutenberg eBook of"):
        cut = t.find("\n***")
        meta_end = max(t.find("\nAuthor:"), t.find("\nRelease date"), t.find("\nLanguage:"))
        if meta_end > 0: t = t[meta_end:]
        t = re.sub(r"^.*?\n\n", "", t, count=3, flags=re.S) if cut < 0 else t
    for pat in [r"\*\*\* END OF (THE|THIS) PROJECT GUTENBERG", r"End of the Project Gutenberg eBook",
                r"Most people start at our website which has the main PG search"]:
        m = re.search(pat, t)
        if m: t = t[:m.start()]; break
    return t

def strip_ccel(t: str) -> str:
    if t.startswith("---"):
        end = t.find("\n---", 3)
        if end > 0: t = t[end + 4:]
    return t

def clean_lines(t: str) -> str:
    out = []
    for line in t.splitlines():
        s = line.strip()
        if re.fullmatch(r"\d{1,4}", s): continue                      # page numbers
        if s and len(s) < 120:
            alnum = sum(c.isalnum() for c in s); total = len(s)
            if total and (total - alnum) / total > 0.55: continue     # garbage/symbol lines
        out.append(line.rstrip())
    t = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", t).strip()

def main():
    log, seen = [], {}
    kept = rejected = quarantined = 0
    for sub in ["ccel", "ia", "gutenberg", "additions", "rescue"]:
        d = SRC / sub
        if not d.exists(): continue
        (DST / sub).mkdir(parents=True, exist_ok=True)
        for path in sorted(d.glob("*.txt")):
            raw = path.read_text(errors="replace")
            t = strip_pg(raw) if sub == "gutenberg" else strip_ccel(raw) if sub == "ccel" else raw
            t = clean_lines(t)
            words = t.split(); n = len(words)
            entry = {"file": f"{sub}/{path.name}", "words_before": len(raw.split()), "words_after": n}
            low = [w.strip(".,;:!?\"'()").lower() for w in words]
            stop_ratio = sum(1 for w in low if w in STOP) / max(n, 1)
            letters = sum(c.isalpha() for c in t); symbols = sum(1 for c in t if not c.isalnum() and not c.isspace())
            soup = symbols / max(letters, 1)
            h = hashlib.sha256(re.sub(r"\s+", " ", t.lower()).encode()).hexdigest()[:16]
            if n < 400: entry["action"] = "quarantine_stub"; quarantined += 1
            elif stop_ratio < 0.025: entry["action"] = "reject_non_english"; rejected += 1
            elif soup > 0.05: entry["action"] = "reject_symbol_soup"; entry["soup"] = round(soup, 3); rejected += 1
            elif h in seen: entry["action"] = "reject_duplicate"; entry["dup_of"] = seen[h]; rejected += 1
            else:
                entry["action"] = "kept"; seen[h] = entry["file"]; kept += 1
                (DST / sub / path.name).write_text(t)
            log.append(entry)
    (DST / "meta").mkdir(parents=True, exist_ok=True)
    (DST / "meta/clean-log.json").write_text(json.dumps(log, indent=1))
    kw = sum(e["words_after"] for e in log if e["action"] == "kept")
    print(f"kept {kept} files ({kw:,} words) | quarantined stubs {quarantined} | rejected {rejected}")
    from collections import Counter
    print(Counter(e["action"] for e in log))

if __name__ == "__main__":
    main()
