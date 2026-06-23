#!/usr/bin/env python3
"""Stage the Resonance corpus from the review manifest.

What it does
------------
- Downloads Gutenberg and Internet Archive text files into a staging corpus.
- Splits the local CCEL omnibus into per-work staging files using the split manifest.
- Writes an index + run summary so the next step can verify exactly what landed.

Conventions
-----------
- one canonical file per manifest item
- status != download is skipped
- no overwrite unless --force is set
- dry-run mode for review
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

STOPWORDS = {
    "the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "by",
    "from", "his", "her", "their", "our", "your", "my", "at", "as", "or",
    "st", "saint", "book", "volume", "vol", "works", "work", "selected", "select",
}


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "untitled"


def norm(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [t for t in text.split() if t and t not in STOPWORDS]
    return " ".join(tokens)


def sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def download_text(urls: list[str], timeout: int = 90) -> str:
    last_error: Optional[Exception] = None
    for url in urls:
        try:
            proc = subprocess.run(
                ["curl", "-L", "-A", "Mozilla/5.0", "--fail", "--silent", url],
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout:
                return proc.stdout.decode("utf-8", errors="replace")
            raise RuntimeError(
                f"curl failed rc={proc.returncode} stderr={proc.stderr.decode('utf-8', errors='replace')[:200]}"
            )
        except Exception as e:  # noqa: BLE001
            last_error = e
    raise RuntimeError(f"download failed for all URLs: {urls!r}; last error={last_error}")


def parse_split_manifest(path: Path):
    text = path.read_text().splitlines()
    section_starts: dict[str, int] = {}
    title_to_section: dict[str, str] = {}
    current_section: Optional[str] = None
    for line in text:
        if line.startswith("## "):
            m = re.match(r"## (.+?) \(contents @ line (\d+)\)", line)
            if m:
                current_section = m.group(1).strip()
                section_starts[current_section] = int(m.group(2))
            else:
                current_section = line[3:].strip()
            continue
        if line.startswith("- ") and current_section:
            title = line[2:].strip()
            title_to_section[title] = current_section
    return section_starts, title_to_section


def title_lookup(title: str, title_to_section: dict[str, str]) -> Optional[str]:
    if title in title_to_section:
        return title_to_section[title]
    ntitle = norm(title)
    if not ntitle:
        return None
    best = None
    best_score = 0.0
    for known, section in title_to_section.items():
        score = sim(ntitle, norm(known))
        if score > best_score:
            best_score = score
            best = section
    return best if best_score >= 0.78 else None


def section_ranges(section_starts: dict[str, int], total_lines: int) -> dict[str, tuple[int, int]]:
    ordered = sorted(section_starts.items(), key=lambda kv: kv[1])
    ranges: dict[str, tuple[int, int]] = {}
    for idx, (section, start) in enumerate(ordered):
        next_start = ordered[idx + 1][1] if idx + 1 < len(ordered) else total_lines + 1
        ranges[section] = (start, next_start - 1)
    return ranges


def extract_section(source_lines: list[str], start_line: int, end_line: int) -> str:
    start_idx = max(start_line - 1, 0)
    end_idx = min(end_line, len(source_lines))
    segment = source_lines[start_idx:end_idx]
    while segment and not segment[0].strip():
        segment.pop(0)
    while segment and not segment[-1].strip():
        segment.pop()
    return "\n".join(segment).rstrip() + "\n"


def parse_manifest(path: Path):
    data = json.loads(path.read_text())
    return data["items"], data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="/data/resonance/plans/2026-06-23-download-manifest.json")
    ap.add_argument("--split-manifest", default="/data/resonance/plans/2026-06-23-church-fathers-split-manifest.md")
    ap.add_argument("--ccel-source", default="/data/resonance/corpus/church_fathers_complete.txt")
    ap.add_argument("--output-dir", default="/data/resonance/corpus_staging")
    ap.add_argument("--limit", type=int, default=0, help="Process only the first N manifest items (0 = all)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    items, _manifest = parse_manifest(manifest_path)
    if args.limit and args.limit > 0:
        items = items[: args.limit]

    outdir = Path(args.output_dir)
    (outdir / "gutenberg").mkdir(parents=True, exist_ok=True)
    (outdir / "ia").mkdir(parents=True, exist_ok=True)
    (outdir / "ccel").mkdir(parents=True, exist_ok=True)
    (outdir / "meta").mkdir(parents=True, exist_ok=True)

    split_path = Path(args.split_manifest)
    section_starts, title_to_section = parse_split_manifest(split_path)
    ccel_source_lines = Path(args.ccel_source).read_text(errors="replace").splitlines()
    ranges = section_ranges(section_starts, len(ccel_source_lines))

    summary = Counter()
    files_written = []
    skipped = []
    warnings = []

    def write_file(path: Path, content: str):
        if path.exists() and not args.force:
            skipped.append({"path": str(path), "reason": "exists"})
            return False
        if args.dry_run:
            files_written.append(str(path))
            return True
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        files_written.append(str(path))
        return True

    for item in items:
        if item.get("status", "download") != "download":
            skipped.append({"title": item.get("title"), "reason": f"status={item.get('status')}"})
            continue

        kind = item["source_kind"]
        title = item["title"]
        summary[kind] += 1
        slug = slugify(title)

        if kind == "gutenberg":
            identifier = item["identifier"].split(",")[0].strip()
            urls = [item["source_url"]]
            if item.get("fallback_url"):
                urls.append(item["fallback_url"])
            try:
                text = (
                    f"DRY RUN: would download Gutenberg item {title} from {urls[0]}\n"
                    if args.dry_run
                    else download_text(urls)
                )
            except Exception as e:  # noqa: BLE001
                warnings.append({"title": title, "source_kind": kind, "error": str(e)})
                continue

            dest = outdir / "gutenberg" / f"{slug}__{identifier}.txt"
            content = (
                f"---\nsource_kind: gutenberg\nidentifier: {identifier}\ntitle: {title}\nsource_url: {urls[0]}\n---\n"
                + text
            )
            write_file(dest, content)
            continue

        if kind == "ia":
            identifier = item["identifier"]
            urls = [item["source_url"]]
            if item.get("fallback_url"):
                urls.append(item["fallback_url"])
            try:
                text = (
                    f"DRY RUN: would download IA item {title} from {urls[0]}\n"
                    if args.dry_run
                    else download_text(urls)
                )
            except Exception as e:  # noqa: BLE001
                warnings.append({"title": title, "source_kind": kind, "error": str(e)})
                continue

            dest = outdir / "ia" / f"{slug}__{slugify(identifier)}.txt"
            content = (
                f"---\nsource_kind: ia\nidentifier: {identifier}\ntitle: {title}\nsource_url: {urls[0]}\n---\n"
                + text
            )
            write_file(dest, content)
            continue

        if kind == "ccel_extract":
            section = title_lookup(title, title_to_section)
            if not section:
                warnings.append({
                    "title": title,
                    "source_kind": kind,
                    "error": "no matching split-manifest section",
                })
                continue
            start, end = ranges[section]
            text = extract_section(ccel_source_lines, start, end)
            dest = outdir / "ccel" / f"{slug}__{slugify(section)}.txt"
            content = (
                "---\n"
                f"source_kind: ccel_extract\nsource_file: {args.ccel_source}\nsection: {section}\n"
                f"title: {title}\n"
                "---\n"
                + text
            )
            write_file(dest, content)
            continue

        warnings.append({"title": title, "source_kind": kind, "error": "unknown source kind"})

    index = {
        "manifest": str(manifest_path),
        "output_dir": str(outdir),
        "dry_run": args.dry_run,
        "force": args.force,
        "limit": args.limit,
        "summary": dict(summary),
        "files_written": files_written,
        "skipped": skipped,
        "warnings": warnings,
    }
    if not args.dry_run:
        (outdir / "meta" / "run-index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    print(json.dumps(index, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
