#!/usr/bin/env python3
"""
Resonance — IA Search (properly identified, with retry logic)
Targets only the 34 authors still missing from our corpus.
"""

import requests
import time
import json
from urllib.parse import quote

# ── IA API settings ──
IA_API = "https://archive.org/advancedsearch.php"
HEADERS = {
    "User-Agent": "ResonanceCorpusDiscovery/1.0 (hermes-agent; resonance-corpus)"
}
REQUEST_DELAY = 2.0  # seconds between queries

# ── 34 missing authors ──
MISSING = [
    ("Irenaeus", "Irenaeus Against Heresies"),
    ("Gregory of Nyssa", "Gregory of Nyssa Life of Moses"),
    ("John Cassian", "John Cassian Conferences"),
    ("Pseudo-Dionysius", "Pseudo-Dionysius mystical theology"),
    ("Maximus the Confessor", "Maximus Confessor"),
    ("Isaac of Nineveh", "Isaac of Nineveh ascetical homilies"),
    ("Symeon the New Theologian", "Symeon New Theologian"),
    ("Hildegard of Bingen", "Hildegard of Bingen scivias"),
    ("Henry Suso", "Henry Suso eternal wisdom"),
    ("Cloud of Unknowing", "Cloud of Unknowing"),
    ("Julian of Norwich", "Julian of Norwich revelations"),
    ("Catherine of Siena", "Catherine of Siena dialogue"),
    ("John of the Cross", "John of the Cross dark night soul"),
    ("Andrew Murray", "Andrew Murray abide Christ"),
    ("Oswald Chambers", "Oswald Chambers utmost highest"),
    ("Christina Rossetti", "Christina Rossetti poems devotional"),
    ("Therese of Lisieux", "Therese Lisieux story of a soul"),
    ("Way of a Pilgrim", "Way of a Pilgrim"),
    ("Philokalia", "Philokalia"),
    ("Seraphim of Sarov", "Seraphim of Sarov"),
    ("Theophan the Recluse", "Theophan the Recluse"),
    ("John of Kronstadt", "John of Kronstadt"),
    ("Menno Simons", "Menno Simons"),
    ("Desert Fathers", "Desert Fathers sayings apophthegmata"),
    ("Charles Spurgeon", "Spurgeon morning evening treasury"),
    ("George MacDonald", "George MacDonald unspoken sermons"),
    ("John Wesley", "John Wesley sermons"),
    ("John Owen", "John Owen mortification sin"),
    ("Leo Tolstoy", "Tolstoy kingdom God confession"),
    ("Soren Kierkegaard", "Kierkegaard fear trembling"),
    ("Gregory the Great", "Gregory the Great pastoral rule"),
    ("Jerome", "Jerome letters"),
    ("Catherine of Genoa", "Catherine of Genoa purgatory"),
    ("Jean-Pierre de Caussade", "Caussade abandonment divine providence"),
]


def search_ia(query, max_retries=3):
    """Search Internet Archive with proper headers and retry logic."""
    params = {
        "q": f"{query} AND mediatype:texts AND language:English",
        "fl[]": ["title", "creator", "year", "identifier"],
        "sort[]": "year asc",
        "rows": 15,
        "output": "json"
    }
    
    for attempt in range(max_retries):
        try:
            r = requests.get(IA_API, params=params, headers=HEADERS, timeout=20)
            
            if r.status_code == 429:
                retry_after = int(r.headers.get("Retry-After", 10))
                print(f"    ⏳ Rate limited, waiting {retry_after}s...")
                time.sleep(retry_after)
                continue
            
            if r.status_code == 200:
                data = r.json()
                docs = data.get("response", {}).get("docs", [])
                results = []
                for doc in docs:
                    yr = doc.get("year", "????")
                    title = doc.get("title", "Unknown")[:100]
                    creator = doc.get("creator", "")[:60] if doc.get("creator") else ""
                    identifier = doc.get("identifier", "")
                    results.append({
                        "title": title,
                        "creator": creator,
                        "year": str(yr) if yr else "????",
                        "identifier": identifier,
                        "url": f"https://archive.org/details/{identifier}"
                    })
                return results
            else:
                print(f"    HTTP {r.status_code}, retrying...")
                time.sleep(5)
                
        except Exception as e:
            print(f"    Error: {e}, retrying...")
            time.sleep(5)
    
    return []


def is_legitimate_hit(book, author):
    """Filter out noise: random mentions vs actual works by/about the author."""
    title = book.get("title", "").lower()
    creator_raw = book.get("creator", "")
    if isinstance(creator_raw, list):
        creator = " ".join(creator_raw).lower()
    else:
        creator = str(creator_raw).lower()
    author_lower = author.lower()
    
    # Must have author name in title OR creator
    has_author = author_lower in title or author_lower in creator
    
    # Skip obvious noise
    noise_keywords = ["cia reading room", "chambers's edinburgh", "camp fire girls",
                      "brighton boys", "shaker hymnal", "compend of history"]
    is_noise = any(kw in title for kw in noise_keywords)
    
    return has_author and not is_noise


def main():
    found_count = 0
    not_found = []
    
    for author, query in MISSING:
        print(f"Searching: {author}...", end=" ", flush=True)
        results = search_ia(query)
        
        # Filter for legitimate hits
        good = [b for b in results if is_legitimate_hit(b, author)]
        maybe = [b for b in results if not is_legitimate_hit(b, author)]
        
        # Check for pre-1928 editions
        pd = [b for b in good if b["year"] != "????" and int(b["year"][:4]) <= 1928]
        
        if pd:
            print(f"✅ {len(pd)} PD edition(s)")
            for b in pd[:3]:
                print(f"   [{b['year']}] {b['title'][:70]}")
                if b['creator']:
                    print(f"          by {b['creator'][:60]}")
                print(f"          {b['url']}")
            found_count += 1
        elif good:
            print(f"🟡 {len(good)} hit(s) but not pre-1928")
            for b in good[:2]:
                print(f"   [{b['year']}] {b['title'][:70]}")
            found_count += 1
        else:
            print(f"❌ not found")
            not_found.append(author)
        
        time.sleep(REQUEST_DELAY)
    
    print(f"\n{'='*60}")
    print(f"FOUND: {found_count}/{len(MISSING)}")
    print(f"STILL MISSING ({len(not_found)}):")
    for a in not_found:
        print(f"  - {a}")


if __name__ == "__main__":
    main()
