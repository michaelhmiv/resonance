#!/usr/bin/env python3
"""Build canonical units (chunking-spec SS2-SS4) from the cleaned corpus.

Authors: corpus/staging_v4_clean/<source>/*.txt -> corpus/units/<work_id>.jsonl
Bible:   corpus/bible/web.json -> verse-group units in corpus/units/web.jsonl

Cleaning:
  - Excludes TOC-only stubs, severely corrupted scans, and lower-quality
    duplicate scans where a clean human-proofread or CCEL edition exists.
  - Strips YAML/IA metadata headers, Google Books front-matter & watermarks,
    Project Gutenberg / Transcriber's Note / University Library boilerplate,
    imprimatur/printer colophons, and URLs.
  - De-hyphenates, repairs long-s and unambiguous OCR typos, captures
    heading->division structure, splits paragraph/poetry units, and enforces a
    strict clean-English readability gate (quarantine logged to
    corpus/units/meta-log.json).
"""
import json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "corpus/staging_v4_clean"
OUT = ROOT / "corpus/units"
SOURCES = ["ccel", "ia", "gutenberg", "additions", "rescue"]
CLEAN_VOCAB_SOURCES = ["gutenberg", "rescue"]
TOKEN = re.compile(r"[A-Za-z']+")
ALPHA_TOKEN = re.compile(r"[A-Za-z]+")

# Works excluded from shipping packs: TOC-only broken scans, severely corrupted
# marginal-note scans, or lower-quality IA duplicates of clean CCEL/Gutenberg works.
EXCLUDED_WORKS = {
    "acts-of-paul-and-thecla__contents-1057",
    "the-history-and-life-of-the-reverend-doctor-john-tauler-of-strasbourg-with-twenty-five-of-his-sermons__historyandlifer01kinggoog",
    "the-life-of-saint-teresa-of-jesus-of-the-order-of-our-lady-of-carmel__the-life-of-saint-teresa-of-jesus-by-herself",
    "the-city-of-god-de-civitate-dei__cityofgoddecivit0000augu",
    "the-nine-homilies-of-the-hexaemeron__st-basillettersandselectedworks",
    "on-the-priesthood-in-six-books__onpriesthood00unkngoog",
    "preacher-and-prayer",
}

def words(s: str) -> int:
    return len(s.split())

# ---------- vocabularies (full for long-s, clean-only for quality gate) ----------
def build_vocabs() -> tuple[Counter, set[str]]:
    full_vocab = Counter()
    clean_vocab = Counter()
    for src in SOURCES:
        d = STAGING / src
        if not d.exists():
            continue
        for f in sorted(d.glob("*.txt")):
            if f.stem in EXCLUDED_WORKS:
                continue
            txt = f.read_text(errors="replace")
            toks = [t.lower() for t in TOKEN.findall(txt)]
            full_vocab.update(toks)
            if src in CLEAN_VOCAB_SOURCES:
                clean_vocab.update(w.lower() for w in ALPHA_TOKEN.findall(txt))

    # Add WEB Bible words to clean vocabulary
    bible_path = ROOT / "corpus/bible/web.json"
    if bible_path.exists():
        bdata = json.loads(bible_path.read_text())
        for v in bdata.get("verses", []):
            clean_vocab.update(w.lower() for w in ALPHA_TOKEN.findall(v.get("text", "")))

    # Add system English dictionary if installed
    for dp in ("/usr/share/dict/words", "/usr/share/dict/american-english"):
        p = Path(dp)
        if p.exists():
            for line in p.read_text(errors="ignore").splitlines():
                w = line.strip().lower()
                if w.isalpha():
                    clean_vocab[w] += 10
            break

    good_words = {w for w, c in clean_vocab.items() if c >= 3}
    return full_vocab, good_words

def longs_repair(text: str, vocab: Counter) -> tuple[str, int]:
    fixes = 0
    def repl(m):
        nonlocal fixes
        tok = m.group(0)
        low = tok.lower()
        if len(low) < 3 or "f" not in low:
            return tok
        best, best_n = None, max(199, 20 * vocab[low])
        cands = {low[:i] + "s" + low[i + 1:] for i, ch in enumerate(low) if ch == "f"}
        cands.add(low.replace("f", "s"))
        for cand in cands:
            if vocab[cand] > best_n:
                best, best_n = cand, vocab[cand]
        if best is None:
            return tok
        fixes += 1
        return best.capitalize() if tok[:1].isupper() else best
    return TOKEN.sub(repl, text), fixes

