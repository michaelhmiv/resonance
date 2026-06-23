#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.1: Bible Ingestion + Phrase-Level Chunking

Takes Bible JSON files (BibleSuperSearch format) and produces chunked passages
with metadata. Splits verses into phrase-level chunks at natural punctuation
(clauses split at semicolons, commas before conjunctions).

Input:  corpus/bible/{web,kjv,asv}.json
Output: build/output/bible_passages.json
        build/output/bible_books.json
"""

import json
import os
import re
import sys

INPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "corpus", "bible")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

TRANSLATIONS = ["web", "kjv", "asv"]

# Books of the Bible in canonical order
BOOKS_OT = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
    "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
    "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
    "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
    "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
    "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
    "Zephaniah", "Haggai", "Zechariah", "Malachi"
]

BOOKS_NT = [
    "Matthew", "Mark", "Luke", "John", "Acts",
    "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
    "James", "1 Peter", "2 Peter", "1 John", "2 John",
    "3 John", "Jude", "Revelation"
]

ALL_BOOKS = BOOKS_OT + BOOKS_NT


def phrase_split(text: str) -> list:
    """
    Split a verse into phrase-level chunks at natural clause boundaries.
    Keeps clauses meaningful — not too granular, not too coarse.

    "Come to me, all who labor and are heavy laden, and I will give you rest"
    → ["Come to me, all who labor and are heavy laden,", "and I will give you rest"]
    
    "He makes me lie down in green pastures; he leads me beside still waters"
    → ["He makes me lie down in green pastures;", "he leads me beside still waters"]
    """
    if not text or len(text.strip()) < 3:
        return [text] if text else []

    # Remove bracketed annotations like [ye] or {the LORD}
    clean = re.sub(r'[\[\]{}]', '', text).strip()
    
    # Split at semicolons (strong clause boundary)
    clauses = re.split(r'(?<=;)\s*', clean)
    
    # Further split at " and " / " but " / " for " if the clause is long enough
    chunks = []
    for clause in clauses:
        clause = clause.strip()
        if not clause:
            continue
        
        # If the clause is short, keep it as-is
        if len(clause) < 40:
            chunks.append(clause)
            continue
        
        # Split at " and " / " but " / " for " boundaries for long clauses
        sub = re.split(r'\s+(?=and |but |for |so that |therefore |yet )', clause)
        for s in sub:
            s = s.strip()
            if s:
                chunks.append(s)
    
    return chunks if chunks else [clean]


def process_bible(translation: str, verses: list) -> tuple:
    """Process a single Bible translation into passages + books."""
    passages = []
    passage_id = 0
    
    for verse in verses:
        book_name = verse["book_name"]
        chapter = verse["chapter"]
        verse_num = verse["verse"]
        text = verse["text"]
        
        # Skip empty verses
        if not text or len(text.strip()) < 2:
            continue
        
        # Split into phrases
        phrases = phrase_split(text)
        
        for chunk_idx, phrase in enumerate(phrases):
            passage_id += 1
            passages.append({
                "id": passage_id,
                "book": book_name,
                "chapter": chapter,
                "verse_start": verse_num,
                "verse_end": verse_num,
                "text": phrase,
                "translation": translation,
                "chunk_id": chunk_idx,
            })
    
    return passages


def build_book_list(translation: str) -> list:
    """Build the books metadata for a translation."""
    books = []
    for i, book in enumerate(ALL_BOOKS):
        testament = "OT" if i < len(BOOKS_OT) else "NT"
        books.append({
            "id": f"{translation}_{i+1}",
            "title": book,
            "author": None,
            "era": None,
            "package_id": "seeded",
            "type": "bible",
            "translation": translation,
            "testament": testament,
            "order": i + 1,
        })
    return books


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    all_passages = []
    all_books = []
    passage_offset = 0
    
    for translation in TRANSLATIONS:
        json_path = os.path.join(INPUT_DIR, f"{translation}.json")
        if not os.path.exists(json_path):
            print(f"  Skipping {translation} — file not found")
            continue
        
        print(f"Processing {translation}...")
        with open(json_path) as f:
            data = json.load(f)
        
        verses = data["verses"]
        passages = process_bible(translation, verses)
        
        # Offset passage IDs so they're unique across translations
        for p in passages:
            p["id"] += passage_offset
        passage_offset += len(passages) + 1
        
        all_passages.extend(passages)
        
        books = build_book_list(translation)
        all_books.extend(books)
        
        # Count verses vs chunks
        verse_count = len(verses)
        chunk_count = len(passages)
        print(f"  {translation}: {verse_count} verses → {chunk_count} phrase-level chunks")
    
    # Write outputs
    passages_path = os.path.join(OUTPUT_DIR, "bible_passages.json")
    with open(passages_path, "w") as f:
        json.dump(all_passages, f)
    print(f"\nWrote {len(all_passages)} passages to {passages_path}")
    
    books_path = os.path.join(OUTPUT_DIR, "bible_books.json")
    with open(books_path, "w") as f:
        json.dump(all_books, f)
    print(f"Wrote {len(all_books)} book records to {books_path}")
    
    # Stats
    translations_seen = set(p["translation"] for p in all_passages)
    print(f"\nTranslations: {translations_seen}")
    print(f"Total passages: {len(all_passages)}")
    print(f"Total books: {len(all_books)}")


if __name__ == "__main__":
    main()
