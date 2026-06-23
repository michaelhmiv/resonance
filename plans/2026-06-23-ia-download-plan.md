# Resonance IA download plan

## Goal
Build a **modular offline corpus** for Resonance without bloating the base app and without downloading duplicate titles.

This plan assumes:
- public-domain source texts may be hosted online or shipped as packs
- user journal / prompt data stays local
- the base app ships only a small starter set
- additional content arrives as **downloadable offline packs**

## Non-negotiable dedupe rules

1. **One canonical work family per title.**
   - Do **not** download multiple editions of the same work unless there is a clear OCR / translation reason.
   - Example: if *Confessions* is already local, do not grab another *Confessions* edition just because IA has it.

2. **Prefer one edition per canonical work.**
   - Normalize by:
     - author
     - work family
     - language
     - translation family
   - This prevents edition spam like `The imitation of Christ`, `Of the Imitation of Christ`, `The Imitation ... 1584`, etc.

3. **Treat omnibus files as source material, not final packs.**
   - The current `church_fathers_complete.txt` should be split and indexed before any new Church Fathers downloads are added.
   - If a work already exists inside the omnibus, prefer extracting / chunking it over downloading the same work again.

4. **No duplicate pack content.**
   - A work belongs to exactly one pack.
   - If a title is already present locally, it should only be re-downloaded if the new edition is materially better.

## Current local anchors to protect

Do not re-download these unless a specific edition upgrade is justified:
- `augustine_confessions.txt`
- `aquinas_summa_theologica.txt`
- `teresa_interior_castle.txt`
- `john_of_the_cross_dark_night.txt`
- `john_of_the_cross_spiritual_canticle.txt`
- `bernard_life_and_works.txt`
- `bernard_sermons_canticle.txt`
- `francis_de_sales_practical_piety.txt`
- `bunyan_pilgrims_progress.txt`
- `bonaventure_breviloquium.txt`
- `julian_of_norwich_revelations.txt`
- `kempis_imitation.txt`
- `pascal_pensees.txt`
- `kierkegaard_hauptschriften.txt`
- `brother_lawrence_practice.txt`
- `cloud_of_unknowing.txt`
- `catherine_siena_letters.txt`
- `church_fathers_complete.txt` (split first, then dedupe)

## Download strategy

### Phase 0 — Normalize the current corpus
Before adding anything new:
1. Build a canonical manifest from the current local files.
2. Split the big Church Fathers omnibus into indexed chunks / work families.
3. Record each chunk’s canonical key so it can block duplicates later.
4. Mark already-downloaded works as “locked” unless a clearly better edition exists.

### Phase 1 — High-value first-wave packs
These are the best next downloads because they add breadth, not just duplicate editions.

#### Pack A — Augustine / Aquinas / Bernard / Bonaventure
| Author | Canonical works to download |
|---|---|
| Augustine | *The City of God*; *On Christian Doctrine*; *On the Trinity*; *Letters* or *selected letters* |
| Thomas Aquinas | *Summa Contra Gentiles*; *On Kingship*; *On Being and Essence*; *Compendium of Theology* |
| Bernard of Clairvaux | *On Loving God*; *On Consideration*; *Life of St. Malachy* |
| Bonaventure | *The Mind’s Road to God*; *The Tree of Life*; *Life of St. Francis* |

#### Pack B — Mystics / contemplatives
| Author | Canonical works to download |
|---|---|
| Teresa of Ávila | *The Way of Perfection*; *The Book of Her Life*; *The Book of Foundations* |
| John of the Cross | *Ascent of Mount Carmel*; *The Living Flame of Love*; *Sayings of Light and Love* |
| Julian of Norwich | only if a better edition than the current one appears; otherwise hold |
| Walter Hilton | *The Scale of Perfection* |
| Richard Rolle | *The Fire of Love*; *The Mending of Life*; *The Pricke of Conscience* |
| Johannes Tauler | *Sermons* / selected sermons |
| Henry Suso | *The Life of Blessed Henry Suso*; *The Little Book of Eternal Wisdom* |
| Jan van Ruusbroec | *The Adornment of the Spiritual Marriage* / selected works |