# ---------- document-level boilerplate scrubber ----------
YAML_META_LINE = re.compile(r"^\s*(?:source_kind|identifier|title|source_url|author|date|language)\s*:\s*.*$", re.I)

GOOGLE_BLOCK_START = re.compile(
    r"(?:^|\n)\s*(?:Google\s*\n+)?This is a digital copy of a book that was preserved for generations",
    re.I,
)
GOOGLE_BLOCK_END = re.compile(
    r"(?:books\s*\.\s*google\s*\.\s*com|About Google Book Search[^\n]*\n(?:[^\n]*\n){0,8})",
    re.I,
)

# Full-line watermark pattern (catches OCR-mangled "Digitized by Google" + blackletter headers on the same line)
WATERMARK_LINE_RE = re.compile(
    r"(?:\b(?:digitiz|bigitiz|uigmz)\w*|\b\w{0,4}itized\s+(?:by|bf))\s*[^\n]*|\bd\s+by\s+g[o0a]{1,2}gl\w*\b|\bhosted\s+by\s+google\b|^\s*google\s*$",
    re.I,
)

INLINE_WATERMARK_RE = re.compile(
    r"(?:(?:Digitized|Hosted|d)\s+by\s+G[o0a]{1,2}gl\w*|Generated on \d{4}-\d{2}-\d{2}[^\n]*|https?://\S+|www\.\S+|\b[a-z0-9-]+\.(?:com|org|edu)\b)",
    re.I,
)

# Budge's Desert Fathers OCR'd opening quote marks at line starts ("44 " / "4 4 ")
BUDGE_QUOTE_MARGIN_RE = re.compile(r"(?:^|\n)\s*4\s*4\s+(?=[A-Za-z])")

BOILERPLATE_SUBSTRINGS = (
    "this is a digital copy of a book",
    "digitized by google",
    "google book search",
    "about google book search",
    "books.google",
    "google is proud to partner",
    "make the world's books discoverable",
    "make non-commercial use of the files",
    "refrain from automated querying",
    "maintain attribution",
    "keep it legal",
    "usage guidelines",
    "copyright to expire",
    "legal copyright term",
    "gateways to the past",
    "public domain book is one",
    "enter the public domain",
    "public domain in the united states",
    "vary country to country",
    "present in the original volume",
    "reminder of this book's long",
    "we are merely their custodians",
    "prevent abuse by commercial",
    "this book should be returned on or before",
    "books are loaned for",
    "fines will be charged",
    "membership cards are the personal",
    "morrison and gibb",
    "158 fifth avenue",
    "paternoster square",
    "project gutenberg",
    "distributed proofreading",
    "transcriber's note",
    "transcribers note",
    "gutenberg.org",
    "source_kind:",
    "source_url:",
    "identifier:",
    "internet archive",
    "archive.org",
    "christian classics ethereal library",
    "ccel.org",
    "university of texas bulletin",
    "mirabeau b. lamar",
    "sam houston",
    "benefits of education and of useful knowledge",
    "guardian genius of democracy",
    "made and printed in great britain",
    "printed in great britain",
    "printed at the appleton press",
    "images of the original pages are available",
    "produced by elizabeth",
    "produced by david",
    "produced by charles",
    "produced by the online distributed",
    "e-text prepared by",
    "etext prepared by",
    "ebook was produced by",
    "about this ebook",
    "other information and formats:",
    "this electronic text is derived",
    "prepared by distributed proofreaders",
    "practicegodspresence",
    "due on the last date stamped",
    "all rights reserved",
    "no part of this publication may be reproduced",
    "entered according to act of congress",
    "notice to subscribers",
    "the quotations that precede each chapter have been moved",
    "a list of other books from the same publisher",
    "copyright (c)",
    "copyright 18",
    "copyright, 18",
    "copyright 19",
    "copyright, 19",
    "copyright 20",
    "fleming h. revell",
    "walton street, oxford",
    "oxford university press",
    "the devotional library",
    "handsomely printed and bound",
    "crown 8vo",
    "crown svo",
    "fcap. 8vo",
    "demy 8vo",
    "3s. 6d.",
    "price 3s",
    "price 5s",
    "price 6s",
    "price 7s",
    "red-line edition",
    "large-type edition",
    "limp cloth",
    "foreign theological library",
    "ante-nicene library",
    "works by, and edited by",
    "harvard college library",
    "princeton theological seminary",
    "university of toronto",
    "robarts library",
    "cornell university library",
    "boston public library",
    "library of congress",
    "microsoft corporation",
    "imprimatur",
    "nihil obstat",
    "npnf1-06 contents",
    "anfo8 contents",
)

