#!/usr/bin/env python3
"""Build pre-embedded 512d int8 Resonance corpus packs for GitHub Releases.

Embeds `corpus/chunks_v3.jsonl` using the exact pinned `Voyage-4-Nano` INT8 ONNX
model (`onnx-community/voyage-4-nano-ONNX`, commit fb6f32cceb63b6eac92e1fdc08e00d03c41cdf5a),
MRL-slices to 512d, L2-normalizes, and symmetrically quantizes per-vector into
`int8` (`RVEC` v1 binary format matching `packages/core/src/embedding.ts`).

Assembles:
  - Core Bible pack (`bible-web.passages.jsonl.gz` + `bible-web.vectors.rvec`, ~4.2 MB)
  - Individual per-work Church Library assets (`work_<slug>.passages.jsonl.gz` +
    `work_<slug>.vectors.rvec`, typically 50 KB–2 MB each) grouped into 4 curated
    collections in `packs-manifest.json` so users can cherry-pick individual books
    or whole collections without downloading all 80 works at once.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import struct
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

VOYAGE_REPO = "onnx-community/voyage-4-nano-ONNX"
VOYAGE_SHA = "fb6f32cceb63b6eac92e1fdc08e00d03c41cdf5a"
EMBEDDING_DIM = 512
RVEC_MAGIC = b"RVEC"
RVEC_VERSION = 1
RVEC_QUANT_INT8 = 1

# ── Curated Collections & Author/Title Metadata ────────────────────────────

COLLECTIONS: list[dict[str, str]] = [
    {
        "id": "church-fathers",
        "label": "The Church Fathers",
        "era": "1st–8th c.",
        "description": "Augustine, Athanasius, Chrysostom, Basil, Ambrose, Gregory the Great, John Cassian, and the Desert Fathers.",
    },
    {
        "id": "medieval-mystics",
        "label": "Medieval & Contemplative Voices",
        "era": "12th–17th c.",
        "description": "Thomas à Kempis, John of the Cross, Teresa of Avila, Brother Lawrence, Bernard of Clairvaux, Fénelon, and Francis de Sales.",
    },
    {
        "id": "reformation-puritans",
        "label": "Reformation & Devotional Classics",
        "era": "16th–18th c.",
        "description": "Luther, Calvin, Bunyan, Richard Baxter, Jonathan Edwards, John Donne, Thomas Traherne, and William Law.",
    },
    {
        "id": "modern-witnesses",
        "label": "Modern Witnesses",
        "era": "19th–20th c.",
        "description": "G.K. Chesterton, George MacDonald, E.M. Bounds, and Samuel Rutherford.",
    },
]

# Explicit curated metadata (title, author, era, collectionId) keyed by work_id
WORK_CATALOG_META: dict[str, tuple[str, str, str, str]] = {
    # Church Fathers
    "the-confessions-of-st-augustin__st-augustine-the-confessions-and-letters-of-st-augustine-with-a-sketch-of-his-life-and-work": ("Confessions & Letters", "Augustine of Hippo", "4th–5th c.", "church-fathers"),
    "the-city-of-god__npnf1-02-st-augustine-city-of-god-and-christian-doctrine": ("City of God & Christian Doctrine", "Augustine of Hippo", "5th c.", "church-fathers"),
    "the-city-of-god-de-civitate-dei__cityofgoddecivit0000augu": ("The City of God (De Civitate Dei)", "Augustine of Hippo", "5th c.", "church-fathers"),
    "our-lord-s-sermon-on-the-mount__npnf-1-06-st-augustine-sermon-on-the-mount-harmony-of-the-gospels-homilies-on-the-gospels": ("Sermon on the Mount & Gospel Homilies", "Augustine of Hippo", "4th–5th c.", "church-fathers"),
    "a-treatise-on-faith-and-the-creed__st-augustine-on-the-holy-trinity-doctrinal-treatises-moral-treatises": ("On the Holy Trinity & Moral Treatises", "Augustine of Hippo", "4th–5th c.", "church-fathers"),
    "a-treatise-concerning-man-s-perfection-in-righteousness__saint-augustin-s-anti-pelagian-works": ("Anti-Pelagian Writings", "Augustine of Hippo", "5th c.", "church-fathers"),
    "letters__letters0001augu": ("Letters of St. Augustine", "Augustine of Hippo", "4th–5th c.", "church-fathers"),
    "select-writings-and-letters-of-athanasius-bishop-of-alexandria__npnf2-04-athanasius-select-works-and-letters": ("Select Writings & Letters", "Athanasius of Alexandria", "4th c.", "church-fathers"),
    "the-life-of-antony__the-life-of-antony-by-saint-athanasius-of-alexandria": ("The Life of Antony", "Athanasius of Alexandria", "4th c.", "church-fathers"),
    "an-exhortation-to-theodore-after-his-fall__st-chrysostom-on-the-priesthood-ascetic-treatises-select-homilies-and-letters-homilies-on-the-statutes": ("On the Priesthood, Homilies & Letters", "John Chrysostom", "4th c.", "church-fathers"),
    "on-the-priesthood-in-six-books__onpriesthood00unkngoog": ("On the Priesthood (Six Books)", "John Chrysostom", "4th c.", "church-fathers"),
    "the-treatise-de-spiritu-sancto__npnf2-08-basil-letters-and-select-works": ("On the Holy Spirit & Letters", "Basil the Great", "4th c.", "church-fathers"),
    "the-nine-homilies-of-the-hexaemeron__st-basillettersandselectedworks": ("Nine Homilies of the Hexaemeron", "Basil the Great", "4th c.", "church-fathers"),
    "concerning-repentance__npnf2-10-ambrose-selected-works-and-letters": ("Selected Works & Letters", "Ambrose of Milan", "4th c.", "church-fathers"),
    "de-trinitate__npnf2-09-hilary-of-poitiers-john-of-damascus": ("On the Trinity & Orthodox Faith", "Hilary of Poitiers & John of Damascus", "4th–8th c.", "church-fathers"),
    "st-john-damascene-on-holy-images-followed-by-three-sermons-on-the-assumption__stjohndamasceneo00john": ("On Holy Images & Sermons", "John of Damascus", "8th c.", "church-fathers"),
    "register-of-the-epistles-of-saint-gregory-the-great__npnf2-12-leo-the-great-gregory-the-great": ("Epistles & Pastoral Rule", "Leo the Great & Gregory the Great", "5th–6th c.", "church-fathers"),
    "nineteen-hymns-on-the-nativity-of-christ-in-the-flesh__npnf2-13-gregory-the-great-ii-ephraim-syrus-aphrahat": ("Hymns & Demonstrations", "Ephrem the Syrian, Aphrahat & Gregory", "4th–6th c.", "church-fathers"),
    "the-conferences-of-john-cassian__npnf2-11-sulpitius-severus-vincent-of-lerins-john-cassian": ("Conferences & Commonitory", "John Cassian, Vincent & Sulpitius", "5th c.", "church-fathers"),
    "desert-fathers-paradise-budge": ("The Paradise of the Desert Fathers", "Desert Fathers (tr. E.A.W. Budge)", "4th–5th c.", "church-fathers"),
    "the-epistle-concerning-the-martyrdom-of-polycarp__anfo1-the-apostolic-fathers-with-justin-martyr-and-irenaeus": ("The Apostolic Fathers, Justin & Irenaeus", "Polycarp, Ignatius, Justin & Irenaeus", "1st–2nd c.", "church-fathers"),
    "the-church-history-of-eusebius__npnf2-01-eusebius-pamphilius-church-history-life-of-constantine-oration-in-praise-of-constantine": ("Church History", "Eusebius of Caesarea", "4th c.", "church-fathers"),
    "jerome-and-gennadius-lives-of-illustrious-men__theodoret-jerome-gennadius-rufinus-historical-writings": ("Historical Writings & Lives", "Jerome, Theodoret & Rufinus", "4th–5th c.", "church-fathers"),
    "the-philocalia-of-origen__thephilocaliaofo00origuoft": ("The Philocalia of Origen", "Origen (ed. Basil & Gregory)", "3rd c.", "church-fathers"),
    "dionysius-the-areopagite-on-the-divine-names-and-the-mystical-theology__dionysiusareopag00pseu": ("On the Divine Names & Mystical Theology", "Pseudo-Dionysius the Areopagite", "5th–6th c.", "church-fathers"),
    "in-trullo__npnf2-14-the-seven-ecumenical-councils": ("The Seven Ecumenical Councils", "Early Church Councils", "4th–8th c.", "church-fathers"),
    "barlaam-and-ioasaph": ("Barlaam and Ioasaph", "Attributed to John of Damascus", "8th c.", "church-fathers"),
    "acts-of-the-holy-apostles-peter-and-paul__the-t-twelve-patriarchs-excerpts-and-epistles-the-clementia-apocrypha-decretals-memoirs-of-edessa-and-syriac-documents-remains-of-the-first-age": ("Early Syriac & Ante-Nicene Writings", "Ante-Nicene Fathers (Vol. VIII)", "2nd–3rd c.", "church-fathers"),
    "acts-of-paul-and-thecla__contents-1057": ("Acts of Paul and Thecla", "Early Christian Anthology", "2nd c.", "church-fathers"),
    "the-narrative-of-joseph-of-arimathaea__jamesapocryphalnewtestament1924": ("Early Christian Narratives (M.R. James)", "Early Church Anthology", "2nd–4th c.", "church-fathers"),

    # Medieval & Contemplative Voices
    "kempis-imitation-of-christ": ("The Imitation of Christ", "Thomas à Kempis", "15th c.", "medieval-mystics"),
    "brother-lawrence-practice": ("The Practice of the Presence of God", "Brother Lawrence", "17th c.", "medieval-mystics"),
    "john-of-the-cross-dark-night": ("Dark Night of the Soul", "John of the Cross", "16th c.", "medieval-mystics"),
    "the-ascent-of-mount-carmel__ascentofmountcar00johnuoft": ("The Ascent of Mount Carmel", "John of the Cross", "16th c.", "medieval-mystics"),
    "a-spiritual-canticle-of-the-soul-and-the-bridegroom-christ__spiritualcanticl0000john": ("A Spiritual Canticle of the Soul", "John of the Cross", "16th c.", "medieval-mystics"),
    "the-living-flame-of-love__johnofthecross00johnuoft": ("The Living Flame of Love", "John of the Cross", "16th c.", "medieval-mystics"),
    "teresa-interior-castle": ("The Interior Castle", "Teresa of Avila", "16th c.", "medieval-mystics"),
    "the-way-of-perfection__thewayofperfecti00tereuoft": ("The Way of Perfection", "Teresa of Avila", "16th c.", "medieval-mystics"),
    "the-book-of-the-foundations-of-s-teresa-of-jesus-of-the-order-of-our-lady-of-carmel__bookoffoundation00tereuoft": ("The Book of the Foundations", "Teresa of Avila", "16th c.", "medieval-mystics"),
    "the-life-of-saint-teresa-of-jesus-of-the-order-of-our-lady-of-carmel__the-life-of-saint-teresa-of-jesus-by-herself": ("The Life of St. Teresa of Jesus", "Teresa of Avila", "16th c.", "medieval-mystics"),
    "autobiography-life": ("Autobiography of St. Teresa (Gutenberg)", "Teresa of Avila", "16th c.", "medieval-mystics"),
    "on-loving-god-by-st-bernard-of-clairvaux__on-loving-god-by-saint-bernard-of-clairvaux": ("On Loving God", "Bernard of Clairvaux", "12th c.", "medieval-mystics"),
    "on-consideration__onconsideration00bern": ("On Consideration", "Bernard of Clairvaux", "12th c.", "medieval-mystics"),
    "the-scale-of-perfection__scaleofperfectio0000walt-c0h2": ("The Scale of Perfection", "Walter Hilton", "14th c.", "medieval-mystics"),
    "the-history-and-life-of-the-reverend-doctor-john-tauler-of-strasbourg-with-twenty-five-of-his-sermons__historyandlifer01kinggoog": ("History, Life & Twenty-Five Sermons", "Johannes Tauler", "14th c.", "medieval-mystics"),
    "the-life-of-blessed-henry-suso-by-himself__the-life-of-blessed-henry-suso-by-himself": ("The Life of Blessed Henry Suso", "Henry Suso", "14th c.", "medieval-mystics"),
    "ruysbroeck-and-the-mystics": ("Ruysbroeck and the Mystics", "Jan van Ruysbroeck", "14th c.", "medieval-mystics"),
    "the-life-of-st-francis-of-assisi-from-the-legenda-santa-francisci-of-st-bonaventura__lifeofstfranciso00bona": ("The Life of St. Francis of Assisi", "Bonaventure", "13th c.", "medieval-mystics"),
    "the-spiritual-conferences": ("The Spiritual Conferences", "Francis de Sales", "17th c.", "medieval-mystics"),
    "ignatius-spiritual-exercises": ("Spiritual Exercises", "Ignatius of Loyola", "16th c.", "medieval-mystics"),
    "abandonment-to-divine-providence": ("Abandonment to Divine Providence", "Jean-Pierre de Caussade", "18th c.", "medieval-mystics"),
    "fenelon-spiritual-letters": ("Spiritual Letters", "François Fénelon", "17th c.", "medieval-mystics"),

    # Reformation & Devotional Classics
    "large-catechism": ("The Large Catechism", "Martin Luther", "16th c.", "reformation-puritans"),
    "institutes-of-the-christian-religion__institutesofchri0000john-q1s5": ("Institutes of the Christian Religion", "John Calvin", "16th c.", "reformation-puritans"),
    "grace-abounding-to-the-chief-of-sinners__bwb-t3-cbt-732": ("Grace Abounding to the Chief of Sinners", "John Bunyan", "17th c.", "reformation-puritans"),
    "the-holy-war__holywar0000unse-e0t4": ("The Holy War", "John Bunyan", "17th c.", "reformation-puritans"),
    "the-reformed-pastor-a-discourse-on-the-pastoral-office__reformedpastor00baxtgoog": ("The Reformed Pastor", "Richard Baxter", "17th c.", "reformation-puritans"),
    "a-call-to-the-unconverted-to-turn-and-live__acalltounconver01baxtgoog": ("A Call to the Unconverted", "Richard Baxter", "17th c.", "reformation-puritans"),
    "a-treatise-concerning-religious-affections-in-three-parts__atreatiseconcer00edwagoog": ("Religious Affections", "Jonathan Edwards", "18th c.", "reformation-puritans"),
    "freedom-of-the-will__freedomofwill0000revj": ("Freedom of the Will", "Jonathan Edwards", "18th c.", "reformation-puritans"),
    "devotions-by-j-donne-with-two-sermons__devotionsbyjdon00donngoog": ("Devotions Upon Emergent Occasions", "John Donne", "17th c.", "reformation-puritans"),
    "letters-to-severall-persons-of-honour__letterstosevera00donngoog": ("Letters to Several Persons of Honour", "John Donne", "17th c.", "reformation-puritans"),
    "centuries-of-meditations__centuriesmedita00trahgoog": ("Centuries of Meditations", "Thomas Traherne", "17th c.", "reformation-puritans"),
    "a-serious-call-to-a-devout-and-holy-life__aseriouscalltoa01lawgoog": ("A Serious Call to a Devout and Holy Life", "William Law", "18th c.", "reformation-puritans"),
    "a-practical-treatise-upon-christian-perfection__apracticaltreat01lawgoog": ("A Practical Treatise Upon Christian Perfection", "William Law", "18th c.", "reformation-puritans"),
    "selections-from-the-epistles-of-george-fox__selectionsfrome00tukegoog": ("Selections from the Epistles", "George Fox", "17th c.", "reformation-puritans"),
    "letters-vol-1-2": ("Letters of Samuel Rutherford", "Samuel Rutherford", "17th c.", "reformation-puritans"),

    # Modern Witnesses
    "orthodoxy": ("Orthodoxy", "G.K. Chesterton", "20th c.", "modern-witnesses"),
    "heretics": ("Heretics", "G.K. Chesterton", "20th c.", "modern-witnesses"),
    "the-everlasting-man": ("The Everlasting Man", "G.K. Chesterton", "20th c.", "modern-witnesses"),
    "st-francis-of-assisi": ("St. Francis of Assisi", "G.K. Chesterton", "20th c.", "modern-witnesses"),
    "what-s-wrong-with-the-world": ("What's Wrong with the World", "G.K. Chesterton", "20th c.", "modern-witnesses"),
    "unspoken-sermons-first-third-series__unspokensermonsf0000macd": ("Unspoken Sermons (Series I–III)", "George MacDonald", "19th c.", "modern-witnesses"),
    "the-hope-of-the-gospel__hopeofgospel00macd": ("The Hope of the Gospel", "George MacDonald", "19th c.", "modern-witnesses"),
    "phantastes-a-faerie-romance__phantastesfaerie0000geor-j1t6": ("Phantastes", "George MacDonald", "19th c.", "modern-witnesses"),
    "power-through-prayer": ("Power Through Prayer", "E.M. Bounds", "19th c.", "modern-witnesses"),
    "preacher-and-prayer": ("Preacher and Prayer", "E.M. Bounds", "19th c.", "modern-witnesses"),
    "purpose-in-prayer": ("Purpose in Prayer", "E.M. Bounds", "20th c.", "modern-witnesses"),
    "selections-from-the-writings": ("Selections from the Writings", "Public Domain Anthology", "19th c.", "modern-witnesses"),
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def safe_slug(work_id: str) -> str:
    base = work_id.split("__")[0]
    slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")
    if len(slug) > 48:
        h = hashlib.sha1(work_id.encode("utf-8")).hexdigest()[:6]
        slug = f"{slug[:41].rstrip('-')}-{h}"
    return slug


def metadata_for_work(work_id: str) -> tuple[str, str, str, str]:
    if work_id in WORK_CATALOG_META:
        return WORK_CATALOG_META[work_id]
    title = work_id.split("__")[0].replace("-", " ").title()
    return (title, "", "Classic", "modern-witnesses")


def write_rvec(path: Path, vectors_int8, scales_f32) -> None:
    """Write RVEC v1 binary file matching `parseRvec` in @resonance/core."""
    import numpy as np

    vecs = np.ascontiguousarray(vectors_int8, dtype=np.int8)
    scales = np.ascontiguousarray(scales_f32, dtype="<f4")
    count, dim = vecs.shape
    assert scales.shape == (count,), f"scales shape {scales.shape} != ({count},)"
    header = struct.pack("<4sBBHII", RVEC_MAGIC, RVEC_VERSION, RVEC_QUANT_INT8, dim, count, 0)
    with path.open("wb") as fh:
        fh.write(header)
        fh.write(scales.tobytes())
        fh.write(vecs.tobytes())


def quantize_int8_512(vecs_f32):
    """MRL-slice to 512d, L2-normalize, and symmetrically quantize per-vector int8."""
    import numpy as np

    sliced = np.asarray(vecs_f32[:, :EMBEDDING_DIM], dtype=np.float32)
    norms = np.linalg.norm(sliced, axis=1, keepdims=True)
    norms = np.where(norms > 1e-12, norms, 1.0)
    unit = sliced / norms

    max_abs = np.max(np.abs(unit), axis=1)
    scales = np.where(max_abs > 1e-12, max_abs / 127.0, 1.0).astype(np.float32)
    inv = np.where(max_abs > 1e-12, 127.0 / max_abs, 0.0)[:, None]
    q = np.clip(np.rint(unit * inv), -127, 127).astype(np.int8)
    return q, scales


def load_chunks(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def format_doc(chunk: dict[str, Any]) -> str:
    if chunk.get("source") == "bible":
        title = f"Bible — {chunk.get('chunk_id', '')}"
    else:
        wid = chunk["work_id"].split("__")[0].replace("-", " ").title()
        div = (chunk.get("division") or "").strip()
        title = f"{wid} — {div[:80]}" if div else wid
    return f"Represent the document for retrieval: [{title}]\n{chunk['text']}"


def cmd_embed_shard(args: argparse.Namespace) -> None:
    import shutil
    import numpy as np
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from transformers import AutoTokenizer

    rows = load_chunks(Path(args.chunks))
    n = len(rows)
    shard = args.shard
    num_shards = args.num_shards
    start = (n * shard) // num_shards
    end = (n * (shard + 1)) // num_shards
    sub = rows[start:end]
    print(f"[shard {shard}/{num_shards}] embedding rows [{start}:{end}] ({len(sub):,} chunks)", flush=True)

    model_dir = Path("/tmp/model_voyage_4_nano")
    model_dir.mkdir(parents=True, exist_ok=True)
    for fn in ("onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data"):
        dst = model_dir / Path(fn).name
        if not dst.exists():
            shutil.copy(hf_hub_download(VOYAGE_REPO, filename=fn, revision=VOYAGE_SHA), dst)

    tokenizer = AutoTokenizer.from_pretrained(VOYAGE_REPO, revision=VOYAGE_SHA)

    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_opts.intra_op_num_threads = args.threads
    sess = ort.InferenceSession(
        str(model_dir / "model_quantized.onnx"),
        sess_options=sess_opts,
        providers=["CPUExecutionProvider"],
    )
    input_names = [i.name for i in sess.get_inputs()]
    output_names = [o.name for o in sess.get_outputs()]
    print(f"loaded voyage-4-nano inputs={input_names} outputs={output_names}", flush=True)

    order = sorted(range(len(sub)), key=lambda i: len(sub[i]["text"]))
    out_q = np.zeros((len(sub), EMBEDDING_DIM), dtype=np.int8)
    out_s = np.zeros((len(sub),), dtype=np.float32)

    batch_size = args.batch_size
    t0 = time.time()
    for b_start in range(0, len(order), batch_size):
        idxs = order[b_start : b_start + batch_size]
        texts = [format_doc(sub[i]) for i in idxs]
        enc = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="np",
        )
        ids = enc["input_ids"].astype(np.int64)
        mask = enc["attention_mask"].astype(np.int64)

        feeds: dict[str, Any] = {}
        for name in input_names:
            if name == "input_ids":
                feeds[name] = ids
            elif name == "attention_mask":
                feeds[name] = mask
            elif name == "token_type_ids":
                feeds[name] = enc.get("token_type_ids", np.zeros_like(ids)).astype(np.int64)
            elif name == "position_ids":
                feeds[name] = np.maximum(np.cumsum(mask, axis=1) - 1, 0).astype(np.int64)

        outs = sess.run(output_names, feeds)
        out_map = dict(zip(output_names, outs))
        if "pooler_output" in out_map and out_map["pooler_output"].ndim == 2:
            pooled = out_map["pooler_output"]
        elif outs[0].ndim == 3:
            m = mask[:, :, None].astype(np.float32)
            pooled = (outs[0] * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-6)
        else:
            pooled = outs[0]

        q, s = quantize_int8_512(pooled)
        for j, orig_i in enumerate(idxs):
            out_q[orig_i] = q[j]
            out_s[orig_i] = s[j]

        done = b_start + len(idxs)
        if done % 1000 < batch_size or done == len(order):
            dt = max(time.time() - t0, 1e-3)
            print(f"  [{shard}] {done:,}/{len(order):,} ({done/dt:.1f} chunks/s)", flush=True)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / f"shard_{shard:02d}_q.npy", out_q)
    np.save(out_dir / f"shard_{shard:02d}_s.npy", out_s)
    meta = {"shard": shard, "num_shards": num_shards, "start": start, "end": end, "count": len(sub)}
    (out_dir / f"shard_{shard:02d}_meta.json").write_text(json.dumps(meta, indent=2))
    print(f"[shard {shard}] saved {len(sub):,} int8 512d vectors")


def cmd_assemble(args: argparse.Namespace) -> None:
    import numpy as np

    rows = load_chunks(Path(args.chunks))
    shards_dir = Path(args.shards_dir)
    meta_files = sorted(shards_dir.rglob("shard_*_meta.json"))
    if not meta_files:
        raise SystemExit(f"No shard metadata files found in {shards_dir}")

    # Deduplicate & sort shards by shard index
    by_shard: dict[int, tuple[dict[str, Any], Path]] = {}
    for mf in meta_files:
        m = json.loads(mf.read_text())
        by_shard[int(m["shard"])] = (m, mf.parent)

    all_q_parts = []
    all_s_parts = []
    expected_start = 0
    for idx in sorted(by_shard.keys()):
        m, parent = by_shard[idx]
        if m["start"] != expected_start:
            raise SystemExit(f"Shard gap/overlap at shard {idx}: expected start {expected_start}, got {m['start']}")
        expected_start = m["end"]
        all_q_parts.append(np.load(parent / f"shard_{idx:02d}_q.npy"))
        all_s_parts.append(np.load(parent / f"shard_{idx:02d}_s.npy"))

    if expected_start != len(rows):
        raise SystemExit(f"Total shard rows {expected_start} != chunks_v3 rows {len(rows)}")

    all_q = np.concatenate(all_q_parts, axis=0)
    all_s = np.concatenate(all_s_parts, axis=0)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    base_url = f"https://github.com/{args.repo}/releases/download/{args.release_tag}"

    # 1. Core Bible pack (`bible-web`, ~4.2 MB)
    bible_idxs = [
        i for i, r in enumerate(rows)
        if r.get("source") == "bible" or r.get("work_id") == "web"
    ]
    manifest_packs = []
    if bible_idxs:
        p_path = out_dir / "bible-web.passages.jsonl.gz"
        v_path = out_dir / "bible-web.vectors.rvec"
        with gzip.open(p_path, "wt", encoding="utf-8", compresslevel=6) as gz:
            for pos, row_idx in enumerate(bible_idxs):
                r = rows[row_idx]
                gz.write(
                    json.dumps(
                        {
                            "work_id": "web",
                            "division": r.get("division"),
                            "chunk_index": pos,
                            "text": r["text"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        write_rvec(v_path, all_q[bible_idxs], all_s[bible_idxs])
        manifest_packs.append(
            {
                "id": "bible-web",
                "label": "World English Bible (512d vectors)",
                "description": "Scripture passages pre-embedded with Voyage-4-Nano INT8.",
                "version": args.version,
                "kind": "bible",
                "workCount": 66,
                "passageCount": len(bible_idxs),
                "dim": EMBEDDING_DIM,
                "quantization": "int8",
                "modelId": "voyage-4-nano",
                "passagesUrl": f"{base_url}/{p_path.name}",
                "passagesBytes": p_path.stat().st_size,
                "passagesSha256": sha256_file(p_path),
                "vectorsUrl": f"{base_url}/{v_path.name}",
                "vectorsBytes": v_path.stat().st_size,
                "vectorsSha256": sha256_file(v_path),
            }
        )
        print(
            f"[pack bible-web] {len(bible_idxs):,} passages | "
            f"text={p_path.stat().st_size/1e6:.2f} MB | rvec={v_path.stat().st_size/1e6:.2f} MB"
        )

    # 2. Individual per-work Church Library assets grouped into curated collections
    work_indices: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rows):
        if r.get("source") == "bible" or r.get("work_id") == "web":
            continue
        work_indices[r["work_id"]].append(i)

    used_slugs: set[str] = set()
    manifest_works = []
    collection_work_ids: dict[str, list[str]] = defaultdict(list)
    collection_passages: dict[str, int] = defaultdict(int)
    collection_bytes: dict[str, int] = defaultdict(int)

    for wid in sorted(work_indices.keys()):
        idxs = work_indices[wid]
        title, author, era, col_id = metadata_for_work(wid)
        slug = safe_slug(wid)
        if slug in used_slugs:
            slug = f"{slug}-{hashlib.sha1(wid.encode()).hexdigest()[:5]}"
        used_slugs.add(slug)

        p_path = out_dir / f"work_{slug}.passages.jsonl.gz"
        v_path = out_dir / f"work_{slug}.vectors.rvec"

        with gzip.open(p_path, "wt", encoding="utf-8", compresslevel=6) as gz:
            for pos, row_idx in enumerate(idxs):
                r = rows[row_idx]
                gz.write(
                    json.dumps(
                        {
                            "division": r.get("division"),
                            "chapter": 1,
                            "chunk_index": pos,
                            "text": r["text"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        write_rvec(v_path, all_q[idxs], all_s[idxs])

        p_bytes = p_path.stat().st_size
        v_bytes = v_path.stat().st_size

        manifest_works.append(
            {
                "id": wid,
                "slug": slug,
                "title": title,
                "author": author,
                "era": era,
                "collectionId": col_id,
                "passageCount": len(idxs),
                "passagesUrl": f"{base_url}/{p_path.name}",
                "passagesBytes": p_bytes,
                "passagesSha256": sha256_file(p_path),
                "vectorsUrl": f"{base_url}/{v_path.name}",
                "vectorsBytes": v_bytes,
                "vectorsSha256": sha256_file(v_path),
            }
        )
        collection_work_ids[col_id].append(wid)
        collection_passages[col_id] += len(idxs)
        collection_bytes[col_id] += p_bytes + v_bytes

    manifest_works.sort(key=lambda w: (w["collectionId"], w["author"], w["title"]))

    manifest_collections = []
    for col in COLLECTIONS:
        cid = col["id"]
        manifest_collections.append(
            {
                "id": cid,
                "label": col["label"],
                "era": col["era"],
                "description": col["description"],
                "workIds": collection_work_ids.get(cid, []),
                "passageCount": collection_passages.get(cid, 0),
                "totalBytes": collection_bytes.get(cid, 0),
            }
        )

    manifest = {
        "schemaVersion": 2,
        "releaseTag": args.release_tag,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "modelId": "voyage-4-nano",
        "modelRepo": VOYAGE_REPO,
        "modelCommitSha": VOYAGE_SHA,
        "dim": EMBEDDING_DIM,
        "quantization": "int8",
        "packs": manifest_packs,
        "collections": manifest_collections,
        "works": manifest_works,
    }
    manifest_path = out_dir / "packs-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Assembled {len(manifest_works)} individual Church works across "
        f"{len(manifest_collections)} collections + bible-web -> {manifest_path}"
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Build 512d int8 Resonance corpus packs")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_sh = sub.add_parser("embed-shard")
    p_sh.add_argument("--chunks", default="corpus/chunks_v3.jsonl")
    p_sh.add_argument("--shard", type=int, required=True)
    p_sh.add_argument("--num-shards", type=int, default=16)
    p_sh.add_argument("--batch-size", type=int, default=32)
    p_sh.add_argument("--threads", type=int, default=4)
    p_sh.add_argument("--out-dir", required=True)

    p_as = sub.add_parser("assemble")
    p_as.add_argument("--chunks", default="corpus/chunks_v3.jsonl")
    p_as.add_argument("--shards-dir", required=True)
    p_as.add_argument("--out-dir", required=True)
    p_as.add_argument("--repo", default="michaelhmiv/resonance")
    p_as.add_argument("--release-tag", default="corpus-packs-latest")
    p_as.add_argument("--version", default="1.0.0")

    args = p.parse_args()
    if args.cmd == "embed-shard":
        cmd_embed_shard(args)
    else:
        cmd_assemble(args)


if __name__ == "__main__":
    main()
