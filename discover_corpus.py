#!/usr/bin/env python3
"""
Resonance Corpus Discovery Script
==================================
Queries Anna's Archive and Internet Archive for each author in the library.
Reports available public domain English editions. Does NOT download.

Usage: python3 discover_corpus.py
Output: corpus_discovery_report.md
"""

import requests
import time
import json
import re
from urllib.parse import quote

# ── Author list (name + search query) ──
AUTHORS = [
    # Early Church
    ("Didache", "Didache Teaching of the Twelve Apostles"),
    ("Clement of Rome", "Clement of Rome First Epistle"),
    ("Ignatius of Antioch", "Ignatius of Antioch epistles"),
    ("Polycarp", "Polycarp epistle martyrdom"),
    ("Justin Martyr", "Justin Martyr apology dialogue Trypho"),
    ("Irenaeus", "Irenaeus Against Heresies"),
    ("Clement of Alexandria", "Clement of Alexandria stromata"),
    ("Tertullian", "Tertullian apology"),
    ("Origen", "Origen On First Principles Contra Celsum"),
    ("Cyprian", "Cyprian unity church"),
    # Post-Nicene
    ("Athanasius", "Athanasius On the Incarnation"),
    ("Basil the Great", "Basil the Great Holy Spirit"),
    ("Gregory of Nazianzus", "Gregory Nazianzus orations"),
    ("Gregory of Nyssa", "Gregory of Nyssa Life of Moses"),
    ("Ambrose", "Ambrose Milan duties"),
    ("John Chrysostom", "John Chrysostom homilies"),
    ("Jerome", "Jerome letters lives"),
    ("Augustine", "Augustine Confessions City of God"),
    ("John Cassian", "John Cassian conferences"),
    ("Cyril of Alexandria", "Cyril Alexandria commentary"),
    ("Leo the Great", "Leo the Great sermons"),
    # Byzantine / Medieval
    ("Pseudo-Dionysius", "Pseudo-Dionysius mystical theology divine names"),
    ("Gregory the Great", "Gregory the Great pastoral rule"),
    ("Maximus the Confessor", "Maximus Confessor chapters love"),
    ("Isaac of Nineveh", "Isaac Nineveh ascetical homilies"),
    ("John of Damascus", "John Damascus orthodox faith"),
    ("Symeon the New Theologian", "Symeon New Theologian discourses hymns"),
    # Medieval Mystics
    ("Anselm", "Anselm proslogion cur deus homo"),
    ("Bernard of Clairvaux", "Bernard Clairvaux loving God Song Songs"),
    ("Hildegard of Bingen", "Hildegard Bingen scivias"),
    ("Francis of Assisi", "Francis Assisi canticle admonitions"),
    ("Bonaventure", "Bonaventure soul journey"),
    ("Thomas Aquinas", "Thomas Aquinas summa theologica"),
    ("Meister Eckhart", "Meister Eckhart sermons"),
    ("Johannes Tauler", "Johannes Tauler sermons"),
    ("Henry Suso", "Henry Suso eternal wisdom"),
    ("Jan van Ruusbroec", "Ruusbroec spiritual espousals"),
    ("Richard Rolle", "Richard Rolle fire love"),
    ("Cloud of Unknowing", "Cloud Unknowing"),
    ("Walter Hilton", "Walter Hilton ladder perfection"),
    ("Julian of Norwich", "Julian Norwich revelations divine love"),
    ("Catherine of Siena", "Catherine Siena dialogue"),
    ("Catherine of Genoa", "Catherine Genoa purgatory"),
    ("Thomas a Kempis", "Thomas Kempis imitation Christ"),
    # Catholic Reform
    ("Ignatius of Loyola", "Ignatius Loyola spiritual exercises"),
    ("Teresa of Avila", "Teresa Avila interior castle"),
    ("John of the Cross", "John Cross dark night soul"),
    ("Francis de Sales", "Francis Sales devout life"),
    ("Brother Lawrence", "Brother Lawrence practice presence"),
    ("Jean-Pierre de Caussade", "Caussade abandonment divine providence"),
    # Protestant Reformers
    ("Martin Luther", "Martin Luther freedom Christian catechism"),
    ("John Calvin", "John Calvin institutes Christian religion"),
    # Protestant
    ("John Bunyan", "John Bunyan pilgrim progress"),
    ("John Owen", "John Owen mortification sin communion"),
    ("Richard Baxter", "Richard Baxter reformed pastor"),
    ("Jonathan Edwards", "Jonathan Edwards religious affections"),
    ("John Wesley", "John Wesley sermons journal"),
    ("William Law", "William Law serious call"),
    ("Charles Spurgeon", "Spurgeon morning evening treasury David"),
    ("George MacDonald", "George MacDonald unspoken sermons"),
    ("Andrew Murray", "Andrew Murray abide Christ humility"),
    ("Oswald Chambers", "Oswald Chambers utmost highest"),
    ("E.M. Bounds", "Bounds power prayer"),
    # Eastern / Orthodox
    ("Philokalia", "Philokalia prayer heart"),
    ("Way of a Pilgrim", "Way Pilgrim"),
    ("Seraphim of Sarov", "Seraphim Sarov holy spirit"),
    ("Theophan the Recluse", "Theophan Recluse spiritual life"),
    ("John of Kronstadt", "John Kronstadt my life Christ"),
    # Anglican
    ("John Donne", "John Donne devotions poems sermons"),
    ("George Herbert", "George Herbert temple poems"),
    ("Henry Vaughan", "Henry Vaughan silex scintillans"),
    ("Thomas Traherne", "Thomas Traherne centuries meditations"),
    # Philosophy
    ("Blaise Pascal", "Blaise Pascal pensees"),
    ("Soren Kierkegaard", "Kierkegaard fear trembling sickness death"),
    ("Fyodor Dostoevsky", "Dostoevsky brothers Karamazov"),
    ("Leo Tolstoy", "Tolstoy kingdom God within you confession"),
    ("William James", "William James varieties religious experience"),
    # Mysticism Scholarship
    ("Evelyn Underhill", "Evelyn Underhill mysticism study"),
    # Poetry
    ("John Milton", "John Milton paradise lost"),
    ("Isaac Watts", "Isaac Watts hymns psalms"),
    ("Charles Wesley", "Charles Wesley hymns"),
    ("Gerard Manley Hopkins", "Gerard Manley Hopkins poems"),
    ("Christina Rossetti", "Christina Rossetti goblin market face deep"),
    ("Francis Thompson", "Francis Thompson hound heaven"),
    # Other
    ("George Fox", "George Fox journal"),
    ("Menno Simons", "Menno Simons works"),
    ("Desert Fathers", "Desert Fathers sayings apophthegmata"),
    ("Therese of Lisieux", "Therese Lisieux story soul"),
    ("G.K. Chesterton", "Chesterton orthodoxy everlasting man"),
]

