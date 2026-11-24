#!/usr/bin/env python3
"""Build the mobile app's bundled Scripture seed files (issue #53, P1-14).

Reads the canonical corpus modules (corpus/bible/web.json, kjv.json —
public-domain texts) and writes compact tuple-format seed files into
apps/mobile/assets/seeded_library/:

    {"translation": "WEB",
     "books": ["Genesis", "Exodus", ...],           # canonical order
     "verses": [[book_index, chapter, verse, text], ...]}

The mobile libraryLoader seeds its SQLite `books`/`passages` tables
from these on first launch. WEB is the app's default translation and
KJV is bundled alongside (apps/mobile bibleQueries: TRANSLATIONS =
['WEB', 'KJV'], DEFAULT_TRANSLATION = 'WEB').

Re-run after updating the corpus files:
    python3 scripts/library/build_mobile_scripture.py
"""

import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT_DIR = os.path.join(ROOT, "apps", "mobile", "assets", "seeded_library")

SOURCES = {
    "WEB": os.path.join(ROOT, "corpus", "bible", "web.json"),
    "KJV": os.path.join(ROOT, "corpus", "bible", "kjv.json"),
}


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for translation, src in SOURCES.items():
        with open(src, encoding="utf-8") as f:
            module = json.load(f)
        verses = module["verses"]

        books: list[str] = []
        book_index: dict[str, int] = {}
        tuples: list[list] = []
        for v in verses:
            name = v["book_name"]
            if name not in book_index:
                book_index[name] = len(books)
                books.append(name)
            tuples.append(
                [book_index[name], v["chapter"], v["verse"], v["text"].strip()]
            )

        out = {"translation": translation, "books": books, "verses": tuples}
        dest = os.path.join(OUT_DIR, f"bible_{translation.lower()}.json")
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        size_mb = os.path.getsize(dest) / 1_000_000
        print(f"{translation}: {len(books)} books, {len(tuples)} verses -> "
              f"{dest} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