#### Pack C — Protestant / Reformation classics
| Author | Canonical works to download |
|---|---|
| John Bunyan | *Grace Abounding to the Chief of Sinners*; *The Holy War*; *Mr. Badman* |
| Jonathan Edwards | *Religious Affections*; *Freedom of the Will*; *The End for Which God Created the World* |
| John Wesley | *Sermons*; *Journal*; *Notes on the New Testament* |
| Richard Baxter | *A Call to the Unconverted*; *The Reformed Pastor*; *The Saints’ Everlasting Rest* |
| John Owen | *Pneumatologia*; *The Mortification of Sin*; *The Glory of Christ* |
| Martin Luther | *Small Catechism*; *Large Catechism*; *The Freedom of a Christian*; *Table Talk* |
| John Calvin | *Institutes of the Christian Religion*; *Commentary on Romans*; *Letters* |
| William Law | *A Serious Call to a Devout and Holy Life*; *The Spirit of Love*; *Christian Perfection* |

#### Pack D — Devotional / poetic / modern spirituals
| Author | Canonical works to download |
|---|---|
| Francis de Sales | *Introduction to the Devout Life*; *Treatise on the Love of God*; *Spiritual Conferences* |
| Thomas à Kempis | keep the current *Imitation of Christ*; only add a better edition if OCR is clearly superior |
| Brother Lawrence | keep current *Practice of the Presence of God*; only add a better edition if clearly needed |
| George Herbert | *The Temple*; *The Country Parson*; *Outlandish Proverbs* |
| John Donne | *Devotions upon Emergent Occasions*; selected sermons; selected poems |
| Henry Vaughan | *Sacred Poems*; *Silex Scintillans* |
| Thomas Traherne | *Centuries of Meditations*; *Poetical Works* |
| Blaise Pascal | *Provincial Letters*; *Pensées* (skip if current edition is sufficient) |
| Søren Kierkegaard | *Fear and Trembling*; *Works of Love*; *The Sickness Unto Death*; *Practice in Christianity* |
| G.K. Chesterton | *Orthodoxy*; *Heretics*; *The Everlasting Man*; *St. Francis of Assisi* |
| George MacDonald | *Unspoken Sermons*; *Lilith*; *Phantastes* |
| George Fox | *Journal*; *Epistles* / selected writings |
| Thérèse of Lisieux | *Story of a Soul*; *Thoughts of Saint Thérèse* |

### Phase 2 — Church Fathers cleanup pack
Use IA to fill gaps that the current omnibus does not cover cleanly, but only after splitting the omnibus.

Priority authors:
- Clement of Alexandria
- Tertullian
- Origen
- Justin Martyr
- Gregory of Nazianzus
- Gregory of Nyssa
- John Chrysostom
- Augustine
- John of Damascus
- Pseudo-Dionysius

## Suggested pack order

1. **Core conversion pack**
   - Augustine
   - Aquinas
   - Teresa
   - John of the Cross
   - Bernard

2. **Mystics pack**
   - Julian / Hilton / Rolle / Tauler / Suso / Ruusbroec

3. **Protestant classics pack**
   - Bunyan / Edwards / Wesley / Baxter / Owen / Calvin / Luther / Law

4. **Devotional & poetic pack**
   - Francis de Sales / Herbert / Donne / Vaughan / Traherne / Pascal / Kierkegaard / Chesterton / MacDonald / Fox / Thérèse

5. **Church Fathers pack**
   - only after the omnibus is split and the manifest is canonicalized

## Verification checklist for each download

- [ ] Author name matches the canonical author
- [ ] Title matches the canonical work family
- [ ] Year is **pre-1928**
- [ ] OCR/text is readable enough to chunk
- [ ] The title is **not already present** in local files
- [ ] The work is not already covered by a local omnibus chunk
- [ ] Only **one edition** is kept unless there is a justified OCR upgrade

## Rough first-wave target count

If we take the packs above as written and keep one edition per work family, the first wave is roughly:
- **~40–50 new work families**
- spread across **4 modular packs**
- plus the Church Fathers split/cleanup pass

That is the right scale for a meaningful corpus expansion without making the base app unwieldy.
