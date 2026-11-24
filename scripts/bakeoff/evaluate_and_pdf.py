#!/usr/bin/env python3
"""Objective golden-set evaluator + multi-way comparison PDF builder for Resonance.

Usage:
  python3 scripts/bakeoff/evaluate_and_pdf.py \
    --out-pdf /path/to/comparison.pdf \
    --out-json /path/to/summary.json \
    --title "Resonance Bake-Off Comparison" \
    --model "EG2 Baseline (int8, title:none)"=/path/to/bakeoff-results.json \
    --model "Qwen3-Emb-0.6B (int8, 512d)"=/path/to/results-qwen3-emb-0.6b.json \
    ...
"""
import argparse, json, re
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]

BOOK_ALIASES = {
    "psalm": "psalms",
    "psalms": "psalms",
    "song of solomon": "song of solomon",
    "song of songs": "song of solomon",
    "1 samuel": "1 samuel",
    "2 samuel": "2 samuel",
    "1 kings": "1 kings",
    "2 kings": "2 kings",
    "1 corinthians": "1 corinthians",
    "2 corinthians": "2 corinthians",
    "1 timothy": "1 timothy",
    "2 timothy": "2 timothy",
    "1 peter": "1 peter",
    "2 peter": "2 peter",
    "1 john": "1 john",
    "1 thessalonians": "1 thessalonians",
}

AUTHOR_WORK_PATTERNS = {
    "augustine": ["augustin", "confessions", "city-of-god", "christian-doctrine"],
    "kempis": ["kempis", "imitation"],
    "brother lawrence": ["lawrence", "practice-of-the-presence"],
    "john of the cross": ["dark-night", "john-of-the-cross", "ascent-of-mount-carmel", "spiritual-canticle"],
    "teresa": ["teresa", "interior-castle", "autobiography-life"],
    "julian": ["julian", "revelations-of-divine-love"],
    "pascal": ["pascal", "pensees", "thoughts"],
    "ignatius": ["ignatius", "spiritual-exercises"],
    "herbert": ["herbert", "temple"],
    "luther": ["luther", "galatians"],
    "bunyan": ["bunyan", "grace-abounding", "pilgrim"],
    "eckhart": ["eckhart"],
    "cassian": ["cassian", "conferences"],
}

HARD_NEGATIVES = {
    "G01": ("psalms", 127, (3, 5)),
    "G06": ("psalms", 95, (1, 11)),
    "G13": ("psalms", 14, (1, 7)),
    "G21": ("1 corinthians", 10, (12, 14)),
}


def norm_book(b):
    b = re.sub(r"\s+", " ", b.strip().lower())
    return BOOK_ALIASES.get(b, b)


def parse_bible_ref(ref_str):
    """Parse 'Psalms 42:1-5' or 'Matthew 6:25-34' -> (book, chapter, v_start, v_end)."""
    if not ref_str:
        return None
    m = re.search(
        r"\b((?:[123]\s+)?(?:Song of Solomon|Song of Songs|[A-Z][a-z]+))\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?",
        ref_str,
    )
    if not m:
        return None
    book = norm_book(m.group(1))
    chap = int(m.group(2))
    v1 = int(m.group(3)) if m.group(3) else 1
    v2 = int(m.group(4)) if m.group(4) else (v1 if m.group(3) else 200)
    return (book, chap, v1, v2)


def refs_overlap(ref_a, ref_b):
    if not ref_a or not ref_b:
        return False
    return ref_a[0] == ref_b[0] and ref_a[1] == ref_b[1] and not (ref_a[3] < ref_b[2] or ref_b[3] < ref_a[2])


def parse_golden_set():
    text = (ROOT / "docs/resonance/golden-set-v1.md").read_text()
    entries = []
    for block in re.split(r"\n### ", text)[1:]:
        head = block.splitlines()[0].strip()
        eid = head.split(" — ")[0].strip()
        jm = re.search(r'\*\*Journal:\*\* "(.+?)"', block, re.S)
        journal = jm.group(1).replace("\n", " ") if jm else ""
        echoes = re.findall(r"^- (.+)$", block, re.M)
        hn_m = re.search(r"\*\*Hard negative[s]?:\*\*\s*(.+)", block)
        expected_refs = []
        expected_authors = []
        for line in echoes:
            pr = parse_bible_ref(line)
            if pr:
                expected_refs.append(pr)
            ll = line.lower()
            for auth, pats in AUTHOR_WORK_PATTERNS.items():
                if auth in ll or any(p.replace("-", " ") in ll for p in pats):
                    expected_authors.append(auth)
        entries.append({
            "id": eid,
            "title": head,
            "journal": journal,
            "echoes": echoes,
            "expected_refs": expected_refs,
            "expected_authors": sorted(set(expected_authors)),
            "hard_negative": hn_m.group(1).strip() if hn_m else None,
        })
    return entries