SAFE_OCR_MAP = {
    "Gop": "God",
    "tliis": "this",
    "Tliis": "This",
    "liave": "have",
    "tbe": "the",
    "Tbe": "The",
    "fhe": "the",
    "Fhe": "The",
    "tlie": "the",
    "Tlie": "The",
    "wbich": "which",
    "tbat": "that",
    "tliat": "that",
    "witb": "with",
    "wlio": "who",
    "sball": "shall",
    "veiy": "very",
    "eveiy": "every",
    "tliem": "them",
    "tlieir": "their",
}
SAFE_OCR_RE = re.compile(
    r"\b(?:[Cc]u(?:[Hh]?a|ha)p[tT]{1,2}e[rR]{1,2}|[Cc][uU][Hh]?[aA][pP][tT][eE][rR]|"
    + "|".join(SAFE_OCR_MAP.keys())
    + r")\b"
)

def _ocr_repl(m: re.Match) -> str:
    w = m.group(0)
    return SAFE_OCR_MAP.get(w, "Chapter")

def _norm_for_boilerplate(text: str) -> str:
    return " ".join(text.lower().replace("\u2019", "'").replace("\u2018", "'").split())

def scrub_document_text(text: str) -> str:
    text = re.sub(r"\r\n?", "\n", text)

    # Strip leading YAML / metadata front-matter block
    lines = text.splitlines()
    i = 0
    while i < min(len(lines), 25):
        s = lines[i].strip()
        if not s or YAML_META_LINE.match(s) or s.lower() == "google" or s == "---":
            i += 1
        else:
            break
    text = "\n".join(lines[i:])

    # Strip Google Books multi-paragraph license preamble if present
    m_start = GOOGLE_BLOCK_START.search(text[:15000])
    if m_start:
        m_end = GOOGLE_BLOCK_END.search(text, m_start.end(), min(len(text), m_start.end() + 7000))
        if m_end:
            text = text[:m_start.start()] + "\n\n" + text[m_end.end():]
        else:
            paras = re.split(r"\n\s*\n", text)
            text = "\n\n".join(p for p in paras if "google" not in p.lower() or len(p) > 1500)

    # Strip watermark lines BEFORE paragraph joining so page-break Google headers
    # never fuse into neighboring prose sentences
    cleaned_lines = []
    for ln in text.splitlines():
        if WATERMARK_LINE_RE.search(ln):
            # If the watermark is embedded inside a long real prose line, strip only the watermark fragment
            if len(ln) > 140 and not re.search(r"digitiz|bigitiz|uigmz", ln, re.I):
                cleaned_lines.append(INLINE_WATERMARK_RE.sub("", ln))
            continue
        cleaned_lines.append(ln)
    text = "\n".join(cleaned_lines)

    # Strip remaining inline watermarks & URLs
    text = INLINE_WATERMARK_RE.sub("", text)

    # Clean OCR'd block-quote margin numbers ("44 ")
    text = BUDGE_QUOTE_MARGIN_RE.sub("\n", text)

    # Strip trailing Project Gutenberg / EBook / Transcriber footers
    for marker in (
        "*** END OF THE PROJECT GUTENBERG",
        "*** END OF THIS PROJECT GUTENBERG",
        "End of the Project Gutenberg",
        "About This EBook",
    ):
        idx = text.find(marker)
        if idx > 0:
            text = text[:idx]

    # Strip trailing Transcriber's Note when in the last 5% of the document
    tail_start = int(len(text) * 0.95)
    m_trans = re.search(r"(?:^|\n)\s*Transcriber['\u2019]s\s+Note", text[tail_start:], re.I)
    if m_trans:
        text = text[:tail_start + m_trans.start()]

    # Apply single-pass safe unambiguous OCR repairs
    text = SAFE_OCR_RE.sub(_ocr_repl, text)

    return text

def is_boilerplate_block(text: str) -> bool:
    low = _norm_for_boilerplate(text)
    if any(nd in low for nd in BOILERPLATE_SUBSTRINGS):
        return True
    if "http://" in low or "https://" in low or "www." in low:
        return True
    if re.search(r"\bgoogle\b|digitized by|bigitized", low):
        return True
    if low.strip(" .|-_*[]()") in ("google", "digitized by google"):
        return True
    return False

