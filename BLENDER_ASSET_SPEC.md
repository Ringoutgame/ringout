# BLENDER_ASSET_SPEC.md — GLB-Assets für den RingOut-3D-Prototyp

**Zuletzt aktualisiert:** 2026-07-07
**Zielabnehmer:** `prototype3d.html` (isolierter Visual-Spike; kein Bezug zum Hauptspiel)
**Status:** Blender ist auf dieser Maschine nicht installiert — diese Spezifikation definiert die Assets, damit sie in Blender (lokal nach Installation oder extern) erstellt werden können.

---

## 1. Benötigte Modelle

| Priorität | Datei | Inhalt |
|---|---|---|
| P0 | `assets/arena_platform.glb` | Komplette Arena-Struktur: Spielfläche, erhöhter Randweg, Gesims, Wandringe, 8 Kristall-Sockel **mit** Kristallen, skulptierte Fels-Unterseite |
| P1 | `assets/floating_island.glb` | Eine ferne Wolkeninsel (Fels + Deckplatte, optional Säulen-Ruine) — wird 3× instanziert |

**Nicht modellieren:** Spielkugeln und die leuchtende Spielfeld-Grenze — beide bleiben prozedural im Prototyp und überleben den Asset-Tausch.

---

## 2. Koordinatensystem & Maße (VERBINDLICH)

