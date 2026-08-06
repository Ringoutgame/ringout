# Temporary Barrier — Canonical Asset (Polish 2)

**Status: VISUELL UND TECHNISCH FREIGEGEBEN** (2026-08-07)
**Ausgangscommit:** `b914b919ce572eb4cb485dee9c437a0a6ca3f507`
(Branch `feature/temporary-barrier-final-visual`; Herkunft: untracked
Artefaktphasen `artifacts/temporary_barrier_final_visual_polish2/` und
`artifacts/temporary_barrier_final_export/`)

Kanonisches Asset der temporären Schutzwand. Noch **nicht** in `index.html`
integriert — die Integration ist eine eigene, spätere Phase.

---

## Geometrievertrag

- Energiefläche exakt auf dem Collider-Bogen **r = 10.1** (GLB-Units = Spielskala `R/10.1`)
- **30°-Segment** (±15° um die Segmentmitte), Krümmung entlang des Arenaradius
- Feldhöhe z 0.22–1.90, Pfeilerkappen bis 2.14, alles auf dem Randweg (z ≥ 0.159)
- **Bounding Box** (glTF Y-up): min (−2.8628, 0.159, −10.124), max (+2.8628, 2.140, −9.5071)
- Vertexradius 9.895–10.309 → kein Eindringen ins Spielfeld (< 8.7)

## Ausrichtung & Platzierung

- **Kanonische Grundausrichtung = barrierSeg-Index 0** (aus `barrierSegAt()` /
  `barrierSegMid()` und der Debug-Barriere hergeleitet; Wandmitte zeigt in
  Three.js nach (0, 0, −1) = Arenawinkel −90°).
- **Root-Pivot exakt im Arenamittelpunkt: Position 0/0/0, Rotation identisch,
  Scale 1/1/1** — auch alle Kind-Nodes tragen Identitätstransforms.
- Runtime-Platzierung (identisch zur bestehenden Debug-Barriere):

```js
root.rotation.y = -barrierSeg * BARRIER_SPAN;   // BARRIER_SPAN = PI/6
root.position.set(cx, bob, cy);
root.scale.setScalar(R / 10.1);
```

Verifiziert für Segment 0, 1 und 11 (inkl. 11→0-Wrap).

## GLB-Inhalt (`export/temporary_barrier_polish2.glb`, 1 845 280 Bytes)

- Root-Node `TemporaryBarrier` + 6 Mesh-Nodes: `BarrierField`, `BarrierPylons`,
  `BarrierEmitters`, `BarrierDockGlow`, `BarrierFrame`, `BarrierGold`
- Materialien (6): `M_BarrierField` (BLEND, doubleSided), `M_BarrierMarble`,
  `M_BarrierEmit`, `M_BarrierDock`, `M_BarrierFrame`, `M_BarrierGold`
- 7 eingebettete Texturen: `T_BarrierField_BaseColor` + `T_BarrierField_Emissive`
  (je 1024×512), `T_BarrierMarble_BaseColor/Roughness/Normal` (je 1024²),
  `T_BarrierEmit_Emissive` (512²), `T_BarrierDock_Emissive` (256²)
- Extensions (alle optional): `KHR_materials_emissive_strength` (Emitter 10.08,
  Dock 5.04), `KHR_materials_clearcoat` (Marmor 0.15), `KHR_materials_specular`
  (Specular 0 auf dem Feld)
- **Keine** Kameras, Lichter, Animationen, Skins, externen URIs
- **Keine KTX2-/Draco-/Meshopt-Kompression** (bewusst, Phase offen)
- **Keine Animation im Asset** — Energiebewegung folgt erst in der
  Integrationsphase (Shader), die Wolken/Flux-Struktur ist statisch gebacken.

### Texturklärung (8 Bake-PNGs vs. 7 im GLB)

Der Export-Bake erzeugt 8 PNGs (Sichtkopien in
`artifacts/temporary_barrier_final_export/textures/`). Eingebettet sind 7 —
`T_BarrierField_Alpha.png` ist das **Zwischenprodukt** des Alpha-Bakes: sein
Inhalt liegt im **Alphakanal** von `T_BarrierField_BaseColor` und wird von
keinem Material referenziert. Es fehlt also keine Materialtextur.

## Materialabweichungen gegenüber der Blender-Quelle (dokumentiert & beabsichtigt)

1. **Kein Facing-Glow** — der blickwinkelabhängige LayerWeight-Term ist in
   glTF-Core nicht darstellbar; Wiederherstellung als Shader-Override in der
   Integration (z. B. `onBeforeCompile`-Fresnel).
2. **Konstante Rail-Roughness 0.37** statt prozeduralem Drift 0.32–0.42
   (auf den dünnen Profilen nicht wahrnehmbar).
3. **Kein Transmission-Tint** — der leichte Cyan-Tint des Transparent-BSDF
   bräuchte `KHR_materials_transmission`; Wirkung ≤ 10 % in Blaukanälen bei
   Alpha ≤ 0.44, daher entfallen.

## Erwartete Three.js-Runtime-Overrides (Integration, nicht im Asset)

- `M_BarrierField`: `depthWrite = false`, `renderOrder = 2` (wie Debug-Barriere;
  `transparent = true` kommt automatisch aus alphaMode BLEND),
  `emissiveIntensity`-Feintuning gegen die Cycles-Kalibrierung; `opacity` bei
  1.0 lassen (Alpha liegt in der BaseColor-Textur).
- `M_BarrierEmit` / `M_BarrierDock`: `emissiveIntensity` (10.08 / 5.04 aus der
  KHR-Extension) bei Bedarf für Match-Effekte skalieren.
- Metalle brauchen `scene.environment` (im Spiel immer gesetzt).

## Ordnerstruktur

| Pfad | Inhalt |
|---|---|
| `source/temporary_barrier_polish2.blend` | freigegebene Polish-2-Quelle (eingefroren) |
| `export/temporary_barrier_polish2.glb` | kanonischer GLB-Export |
| `validation/glb_manifest.json` | vollständiges GLB-Inventar |
| `validation/validation_report.json` | maschinenlesbarer Prüfbericht (Struktur 21/21, Reimport 18/18, Three.js-Harness, Texturklärung) |
| `validation/approved_previews/` | freigegebene Referenz-Renders (overview / front / pylon_detail) |
| `tools/temporary_barrier/build_temporary_barrier_visual.py` | reproduzierbarer Visual-Build (Cycles) |
| `tools/temporary_barrier/export_temporary_barrier.py` | Bake + Seg-0-Reorientierung + GLB-Export (`--out <scratch>` angeben) |
| `tools/temporary_barrier/validate_glb_structure.py` | Strukturvalidator (Default: kanonischer GLB) |
| `tools/temporary_barrier/validate_reimport_blender.py` | Blender-Reimportvalidator (Default: kanonischer GLB) |

Das isolierte Three.js-Harness (Screenshots, CDP-Treiber, three-Vendor-Kopie)
liegt bewusst **nicht** im kanonischen Baum, sondern in
`artifacts/temporary_barrier_final_export/threejs_harness/`.
