"""
Resonance library ingest pipeline.

Fetches text from candidate sources, validates quality, chunks into passages,
emits per-work files in corpus/staging/ and a combined voice_books.json +
voice_passages.json for the web app.

Usage:
    python3 ingest.py --manifest manifest.json --out-dir ../../corpus/staging \\
                     --final-dir ../../apps/web/data/seeded_library
    python3 ingest.py --manifest manifest.json --only athanasius-incarnation
    python3 ingest.py --lint-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup
import requests

# Local import
sys.path.insert(0, str(Path(__file__).parent))
from quality_checks import check_quality, strip_preamble, QualityReport


# ──────────────────────────────────────────────────────────────────────
# Fetch
# ──────────────────────────────────────────────────────────────────────

USER_AGENT = "Resonance/2.0 (https://resonance.up.railway.app; library@resonance.app)"


@dataclass
class FetchedText:
    text: str
    source_url: str
    content_type: str
    size: int
    fetched_at: str
    quality: QualityReport
    source_kind: str  # "ccel" | "project_gutenberg" | "new_advent" | "wikisource" | "ia_raw" | "unknown"


def fetch_url(url: str, timeout: int = 60) -> tuple[str, str, str]:
    """
    Fetch URL with curl (more reliable than requests for odd servers).
    Returns (body, content_type, http_status).
    """
    proc = subprocess.run(
        ["curl", "-L", "-A", USER_AGENT, "--fail", "--silent",
         "--max-time", str(timeout),
         "-w", "\n%{http_code}|%{content_type}|%{size_download}",
         url],
        capture_output=True,
        timeout=timeout + 10,
    )
    if proc.returncode != 0:
        raise FetchError(f"curl failed rc={proc.returncode} for {url} stderr={proc.stderr.decode('utf-8', errors='replace')[:200]}")
    # Last line is the trailing data; split it
    output = proc.stdout.decode("utf-8", errors="replace")
    # Split off the trailing %{http_code}|%{content_type}|%{size_download}
    lines = output.rsplit("\n", 1)
    if len(lines) != 2 or "|" not in lines[1]:
        raise FetchError(f"could not parse curl trailing data for {url}: {lines[-1][:200]}")
    body, info = lines
    http_code, content_type, size_download = info.split("|", 2)
    if not http_code.startswith("2"):
        raise FetchError(f"non-2xx response for {url}: HTTP {http_code}")
    return body, content_type, http_code


def html_to_text(html: str) -> str:
    """Strip HTML to readable text. Drops nav, scripts, styles, ads."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "noscript", "iframe"]):
        tag.decompose()
    # Get the main content if there's a <main> or article, else just the body
    main = soup.find("main") or soup.find("article") or soup.find(id="content") or soup.find(class_="content") or soup.body or soup
    text = main.get_text(separator="\n", strip=True)
    # Collapse 3+ blank lines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def detect_source_kind(url: str, content_type: str) -> str:
    if "ccel.org" in url:
        return "ccel"
    if "gutenberg.org" in url or "gutenberg" in url:
        return "project_gutenberg"
    if "newadvent.org" in url:
        return "new_advent"
    if "wikisource.org" in url:
        return "wikisource"
    if "archive.org" in url:
        return "ia_raw"
    return "unknown"


def fetch_and_validate(url: str) -> FetchedText:
    body, content_type, _http_code = fetch_url(url)
    # Normalize
    if "html" in content_type.lower() and not url.endswith(".html"):
        # Likely an error page disguised as 200
        if body.lstrip().lower().startswith(("<!doctype", "<html")):
            raise FetchError(f"got HTML body when expecting text for {url}")

    source_kind = detect_source_kind(url, content_type)

    if "html" in content_type.lower():
        text = html_to_text(body)
    else:
        text = body

    # Strip known preambles
    text = strip_preamble(text, source_kind)

    quality = check_quality(text)
    fetched_at = datetime.now(timezone.utc).isoformat()

    return FetchedText(
        text=text,
        source_url=url,
        content_type=content_type,
        size=len(text),
        fetched_at=fetched_at,
        quality=quality,
        source_kind=source_kind,
    )


class FetchError(Exception):
    pass


# ──────────────────────────────────────────────────────────────────────
# Chunking
# ──────────────────────────────────────────────────────────────────────

@dataclass
class Passage:
    book_id: str
    text: str
    chunk_id: int
    work: str
    author: str