BASE_URL = "https://annas-archive.org/search"
HEADERS = {"User-Agent": "ResonanceCorpusDiscovery/1.0 (research bot; corpus@resonance.local)"}

def search_annas_archive(query):
    """Search Anna's Archive and return list of found works."""
    params = {
        "q": query,
        "sort": "oldest",  # prefer older editions (more likely PD)
        "lang": "en",
    }
    try:
        r = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return []
        # Parse book entries from HTML
        # Each book is an <a> with class "js-scroll" or similar
        books = []
        # Look for md5 links and extract title/author/year from surrounding text
        pattern = r'<a[^>]*href="/md5/([^"]+)"[^>]*>(.*?)</a>'
        matches = re.findall(pattern, r.text, re.DOTALL)
        for md5, inner in matches[:20]:
            # Extract year if present
            year_match = re.search(r'\b(1[5-9]\d{2}|19[0-2]\d)\b', inner)
            year = year_match.group(0) if year_match else "????"
            # Clean title
            title = re.sub(r'<[^>]+>', '', inner).strip()[:100]
            if title:
                books.append({
                    "id": md5,
                    "title": title,
                    "year": year,
                    "url": f"https://annas-archive.org/md5/{md5}"
                })
        return books
    except Exception as e:
        return []


def search_internet_archive(query):
    """Search Internet Archive for public domain texts."""
    url = "https://archive.org/advancedsearch.php"
    params = {
        "q": f"{query} AND mediatype:texts AND language:English",
        "fl[]": ["title", "creator", "year", "identifier"],
        "sort[]": "year asc",
        "rows": 10,
        "output": "json"
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        if r.status_code != 200:
            return []
        data = r.json()
        docs = data.get("response", {}).get("docs", [])
        books = []
        for doc in docs:
            yr = doc.get("year", "????")
            title = doc.get("title", "Unknown")[:100]
            identifier = doc.get("identifier", "")
            books.append({
                "id": identifier,
                "title": title,
                "year": str(yr) if yr else "????",
                "url": f"https://archive.org/details/{identifier}"
            })
        return books
    except Exception:
        return []


def is_likely_public_domain(book, author_name):
    """Heuristic check: is this book likely public domain in English?"""
    title = book.get("title", "").lower()
    yr_str = book.get("year", "????")
    
    # Skip if no year
    if yr_str == "????":
        # Harder to verify — flag as uncertain
        return False
    
    try:
        yr = int(yr_str[:4])
    except:
        return False
    
    # Published 1928 or earlier → PD in US
    if yr <= 1928:
        return True
    
    # Between 1929-1940: might be PD if not renewed (hard to verify)
    if yr <= 1940:
        return None  # uncertain
    
    # Modern editions — likely copyrighted
    # But could be a modern reprint of a PD work
    modern_keywords = ["penguin", "classics", "vintage", "modern library", 
                       "paulist press", "cws", "ics publications"]
    if any(kw in title for kw in modern_keywords):
        return False
    
    return None  # uncertain


def main():
    report = []
    report.append("# Resonance — Corpus Discovery Report\n")
    report.append(f"Generated: {time.strftime('%Y-%m-%d %H:%M')}\n")
    report.append(f"Authors queried: {len(AUTHORS)}\n")
    report.append("---\n")
    
    total_pd = 0
    total_uncertain = 0
    total_none = 0
    
    for name, query in AUTHORS:
        print(f"Searching: {name}...", end=" ", flush=True)
        
        # Search both sources
        aa_books = search_annas_archive(query)
        ia_books = search_internet_archive(query)
        all_books = aa_books + ia_books
        
        # Deduplicate by title
        seen = set()
        unique = []
        for b in all_books:
            key = b["title"][:50].lower()
            if key not in seen:
                seen.add(key)
                unique.append(b)
        
        # Classify
        pd_books = [b for b in unique if is_likely_public_domain(b, name) == True]
        uncertain_books = [b for b in unique if is_likely_public_domain(b, name) is None]
        modern_books = [b for b in unique if is_likely_public_domain(b, name) == False]
        
        if pd_books:
            total_pd += 1
            report.append(f"\n## ✅ {name} — {len(pd_books)} PD editions found\n")
            for b in pd_books[:8]:
                report.append(f"- [{b['year']}] **{b['title']}** — {b['url']}")
            report.append("")
        elif uncertain_books:
            total_uncertain += 1
            report.append(f"\n## 🟡 {name} — {len(uncertain_books)} uncertain (check year)\n")
            for b in uncertain_books[:5]:
                report.append(f"- [{b['year']}] {b['title']} — {b['url']}")
            report.append("")
        else:
            total_none += 1
            report.append(f"\n## ❌ {name} — no PD editions found\n")
        report.append("")
        
        status = "✅" if pd_books else ("🟡" if uncertain_books else "❌")
        print(f"{status} ({len(pd_books)} PD / {len(uncertain_books)} uncertain / {len(modern_books)} modern)")
        
        # Rate limit: be respectful
        time.sleep(2)
    
    # Summary
    report.append("---\n")
    report.append("## Summary\n")
    report.append(f"- ✅ Confirmed PD: **{total_pd}** authors\n")
    report.append(f"- 🟡 Uncertain (needs verification): **{total_uncertain}** authors\n")
    report.append(f"- ❌ No PD found: **{total_none}** authors\n")
    report.append(f"- Total: **{len(AUTHORS)}** authors\n")
    
    # Recommendations
    report.append("\n## Recommendations\n")
    report.append("1. For 🟡 uncertains: manually verify the year on Anna's Archive. Pre-1928 editions are PD.\n")
    report.append("2. For ❌ missing: check Internet Archive directly for scanned pre-1928 editions.\n")
    report.append("3. Some may only exist in Latin/Greek with no public domain English translation.\n")
    report.append("4. Gutenberg is an additional source not queried here — run a second pass.\n")
    
    with open("corpus_discovery_report.md", "w") as f:
        f.write("\n".join(report))
    
    print(f"\n✅ Report saved to corpus_discovery_report.md")


if __name__ == "__main__":
    main()