def extract_items(entry_obj):
    """Support results (top-5), picks (decider top-5), or candidates (top-50)."""
    for k in ("picks", "results", "candidates"):
        if k in entry_obj and isinstance(entry_obj[k], list):
            return entry_obj[k]
    return []


def score_item_match(item, g_entry):
    ref = parse_bible_ref(item.get("ref") or "")
    ref_hit = any(refs_overlap(ref, er) for er in g_entry["expected_refs"]) if ref else False
    book_chap_hit = any(ref and ref[0] == er[0] and ref[1] == er[1] for er in g_entry["expected_refs"]) if ref else False
    wid = (item.get("work_id") or "").lower()
    auth_hit = False
    for a in g_entry["expected_authors"]:
        if any(p in wid for p in AUTHOR_WORK_PATTERNS[a]):
            auth_hit = True
            break
    return ref_hit, book_chap_hit, auth_hit


def is_hard_negative(eid, item):
    if eid not in HARD_NEGATIVES:
        return False
    book, chap, (v1, v2) = HARD_NEGATIVES[eid]
    ref = parse_bible_ref(item.get("ref") or "")
    return refs_overlap(ref, (book, chap, v1, v2))


def evaluate_model(label, data, golden, subset_refs=None):
    by_id = {e["id"]: e for e in data}
    n_total = len(golden)
    scripture_top1 = 0
    scripture_top5 = 0
    exact_ref_hit_top5 = 0
    chap_hit_top5 = 0
    auth_hit_top5 = 0
    any_hit_top5 = 0
    hn_violations = []
    hub_counter = Counter()
    unique_top5 = set()
    g09_summary = {}

    for g in golden:
        eid = g["id"]
        e = by_id.get(eid)
        if not e:
            continue
        items = extract_items(e)[:5]
        if not items:
            continue
        if items[0].get("source") == "bible":
            scripture_top1 += 1
        if any(it.get("source") == "bible" for it in items):
            scripture_top5 += 1

        r_hit, c_hit, a_hit = False, False, False
        for it in items:
            key = it.get("ref") or (it.get("work_id", "") + ":" + it.get("text", "")[:60])
            hub_counter[key] += 1
            unique_top5.add(key)
            rh, ch, ah = score_item_match(it, g)
            r_hit = r_hit or rh
            c_hit = c_hit or ch
            a_hit = a_hit or ah
            if is_hard_negative(eid, it):
                hn_violations.append((eid, it.get("ref")))

        if r_hit:
            exact_ref_hit_top5 += 1
        if c_hit:
            chap_hit_top5 += 1
        if a_hit:
            auth_hit_top5 += 1
        if r_hit or c_hit or a_hit:
            any_hit_top5 += 1

        if eid == "G09":
            g09_summary = {
                "top5_labels": [it.get("ref") or it["work_id"].split("__")[0] for it in items],
                "has_job_bitterness": any((it.get("ref") or "").startswith("Job ") for it in items),
                "has_forgiveness_kw": any(
                    any(w in it.get("text", "").lower() for w in ("forgiv", "pardon", "mercy", "offence", "offense", "reconcil"))
                    for it in items
                ),
            }

    # Check top-50 recall if candidates are present
    recall50_ref, recall50_chap, recall50_any = None, None, None
    sample_items = extract_items(next(iter(by_id.values()))) if by_id else []
    if len(sample_items) >= 20:
        r50, c50, a50 = 0, 0, 0
        for g in golden:
            e = by_id.get(g["id"])
            if not e:
                continue
            items = extract_items(e)[:50]
            rh = any(score_item_match(it, g)[0] for it in items)
            ch = any(score_item_match(it, g)[1] for it in items)
            ah = any(score_item_match(it, g)[2] for it in items)
            r50 += int(rh)
            c50 += int(ch)
            a50 += int(rh or ch or ah)
        recall50_ref, recall50_chap, recall50_any = r50, c50, a50

    return {
        "label": label,
        "entries": len(by_id),
        "scripture_top1": scripture_top1,
        "scripture_top5": scripture_top5,
        "exact_bible_ref_top5": exact_ref_hit_top5,
        "bible_chapter_top5": chap_hit_top5,
        "expected_author_top5": auth_hit_top5,
        "any_expected_echo_top5": any_hit_top5,
        "recall50_ref": recall50_ref,
        "recall50_chap": recall50_chap,
        "recall50_any": recall50_any,
        "hard_negative_violations": hn_violations,
        "max_hub_top5": hub_counter.most_common(1)[0][1] if hub_counter else 0,
        "unique_passages_top5": len(unique_top5),
        "top_hubs": hub_counter.most_common(5),
        "g09": g09_summary,
    }