def chunk_text(text: str, book_id: str, work: str, author: str, strategy: str = "paragraph",
               min_passage_len: int = 80, max_passage_len: int = 1200) -> list[Passage]:
    """
    Split text into passages.

    strategy:
      - "chapter": split on chapter markers, then break chapters into paragraphs
      - "paragraph": split on blank lines
      - "section": split on `***` or `---` separators (PG style)
    """
    if strategy == "chapter":
        passages = _chunk_by_chapter(text, book_id, work, author, min_passage_len, max_passage_len)
    elif strategy == "section":
        passages = _chunk_by_section(text, book_id, work, author, min_passage_len, max_passage_len)
    else:
        passages = _chunk_by_paragraph(text, book_id, work, author, min_passage_len, max_passage_len)

    return passages


def _chunk_by_paragraph(text, book_id, work, author, min_len, max_len):
    # Split on 2+ newlines, then merge tiny fragments
    raw = re.split(r"\n\s*\n+", text)
    raw = [p.strip() for p in raw if p.strip()]
    return _merge_fragments(raw, book_id, work, author, min_len, max_len)


def _chunk_by_chapter(text, book_id, work, author, min_len, max_len):
    """
    Split on chapter-like markers. Works for most CCEL/New Advent texts:
      Chapter 1
      CHAPTER I
      Chapter 1. Title
    """
    # Find chapter boundaries
    pattern = re.compile(r"^(CHAPTER|Chapter)\s+([IVXLC0-9]+)([\.\:]\s*.*)?$", re.MULTILINE)
    matches = list(pattern.finditer(text))
    if not matches:
        # Fall back to paragraph chunking
        return _chunk_by_paragraph(text, book_id, work, author, min_len, max_len)

    chapters = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chapter_text = text[start:end]
        chapters.append(chapter_text)

    # Chunk each chapter by paragraph
    raw_passages = []
    for ch in chapters:
        raw_passages.extend(re.split(r"\n\s*\n+", ch))
    raw_passages = [p.strip() for p in raw_passages if p.strip() and len(p.strip()) > 20]
    return _merge_fragments(raw_passages, book_id, work, author, min_len, max_len)


def _chunk_by_section(text, book_id, work, author, min_len, max_len):
    """Split on *** or --- separators (PG style)."""
    parts = re.split(r"\n\s*(\*{3,}|---{3,})\s*\n", text)
    raw = [p.strip() for p in parts if p.strip() and not re.match(r"^[*\-]+$", p.strip())]
    return _merge_fragments(raw, book_id, work, author, min_len, max_len)


def _merge_fragments(fragments, book_id, work, author, min_len, max_len):
    """
    Merge fragments that are too small; split fragments that are too large.
    The result is a list of passages in the [min_len, max_len*1.5] range.
    """
    merged = []
    buf = ""
    for frag in fragments:
        if not buf:
            buf = frag
        elif len(buf) < min_len:
            buf = buf + "\n\n" + frag
        else:
            merged.append(buf.strip())
            buf = frag
    if buf.strip():
        merged.append(buf.strip())

    # Now split oversized ones at sentence boundaries
    final = []
    for p in merged:
        if len(p) <= max_len * 1.5:
            final.append(p)
            continue
        # Try sentence split
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z\"'])", p)
        current = ""
        for s in sentences:
            if len(current) + len(s) + 1 > max_len and current:
                final.append(current.strip())
                current = s
            else:
                current = (current + " " + s).strip() if current else s
        if current:
            final.append(current.strip())

    return [
        Passage(book_id=book_id, text=p, chunk_id=i, work=work, author=author)
        for i, p in enumerate(final)
        if p and len(p) >= 20
    ]


# ──────────────────────────────────────────────────────────────────────
# Manifest
# ──────────────────────────────────────────────────────────────────────

@dataclass
class WorkManifest:
    book_id: str
    title: str
    author: str
    era: str
    package_id: str
    chunk_strategy: str = "paragraph"
    min_passages: int = 20
    candidate_sources: list[dict] = field(default_factory=list)
    # Each source: {"url": str, "label": str, "expected_kind": str}


def load_manifest(path: Path) -> list[WorkManifest]:
    data = json.loads(path.read_text())
    works = []
    for entry in data["works"]:
        works.append(WorkManifest(
            book_id=entry["book_id"],
            title=entry["title"],
            author=entry["author"],
            era=entry["era"],
            package_id=entry["package_id"],
            chunk_strategy=entry.get("chunk_strategy", "paragraph"),
            min_passages=entry.get("min_passages", 20),
            candidate_sources=entry.get("candidate_sources", []),
        ))
    return works