# ---------- unit splitting ----------
HEAD_RE = re.compile(r"^(CHAPTER|BOOK|PART|SERMON|LETTER|PSALM|SECTION|DISCOURSE|HOMILY)\b", re.I)
def is_heading(p: str) -> bool:
    p = p.strip()
    if not p or len(p) > 70 or words(p) > 9: return False
    if p[-1] in ".!?;:," : return False
    if HEAD_RE.match(p): return True
    letters = [c for c in p if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.8: return True
    if p == p.title() and words(p) >= 2: return True
    return False

INDEX_LINE_RE = re.compile(r"(?:,\s*|\s+)\d{1,4}\.?$")
INDEX_REF_RE = re.compile(r"[,;]\s*\d{1,4}(?:\s*[.,;])")
def is_furniture(p: str) -> bool:
    s = p.strip()
    if not s: return True
    if is_boilerplate_block(s): return True
    if re.fullmatch(r"(page\s+)?\d{1,4}", s, re.I): return True
    if re.fullmatch(r"\[illustration[^\]]*\]", s, re.I): return True
    if s and sum(c.isdigit() or not c.isalnum() for c in s) / len(s) > 0.6 and words(s) < 6: return True
    lines = [l.strip() for l in s.split("\n") if l.strip()]
    if len(lines) >= 4 and sum(1 for l in lines if INDEX_LINE_RE.search(l)) / len(lines) >= 0.6:
        return True
    # Detect flattened back-of-book alphabetical index blocks ("Way, the strait; 86. Will, the, 281.")
    if len(INDEX_REF_RE.findall(s)) >= 5 and len(INDEX_REF_RE.findall(s)) / max(words(s), 1) > 0.08:
        return True
    return False

def split_units(text: str):
    """Yield (division, kind, text) units from a cleaned work text."""
    text = scrub_document_text(text)
    text = re.sub(r"([a-z])-\n([a-z])", r"\1\2", text)          # de-hyphenate
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text)]
    from collections import Counter as _C
    _freq = _C(" ".join(b.split()).lower() for b in blocks)
    def _running_head(b):
        s = " ".join(b.split())
        letters = [c for c in s if c.isalpha()]
        return (words(s) <= 10 and letters and
                sum(c.isupper() for c in letters) / len(letters) > 0.75 and
                (_freq[s.lower()] >= 3 or any(c.isdigit() for c in s)))
    blocks = [re.sub(r"^\d{1,4}\s+(?=[A-Z])", "", b) if _running_head(b) else b for b in blocks]
    blocks = [b for b in blocks if not _running_head(b)]
    division, pending = None, ""
    for b in blocks:
        if not b or is_furniture(b): continue
        if is_heading(b):
            if pending: yield division, "prose", pending; pending = ""
            division = " ".join(b.split()); continue
        lines = [l for l in b.split("\n") if l.strip()]
        kind = "prose"
        if len(lines) >= 4 and sum(words(l) for l in lines) / len(lines) < 8:
            kind = "poetry"
            unit = "\n".join(" ".join(l.split()) for l in lines)
        else:
            unit = " ".join(" ".join(l.split()) for l in lines)
        if kind == "prose" and words(unit) < 12:
            pending = f"{pending} {unit}".strip(); continue
        if pending:
            unit = f"{pending} {unit}".strip() if kind == "prose" else unit
            if kind == "prose": pending = ""
            else: yield division, "prose", pending; pending = ""
        yield division, kind, unit
    if pending: yield division, "prose", pending

ARTIFACT_CHARS = set("^~|\\@#_■£¢¥§«»<>`")
MIXED_CASE_RE = re.compile(r"\b[a-z]+[A-Z][a-zA-Z]*\b|\b[A-Z]{2,}[a-z]+[A-Z]\w*\b")
VALID_SHORT_WORDS = {
    "a", "i", "o", "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi",
    "if", "in", "is", "it", "me", "my", "no", "of", "oh", "on", "or", "ox",
    "so", "to", "up", "us", "we", "ye", "st", "dr", "mr", "ms", "ad", "bc",
    "ii", "iv", "vi", "ix", "xi", "xv", "xx", "vs", "cf", "ch", "pp", "ex",
    "et", "de", "la", "le", "en", "lo", "eh", "ah", "ha", "ho",
}

