#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.6: Verse of the Day Sequence Generation

Creates a curated 365-day verse sequence. Draws from Psalms, Gospels, 
Epistles, and select prophetic passages. Avoids genealogies, censuses,
and imprecatory passages. No two consecutive days from the same book.

Output: build/output/verse_of_day.json
"""

import json
import os
import random

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Curated book+chapter ranges (book, start_chapter, end_chapter)
# These chapters contain encouraging, reflective, or comforting passages
CURATED_RANGES = {
    "Psalms": list(range(1, 10)) + list(range(16, 25)) + list(range(27, 38)) + list(range(40, 44)) + list(range(46, 48)) + list(range(51, 53)) + list(range(55, 58)) + list(range(62, 64)) + list(range(65, 68)) + list(range(71, 74)) + list(range(77, 78)) + list(range(84, 89)) + list(range(90, 92)) + list(range(95, 100)) + list(range(103, 107)) + list(range(111, 112)) + list(range(116, 119)) + list(range(121, 131)) + list(range(133, 136)) + list(range(138, 139)) + list(range(141, 143)) + list(range(145, 150)),
    "Matthew": list(range(4, 7)) + [9, 10, 11] + list(range(14, 16)) + [18, 19] + list(range(21, 23)) + [25, 26, 28],
    "Mark": list(range(1, 5)) + [6, 8, 9, 10] + list(range(11, 13)) + [16],
    "Luke": list(range(1, 3)) + [4, 5, 6] + list(range(8, 10)) + list(range(11, 13)) + [15, 17, 18] + list(range(21, 24)),
    "John": list(range(1, 4)) + list(range(4, 7)) + [7, 8, 9] + list(range(10, 13)) + list(range(14, 17)) + [19, 20, 21],
    "Romans": list(range(5, 9)) + list(range(12, 16)),
    "1 Corinthians": [1, 2, 3, 6, 10, 11, 13, 15],
    "2 Corinthians": [1, 3, 4, 5, 6, 7, 8, 9, 12, 13],
    "Galatians": [2, 3, 4, 5, 6],
    "Ephesians": list(range(1, 7)),
    "Philippians": list(range(1, 5)),
    "Colossians": list(range(1, 5)),
    "1 Thessalonians": list(range(1, 6)),
    "2 Thessalonians": [2, 3],
    "1 Timothy": [1, 2, 3, 4, 6],
    "2 Timothy": [1, 2, 3, 4],
    "Titus": [2, 3],
    "Hebrews": list(range(1, 14)),
    "James": list(range(1, 6)),
    "1 Peter": list(range(1, 6)),
    "2 Peter": [1, 3],
    "1 John": list(range(1, 6)),
    "Isaiah": [1, 6, 9] + list(range(11, 13)) + [26, 30, 33, 38, 40, 41, 43, 44, 45, 46, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66],
    "Jeremiah": [1, 15, 16, 17, 20, 23, 24, 29, 30, 31, 32, 33],
    "Ezekiel": [3, 11, 18, 20, 22, 33, 34, 36, 37, 39, 40, 43, 44, 47, 48],
    "Revelation": [1, 2, 3, 5, 7, 11, 14, 15, 19, 21, 22],
}


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    print("=== Verse of the Day Generation ===")
    
    # Load the Bible to get actual verse counts per chapter
    bible_path = os.path.join(OUTPUT_DIR, "bible_passages.json")
    if not os.path.exists(bible_path):
        print("ERROR: bible_passages.json not found. Run 01_bible_ingestion.py first.")
        return
    
    with open(bible_path) as f:
        passages = json.load(f)
    
    # Build a map of (book, chapter) → max verse number, using WEB translation
    chapter_verses = {}
    for p in passages:
        if p["translation"] == "web":
            key = (p["book"], p["chapter"])
            vs = p["verse_start"]
            if key not in chapter_verses or vs > chapter_verses[key]:
                chapter_verses[key] = vs
    
    # Build curated verse pool
    pool = []
    for book, chapters in CURATED_RANGES.items():
        count = 0
        for ch in chapters:
            max_vs = chapter_verses.get((book, ch), 0)
            if max_vs > 0:
                # Pick verses 1 through max, but skip very short fragments
                # Just use every verse in the chapter
                for vs in range(1, max_vs + 1):
                    pool.append((book, ch, vs))
                    count += 1
        print(f"  {book}: {count} verses from {len(chapters)} chapters")
    
    print(f"\nTotal curated pool: {len(pool)} verses")
    
    # Shuffle with fixed seed for reproducibility
    rng = random.Random(42)
    rng.shuffle(pool)
    
    # Build 365-day sequence, ensuring no two consecutive days from the same book
    sequence = []
    last_book = None
    i = 0
    
    for day in range(1, 366):
        # Find a verse from a different book than yesterday
        attempts = 0
        while attempts < len(pool):
            candidate = pool[i % len(pool)]
            i += 1
            book = candidate[0]
            
            if book != last_book:
                sequence.append({
                    "day_of_year": day,
                    "book": candidate[0],
                    "chapter": candidate[1],
                    "verse": candidate[2],
                    "translation": "web",
                })
                last_book = book
                break
            attempts += 1
        else:
            # Fallback: just use the next verse
            candidate = pool[i % len(pool)]
            i += 1
            sequence.append({
                "day_of_year": day,
                "book": candidate[0],
                "chapter": candidate[1],
                "verse": candidate[2],
                "translation": "web",
            })
            last_book = candidate[0]
    
    # Write output
    output_path = os.path.join(OUTPUT_DIR, "verse_of_day.json")
    with open(output_path, "w") as f:
        json.dump(sequence, f, indent=2)
    
    print(f"\nWrote {len(sequence)} daily verses to {output_path}")
    
    # Verify
    print("\nSample days:")
    for day in [1, 25, 50, 100, 200, 365]:
        v = sequence[day - 1]
        print(f"  Day {day}: {v['book']} {v['chapter']}:{v['verse']}")
    
    # Check no consecutive same book
    consecutive = 0
    for i in range(1, len(sequence)):
        if sequence[i]["book"] == sequence[i-1]["book"]:
            consecutive += 1
    print(f"\nConsecutive same-book violations: {consecutive}")
    
    # Category distribution
    from collections import Counter
    books = [v["book"] for v in sequence]
    for book, count in Counter(books).most_common(10):
        print(f"  {book}: {count} days")
    
    print(f"\n✅ Verse of the day sequence complete")


if __name__ == "__main__":
    main()