# ──────────────────────────────────────────────────────────────────────
# Emit
# ──────────────────────────────────────────────────────────────────────

def write_work_files(work: WorkManifest, fetched: FetchedText, passages: list[Passage],
                     staging_dir: Path) -> None:
    """Write the per-work staging files (text + attribution + manifest entry)."""
    pkg_dir = staging_dir / work.package_id
    pkg_dir.mkdir(parents=True, exist_ok=True)

    # Plain text
    (pkg_dir / f"{work.book_id}.txt").write_text(fetched.text, encoding="utf-8")

    # Source attribution
    attribution = {
        "book_id": work.book_id,
        "title": work.title,
        "author": work.author,
        "era": work.era,
        "package_id": work.package_id,
        "source_url": fetched.source_url,
        "source_kind": fetched.source_kind,
        "content_type": fetched.content_type,
        "size_chars": fetched.size,
        "fetched_at": fetched.fetched_at,
        "passage_count": len(passages),
        "quality_ok": fetched.quality.ok,
        "quality_reasons": fetched.quality.reasons,
        "license": "Public Domain (pre-1928)",
        "translator": "unknown",
    }
    (pkg_dir / f"{work.book_id}.attribution.json").write_text(
        json.dumps(attribution, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # Per-work passages (for debugging / per-work review)
    passages_data = [
        {
            "id": f"{work.book_id}_{p.chunk_id}",
            "book_id": work.book_id,
            "chunk_id": p.chunk_id,
            "text": p.text,
        }
        for p in passages
    ]
    (pkg_dir / f"{work.book_id}.passages.json").write_text(
        json.dumps(passages_data, indent=2, ensure_ascii=False), encoding="utf-8"
    )


# ──────────────────────────────────────────────────────────────────────
# Main pipeline
# ──────────────────────────────────────────────────────────────────────

def ingest_work(work: WorkManifest, staging_dir: Path) -> Optional[FetchedText]:
    """Try each candidate source. Return the first that passes quality."""
    for src in work.candidate_sources:
        url = src["url"]
        label = src.get("label", url)
        print(f"  Trying: {label} ({url})")
        try:
            fetched = fetch_and_validate(url)
        except FetchError as e:
            print(f"    ✗ Fetch failed: {e}")
            continue
        except Exception as e:
            print(f"    ✗ Unexpected error: {type(e).__name__}: {e}")
            continue

        if not fetched.quality.ok:
            reasons = "; ".join(fetched.quality.reasons[:3])
            print(f"    ✗ Quality check failed: {reasons}")
            continue

        if fetched.size < 5000:
            print(f"    ✗ Too small: {fetched.size} bytes (min 5KB)")
            continue

        print(f"    ✓ OK ({fetched.size:,} bytes, {len(fetched.text.split())} words)")
        return fetched

    print(f"  ✗ No candidate source succeeded for {work.book_id}")
    return None


def chunk_work(work: WorkManifest, fetched: FetchedText) -> list[Passage]:
    passages = chunk_text(
        fetched.text,
        book_id=work.book_id,
        work=work.title,
        author=work.author,
        strategy=work.chunk_strategy,
    )
    # Sanity: drop preamble-like and CCEL-catalog-like leading passages
    # until we find a real prose passage (not a metadata/title-page chunk).
    dropped = 0
    while passages and dropped < 30:
        first = passages[0]
        is_droppable = (
            _looks_like_preamble(first.text)
            or _looks_like_ccel_catalog(first.text)
            or _looks_like_toc(first.text)
            or _looks_like_title_page(first.text)
            or _looks_like_editor_credits(first.text)
            or _looks_like_minimal_metadata(first.text)
            or _looks_like_lc_classification(first.text)
        )
        if not is_droppable:
            break
        print(f"    - Dropping preamble-like passage {dropped} ({len(first.text)} chars)")
        passages = passages[1:]
        dropped += 1
    # Re-index
    for i, p in enumerate(passages):
        p.chunk_id = i

    if len(passages) < work.min_passages:
        print(f"    ⚠ Only {len(passages)} passages (min {work.min_passages})")
    return passages


def _looks_like_preamble(text: str) -> bool:
    """Heuristic: the first 200 chars match known preamble signatures."""
    head = text[:200].lower()
    markers = [
        "this is a digital copy",
        "digitized by",
        "this is a reproduction of a library book",
        "google book search",
        "google's mission is",
        "google is proud to partner",
        "*** start of the project gutenberg",
        "***start of the project gutenberg",
        "this ebook is for the use of anyone",
    ]
    return any(m in head for m in markers)


def _looks_like_ccel_catalog(text: str) -> bool:
    """CCEL's structured metadata header (Title/Creator/Rights/LC Call no/etc.)."""
    head = text[:600]
    # If the chunk is dominated by CCEL catalog fields and has no real prose
    markers = [
        "creator(s):",
        "rights:",
        "lc call no",
        "lc subjects:",
        "ccel subjects:",
        "print basis:",
    ]
    hits = sum(1 for m in markers if m in head.lower())
    if hits >= 2:
        return True
    return False


def _looks_like_toc(text: str) -> bool:
    """Heuristic: a chunk that's a table of contents, not real prose."""
    head = text[:600]
    # TOC signature: many "Chapter" or "Part" or "Section" labels in a row
    chapter_count = len(re.findall(r"\b(Chapter|CHAPTER|Part|PART|Section|SECTION|Book|BOOK)\s+[IVXLC0-9]+\b", head))
    # If there are 3+ chapter labels in the first 600 chars and no paragraph break, it's a TOC
    if chapter_count >= 3:
        return True
    # The Teresa gibbon signature
    if any(w in head for w in ["White-handed Gibbon", "Hoolock Gibbon", "Proboscis Monkey", "Langur"]):
        return True
    return False


def _looks_like_title_page(text: str) -> bool:
    """Title page: short chunk with editor name, "Volume N", publisher, year."""
    head = text[:500]
    if len(head) > 1000:  # Too long to be a title page
        return False
    markers = [
        "edited by", "revised and chronologically arranged",
        "volume i", "volume ii", "volume iii", "volume 1", "volume 2", "volume 3",
        "revised and chronologically", "with brief",
        "prefaces and occasional notes",
        "ante-nicene fathers", "nicene and post-nicene fathers",
    ]
    hits = sum(1 for m in markers if m in head.lower())
    return hits >= 1


def _looks_like_editor_credits(text: str) -> bool:
    """A chunk that's just an editor name, affiliation, and date."""
    head = text[:500].strip()
    if len(head) > 600:
        return False
    # Mostly just names, titles, dates
    lines = [l.strip() for l in head.split("\n") if l.strip()]
    if not lines: return False
    # If most lines are short fragments like "D.D.", "LL.D.", "Editor", "January, 6, 1885"
    short_lines = sum(1 for l in lines if len(l) < 60)
    return short_lines >= len(lines) * 0.7 and len(lines) <= 20


def _looks_like_minimal_metadata(text: str) -> bool:
    """A very short passage (< 200 chars) that's likely a stray metadata line.
    Common in ANF/NPNF volumes: 'Christianity', 'Methodism', single-line subject headers.
    """
    if len(text.strip()) > 250:
        return False
    # No sentence punctuation
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return True
    # No real sentences (no period or question mark at end of any line)
    has_sentence = any("." in l or "?" in l or "!" in l for l in lines)
    if has_sentence and len(text.strip()) > 100:
        return False
    # Just a few short lines
    if len(lines) <= 5 and all(len(l) < 100 for l in lines):
        return True
    return False


def _looks_like_lc_classification(text: str) -> bool:
    """CCEL's Library of Congress classification card. Usually 1-2 lines like:
    'Christianity' / 'Early Christian Literature. Fathers of the Church, etc.'
    """
    head = text.strip()[:300]
    if len(head) > 400:
        return False
    # Patterns unique to LC classification
    patterns = [
        r"^Early Christian Literature",
        r"^Christian Denominations$",
        r"^Theology\. Doctrine\. Dogmatics",
        r"^Practical theology",
        r"^Mysticism$",
        r"^Devotional literature",
        r"^Roman Catholic Church$",
        r"^Methodism$",
    ]
    for p in patterns:
        if re.search(p, head, re.MULTILINE):
            return True
    return False


# ──────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=str(Path(__file__).parent / "manifest.json"))
    ap.add_argument("--staging-dir", default=str(Path(__file__).parent.parent.parent / "corpus" / "staging_v2"))
    ap.add_argument("--final-dir", default=str(Path(__file__).parent.parent.parent / "apps" / "web" / "data" / "seeded_library"))
    ap.add_argument("--only", help="Only ingest this book_id (comma-sep for multiple)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-final", action="store_true", help="Don't write voice_books.json/voice_passages.json; only write staging")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    staging_dir = Path(args.staging_dir)
    final_dir = Path(args.final_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)

    works = load_manifest(manifest_path)
    if args.only:
        wanted = set(args.only.split(","))
        works = [w for w in works if w.book_id in wanted]

    print(f"Manifest: {len(works)} works")
    print(f"Staging dir: {staging_dir}")
    print()

    all_books = []
    all_passages = []

    for work in works:
        print(f"[{work.book_id}] {work.author} — {work.title} ({work.package_id})")
        fetched = ingest_work(work, staging_dir)
        if fetched is None:
            continue

        passages = chunk_work(work, fetched)
        print(f"    {len(passages)} passages from {fetched.size:,} chars")

        if not args.dry_run:
            write_work_files(work, fetched, passages, staging_dir)

        # Collect for the final emit
        all_books.append({
            "id": work.book_id,
            "title": work.title,
            "author": work.author,
            "era": work.era,
            "package_id": work.package_id,
            "type": "voice",
            "translation": None,
            "source": fetched.source_kind,
            "source_url": fetched.source_url,
            "passage_count": len(passages),
        })
        # Stable sequential numeric IDs (per-book) for voice_passages.json
        base_id = _stable_id_for(work.book_id)
        for p in passages:
            all_passages.append({
                "id": base_id + p.chunk_id,
                "book_id": work.book_id,
                "author": work.author,
                "work": work.title,
                "text": p.text,
                "chunk_id": p.chunk_id,
            })
        print()

    # Lint the collected output
    print("=" * 60)
    print("LINT")
    print("=" * 60)
    issues = lint_books(all_books, all_passages)
    if issues:
        for issue in issues:
            print(f"  ✗ {issue}")
        print(f"\n{len(issues)} lint issues")
    else:
        print("  ✓ All lint checks passed")

    # Emit
    if args.dry_run or args.skip_final:
        print("\n(dry run / skip-final — not writing voice_books.json)")
        return

    final_dir.mkdir(parents=True, exist_ok=True)
    (final_dir / "voice_books.json").write_text(
        json.dumps(all_books, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (final_dir / "voice_passages.json").write_text(
        json.dumps(all_passages, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nWrote {final_dir}/voice_books.json ({len(all_books)} books)")
    print(f"Wrote {final_dir}/voice_passages.json ({len(all_passages):,} passages)")


def _stable_id_for(book_id: str) -> int:
    """
    Generate a stable, unique, sequential numeric ID for each book's passages.
    We hash the book_id and use a high-base to spread IDs across the int range.
    """
    import hashlib
    h = hashlib.md5(book_id.encode("utf-8")).digest()
    # Use first 4 bytes as a 32-bit int, then offset so we don't collide with
    # legacy IDs (100000-118838)
    n = int.from_bytes(h[:4], "big")
    # Spread to range 500000-999999 (500K IDs available per book)
    return 500000 + (n % 500_000) * 1000


def lint_books(books, passages):
    """Check the final output for the issues called out in the audit plan."""
    issues = []
    book_ids = [b["id"] for b in books]

    # Unique IDs
    if len(set(book_ids)) != len(book_ids):
        issues.append(f"duplicate book IDs: {len(book_ids) - len(set(book_ids))} dupes")

    # No HTML error passages
    html_sigs = ["<html", "<!doctype", "404 not found", "401 authorization", "403 forbidden"]
    for p in passages:
        head = p["text"][:200].lower()
        for sig in html_sigs:
            if sig in head:
                issues.append(f"passage {p['id']} ({p['book_id']}) contains HTML error: {sig}")
                break

    # No OCR-damaged passages (first 200 chars)
    for p in passages:
        head = p["text"][:200]
        if any(s in head for s in ["prcscrvod", "Googlc", "bcforc"]):
            issues.append(f"passage {p['id']} ({p['book_id']}) contains OCR damage")

    # No Google Books preamble
    for p in passages:
        head = p["text"][:300].lower()
        if "this is a digital copy" in head or "this is a reproduction of a library book" in head:
            issues.append(f"passage {p['id']} ({p['book_id']}) contains Google Books preamble")

    # Stable IDs (not the old voice_100000 sequential)
    legacy = [bid for bid in book_ids if bid.startswith("voice_") and bid.split("_")[1].isdigit()]
    if legacy:
        issues.append(f"{len(legacy)} books still have legacy voice_NNNNN IDs (should be stable slugs)")

    # All books have at least 5 passages (sanity floor)
    for b in books:
        if b["passage_count"] < 5:
            issues.append(f"book {b['id']} has only {b['passage_count']} passages (min 5)")

    return issues


if __name__ == "__main__":
    main()
