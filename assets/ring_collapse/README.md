# Ring-Collapse Visual Prototype (Blender)

Standalone visual asset prototype for the ring-collapse sequence: the intact
RingOut arena develops fine cracks in its outer ring, the cracks deepen, six
large marble segments break off, fall away, and a smaller stable arena remains.

**Status: prototype — NOT integrated into the game.** Gameplay radius logic
(`COLLAPSE_RADIUS_FACTOR = 0.82` in `index.html`) is untouched and stays the
single source of truth; this asset only *visualises* that state change.

---

## Reproduction

Everything is generated deterministically (fixed seeds, no runtime randomness)
by one script:

```
"D:\Blender\blender.exe" --background --factory-startup ^
    --python tools/build_ring_collapse_blender.py -- --stage build
```

Stages: `build` (blend + GLB + stats) · `stills` (6 phase renders) · `video`
(preview MP4 via Blender's built-in FFmpeg) · `all`. `--quick` renders low-res
test images, `--fstep 2` halves video frames. Blender 4.4.0, no add-ons.

> **Warning:** every stage of `build_ring_collapse_blender.py` WRITES build
> outputs — `stills` and `video` rebuild the scene first and also
> save/overwrite the blend, GLB and stats, exactly like `build`. There is no
> render-only stage yet (tracked follow-up task in `TODO.md`). Do not run any
> stage if the on-disk outputs must stay untouched.

Outputs:

| Path | Content |
|---|---|
| `assets/ring_collapse/source/ring_collapse.blend` | editable source scene |
| `assets/ring_collapse/source/textures/` | generated PNG texture set |
| `assets/ring_collapse/export/ring_collapse.glb` | test export (see below) |
| `assets/ring_collapse/export/textures/` | runtime crack-stage masks |
| `artifacts/ring_collapse/` | phase renders, preview video, `stats.md/json` |

## Dimensional contract (from `tools/build_arena_v2_blender.py`)

- play floor top `z = 0`, `r <= 8.55` · outer band top `z = +0.045`, `r 8.78..10.1`
- visible outer edge `r = 10.1` — runtime maps gameplay radius R via `scale = R / 10.1`
- new visible edge after collapse: `r = 10.1 x 0.82 = 8.282` (irregular ±0.24)
- Blender Z-up; the glTF exporter converts to +Y-up. 1 unit = 1 three.js unit.

## Scene structure / naming

```
Arena_Core            static remaining arena: play floor (gold inlays 2.86/4.70/6.55,
                      medallion), irregular fracture rim band, chalice underbase
Collapse_Ring         empty — parent of the six segments
Collapse_Segment_01..06   solid slabs: top plate + drum wall (fascia bands, dark
                      channel, piers, gold trim arcs) + shoulder-curved underside
                      + rough fracture faces (inner + two jagged radial cuts)
Debris_Root           empty — parent of small visual-only chunks
Debris_Small_01..26   2 phase-B chips, 4 phase-C chips, 17 fall companions
                      (incl. fine splinters), 3 chips that land near the new
                      edge and stay (final set dressing)
PreviewOnly (collection, NOT exported)   gold hoop prop + dust puffs/columns/
                      wisps in 3 opacity tiers (M_Dust_A/B/C)
Studio (collection, NOT exported)        HDRI world, key sun + warm fill, camera
```

Segment boundaries (deg): 10 / 72 / 128 / 183 / 255 / 308 — six controlled
segments of varied width (54–75°). All fracture edges come from seeded harmonic
fields (`r_edge`, `rock`, per-boundary `jag`), so neighbouring segments and the
core rim match exactly; the core rim is inset 0.02 to prevent z-fighting while
intact. Gold trim arcs end 0.008 rad before each cut (reads as a joint when
intact, as a clean break once separated — no gold crosses a fracture face).

## Animation — one clip `Collapse_Active` (300 frames @ 30 fps, baked keys)

| Phase | Frames | Content |
|---|---|---|
| A intact | 1–36 | pristine arena |
| B fine cracks | 36–102 | crack stage 1 fades in (36→66), 2 rim chips |
| C heavy cracks | 102–168 | stage 2 fades in (102→138), 4 chips, tremor |
| D release | 168–228 | staggered releases at 168/178/187/197/208/218: 12-frame tremor, ~8° outward hinge tilt, then free fall |
| E fall | 168–282 | accelerating fall with individual tumble to z = −46 (below any camera), 8 companion debris |
| F final | 282–300 | smaller stable arena only |

Object transforms are baked every 2–3 frames (linear-safe across engines) and
pushed to NLA tracks all named `Collapse_Active`, which the glTF exporter
merges into a single animation clip (54 channels). Debris visibility uses
glTF-safe scale pops (0.001 → 1) instead of hide flags.

**Crack stages are material work, not part of the glTF clip** (glTF cannot
animate material graphs). In Blender the top material blends
clean → stage1 → stage2 via two keyed factors (plus a frame handler for
headless renders). The GLB ships with the stage-2 (damaged) texture set baked
in; `export/textures/rc_crack_mask_stage1/2.png` plus the clean/stage1 maps in
`source/textures/` let the runtime cross-fade stages in the game shader later.

## Materials / textures

| Material | Maps | Notes |
|---|---|---|
| M_ArenaTop | 2048 basecolor + ORM + normal, all in 3 crack stages, unique planar disc UV (`xy/21.2+0.5`) | crack continuity across core + segments; crack relief carved into stage normals; light coat sheen |
| M_ArenaMarble | 1024 basecolor/ORM/normal, tiling (isotropic wall UVs) | drum wall + underbase, calm Calacatta |
| M_Fracture | 1024 basecolor/ORM/normal, tiling | fresh marble break: bright Worley facet plates, gated seams, crystalline speckle; fracture geometry is flat-shaded |
| M_ArenaGold | untextured PBR (metallic 1, rough 0.22) | inlays (near-flush beads), trims, domed medallion |
| M_ArenaDark | untextured PBR | shadow groove + pier channel |

ORM images wire G→Roughness, B→Metallic (glTF metallicRoughness pattern).

## Later integration (architecture)

1. **Gameplay radius** stays authoritative in `index.html` — collapse state
   machine already exists (`collapseState`, `doCollapse()`).
2. **Arena visual**: swap the static platform GLB for this asset (or overlay
   it); `Arena_Core` is exactly the post-collapse platform.
3. **Collapse segments** are visual only — no gameplay collision, never touch
   the deterministic ball physics.
4. **Debris/dust**: `Debris_Small_*` can be culled on mobile; dust is not in
   the GLB — reuse the game's existing particle spawner, scalable/disableable.
5. **Trigger**: play `Collapse_Active` when `collapseState` becomes
   `'expired'` → the state flips to `'collapsed'` (radius 0.82) exactly when
   the last segment clears the rim (~frame 282 ≈ 9.4 s, tuneable); crack
   stages 1/2 can foreshadow during the 10 s warning window.

## Performance snapshot (see `artifacts/ring_collapse/stats.md`)

~44 k triangles total (core ~15 k, six segments ~4–5.6 k each, debris ~1 k),
5 materials, 9 GLB images, ~60 draw calls worst case (all pieces visible),
GLB ≈ 10.9 MB (uncompressed PNG textures dominate).

**Before shipping in-game:** KTX2/Basis or reduced-res textures (top 2048→1024
saves ~6 MB), optional meshopt; merge debris; mobile LOD = drop debris +
1024→512 body/fracture maps; consider capping segment fall keys once offscreen.

## Cracked segment variants — APPROVED STAND (2026-07-26)

Beyond the animated prototype above, each of the six ring segments now also has
a **cracked variant** — a statically fractured version of the same slab, used to
show ring damage without the fall animation.

**Binding stand:**
`validation/six_segment_rollout/ring_collapse_six_segment_simplified.glb`
— 12 roots (`Segment01..06_Intact` + `Segment01..06_Cracked_BALANCED`).
Segment 06 is frozen as the *dark-facet-removal* stand; the visual state is
approved and must not be reinterpreted.

### Chain (five deterministic stages) — reproducible from the committed base, not a rebuild from zero

Committed scope:

- the approved final GLB (the binding 12-root stand)
- the approved 10-root base stand
  (`validation/seam_corridor_final_fix/ring_collapse_seam_corridor_final_fix.glb`)
- the production source blend
- the 9 build-necessary source textures in `source/textures/` (see below)
- the five pair-3 atlas PNGs
- the builder, the validators and the graft script
- the vendored three.js r170 tree incl. licence and manifest
- the final-only browser smoke (runner + harness)
- documentation and the curated approval evidence

Every intermediate gate/rollout/graft GLB is a **build artifact** — the scripts
regenerate it deterministically and it is intentionally **not** committed.

| # | Stage | Script | Reads | Writes |
|---|---|---|---|---|
| 1 | Gate (pair) | `tools/validate_ring_collapse_seg36_gate.py` | blend (read-only) | `seg36_gate/ring_collapse_seg36_gate.glb` (seg03+seg06 raw) + fresh pair-3 atlas (both halves) |
| 2 | Rollout (pair) | `tools/validate_ring_collapse_seg36_rollout.py` | approved base + step 1 | `seg36_rollout/ring_collapse_seg36_rollout.glb` (harmonized Segment 03) |
| 3 | Gate (seg06 simplified) | `tools/validate_ring_collapse_seg06_simplified_gate.py` | blend (read-only) + loads step 1's atlas, re-bakes only the seg06 half | `seg36_gate/ring_collapse_seg06_simplified.glb` |
| 4 | Rollout (seg06 simplified) | `tools/validate_ring_collapse_seg06_simplified_rollout.py` | approved base + step 1 (neighbour context) + step 3 | `seg36_rollout/ring_collapse_seg06_simplified_rollout.glb` |
| 5 | Graft | `tools/ring_collapse/graft_simplified.js` | approved base + step 2 (Segment 03) + step 4 (Segment 06) | the binding 12-root GLB |

Run order: 1 before 2 and 3; 3 before 4; 2 and 4 before 5.

#### Copy-paste rebuild + validation (approved PNG profile)

Every validator exits non-zero if any assertion fails — chain them with `&&`.
No environment variables are needed; the final validator's defaults point at
the approved stand (`SIX_GLB` / `PAIR06_GLB` remain available as overrides,
`CHECK_KTX2=1` enables the KTX2 check once the follow-up task produced that
variant).

```
"D:/Blender/blender.exe" --background --factory-startup --python tools/validate_ring_collapse_seg36_gate.py                && ^
"D:/Blender/blender.exe" --background --factory-startup --python tools/validate_ring_collapse_seg36_rollout.py            && ^
"D:/Blender/blender.exe" --background --factory-startup --python tools/validate_ring_collapse_seg06_simplified_gate.py    && ^
"D:/Blender/blender.exe" --background --factory-startup --python tools/validate_ring_collapse_seg06_simplified_rollout.py && ^
node tools/ring_collapse/graft_simplified.js                                                                              && ^
"D:/Blender/blender.exe" --background --factory-startup --python tools/validate_ring_collapse_six_segment_rollout.py
```

(POSIX shells: same six commands joined with `&&` instead of `&& ^`.)
Note: steps 1 and 3 re-bake the pair-3 atlas PNGs in
`validation/seg36_gate/textures/` — Cycles bakes are deterministic in layout
but not guaranteed bit-identical across GPU/driver versions; the committed
PNGs are the approved reference. The final validator aborts with the exact
missing build steps if the regenerated pair GLBs are absent.

Dependency closure (closed and verified 2026-07-26 by a clean-checkout scratch
rebuild): every path read by the five steps is committed or produced by an
earlier step. The blend links **15 texture files**; **9 of them are
build-necessary source dependencies and part of the commit**
(`rc_body_basecolor/normal/orm`, `rc_fracture_basecolor/normal/orm`,
`rc_top_basecolor_clean`, `rc_top_normal`, `rc_top_orm_clean` in
`source/textures/`) — the gate GLBs embed them as their 9 non-atlas images.
A checkout containing only the
commit ran all six steps green (29/39/17/29 assertions, graft, final validator
14 PASS + 1 documented KTX2 skip) and the browser smoke exit 0.

The rebuild is shape-exact but not byte-identical to the approved GLB: the 10
protected roots come out identical, the two rebuilt roots keep the same unique
vertex positions and triangle counts (9094 / 9465) but differ in one
attribute-split duplicate each plus vertex order, and the three re-baked atlas
PNGs differ in size. The committed GLB stays the binding artifact.

The remaining 6 (`rc_top_{basecolor,normal,orm}_stage1/stage2`) are **GUI/preview
maps only** — they feed the blend's preview cross-fade in `M_ArenaTop`, no build
step reads them, and `tools/build_ring_collapse_blender.py` regenerates all 15
texture files itself. They are deliberately not committed; **the full build chain
starts and runs green without them** (proven by the clean-checkout scratch
rebuild). Opening the blend in the GUI before running the builder shows those
preview nodes without image data. The canonical graft script
(`tools/ring_collapse/graft_simplified.js`) was checked to produce a
byte-identical output GLB against its prior working copy before promotion.

#### Browser smoke (reproducible from the commit)

```
node tools/ring_collapse/browser_smoke/run_smoke.js
```

Loads ONLY the committed final GLB through the tracked vendored three.js
r170 tree (needs a local Playwright + Chromium install, the same runtime the
validation harnesses used). Exit 0 = 12 roots present, one frame rendered,
0 console/page errors, 0 external requests; any failure exits 1. The curated
before/after captures in `artifacts/ring_collapse/seg06_simplified/` are
**archived approval evidence** — their exact regeneration (which needed the
uncommitted before-GLB) is intentionally not part of the commit.

### Guarantees / measured values

- byte-preserving graft: the approved predecessor's BIN is a verbatim prefix and
  every JSON array is a prefix → the 10 previously approved roots and Segment 03
  stay byte-identical; new content is only appended
- 1 island for Segment 06 · thin groups 0 · weld open edges 94
- intact pixel diff exactly 0 · silhouette equals intact (max z 0.0620)
- gate 17/17 · rollout 29/29 · validator 14/14
- browser: the approval run measured 0 errors / 0 external requests — those
  captures are archived evidence; the reproducible browser proof is the
  final-only smoke test above (vendored three.js r170 under
  `validation/two_segment_pilot/vendor/`)

### Cleanup architecture (non-obvious, hence documented)

Thin cover plates in the crack canal are **not** cut away any more — the earlier
consume dishes left visible faceted interiors that read as dark blue stones.
Instead they are thickened from below: only the *concealed* counter-skins move,
vertices near the plateau top (`TOP_Z`) never do. A census snap then merges
vertex pairs ≤0.5 mm that the gold taper had pulled apart (pure position
equalisation — normals and topology unchanged).

### Open / out of scope

- The pair-3 atlas (`validation/seg36_gate/textures/seg36_frac_*.png`) is still
  **PNG**; KTX2/HQ finalisation is a **separate follow-up task** (the loader
  handles the mixed form without errors, so it is not a blocker).
- **No production integration**: `index.html`, physics, lockstep, online and
  Firebase are untouched.
- Discarded intermediate stands (`preview1`, `final1`, `micro_fix`, older
  segment-06 GLBs and their builder/graft scripts) are **not part of the
  approval** and exist locally as history only.

## Known limitations

- Crack-stage blending is runtime work (shader mix by design, see above); the
  per-stage normal maps (`rc_top_normal_stage1/2`) ship alongside the masks.
- Dust is preview-only; the game's particle system should own it.
- The `.blend` studio rig uses the same HDRI family as the in-game default
  environment profile (dawn → `qwantani_sunset_puresky_2k.hdr`, warm key sun
  matching the visible glow) — an approximation, not a replication.
- Chalice underbase is included down to z ≈ −7.1 (below-frame tip omitted).
