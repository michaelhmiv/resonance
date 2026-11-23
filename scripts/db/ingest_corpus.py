#!/usr/bin/env python3
"""Load the Resonance corpus into the Railway Postgres database.

Idempotent: drops and reloads the corpus tables. Reads DATABASE_URL from env.
Sources (all in-repo):
  - apps/web/data/seeded_library/bible_books.json + bible_passages.json
  - corpus/staging_v2/**/*.attribution.json  (per-work provenance manifest)
Embeddings are NOT generated here — passage_embeddings stays empty until the
embedding-model bake-off picks a model (one model, one space, for everything).
"""
import glob, json, os, sys
import psycopg

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main() -> None:
    url = os.environ["DATABASE_URL"]
    conn = psycopg.connect(url, connect_timeout=30)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    cur.execute("SELECT extversion FROM pg_extension WHERE extname='vector';")
    print("pgvector version:", cur.fetchone()[0])

    cur.execute("""
    DROP TABLE IF EXISTS passage_embeddings, passages, books, corpus_works CASCADE;
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT, author TEXT, era TEXT, package_id TEXT,
      type TEXT, translation TEXT, source TEXT, license TEXT);
    CREATE TABLE passages (
      id BIGINT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id),
      chapter INT, verse_start INT, verse_end INT, text TEXT,
      translation TEXT, chunk_id INT);
    CREATE INDEX idx_passages_book ON passages(book_id);
    CREATE INDEX idx_passages_ref ON passages(book_id, chapter, verse_start);
    CREATE TABLE passage_embeddings (
      passage_id BIGINT NOT NULL REFERENCES passages(id),
      model TEXT NOT NULL, embedding vector, PRIMARY KEY (passage_id, model));
    CREATE TABLE corpus_works (
      book_id TEXT PRIMARY KEY, title TEXT, author TEXT, era TEXT, package_id TEXT,
      source_url TEXT, source_kind TEXT, size_chars BIGINT, passage_count INT,
      quality_ok BOOLEAN, license TEXT, translator TEXT);
    """)
    print("schema created")

    seed = os.path.join(REPO, "apps/web/data/seeded_library")
    books = json.load(open(os.path.join(seed, "bible_books.json")))
    with cur.copy("COPY books (id,title,author,era,package_id,type,translation,source,license) FROM STDIN") as cp:
        for b in books:
            cp.write_row((b["id"], b.get("title"), b.get("author"), b.get("era"), b.get("package_id"),
                          b.get("type") or "bible", b.get("translation"),
                          "seeded_library (original build)", "public-domain translations (WEB/KJV/ASV)"))
    print("bible books:", len(books))

    passages = json.load(open(os.path.join(seed, "bible_passages.json")))
    with cur.copy("COPY passages (id,book_id,chapter,verse_start,verse_end,text,translation,chunk_id) FROM STDIN") as cp:
        for p in passages:
            cp.write_row((int(p["id"]), f"{p['translation']}_{p['book']}", int(p["chapter"]),
                          int(p["verse_start"]), int(p["verse_end"]), p.get("text"),
                          p.get("translation"), int(p.get("chunk_id") or 0)))
    print("bible passages:", len(passages))

    works = 0
    with cur.copy("COPY corpus_works (book_id,title,author,era,package_id,source_url,source_kind,size_chars,passage_count,quality_ok,license,translator) FROM STDIN") as cp:
        for path in sorted(glob.glob(os.path.join(REPO, "corpus/staging_v2/**/*.attribution.json"), recursive=True)):
            a = json.load(open(path))
            cp.write_row((a["book_id"], a.get("title"), a.get("author"), a.get("era"), a.get("package_id"),
                          a.get("source_url"), a.get("source_kind"), a.get("size_chars"),
                          a.get("passage_count"), a.get("quality_ok"), a.get("license"), a.get("translator")))
            works += 1
    print("corpus works (staging_v2 manifest):", works)

    cur.execute("SELECT translation, COUNT(*) FROM passages GROUP BY 1 ORDER BY 1;")
    print("passages by translation:", cur.fetchall())
    cur.execute("SELECT package_id, COUNT(*), SUM(passage_count) FROM corpus_works GROUP BY 1 ORDER BY 1;")
    print("works by package (works, passages when chunked):", cur.fetchall())
    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database()));")
    print("database size:", cur.fetchone()[0])

if __name__ == "__main__":
    main()
