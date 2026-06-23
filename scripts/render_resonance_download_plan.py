#!/usr/bin/env python3
"""Render a deterministic download plan from the Resonance manifest.

This script is intentionally conservative:
- Gutenberg and IA entries emit concrete download URLs.
- CCEL extraction entries emit local extraction plans from the omnibus source.
- This version only renders the plan; it does not download files.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', default='/data/resonance/plans/2026-06-23-download-manifest.json')
    ap.add_argument('--output', default='')
    args = ap.parse_args()

    mf = json.loads(Path(args.manifest).read_text())
    items = mf['items']

    by_pack = defaultdict(list)
    for item in items:
        by_pack[item['pack']].append(item)

    lines = []
    lines.append('# Resonance download plan')
    lines.append('')
    lines.append(f"Total items: {mf['total_items']}")
    lines.append('')
    lines.append('## Summary')
    lines.append(f"- Source kinds: {dict(Counter(i['source_kind'] for i in items))}")
    lines.append(f"- Packs: {dict(Counter(i['pack'] for i in items))}")
    lines.append('')

    for pack in sorted(by_pack.keys()):
        lines.append(f'### {pack}')
        for item in by_pack[pack]:
            if item['source_kind'] == 'gutenberg':
                lines.append(f"- [GUTENBERG] {item['author']} — {item['title']} — {item['source_url']}")
            elif item['source_kind'] == 'ia':
                lines.append(f"- [IA] {item['author']} — {item['title']} — {item['source_url']}")
            else:
                lines.append(f"- [CCEL-EXTRACT] {item['title']} — {item['notes']}")
        lines.append('')

    out = '\n'.join(lines).rstrip() + '\n'
    if args.output:
        Path(args.output).write_text(out)
    else:
        print(out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
