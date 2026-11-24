#!/usr/bin/env python3
"""Decider-seat rerank test (Michael's ruling, 2026-11-24).

A LOCAL quantized model — Gemma 3n E2B-it Q4_K_M via llama.cpp — reads each
journal entry plus its embedding top-50 shortlist and selects the 5 passages
that genuinely fit, structured JSON out. Nothing is generated for a user;
this measures whether a local decider fixes embedding misunderstandings
(e.g. G09) before the seat is adopted in the product architecture.

Usage: rerank_decider.py <shard_k> <shard_n> <candidates.json> <model.gguf>
Writes rerank-shard-<k>.json.
"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path

SYSTEM = """You are the passage-selection decider for a Christian journaling app. You receive a journal entry and 50 candidate passages retrieved by semantic similarity. Your only job: choose the 5 passages that would most genuinely speak to this writer, in order, best first.

Judge the writer's actual situation and direction — who wronged whom, what they are moving toward, what they need — not shared vocabulary. Reject passages that merely reuse the entry's words while misunderstanding its posture (for example, a passage about nursing bitterness for a writer who wants to forgive). Prefer passages whose stance fits where the writer is heading. Include a Scripture passage when one genuinely fits; never force one. Choose at most 2 passages from the same work.

Reply with JSON only: {"picks": [candidate numbers, best first]}"""

def build_prompt(entry):
    lines = [f'Journal entry:\n"{entry["journal"]}"', "", "Candidates:"]
    for c in entry["candidates"]:
        label = c["ref"] if c["ref"] else c["work_id"].split("__")[0].replace("-", " ").title()
        lines.append(f'{c["n"]}. [{label}] {c["text"][:700]}')
    return "\n".join(lines)

def wait_health(port, proc, timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server exited early rc={proc.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
                if r.status == 200: return
        except Exception:
            time.sleep(3)
    raise RuntimeError("llama-server health timeout")

def decide(port, entry):
    body = json.dumps({
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": build_prompt(entry)}],
        "temperature": 0.1, "max_tokens": 160,
        "response_format": {"type": "json_object",
                            "schema": {"type": "object",
                                       "properties": {"picks": {"type": "array", "items": {"type": "integer"}}},
                                       "required": ["picks"]}},
    }).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                                 data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        out = json.loads(r.read())
    raw = out["choices"][0]["message"]["content"]
    picks = json.loads(raw)["picks"]
    by_n = {c["n"]: c for c in entry["candidates"]}
    chosen, seen = [], set()
    for n in picks:
        if n in by_n and n not in seen:
            chosen.append(by_n[n]); seen.add(n)
        if len(chosen) >= 5: break
    return chosen, raw

def main():
    k, n = int(sys.argv[1]), int(sys.argv[2])
    cand_path, model = sys.argv[3], sys.argv[4]
    entries = json.loads(Path(cand_path).read_text())
    mine = entries[k::n]
    print(f"shard {k}/{n}: {len(mine)} entries", flush=True)
    port = 18080 + k
    server = subprocess.Popen(
        ["llama-server", "-m", model, "--port", str(port), "-c", "16384",
         "-t", "4", "--host", "127.0.0.1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        wait_health(port, server)
        for e in mine:
            t0 = time.time()
            try:
                chosen, raw = decide(port, e)
                status = "ok" if len(chosen) == 5 else f"short:{len(chosen)}"
            except Exception as ex:
                chosen, raw, status = [], "", f"error:{ex}"
            print(f"{e['id']}: {status} ({time.time()-t0:.0f}s)", flush=True)
            results.append({"id": e["id"], "journal": e["journal"],
                            "picks": chosen, "raw": raw, "status": status})
    finally:
        server.terminate()
    Path(f"rerank-shard-{k}.json").write_text(json.dumps(results, indent=1))
    print(f"wrote rerank-shard-{k}.json", flush=True)

if __name__ == "__main__":
    main()
