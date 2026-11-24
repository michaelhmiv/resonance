#!/usr/bin/env python3
"""Decider-seat LLM harness v2 (quantized phone-class GGUF via llama-server).

Improvements over v1:
  - Focuses on top-K candidates (default K=30, 550-char excerpts) -> ~4.5K tokens
    instead of ~11K tokens (2.5x faster, realistic phone KV-cache, less lost-in-middle).
  - Supports Gemma 4 E2B-it (Apache 2.0) and LFM3-1.7B (custom license, flagged).
  - Robust JSON extraction with schema constraint + fence-stripping fallback.
  - Enforces the spec's per-work cap of 2 on final picks.

Usage: rerank_decider_v2.py <shard_k> <num_shards> <candidates.json> <model.gguf> [top_k]
"""
import json, re, subprocess, sys, time, urllib.request
from pathlib import Path

SYSTEM = """You are a librarian for a Christian devotional journaling app. Given a user's journal entry and numbered candidate passages from Scripture and classic Christian writers, choose the 8 passages that best speak to the writer — ordered best first.

Judge the writer's actual situation and direction — who wronged whom, what they are moving toward, what they need — not shared vocabulary. Reject passages that merely reuse the entry's words while misunderstanding its posture (for example, a passage about nursing bitterness for a writer who wants to forgive, or condemning doubt for an honest questioner). Prefer passages whose stance fits where the writer is heading. Include Scripture passages when they genuinely fit; never force one. Choose at most 2 passages from the same work.

Reply with JSON only: {"picks": [eight candidate numbers, best first]}"""


def build_prompt(entry, top_k):
    lines = [f'Journal entry:\n"{entry["journal"]}"', "", "Candidates:"]
    for c in entry["candidates"][:top_k]:
        label = c["ref"] if c.get("ref") else c["work_id"].split("__")[0].replace("-", " ").title()
        lines.append(f'{c["n"]}. [{label}] {c["text"][:550]}')
    return "\n".join(lines)


def wait_health(port, proc, timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if proc.poll() is not None:
            raise RuntimeError(f"llama-server exited early rc={proc.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(3)
    raise RuntimeError("llama-server health timeout")


def parse_picks(raw):
    text = raw.strip()
    if "```" in text:
        m = re.search(r"\{.*?\}", text, re.S)
        if m:
            text = m.group(0)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and "picks" in obj:
            return [int(x) for x in obj["picks"]]
    except Exception:
        pass
    return [int(x) for x in re.findall(r"\b\d+\b", text)]


def decide(port, entry, top_k):
    body = json.dumps({
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": build_prompt(entry, top_k)},
        ],
        "temperature": 0.1,
        "max_tokens": 120,
        "response_format": {
            "type": "json_object",
            "schema": {
                "type": "object",
                "properties": {"picks": {"type": "array", "items": {"type": "integer"}}},
                "required": ["picks"],
            },
        },
    }).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=1200) as r:
        out = json.loads(r.read())
    raw = out["choices"][0]["message"]["content"]
    picks = parse_picks(raw)
    by_n = {c["n"]: c for c in entry["candidates"][:top_k]}
    chosen, seen, per_work = [], set(), {}
    for n in picks:
        if n in by_n and n not in seen:
            c = by_n[n]
            if per_work.get(c["work_id"], 0) >= 2:
                continue
            chosen.append(c)
            seen.add(n)
            per_work[c["work_id"]] = per_work.get(c["work_id"], 0) + 1
        if len(chosen) >= 5:
            break
    return chosen, raw


def main():
    k, n = int(sys.argv[1]), int(sys.argv[2])
    cand_path, model = sys.argv[3], sys.argv[4]
    top_k = int(sys.argv[5]) if len(sys.argv) > 5 else 30
    entries = json.loads(Path(cand_path).read_text())
    mine = entries[k::n]
    print(f"shard {k}/{n}: {len(mine)} entries (top_k={top_k})", flush=True)
    port = 18080 + k
    help_out = subprocess.run(["llama-server", "--help"], capture_output=True, text=True).stdout
    cmd = ["llama-server", "-m", model, "--port", str(port), "-c", "8192", "-t", "4", "--host", "127.0.0.1"]
    if "--reasoning-budget" in help_out:
        cmd += ["--reasoning-budget", "0"]
    server = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    results = []
    try:
        wait_health(port, server)
        for e in mine:
            t0 = time.time()
            try:
                chosen, raw = decide(port, e, top_k)
                status = "ok" if len(chosen) == 5 else f"short:{len(chosen)}"
            except Exception as ex:
                chosen, raw, status = [], "", f"error:{ex}"
            print(f"{e['id']}: {status} ({time.time()-t0:.0f}s)", flush=True)
            results.append({
                "id": e["id"],
                "title": e.get("title", e["id"]),
                "journal": e["journal"],
                "picks": chosen,
                "raw": raw,
                "status": status,
            })
    finally:
        server.terminate()
    Path(f"rerank-shard-{k}.json").write_text(json.dumps(results, indent=1))
    print(f"wrote rerank-shard-{k}.json", flush=True)


if __name__ == "__main__":
    main()