Einheit: **1 Blender-Unit = 1 Einheit im Prototyp** (Meter-Äquivalent). Ursprung = Arenazentrum. **+Z in Blender = oben** (der glTF-Export konvertiert automatisch zu +Y-up — Standardeinstellung „+Y Up" aktiviert lassen).

### arena_platform.glb — Pflichtmaße

| Element | Maß | Zweck |
|---|---|---|
| **Spielfläche (innere Ebene)** | Kreis r = 8.7, Oberfläche exakt bei **z = 0** | Kugeln (r 0.62) und Leuchtgrenze des Prototyps sitzen auf z=0 — Abweichung = schwebende/versenkte Kugeln |
| **Spielfeld-Grenze** | r = 8.4 auf der Spielfläche muss **flach und frei** bleiben (kein Relief > ±0.01) | Prototyp legt dort den emissiven Grenzring auf |
| **Randweg** | Ring r 8.7 → 10.1, Oberfläche bei z = **+0.16** (Stufe zur Spielfläche) | Zwei-Ebenen-Look (Sumo-Ring) |
| **Gesims/Profil** | Auskragung bis max. r = 10.5, Höhenbereich z −1.15 … −2.0 | Silhouette |
| **Wand-/Ringzone** | r ≈ 9.55, z −2.0 … −3.1 | Arkaden/Pfeiler-Zone (Gestaltung frei) |
| **Fels-Unterseite** | ab z ≈ −3.1, Gesamttiefe bis z ≈ **−8.5 bis −9.5**, nach unten verjüngend | „aus dem Berg gerissen"; hängende Brocken erlaubt (dürfen Teil des Meshes sein) |
| **8 Sockel** | Zentren auf r = 9.35, Winkel 22.5° + k·45° (k = 0…7), Standfläche auf dem Randweg (z = +0.16) | Ersetzen die prozeduralen Sockel |
| **Kristalle** | auf den Sockeln, Spitzen-Zentrum ca. z = +1.2 … +1.6 | Als Teil des GLB (eigenes Material, s. u.) |
| **Gesamt-Bounding** | Radius ≤ 10.6, z von +1.8 bis −9.6 | Kamera-/Schatten-Setup des Prototyps |

### floating_island.glb

- Bounding: Ø ca. 9–10, Höhe ca. 5–7; Deckplatte oben flach (Ø ≈ 9), Fels nach unten spitz.
- Ursprung im Zentrum der Deckplatten-Oberfläche (z = 0 dort), damit die Instanzierung im Prototyp passt.
- Optional: 3–5 Säulen-Ruine auf der Platte.
- Wird vom Prototyp 3× geladen/geklont und animiert (Schweben) — keine eigene Animation exportieren.

---

## 3. Materialien (Principled BSDF — exportiert sauber nach glTF-PBR)

| Material-Name im GLB | Verwendung | Richtwerte |
|---|---|---|
| `M_Marble` | Spielfläche + Randweg | Base helles kühles Elfenbein-Grau (~#dfe3e0), Roughness 0.5–0.65 mit Map-Variation, Metallic ≤ 0.1. **Textur:** Marmor mit Adern/feinen Rissen, 2048², + Normal-Map |
| `M_Stone` | Gesims, Wand, Pfeiler, Sockel | Kühles Steingrau (~#93a1b0), Roughness 0.8+, Blöcke/Fugen als Textur + Normal |
| `M_Rock` | Fels-Unterseite | Dunkler (~#5a6773), Roughness 0.95, skulptierte Formen wichtiger als Textur |
| `M_Gold` | Inlay-Ringe (r-Anteile 0.34/0.56/0.78 der Spielfläche ab Zentrum), Trims, Stufenkante | Alt-Gold (~#a9853f), Metallic 1.0, Roughness 0.35–0.45 — eingelassen (minimal versenkt), nicht aufgesetzt |
| `M_Crystal` | Kristalle | Blau (~#5fb2e8), Transmission 0.85, Roughness ≤ 0.05, IOR 1.5 — Blender exportiert das als `KHR_materials_transmission`/`volume`; der Prototyp (three@0.170) unterstützt beides |

**Empfohlen:** Ambient Occlusion in die Base-Color-Texturen **baken** (Fugen, Gesims-Unterseiten, Sockel-Kontakt) — das ist der größte Realismus-Sprung gegenüber dem Prozedural-Look und kostet zur Laufzeit nichts.

---

## 4. Technische Budgets & Export

- **Polygone:** `arena_platform.glb` ≤ 80 k Tris; `floating_island.glb` ≤ 15 k Tris (Mobile-Ziel).
- **Texturen:** max. 2048², JPEG/PNG im GLB eingebettet; gesamt ≤ ~15 MB pro Datei.
- **Export (Blender: Datei → Exportieren → glTF 2.0):**
  - Format: **glTF Binary (.glb)**
  - „+Y Up": **an** (Standard)
  - „Apply Modifiers": an · „Materials: Export" · „Images: Automatic"
  - Keine Animationen, keine Kameras/Lichter exportieren
  - Kompression (Draco): **aus** (der Prototyp lädt ohne Draco-Decoder)
- **Ablage:** Ordner `assets/` neben `prototype3d.html`.

---

## 5. Wie der Prototyp die Assets lädt (bereits verkabelt)

`prototype3d.html` enthält einen `GLTFLoader` mit Fallback:

```js
tryReplace('assets/arena_platform.glb', structure);   // ersetzt die komplette Prozedural-Arena
tryReplace('assets/floating_island.glb', ...);        // ersetzt die Prozedural-Inseln (3 Instanzen)
```

- **Datei vorhanden** → prozedurale Gruppe wird geleert und durch das GLB ersetzt; Schatten (`castShadow`/`receiveShadow`) werden automatisch auf alle Meshes gesetzt.
- **Datei fehlt / Ladefehler** → prozeduraler Fallback bleibt aktiv, keine Fehlermeldung für den Nutzer.
- Kugeln und Leuchtgrenze liegen außerhalb der getauschten Gruppen und bleiben immer erhalten.
- **Achtung `file://`:** Browser blockieren `fetch` lokaler Dateien teils unter `file://`. Falls das GLB lokal nicht lädt: Prototyp über einen Mini-Server öffnen (z. B. `npx serve` oder `python -m http.server` im Projektordner) — Hinweis gilt nur für den Asset-Test, nicht für den Prozedural-Fallback.

---

## 6. Abnahmekriterien

1. GLB in `assets/` legen → Prototyp neu laden → Arena erscheint als Asset (erkennbar an Modell-Details), Kugeln liegen exakt auf der Spielfläche, Grenzring bündig bei r 8.4.
2. Orbit-Rundflug: Silhouette (Gesims, Unterseite) deutlich hochwertiger als Prozedural-Version.
3. Top-down: Spielfläche klar lesbar, Gold-Inlays dezent.
4. FPS auf Ziel-Mobilgerät nicht schlechter als Prozedural-Version.
