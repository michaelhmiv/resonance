#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.5: Book Package Assembly

Assembles the seeded library and individual Book Packages into the file
format the app expects. The seeded library is bundled in the app; additional
packages are served via static file host.

Input:  build/output/bible_passages.json
        build/output/bible_books.json
        build/output/voice_passages.json
        build/output/voice_books.json
        build/output/cross_references.json
        build/output/vectors_<model_id>.bin
        build/output/vectors_<model_id>_manifest.json
        build/output/verse_of_day.json
Output: build/output/seeded_library/      → copy to app/assets/seeded_library/
        build/output/packages/            → serve via static file host
"""

import json
import os
import shutil
import zipfile

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
SEEDED_DIR = os.path.join(OUTPUT_DIR, "seeded_library")
PACKAGES_DIR = os.path.join(OUTPUT_DIR, "packages")

# Models to generate vector sets for
MODELS = ["gte-small"]

# Package definitions for additional content
PACKAGES = [
    {
        "id": "church-fathers",
        "name": "Church Fathers",
        "description": "Writings from the early Church Fathers — Irenaeus, Origen, Chrysostom, and more.",
        "source_dir": "corpus_staging/ccel",
        "category": "Church Fathers",
    },
    {
        "id": "additional-translations",
        "name": "Additional Bible Translations",
        "description": "ASV and other public-domain Bible translations.",
        "bible_only": True,
        "translations": ["asv"],
        "category": "Bible Translations",
    },
]


def assemble_seeded_library():
    """Assemble the seeded library that ships with the app."""
    os.makedirs(SEEDED_DIR, exist_ok=True)
    
    print("=== Assembling Seeded Library ===")
    
    # Copy all output files
    files_to_copy = [
        "bible_passages.json",
        "bible_books.json",
        "voice_passages.json",
        "voice_books.json",
        "cross_references.json",
        "verse_of_day.json",
    ]
    
    for filename in files_to_copy:
        src = os.path.join(OUTPUT_DIR, filename)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(SEEDED_DIR, filename))
            size = os.path.getsize(src) / 1024 / 1024
            print(f"  Copied {filename} ({size:.1f}MB)")
        else:
            print(f"  WARNING: {filename} not found")
    
    # Copy vector files for each model
    for model_id in MODELS:
        vec_file = f"vectors_{model_id}.bin"
        manifest_file = f"vectors_{model_id}_manifest.json"
        
        vec_src = os.path.join(OUTPUT_DIR, vec_file)
        manifest_src = os.path.join(OUTPUT_DIR, manifest_file)
        
        if os.path.exists(vec_src):
            shutil.copy2(vec_src, os.path.join(SEEDED_DIR, vec_file))
            size = os.path.getsize(vec_src) / 1024 / 1024
            print(f"  Copied {vec_file} ({size:.1f}MB)")
        else:
            print(f"  WARNING: {vec_file} not found — run 04_embedding_generation.py {model_id}")
        
        if os.path.exists(manifest_src):
            shutil.copy2(manifest_src, os.path.join(SEEDED_DIR, manifest_file))
            print(f"  Copied {manifest_file}")
    
    # Write a library manifest
    manifest = {
        "version": 1,
        "created_at": os.path.getmtime(SEEDED_DIR),
        "files": [f for f in os.listdir(SEEDED_DIR)],
        "bible_translations": ["web", "kjv"],
        "voice_works": 18,
        "total_passages": "auto",  # app counts on load
        "vector_models": MODELS,
        "verse_of_day_count": 365,
    }
    
    with open(os.path.join(SEEDED_DIR, "library_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    
    # Calculate total size
    total_size = sum(os.path.getsize(os.path.join(SEEDED_DIR, f)) 
                     for f in os.listdir(SEEDED_DIR))
    print(f"\nSeeded library total: {total_size / 1024 / 1024:.1f}MB")
    print(f"Output: {SEEDED_DIR}")
    print(f"Copy this directory to app/assets/seeded_library/")


def assemble_packages():
    """Assemble individual Book Packages for download."""
    os.makedirs(PACKAGES_DIR, exist_ok=True)
    
    print("\n=== Assembling Book Packages ===")
    
    # For now, just create package manifests — the actual content
    # (Church Fathers, etc.) will be processed in the same pipeline
    # as the seeded library voices
    
    # Additional translations package
    trans_package = {
        "id": "additional-translations",
        "name": "Additional Bible Translations",
        "description": "ASV (1901) — public domain. A classic formal-equivalence translation.",
        "category": "Bible Translations",
        "size_mb": 0,  # calculated below
        "contents": [],
    }
    
    # Check if ASV passages exist
    bible_path = os.path.join(OUTPUT_DIR, "bible_passages.json")
    if os.path.exists(bible_path):
        with open(bible_path) as f:
            all_passages = json.load(f)
        
        asv_passages = [p for p in all_passages if p.get("translation") == "asv"]
        asv_books = [b for b in json.load(open(os.path.join(OUTPUT_DIR, "bible_books.json"))) 
                     if b.get("translation") == "asv"]
        
        if asv_passages:
            trans_package["contents"].append({
                "translation": "asv",
                "passage_count": len(asv_passages),
                "book_count": len(asv_books),
            })
            # Estimate size (passages JSON + vectors)
            trans_package["size_mb"] = round(
                len(json.dumps(asv_passages)) / 1024 / 1024, 1
            )
    
    # Write package manifest
    with open(os.path.join(PACKAGES_DIR, "additional-translations.json"), "w") as f:
        json.dump(trans_package, f, indent=2)
    print(f"\n  additional-translations: {trans_package['size_mb']}MB")
    
    # Church Fathers package (placeholder — content in corpus_staging)
    fathers_package = {
        "id": "church-fathers",
        "name": "Church Fathers",
        "description": "Writings from the early Church Fathers — Irenaeus, Origen, Chrysostom, Augustine, and more.",
        "category": "Church Fathers",
        "size_mb": 0,
        "contents": [],
        "status": "pending-ingestion",  # needs 02_voices_ingestion.py to process corpus_staging/ccel
    }
    
    with open(os.path.join(PACKAGES_DIR, "church-fathers.json"), "w") as f:
        json.dump(fathers_package, f, indent=2)
    print(f"  church-fathers: pending ingestion")
    
    # Available packages manifest (what the app checks against)
    available = [
        trans_package,
        fathers_package,
        {
            "id": "mystics-contemplatives",
            "name": "Mystics & Contemplatives",
            "description": "Additional writings from Christian mystics and contemplatives.",
            "category": "Mystics & Contemplatives",
            "status": "not-yet-built",
        },
        {
            "id": "reformation-classics",
            "name": "Reformation Classics",
            "description": "Writings from Luther, Calvin, and other Reformers.",
            "category": "Reformation Classics",
            "status": "not-yet-built",
        },
        {
            "id": "devotional-poetic",
            "name": "Devotional & Poetic",
            "description": "Devotional and poetic works from Christian history.",
            "category": "Devotional & Poetic",
            "status": "not-yet-built",
        },
    ]
    
    with open(os.path.join(PACKAGES_DIR, "available_packages.json"), "w") as f:
        json.dump(available, f, indent=2)
    print(f"\n  Wrote available_packages.json with {len(available)} packages")
    print(f"  Output: {PACKAGES_DIR}")


def main():
    assemble_seeded_library()
    assemble_packages()
    
    print("\n✅ Book Package assembly complete")


if __name__ == "__main__":
    main()
