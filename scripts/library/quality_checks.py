"""
Quality checks for Resonance library text.

Returns a QualityReport with pass/fail + reasons. The key contract: if a
text is broken (HTML error page, OCR-damaged preamble, scan preamble),
this module catches it BEFORE we waste a build pass on it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


# ──────────────────────────────────────────────────────────────────────
# Signatures
# ──────────────────────────────────────────────────────────────────────

# HTML error page signatures — if we see any of these in the first 2KB,
# this is not a book, it's a 404/401 page.
HTML_ERROR_SIGS = [
    "<html",
    "<!doctype html",
    "404 not found",
    "401 authorization required",
    "403 forbidden",
    "nginx",
    "internal server error",
    "this server could not verify",
]

# Google Books library scan preamble (with OCR c→e substitution)
GOOGLE_BOOKS_PREAMBLE_SIGS = [
    "this is a digital copy of a book that was",
    "this is a reproduction of a library book",
    "google book search",
    "google is proud to partner with libraries",
    "make non-commercial use of the files",
    "keep providing this resource",
    "this is a digital copy of a book that was preserved for generations on library shelves",
    "this is a digital copy of a book that was prcscrvod for gcncrations",  # OCR
    "google's mission is to organize the world's information",
]

# Internet Archive preamble
IA_PREAMBLE_SIGS = [
    "digitized by the internet archive",
    "digitized by google",
    "in 2011 with funding from",
    "in 2010 with funding from",
    "with funding from",
    "boston library",
    "new york public library",
]

# Project Gutenberg preamble (we want to STRIP this, not reject)
# But too much of it suggests we're starting from the wrong place.
PG_PREAMBLE_SIGS = [
    "project gutenberg",
    "*** start of the project gutenberg",
    "*** end of the project gutenberg",
    "start full license",
    "this ebook is for the use of anyone anywhere",
]

# OCR substitution signatures (Google Books-style, c→e and similar)
OCR_SUBSTITUTION_SIGS = [
    "thc ",  # "the "
    "bcforc",  # "before"
    "Googlc",  # "Google"
    "gcncrations",  # "generations"
    "shclvcs",  # "shelves"
    "cvcrythlng",  # "everything"
    "somcthing",  # "something"
    "somctimc",  # "sometime"
    "somcbody",  # "somebody"
    "somcwhcrc",  # "somewhere"
    "prcscrvod",  # "preserved"
    "cffcctivc",  # "effective"
    "cvcrybody",  # "everybody"
    "cvcrything",  # "everything"
    "cvcrywhcre",  # "everywhere"
    "rcstrictcd",  # "restricted"
    "rcstrictions",  # "restrictions"
]

# Transcriber notes / TOC fragments that indicate chunking started mid-text
TRANSCRIBER_NOTES = [
    "transcriber's note",
    "transcriber's notes",
    "transcription note",
    "text enclosed by underscores",
    "original spelling",
    "spelling has been",
    "this etext was prepared by",
    "produced by ",
    "this etext is in the public domain",
    "updated editions will replace",
    "gibbon",  # The Teresa contamination signature
    "proboscis monkey",
    "white-handed gibbon",
    "hoolock gibbon",
    "langur",  # Part of the gibbon-TOC
    "table of contents",
    "index of chapters",
]


@dataclass
class QualityReport:
    """Result of running quality checks on a piece of text."""
    is_text_actually_text: bool = True
    has_ocr_damage: bool = False
    has_scan_preamble: bool = False
    has_html_error_page: bool = False
    is_garbage_or_corrupted: bool = False
    has_transcriber_or_toc: bool = False
    first_chunk: str = ""
    reasons: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """A text passes if it's actually text, not OCR-damaged, not a scan preamble, not an HTML error."""
        return (
            self.is_text_actually_text
            and not self.has_html_error_page
            and not self.has_ocr_damage
            and not self.has_scan_preamble
            and not self.is_garbage_or_corrupted
        )


