# Segment 06 — Dark Facet Removal (Preview, flacher Kanal)

Stand: 2026-07-26 · Basis: Simplified-Stand; Crack-Route, Rim-Silhouette,
Seams, Goldtrim, Intact, Kameras unverändert.

## Quelle der beiden dunklen Körper (Kamera-Projektion, exakt)

- Großer Cluster mittig: die fünf überlappenden **Consume-Dishes**
  p0_1/p1_0/p2_0/p2_1/p3_0 bei θ 342.5–344.1 / r 9.0–9.2
  (projiziert px 663–778 / 598–638 — deckungsgleich mit dem Bildbefund).
- Runder Körper Richtung Rim: **Consume-Dish p0_0** bei θ 337.1 / r 9.75
  (projiziert px 1166/470). Beide = exponierte facettierte Dish-Innenflächen
  (jitterte Ellipsoid-Schnitte, Himmelsreflexion). Wall-/Route-Chips,
  Materialzuweisungen und gefaltete Faces ausgeschlossen.

## Behebung

- **Consume-Dishes vollständig deaktiviert** (keine Verkleinerung).
- Damit die Thin-Groups trotzdem 0 werden: neuer Pass `thicken_thin_plates`
  — die dünnen Deckplatten bleiben als sichtbare Plateau-Oberfläche
  unangetastet; nur ihre VERDECKTEN Gegenhäute im Kanal-Hohlraum werden
  entlang der Messrichtung abgesenkt (≤16 mm, Verts nahe TOP_Z nie bewegt,
  koinzidente Dubletten bewegen sich als ein Punkt), bis die 14-mm-Regel
  erfüllt ist. Keine neuen Chips/Cutter/Dishes/Fragmente.
- Census-Snap im Graft (nur Seg06-Root): offene Taper-Mikro-Splits ≤0.5 mm
  auf einen Punkt gelegt (reine Positionsangleichung, Normalen/Topologie
  unverändert) — Open-Edges 102→94.
- Ergebnis im Bereich: nur noch flacher Crack-Kanal + bündige Bruchlippen,
  keine aufragenden/runden Objekte, keine dunkelblauen Facettenflächen.

## Gates

Inseln 3→**1** · Thin-Groups **0** · Weld-Open-Edges **94** (≤99) ·
keine Pinholes/isolierten Fragmente (Diag: micro-Tris 27, alle Restcluster
Arc-End-Baseline) · Seg03 byte-identisch (452 900 Bytes) · Approved-Bin
Verbatim-Präfix ✓ · Intact-Pixeldiff **exakt 0** · Silhouette = intact ·
Gate 17/17 · Rollout 29/29 · Validator **14/14 PASS** (SKIP_KTX) ·
Browser 0 Fehler / 0 externe Requests · `git diff --check` sauber.

## Captures

`artifacts/ring_collapse/seg06_simplified/`
01_segment06_flat_gameplay.png · 02_segment06_flat_closeup.png ·
03_six_segment_flat_control.png (Kameras identisch zum Simplified-Preview).

Kein KTX2-Abschluss, kein Commit, kein Push, kein Merge, kein Deploy.

---

*Präzisierung (2026-07-26, nachträglich):* Die Zeile „kein Commit" oben
beschreibt den damaligen Build-/Capture-Lauf selbst — dieser führte keinen
Commit aus. Dieser Report wurde später zusammen mit den drei kuratierten
Captures als archivierter Freigabenachweis versioniert
(`feat(ring-collapse): add approved six-segment cracked stand`). Die
historischen Messergebnisse oben sind unverändert.
