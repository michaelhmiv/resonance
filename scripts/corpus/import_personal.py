#!/usr/bin/env python3
"""Personal-library import (chunking-spec SS7): a user's file -> canonical units.

Reference implementation. Stdlib-first: EPUB (zip+OPF spine), HTML, TXT,
Markdown, DOCX (zip+document.xml) need no dependencies; PDF uses pypdf when
available. Output: <slug>.units.jsonl in the SS2 schema, ready for chunk_v3
assembly and on-device embedding in the app implementation.

Usage: python import_personal.py <file> [outdir]
"""
import json, re, sys, zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).parent))
from build_units import split_units, words  # reuse SS3 splitting/gates logic

BLOCK = {"p", "div", "section", "article", "li", "blockquote", "pre"}
HEADINGS = {"h1", "h2", "h3", "h4"}

class HTMLUnits(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.cur, self.tag = [], [], None
    def handle_starttag(self, tag, attrs):
        if tag in BLOCK | HEADINGS:
            self.flush(); self.tag = tag
    def handle_endtag(self, tag):
        if tag in BLOCK | HEADINGS: self.flush(); self.tag = None
    def handle_data(self, data):
        if self.tag: self.cur.append(data)
    def flush(self):
        text = " ".join(" ".join(self.cur).split())
        if text: self.blocks.append(("H" if self.tag in HEADINGS else "P", text))
        self.cur = []

def blocks_to_text(blocks):
    return "\n\n".join(t for _, t in blocks)

def extract_epub(path):
    z = zipfile.ZipFile(path)
    container = ET.fromstring(z.read("META-INF/container.xml"))
    ns = {"c": "urn:oasis:names:tc:opendocument:xmlns:container"}
    opf_path = container.find(".//c:rootfile", ns).get("full-path")
    opf = ET.fromstring(z.read(opf_path))
    ns = {"o": "http://www.idpf.org/2007/opf"}
    manifest = {i.get("id"): i.get("href") for i in opf.findall(".//o:manifest/o:item", ns)}
    base = str(Path(opf_path).parent)
    texts = []
    for itemref in opf.findall(".//o:spine/o:itemref", ns):
        href = manifest.get(itemref.get("idref"), "")
        if not href.endswith((".xhtml", ".html", ".htm")): continue
        full = f"{base}/{href}".lstrip("./") if base != "." else href
        try: raw = z.read(full).decode("utf-8", "replace")
        except KeyError: continue
        p = HTMLUnits(); p.feed(raw); p.flush()
        if p.blocks: texts.append(blocks_to_text(p.blocks))
    return "\n\n".join(texts)

def extract_docx(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paras = []
    for p in root.findall(".//w:p", ns):
        style = p.find(".//w:pStyle", ns)
        text = "".join(t.text or "" for t in p.findall(".//w:t", ns)).strip()
        if not text: continue
        is_head = style is not None and "heading" in (style.get(f"{{{ns['w']}}}val") or "").lower()
        paras.append(text.upper() if is_head else text)
    return "\n\n".join(paras)

def extract_pdf(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        raise SystemExit("PDF import needs pypdf (pip install pypdf). Scanned PDFs need OCR first (spec SS7.1).")
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        t = page.extract_text() or ""
        pages.append(t)
    if not any(p.strip() for p in pages):
        raise SystemExit("No text layer found — this looks like a scanned PDF; OCR is required before import (spec SS7.1).")
    return "\n\n".join(pages)

def extract(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".epub": return extract_epub(path)
    if ext == ".docx": return extract_docx(path)
    if ext == ".pdf": return extract_pdf(path)
    if ext in (".html", ".htm"):
        p = HTMLUnits(); p.feed(path.read_text(errors="replace")); p.flush()
        return blocks_to_text(p.blocks)
    if ext in (".txt", ".md", ".markdown"): return path.read_text(errors="replace")
    raise SystemExit(f"Unsupported format: {ext} (supported: epub, pdf, docx, html, txt, md)")

def main():
    src = Path(sys.argv[1])
    outdir = Path(sys.argv[2]) if len(sys.argv) > 2 else src.parent
    slug = re.sub(r"[^a-z0-9]+", "-", src.stem.lower()).strip("-")
    wid = f"personal:{slug}"
    text = extract(src)
    units = []
    for division, kind, utext in split_units(text):
        units.append({"work_id": wid, "author": None, "source": "personal",
                      "division": division, "kind": kind, "seq": len(units),
                      "text": utext, "words": words(utext)})
    out = outdir / f"{slug}.units.jsonl"
    with out.open("w") as fh:
        for u in units: fh.write(json.dumps(u) + "\n")
    print(f"{src.name}: {len(units):,} units -> {out} (feed through chunk_v3 assembly + embedding)")

if __name__ == "__main__":
    main()