def analyze_calibrated_silence(reranker_data):
    """Evaluate calibrated silence floors & Scripture-slot margins on all_scored probabilities."""
    if not reranker_data or "all_scored" not in reranker_data[0]:
        return None
    floors = {}
    for tau in [0.10, 0.20, 0.30, 0.40, 0.50, 0.60]:
        s_silent, w_silent, total_kept = 0, 0, 0
        for e in reranker_data:
            sc = e["all_scored"]
            bib = [x for x in sc if x["source"] == "bible" and x["rerank_prob"] >= tau]
            wit = [x for x in sc if x["source"] != "bible" and x["rerank_prob"] >= tau]
            if not bib:
                s_silent += 1
            if not wit:
                w_silent += 1
            total_kept += min(5, sum(1 for x in sc if x["rerank_prob"] >= tau))
        floors[f"tau_{tau:.2f}"] = {
            "scripture_silent_entries": s_silent,
            "witness_silent_entries": w_silent,
            "avg_passages_shown": round(total_kept / len(reranker_data), 2),
        }

    margins = {}
    for delta in [0.05, 0.10, 0.15, 0.25]:
        fired, skipped = 0, 0
        for e in reranker_data:
            sc = sorted(e["all_scored"], key=lambda x: -x["rerank_prob"])
            top5 = sc[:5]
            if any(x["source"] == "bible" for x in top5):
                continue
            bib = [x for x in sc[5:15] if x["source"] == "bible"]
            if not bib:
                skipped += 1
                continue
            if top5[-1]["rerank_prob"] - bib[0]["rerank_prob"] <= delta:
                fired += 1
            else:
                skipped += 1
        margins[f"delta_{delta:.2f}"] = {"slot_fired": fired, "slot_suppressed_weak": skipped}
    return {"confidence_floors": floors, "scripture_margins": margins}


