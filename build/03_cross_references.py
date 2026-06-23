#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.3: Cross-Reference Ingestion

Takes the Treasury of Scripture Knowledge (TSK) and produces normalized
cross-reference pairs in JSON format.

Input:  build/cross_references.txt (TSV from scrollmapper/bible_databases)
Output: build/output/cross_references.json
"""

import csv
import json
import os
import re

INPUT_FILE = os.path.join(os.path.dirname(__file__), "cross_references.txt")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Abbreviation map for TSK format → full book names
BOOK_ABBREV = {
    "Gen": "Genesis", "Ex": "Exodus", "Lev": "Leviticus", "Num": "Numbers",
    "Deut": "Deuteronomy", "Josh": "Joshua", "Judg": "Judges", "Ruth": "Ruth",
    "1Sam": "1 Samuel", "2Sam": "2 Samuel", "1Kgs": "1 Kings", "2Kgs": "2 Kings",
    "1Chr": "1 Chronicles", "2Chr": "2 Chronicles", "Ezra": "Ezra",
    "Neh": "Nehemiah", "Esth": "Esther", "Job": "Job", "Ps": "Psalms",
    "Prov": "Proverbs", "Eccl": "Ecclesiastes", "Song": "Song of Solomon",
    "Isa": "Isaiah", "Jer": "Jeremiah", "Lam": "Lamentations",
    "Ezek": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea", "Joel": "Joel",
    "Amos": "Amos", "Obad": "Obadiah", "Jonah": "Jonah", "Mic": "Micah",
    "Nah": "Nahum", "Hab": "Habakkuk", "Zeph": "Zephaniah", "Hag": "Haggai",
    "Zech": "Zechariah", "Mal": "Malachi",
    "Matt": "Matthew", "Mark": "Mark", "Luke": "Luke", "John": "John",
    "Acts": "Acts", "Rom": "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
    "Gal": "Galatians", "Eph": "Ephesians", "Phil": "Philippians",
    "Col": "Colossians", "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians",
    "1Tim": "1 Timothy", "2Tim": "2 Timothy", "Titus": "Titus",
    "Phlm": "Philemon", "Heb": "Hebrews", "Jas": "James",
    "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John",
    "3John": "3 John", "Jude": "Jude", "Rev": "Revelation",
}


def normalize_ref(ref: str) -> str:
    """
    Normalize a verse reference from TSK abbreviations to full book names.
    "Gen.1.1" → "Genesis 1:1"
    "Prov.8.22-Prov.8.30" → "Proverbs 8:22-30"
    """
    ref = ref.strip()
    
    # Handle ranges (e.g., "Prov.8.22-Prov.8.30")
    if '-' in ref and not ref.startswith('-'):
        parts = ref.split('-')
        if len(parts) == 2:
            start = normalize_single_ref(parts[0].strip())
            end = normalize_single_ref(parts[1].strip())
            if start and end:
                # Extract just the verse part from the end
                start_match = re.match(r'(.+?) (\d+):(\d+)$', start)
                end_match = re.match(r'(.+?) (\d+):(\d+)$', end)
                if start_match and end_match:
                    book, ch, vs = start_match.groups()
                    _, _, vs2 = end_match.groups()
                    if start_match.group(1) == end_match.group(1) and start_match.group(2) == end_match.group(2):
                        return f"{book} {ch}:{vs}-{vs2}"
            return f"{start}-{end}" if start and end else ref
    
    return normalize_single_ref(ref)


def normalize_single_ref(ref: str) -> str:
    """Normalize a single verse reference."""
    ref = ref.strip()
    
    # Match pattern like "Gen.1.1" or "1Sam.15.23" or "Song.1.2"
    match = re.match(r'^(\d?[A-Za-z]+)\.(\d+)\.(\d+)$', ref)
    if match:
        abbrev, chapter, verse = match.groups()
        book = BOOK_ABBREV.get(abbrev, abbrev)
        return f"{book} {chapter}:{verse}"
    
    # Match "Ps.23.1" style already handled above
    # Try without the dot pattern
    match = re.match(r'^(\d?[A-Za-z]+)\s+(\d+):(\d+)$', ref)
    if match:
        abbrev, chapter, verse = match.groups()
        book = BOOK_ABBREV.get(abbrev, abbrev)
        return f"{book} {chapter}:{verse}"
    
    return ref


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    cross_refs = []
    seen = set()  # Dedup
    skipped = 0
    
    with open(INPUT_FILE) as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            from_ref = row.get("From Verse", "").strip()
            to_ref = row.get("To Verse", "").strip()
            votes = row.get("Votes", "0").strip()
            
            if not from_ref or not to_ref:
                continue
            
            # Skip negative-voted refs
            try:
                vote_num = int(votes)
                if vote_num < 0:
                    skipped += 1
                    continue
            except ValueError:
                pass
            
            from_norm = normalize_ref(from_ref)
            to_norm = normalize_ref(to_ref)
            
            # Dedup
            key = f"{from_norm}→{to_norm}"
            if key in seen:
                continue
            seen.add(key)
            
            cross_refs.append({
                "from_ref": from_norm,
                "to_ref": to_norm,
            })
    
    # Write output
    output_path = os.path.join(OUTPUT_DIR, "cross_references.json")
    with open(output_path, "w") as f:
        json.dump(cross_refs, f)
    
    print(f"Wrote {len(cross_refs)} cross-references to {output_path}")
    print(f"Skipped {skipped} negative-voted references")
    
    # Verify some known refs
    known = [r for r in cross_refs if r["from_ref"].startswith("John 3:16")]
    print(f"\nSpot check — John 3:16 refs: {len(known)} found")
    for r in known[:3]:
        print(f"  {r['from_ref']} → {r['to_ref']}")


if __name__ == "__main__":
    main()
