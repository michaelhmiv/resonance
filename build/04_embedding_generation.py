#!/usr/bin/env python3
"""
Resonance Build Pipeline — Task 0.4: Embedding Generation Pipeline

Takes all chunked passages (Bible + voices) and produces vector files using
the specified embedding model. One run per model.

Input:  build/output/bible_passages.json
        build/output/voice_passages.json
Output: build/output/vectors_<model_id>.bin   (raw float32, row-major)
        build/output/vectors_<model_id>_manifest.json
"""

import json
import os
import sys
import time
import numpy as np

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Default model — GTE-small (locked decision: best quality on spiritual text matching, 33MB, MIT)
MODELS = {
    "gte-small": {
        "hf_id": "thenlper/gte-small",
        "dimensions": 384,
    },
    "embedding-gemma-300m": {
        "hf_id": "google/embeddinggemma-300m",
        "dimensions": 768,
        "gated": True,
    },
    "bge-small-en-v1.5": {
        "hf_id": "BAAI/bge-small-en-v1.5",
        "dimensions": 384,
    },
    "all-minilm-l6-v2": {
        "hf_id": "sentence-transformers/all-MiniLM-L6-v2",
        "dimensions": 384,
    },
}


def load_all_passages():
    """Load all passages from Bible + voice JSON files."""
    all_passages = []
    
    bible_path = os.path.join(OUTPUT_DIR, "bible_passages.json")
    if os.path.exists(bible_path):
        with open(bible_path) as f:
            bible = json.load(f)
        for p in bible:
            p["source_type"] = "bible"
        all_passages.extend(bible)
    
    voice_path = os.path.join(OUTPUT_DIR, "voice_passages.json")
    if os.path.exists(voice_path):
        with open(voice_path) as f:
            voices = json.load(f)
        for p in voices:
            p["source_type"] = "voice"
        all_passages.extend(voices)
    
    return all_passages


def generate_embeddings(model_id: str, passages: list, batch_size: int = 64):
    """Generate embeddings for all passages using the specified model."""
    from sentence_transformers import SentenceTransformer
    
    model_config = MODELS[model_id]
    hf_id = model_config["hf_id"]
    expected_dim = model_config["dimensions"]
    
    print(f"Loading model: {hf_id}...")
    model = SentenceTransformer(hf_id)
    actual_dim = model.get_embedding_dimension()
    
    if actual_dim != expected_dim:
        print(f"  Warning: expected dim {expected_dim}, got {actual_dim}")
        expected_dim = actual_dim
    
    print(f"  Model loaded. Dimensions: {actual_dim}")
    
    # Extract texts
    texts = [p["text"] for p in passages]
    print(f"  Embedding {len(texts)} passages (batch size: {batch_size})...")
    
    start = time.time()
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,  # L2 normalize for cosine similarity
    )
    elapsed = time.time() - start
    
    print(f"  Done in {elapsed:.1f}s ({len(texts)/elapsed:.0f} passages/sec)")
    
    return embeddings, actual_dim


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Default model: gte-small
    model_id = sys.argv[1] if len(sys.argv) > 1 else "gte-small"
    
    if model_id not in MODELS:
        print(f"Unknown model: {model_id}")
        print(f"Available: {list(MODELS.keys())}")
        sys.exit(1)
    
    print(f"=== Embedding Generation Pipeline ===")
    print(f"Model: {model_id} ({MODELS[model_id]['hf_id']})")
    print()
    
    # Load passages
    passages = load_all_passages()
    print(f"Loaded {len(passages)} passages")
    
    if not passages:
        print("No passages found! Run 01_bible_ingestion.py and 02_voices_ingestion.py first.")
        sys.exit(1)
    
    # Generate embeddings
    embeddings, dim = generate_embeddings(model_id, passages)
    
    # Verify shape
    print(f"\nEmbedding matrix shape: {embeddings.shape}")
    print(f"Data type: {embeddings.dtype}")
    
    # Save as binary file (raw float32)
    vector_path = os.path.join(OUTPUT_DIR, f"vectors_{model_id}.bin")
    embeddings.astype(np.float32).tofile(vector_path)
    file_size = os.path.getsize(vector_path) / 1024 / 1024
    print(f"Wrote vectors to {vector_path} ({file_size:.1f}MB)")
    
    # Write manifest
    manifest = {
        "model_id": model_id,
        "hf_id": MODELS[model_id]["hf_id"],
        "num_passages": len(passages),
        "dimensions": dim,
        "passage_ids": [p["id"] for p in passages],
        "passage_sources": [p.get("source_type", "unknown") for p in passages],
        "vector_file": f"vectors_{model_id}.bin",
        "vector_file_size_mb": round(file_size, 1),
    }
    
    manifest_path = os.path.join(OUTPUT_DIR, f"vectors_{model_id}_manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f)
    print(f"Wrote manifest to {manifest_path}")
    
    # Verify: embed a test query and find closest passages
    print(f"\n=== Verification ===")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODELS[model_id]["hf_id"])
    query_vec = model.encode(["I am tired and overwhelmed"], normalize_embeddings=True)
    
    # Cosine similarity (already L2-normalized, so dot product = cosine)
    similarities = embeddings @ query_vec[0]
    top_indices = np.argsort(similarities)[-5:][::-1]
    
    print(f"Query: 'I am tired and overwhelmed'")
    print(f"Top 5 matches:")
    for idx in top_indices:
        p = passages[idx]
        score = similarities[idx]
        text_preview = p["text"][:80]
        source = p.get("source_type", "?")
        if source == "bible":
            ref = f"{p['book']} {p['chapter']}:{p['verse_start']} ({p['translation']})"
        else:
            ref = f"{p['author']}, {p['work']}"
        print(f"  [{score:.4f}] {ref}: {text_preview}...")
    
    print(f"\n✅ Embedding pipeline complete for {model_id}")


if __name__ == "__main__":
    main()