def gates(text: str, good_words: set[str]) -> str | None:
    if not text:
        return "empty"
    if is_boilerplate_block(text):
        return "boilerplate"
    n_chars = max(len(text), 1)
    sym = sum(1 for c in text if not c.isalnum() and not c.isspace() and c not in ".,;:!?()'\"-—–“”‘’…") / n_chars
    if sym > 0.04:
        return f"symbol-ratio {sym:.2f}"
    art = sum(1 for c in text if c in ARTIFACT_CHARS) / n_chars
    if art > 0.008:
        return f"ocr-artifacts {art:.3f}"
    toks = ALPHA_TOKEN.findall(text)
    if not toks:
        return "no-alpha"
    # Reject OCR'd book-cover / endpaper streams of isolated single letters
    if len(toks) >= 8:
        single_ratio = sum(1 for t in toks if len(t) == 1 and t.lower() not in ("a", "i", "o")) / len(toks)
        if single_ratio > 0.12:
            return f"single-letter-ocr {single_ratio:.2f}"
    mc = len(MIXED_CASE_RE.findall(text)) / len(toks)
    if mc > 0.03:
        return f"mixed-case-ocr {mc:.2f}"
    known = sum(
        1 for t in toks
        if (len(t) <= 2 and t.lower() in VALID_SHORT_WORDS) or (len(t) > 2 and t.lower() in good_words)
    ) / len(toks)
    if known < 0.83:
        return f"clean-known-word {known:.2f}"
    return None

# ---------- bible verse groups ----------
def bible_units():
    data = json.loads((ROOT / "corpus/bible/web.json").read_text())
    verses = data["verses"]
    units, i = [], 0
    while i < len(verses):
        book, ch = verses[i]["book_name"], verses[i]["chapter"]
        group = []
        while i < len(verses) and verses[i]["book_name"] == book and verses[i]["chapter"] == ch and len(group) < 5:
            group.append(verses[i]); i += 1
        if len(group) < 3 and units and units[-1]["division"] == book and units[-1]["_ch"] == ch:
            prev = units[-1]
            allv = prev["_verses"] + group
            prev["_verses"] = allv
            prev["text"] = " ".join(v["text"] for v in allv)
            prev["words"] = words(prev["text"])
            prev["_ref"] = f"{book} {ch}:{allv[0]['verse']}-{allv[-1]['verse']}"
            continue
        units.append({"division": book, "_ch": ch, "_verses": group,
                      "text": " ".join(v["text"] for v in group),
                      "_ref": f"{book} {ch}:{group[0]['verse']}" + (f"-{group[-1]['verse']}" if len(group) > 1 else "")})
    for u in units:
        u["words"] = words(u["text"])
    return units

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    # Remove any stale unit files from previous runs (including excluded works)
    for old in OUT.glob("*.jsonl"):
        old.unlink()

    full_vocab, good_words = build_vocabs()
    log = {"works": {}, "excluded": sorted(EXCLUDED_WORKS), "quarantine": [], "longs_fixes": 0}
    total_units = 0
    total_quar = 0
    for src in SOURCES:
        d = STAGING / src
        if not d.exists(): continue
        for f in sorted(d.glob("*.txt")):
            wid = f.stem
            if wid in EXCLUDED_WORKS:
                continue
            raw = f.read_text(errors="replace")
            fixed, nfix = longs_repair(raw, full_vocab)
            log["longs_fixes"] += nfix
            units, quar = [], 0
            for division, kind, text in split_units(fixed):
                why = gates(text, good_words)
                if why:
                    quar += 1
                    total_quar += 1
                    if len(log["quarantine"]) < 60:
                        log["quarantine"].append({"work": wid, "why": why, "text": text[:90]})
                    continue
                units.append({"work_id": wid, "author": None, "source": src,
                              "division": division, "kind": kind, "seq": len(units),
                              "text": text, "words": words(text)})
            if len(units) < 10:
                log["excluded"].append(f"{wid} (too-few-clean-units:{len(units)})")
                continue
            with (OUT / f"{wid}.jsonl").open("w") as fh:
                for u in units: fh.write(json.dumps(u) + "\n")
            log["works"][wid] = {"units": len(units), "quarantined": quar}
            total_units += len(units)
    bu = bible_units()
    with (OUT / "web.jsonl").open("w") as fh:
        for n, u in enumerate(bu):
            fh.write(json.dumps({"work_id": "web", "author": None, "source": "bible",
                                 "division": u["division"], "kind": "scripture", "seq": n,
                                 "text": u["text"], "words": u["words"], "ref": u["_ref"]}) + "\n")
    log["works"]["web"] = {"units": len(bu), "quarantined": 0}
    total_units += len(bu)
    (OUT / "meta-log.json").write_text(json.dumps(log, indent=1))
    print(f"units: {total_units:,} across {len(log['works'])} works | quarantined: {total_quar:,} | long-s fixes: {log['longs_fixes']:,} | bible groups: {len(bu):,}")

if __name__ == "__main__":
    main()