def build_pdf(out_pdf, title, subtitle, models_ordered, summaries, golden):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, HRFlowable
    )

    doc = SimpleDocTemplate(
        str(out_pdf),
        pagesize=letter,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, spaceAfter=6, textColor=colors.HexColor("#1a2b4c"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#1a2b4c"))
    h3 = ParagraphStyle("H3", parent=styles["Heading3"], fontSize=10, spaceBefore=6, spaceAfter=2, textColor=colors.HexColor("#2d4a77"))
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=8.5, leading=11)
    quote = ParagraphStyle("Quote", parent=body, leftIndent=10, textColor=colors.HexColor("#333333"), backColor=colors.HexColor("#f4f6f9"), borderPadding=5)
    small = ParagraphStyle("Small", parent=body, fontSize=7.8, leading=10)
    cell_st = ParagraphStyle("Cell", parent=body, fontSize=7.4, leading=9.4)

    story = []
    story.append(Paragraph(escape(title), h1))
    if subtitle:
        story.append(Paragraph(escape(subtitle), body))
    story.append(Spacer(1, 8))

    # Executive scorecard table
    story.append(Paragraph("Executive Scorecard (50 Golden Entries, v3 Subset 6,785 Passages)", h2))
    headers = ["Model", "Scripture\nTop-5 (Top-1)", "Expected Echo\nTop-5 (Ch/Auth)", "Max Hub\n(Unique/250)", "Hard Neg\nViolations", "G09 Job?\n/ Forgive?"]
    rows = [headers]
    for s in summaries:
        g09 = s["g09"]
        g09_txt = f"{'YES(bad)' if g09.get('has_job_bitterness') else 'No'} / {'YES' if g09.get('has_forgiveness_kw') else 'no'}"
        rows.append([
            Paragraph(f"<b>{escape(s['label'])}</b>", cell_st),
            f"{s['scripture_top5']}/50 ({s['scripture_top1']})",
            f"{s['any_expected_echo_top5']}/50 ({s['bible_chapter_top5']}c / {s['expected_author_top5']}a)",
            f"{s['max_hub_top5']}x ({s['unique_passages_top5']})",
            str(len(s["hard_negative_violations"])),
            g09_txt,
        ])
    t = Table(rows, colWidths=[2.15 * inch, 0.95 * inch, 1.25 * inch, 1.0 * inch, 0.8 * inch, 1.15 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1a2b4c")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7.6),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f9fc")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "<b>Ordering:</b> Per handover specification, <b>G09 (forgiving a parent — canonical posture test)</b> appears first, followed by G01–G50 in order. "
        "Every model shown ran quantized phone-class weights on the identical 6,785-passage v3 subset.",
        small,
    ))
    story.append(PageBreak())

    # Order: G09 first, then G01..G50
    ordered_golden = [g for g in golden if g["id"] == "G09"] + [g for g in golden if g["id"] != "G09"]
    maps = [(lbl, {e["id"]: e for e in data}) for lbl, data in models_ordered]

    for idx, g in enumerate(ordered_golden):
        eid = g["id"]
        badge = " [CANONICAL POSTURE TEST]" if eid == "G09" else ""
        story.append(Paragraph(f"{escape(g['title'])}{badge}", h2))
        story.append(Paragraph(f"<i>\"{escape(g['journal'])}\"</i>", quote))
        exp_str = " | ".join(g["echoes"])
        story.append(Paragraph(f"<b>Expected echoes:</b> {escape(exp_str)}", small))
        if g["hard_negative"]:
            story.append(Paragraph(f"<b>Hard negative (must avoid):</b> {escape(g['hard_negative'])}", small))
        story.append(Spacer(1, 4))

        for lbl, m in maps:
            story.append(Paragraph(f"<b>{escape(lbl)}</b>", h3))
            e = m.get(eid)
            items = extract_items(e)[:5] if e else []
            if not items:
                story.append(Paragraph("<i>(no picks returned)</i>", small))
                continue
            m_rows = []
            for r_i, it in enumerate(items, 1):
                src = "Scripture" if it.get("source") == "bible" else "Witness"
                name = it.get("ref") or it["work_id"].split("__")[0].replace("-", " ").title()
                if "rerank_prob" in it:
                    sc_txt = f"P={it['rerank_prob']:.2f} (emb {it.get('score', 0):.2f})"
                elif "ce_score" in it:
                    sc_txt = f"CE={it['ce_score']:.2f}"
                else:
                    sc_txt = f"{it.get('score', 0):.4f}"
                snippet = re.sub(r"\s+", " ", it.get("text", ""))[:220]
                m_rows.append([
                    f"#{r_i}",
                    Paragraph(f"<b>[{src}] {escape(name)}</b><br/><font color='#555555'>{escape(sc_txt)}</font>", cell_st),
                    Paragraph(escape(snippet), cell_st),
                ])
            mt = Table(m_rows, colWidths=[0.32 * inch, 2.08 * inch, 4.9 * inch])
            mt.setStyle(TableStyle([
                ("FONTSIZE", (0, 0), (-1, -1), 7.4),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]))
            story.append(mt)
            story.append(Spacer(1, 3))

        if idx < len(ordered_golden) - 1:
            story.append(PageBreak())

    doc.build(story)
    print(f"wrote PDF: {out_pdf}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-pdf", required=True)
    ap.add_argument("--out-json", required=True)
    ap.add_argument("--title", default="Resonance Model Bake-Off Comparison")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--model", action="append", required=True, help="Label=path/to/json")
    args = ap.parse_args()

    golden = parse_golden_set()
    models_ordered = []
    summaries = []
    silences = {}
    for spec in args.model:
        lbl, path = spec.split("=", 1)
        data = json.loads(Path(path).read_text())
        models_ordered.append((lbl, data))
        summaries.append(evaluate_model(lbl, data, golden))
        cs = analyze_calibrated_silence(data)
        if cs:
            silences[lbl] = cs

    out_obj = {"summaries": summaries, "calibrated_silence": silences}
    Path(args.out_json).write_text(json.dumps(out_obj, indent=2))
    print(json.dumps(out_obj, indent=2))
    build_pdf(args.out_pdf, args.title, args.subtitle, models_ordered, summaries, golden)


if __name__ == "__main__":
    main()