def check_quality(text: str, sample_size: int = 2000) -> QualityReport:
    """
    Run all quality checks against `text`. The first `sample_size` chars
    are the primary sample (where preamble/HTML lives). A second sample
    of 5KB is used for OCR damage detection.
    """
    report = QualityReport()
    if not text or not text.strip():
        report.is_text_actually_text = False
        report.is_garbage_or_corrupted = True
        report.reasons.append("empty text")
        return report

    first_chunk = text[:sample_size]
    report.first_chunk = first_chunk
    lower_first = first_chunk.lower()
    full_lower = text[:5000].lower()

    # 1. HTML error page detection
    for sig in HTML_ERROR_SIGS:
        if sig in lower_first:
            report.has_html_error_page = True
            report.is_text_actually_text = False
            report.is_garbage_or_corrupted = True
            report.reasons.append(f"HTML error signature: '{sig}'")
            break

    if report.has_html_error_page:
        # No point continuing
        return report

    # 2. Scan preamble detection (Google Books or Internet Archive)
    gb_hits = sum(1 for s in GOOGLE_BOOKS_PREAMBLE_SIGS if s in lower_first)
    ia_hits = sum(1 for s in IA_PREAMBLE_SIGS if s in lower_first)
    if gb_hits >= 1:
        report.has_scan_preamble = True
        report.reasons.append(f"Google Books preamble ({gb_hits} matches)")
    if ia_hits >= 1:
        report.has_scan_preamble = True
        report.reasons.append(f"Internet Archive preamble ({ia_hits} matches)")

    # 3. OCR damage detection
    ocr_hits = sum(full_lower.count(s.lower()) for s in OCR_SUBSTITUTION_SIGS)
    if ocr_hits >= 2:
        report.has_ocr_damage = True
        report.reasons.append(f"OCR substitution signatures ({ocr_hits} hits)")

    # 4. Transcriber / TOC detection (warning, not failure — but should be stripped)
    tn_hits = sum(1 for s in TRANSCRIBER_NOTES if s in lower_first)
    if tn_hits >= 1:
        report.has_transcriber_or_toc = True
        report.reasons.append(f"transcriber note / TOC fragment ({tn_hits} matches)")

    return report


# ──────────────────────────────────────────────────────────────────────
# Preamble stripping
# ──────────────────────────────────────────────────────────────────────

# Project Gutenberg header (strip everything up to and including the
# "*** START OF THE PROJECT GUTENBERG EBOOK ... ***" line)
PG_HEADER_RE = re.compile(
    r"^.*?\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG\s+EBOOK.*?\*\*\*\s*\n",
    re.DOTALL | re.IGNORECASE,
)
# Project Gutenberg footer (strip from the "*** END OF ..." line onward)
PG_FOOTER_RE = re.compile(
    r"\n\s*\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG\s+EBOOK.*$",
    re.DOTALL | re.IGNORECASE,
)

# CCEL header (we have a clean reproducible format — title/creator/rights/etc.)
CCEL_HEADER_RE = re.compile(
    r"^[\s_]*Title:.*?LC Subjects:\s*\n[\s_]*\n+",
    re.DOTALL,
)

# Google Books preamble (strip from start to where actual text begins)
# The preamble ends with "Usage guidelines" or "Usage Guidelines" or similar
GOOGLE_BOOKS_PREAMBLE_END_MARKERS = [
    "usage guidelines",
    "about this book",
    "***start**",
    "*** start",
]
# Internet Archive preamble ends with "usage guidelines" or similar
IA_PREAMBLE_END_MARKERS = [
    "usage guidelines",
    "***start**",
]


def strip_preamble(text: str, source_kind: str) -> str:
    """
    Strip the known preamble for the given source. Returns the cleaned text.
    """
    if source_kind == "project_gutenberg":
        text = PG_HEADER_RE.sub("", text, count=1)
        text = PG_FOOTER_RE.sub("", text, count=1)
    elif source_kind == "ccel":
        # CCEL has a clean header; we strip the structured metadata block
        # but keep the first chapter heading (e.g. "Chapter 1")
        text = CCEL_HEADER_RE.sub("", text, count=1)
    elif source_kind == "new_advent":
        # New Advent HTML — handled in html_to_text; preamble already stripped
        pass
    elif source_kind == "wikisource":
        pass
    # For other sources, no automatic stripping
    return text.strip()
