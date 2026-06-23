#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.2: Voices Ingestion + Paragraph-Level Chunking

Takes public-domain Christian text files (saints, mystics, Fathers) and 
produces paragraph-level passages with metadata.

Input:  corpus/saints/*.txt  (+ corpus_staging/ files, included later as packages)
Output: build/output/voice_passages.json
        build/output/voice_books.json
"""

import json
import os
import re

STAGED_INPUT_DIRS = [
    os.path.join(os.path.dirname(__file__), "..", "corpus", "saints"),
]

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Mapping from filenames to author + work metadata
FILE_METADATA = {
    "augustine_confessions.txt": ("Augustine of Hippo", "Confessions", "4th-5th c.", "Aurelius Augustinus"),
    "teresa_interior_castle.txt": ("Teresa of Ávila", "Interior Castle", "16th c.", "Teresa de Cepeda"),
    "john_of_the_cross_dark_night.txt": ("John of the Cross", "Dark Night of the Soul", "16th c.", "Juan de Yepes"),
    "john_of_the_cross_spiritual_canticle.txt": ("John of the Cross", "Spiritual Canticle", "16th c.", "Juan de Yepes"),
    "julian_of_norwich_revelations.txt": ("Julian of Norwich", "Revelations of Divine Love", "14th c.", "Juliana"),
    "kempis_imitation.txt": ("Thomas à Kempis", "The Imitation of Christ", "15th c.", "Thomas Hemerken"),
    "brother_lawrence_practice.txt": ("Brother Lawrence", "The Practice of the Presence of God", "17th c.", "Nicholas Herman"),
    "bunyan_pilgrims_progress.txt": ("John Bunyan", "The Pilgrim's Progress", "17th c.", None),
    "aquinas_summa_theologica.txt": ("Thomas Aquinas", "Summa Theologica", "13th c.", "Thomas d'Aquino"),
    "anselm_cur_deus_homo.txt": ("Anselm of Canterbury", "Cur Deus Homo", "11th-12th c.", "Anselmus Cantuariensis"),
    "catherine_siena_letters.txt": ("Catherine of Siena", "Letters", "14th c.", "Caterina Benincasa"),
    "cloud_of_unknowing.txt": ("Anonymous", "The Cloud of Unknowing", "14th c.", None),
    "francis_de_sales_practical_piety.txt": ("Francis de Sales", "Practical Piety", "17th c.", "François de Sales"),
    "kierkegaard_hauptschriften.txt": ("Søren Kierkegaard", "Hauptschriften", "19th c.", None),
    "pascal_pensees.txt": ("Blaise Pascal", "Pensées", "17th c.", None),
    "bernard_life_and_works.txt": ("Bernard of Clairvaux", "Life and Works", "12th c.", "Bernardus Claraevallensis"),
    "bernard_sermons_canticle.txt": ("Bernard of Clairvaux", "Sermons on the Canticle", "12th c.", "Bernardus Claraevallensis"),
    "bonaventure_breviloquium.txt": ("Bonaventure", "Breviloquium", "13th c.", "Giovanni di Fidanza"),
}

# Source attribution for licenses
SOURCE = {
    "augustine_confessions.txt": "Project Gutenberg",
    "teresa_interior_castle.txt": "Project Gutenberg",
    "john_of_the_cross_dark_night.txt": "Public Domain",
    "john_of_the_cross_spiritual_canticle.txt": "Public Domain",
    "julian_of_norwich_revelations.txt": "Public Domain",
    "kempis_imitation.txt": "Project Gutenberg",
    "brother_lawrence_practice.txt": "Project Gutenberg",
    "bunyan_pilgrims_progress.txt": "Project Gutenberg",
    "aquinas_summa_theologica.txt": "Public Domain",
    "anselm_cur_deus_homo.txt": "Public Domain",
    "catherine_siena_letters.txt": "Public Domain",
    "cloud_of_unknowing.txt": "Public Domain / CCEL",
    "francis_de_sales_practical_piety.txt": "Public Domain",
    "kierkegaard_hauptschriften.txt": "Public Domain",
    "pascal_pensees.txt": "Project Gutenberg",
    "bernard_life_and_works.txt": "Public Domain",
    "bernard_sermons_canticle.txt": "Public Domain",
    "bonaventure_breviloquium.txt": "Public Domain",
}


def is_paragraph_break(line: str) -> bool:
    """Check if a line is a paragraph break."""
    return len(line.strip()) == 0


def is_header_or_metadata(text: str) -> bool:
    """Check if a paragraph is likely a header or metadata, not body text."""
    stripped = text.strip()
    if len(stripped) < 15:
        return True
    if stripped.isupper():
        return True
    # "Chapter X" / "Book X" headers
    if re.match(r'^(Chapter|Book|Part|Section|Preface|Introduction|Prologue|Epilogue|Conclusion)\b', stripped, re.I):
        # Keep if it's a substantive sentence, skip if it's just a label
        if len(stripped) < 50 and '.' not in stripped:
            return True
    return False


def chunk_text(text: str, min_length: int = 80, max_length: int = 800) -> list:
    """
    Split text into paragraph-level passages.
    - Long paragraphs get split at sentence boundaries if they exceed max_length
    - Very short paragraphs get merged with the next one
    """
    raw_paragraphs = []
    current = []
    
    for line in text.split('\n'):
        if is_paragraph_break(line):
            if current:
                para = ' '.join(current).strip()
                if para:
                    raw_paragraphs.append(para)
                current = []
        else:
            current.append(line.strip())
    
    if current:
        para = ' '.join(current).strip()
        if para:
            raw_paragraphs.append(para)
    
    # Filter out headers and metadata, split long paragraphs, merge short ones
    passages = []
    buffer = ""
    
    for para in raw_paragraphs:
        if is_header_or_metadata(para):
            # Flush buffer before a header
            if buffer:
                passages.append(buffer.strip())
                buffer = ""
            continue
        
        # If we have a buffer, try to merge
        if buffer:
            merged = buffer + " " + para
            if len(merged) <= max_length:
                buffer = merged
            else:
                passages.append(buffer.strip())
                buffer = para
        else:
            if len(para) < min_length:
                buffer = para
            else:
                # Split if too long
                if len(para) > max_length:
                    sentences = re.split(r'(?<=[.!?])\s+', para)
                    chunk = ""
                    for sent in sentences:
                        if len(chunk) + len(sent) + 1 <= max_length:
                            chunk = (chunk + " " + sent).strip() if chunk else sent
                        else:
                            if chunk:
                                passages.append(chunk)
                            chunk = sent
                    if chunk:
                        buffer = chunk
                else:
                    passages.append(para)
    
    if buffer:
        passages.append(buffer.strip())
    
    # Final filter: remove any passage that's too short (likely noise)
    return [p for p in passages if len(p) >= 20]


def process_file(filepath: str, filename: str, passage_id_start: int) -> tuple:
    """Process a single text file into passages + a book record."""
    if filename not in FILE_METADATA:
        return [], None, passage_id_start
    
    author, work, era, _ = FILE_METADATA[filename]
    source = SOURCE.get(filename, "Public Domain")
    
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        text = f.read()
    
    # Skip Gutenberg header/footer
    if "*** START OF" in text:
        text = text.split("*** START OF", 1)[-1]
        # Split on the next line to skip the header line itself
        text = text.split('\n', 1)[-1] if '\n' in text else text
    if "*** END OF" in text:
        text = text.split("*** END OF", 1)[0]
    
    passages_text = chunk_text(text)
    
    book_id = f"voice_{passage_id_start}"
    book = {
        "id": book_id,
        "title": work,
        "author": author,
        "era": era,
        "package_id": "seeded",
        "type": "voice",
        "translation": None,
        "source": source,
        "passage_count": len(passages_text),
    }
    
    passages = []
    for i, p in enumerate(passages_text):
        passages.append({
            "id": passage_id_start + i,
            "book_id": book_id,
            "author": author,
            "work": work,
            "text": p,
            "chunk_id": i,
        })
    
    return passages, book, passage_id_start + len(passages_text)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    all_passages = []
    all_books = []
    passage_id = 100000  # Start at 100K to avoid collision with Bible passages
    
    for input_dir in STAGED_INPUT_DIRS:
        if not os.path.exists(input_dir):
            continue
        
        files = sorted(f for f in os.listdir(input_dir) if f.endswith('.txt'))
        
        for filename in files:
            if filename not in FILE_METADATA:
                continue
            
            filepath = os.path.join(input_dir, filename)
            print(f"Processing {filename}...")
            
            passages, book, new_id = process_file(filepath, filename, passage_id)
            if passages:
                all_passages.extend(passages)
                all_books.append(book)
                print(f"  {book['author']}, '{book['title']}' → {len(passages)} passages")
                passage_id = new_id
    
    # Write outputs
    passages_path = os.path.join(OUTPUT_DIR, "voice_passages.json")
    with open(passages_path, "w") as f:
        json.dump(all_passages, f)
    print(f"\nWrote {len(all_passages)} voice passages to {passages_path}")
    
    books_path = os.path.join(OUTPUT_DIR, "voice_books.json")
    with open(books_path, "w") as f:
        json.dump(all_books, f)
    print(f"Wrote {len(all_books)} voice book records to {books_path}")
    
    # Stats
    print(f"\nTotal voice passages: {len(all_passages)}")
    print(f"Total voice books: {len(all_books)}")
    print(f"Authors: {len(set(b['author'] for b in all_books))}")


if __name__ == "__main__":
    main()
