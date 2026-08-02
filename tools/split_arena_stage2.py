# Teilt AUSSCHLIESSLICH das bestehende PlayFloor-Mesh der Arena in
#   PlayFloor_Core   — verbleibender innerer Kern (r < Trennkante)
#   PlayFloor_Stage2 — separat ausblendbarer Aussenring (Trennkante .. 8.70)
# entlang der SKALIERTEN Ring-1-Bruchkante (x0.82). Es wird keine Silhouette
# erfunden: die Trennkurve wird aus der inneren Bruchflaeche des freigegebenen
# Collapse-GLB ausgelesen und mit 0.82 skaliert.
#
# PlayFloor ist ein geschlossener Koerper (Deckel-n-Gon, Randwand, Boden bei
# y=-1.2). Ein Boolean-Schnitt liefert deshalb auf beiden Seiten geschlossene
# Koerper — die neue Innenwand des Kerns entsteht dabei automatisch mit
# demselben Material; UVs werden vom Solver interpoliert.
#
# Aufruf:
#   "D:\Blender\blender.exe" --background --factory-startup --python tools/split_arena_stage2.py
#
# Schreibt NUR: assets/arena_platform_stage2.glb   (Originalasset bleibt unberuehrt)

import bpy, bmesh, math, os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARENA = os.path.join(ROOT, 'assets', 'arena_platform.glb')
COLL = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                    'six_segment_rollout', 'ring_collapse_six_segment_simplified.glb')
OUT = os.path.join(ROOT, 'assets', 'arena_platform_stage2.glb')

SCALE = 0.82          # Uniform Scale der zweiten Ring-Instanz
NBIN = 720            # Winkelaufloesung der Trennkurve
TOP_LO, TOP_HI = -0.20, 0.20   # y-Fenster der Segment-Deckflaeche
INNER_MAX = 8.50               # oberhalb liegt die 8.55-Stufe, nicht mehr die Bruchkante

def log(m):
    print('[stage2] ' + m, flush=True)

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

# ── 1) Trennkurve aus der Ring-1-Bruchkante lesen ───────────────────────────
clear()
bpy.ops.import_scene.gltf(filepath=COLL)
segs = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('Segment')]
log('Collapse-GLB: %d Segment-Meshes' % len(segs))

# ECHTE innere Randkantenschleife der Deckflaechen — keine Winkelbins, keine
# Minima, keine Interpolation. Pro Segment: Deckflaechen bestimmen, deren
# Randkanten sammeln, davon die inneren behalten. Ergibt exakt die Bruchkontur,
# die der Ring-1-Collapse hinterlaesst.
pts = []
for ob in segs:
    if '_Cracked' in ob.name:
        continue                      # Intact-Satz genuegt: identische Silhouette
    mw = ob.matrix_world
    n3 = mw.to_3x3()
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    tf = set()
    for fc in bm.faces:
        c = mw @ fc.calc_center_median()
        nz = (n3 @ fc.normal).normalized().z
        if nz > 0.70 and TOP_LO <= c.z <= TOP_HI:
            tf.add(fc.index)
    got = 0; skipped_radial = 0
    for e in bm.edges:
        if sum(1 for fc in e.link_faces if fc.index in tf) != 1:
            continue                  # nur Randkanten der Deckflaeche
        a, b = mw @ e.verts[0].co, mw @ e.verts[1].co
        if (math.hypot(a.x, a.y) + math.hypot(b.x, b.y)) * 0.5 > INNER_MAX:
            continue                  # Aussenkante des Bandes verwerfen
        # Radiale Fugenkanten (Segmentseiten) gehoeren NICHT zur umlaufenden
        # Bruchkontur — sie erzeugten die rechteckigen Laschen. Kriterium:
        # Kantenrichtung ueberwiegend radial statt tangential.
        dx, dy = b.x - a.x, b.y - a.y
        dl = math.hypot(dx, dy)
        mx, my = (a.x + b.x) * 0.5, (a.y + b.y) * 0.5
        ml = math.hypot(mx, my)
        if dl < 1e-9 or ml < 1e-9:
            continue
        if abs((dx * mx + dy * my) / (dl * ml)) > 0.50:
            skipped_radial += 1
            continue
        for w in (a, b):
            pts.append((math.atan2(w.y, w.x) % (2 * math.pi), math.hypot(w.x, w.y)))
        got += 1
    bm.free()
    log('  %-26s Deckflaechen=%4d  Umfangskanten=%3d  radiale Fugenkanten verworfen=%2d'
        % (ob.name, len(tf), got, skipped_radial))

if len(pts) < 24:
    log('FEHLER: innere Randkantenschleife nicht gefunden (%d Punkte)' % len(pts)); sys.exit(1)

pts.sort(key=lambda p: p[0])          # nach Winkel ordnen -> sternfoermig, schnittfrei
# Punkte, die winkelmaessig praktisch aufeinanderliegen, zu EINEM Punkt mitteln.
# Verhindert nahezu senkrechte Radiusspruenge (die Laschen-Ursache), ohne die
# Kontur zu glaetten: die Toleranz liegt weit unter dem mittleren Punktabstand.
TH_MIN = 0.010                        # rad; mittlerer Abstand ist rund 0.04 rad
loop = []
for th, r in pts:
    if loop and (th - loop[-1][0]) < TH_MIN:
        n = loop[-1][2] + 1
        loop[-1] = (loop[-1][0], (loop[-1][1] * loop[-1][2] + r) / n, n)
        continue
    loop.append((th, r, 1))
# Ringschluss: erster und letzter Punkt duerfen sich ebenfalls nicht beruehren
if len(loop) > 2 and (loop[0][0] + 2 * math.pi - loop[-1][0]) < TH_MIN:
    n = loop[0][2] + loop[-1][2]
    loop[0] = (loop[0][0], (loop[0][1] * loop[0][2] + loop[-1][1] * loop[-1][2]) / n, n)
    loop.pop()
merged = sum(p[2] for p in loop) - len(loop)
loop = [(th, r) for th, r, _ in loop]
log('Konturpunkte nach Zusammenfassung: %d (%d gleichwinklige Punkte gemittelt)' % (len(loop), merged))
dmax = max(abs(loop[(i + 1) % len(loop)][1] - loop[i][1]) for i in range(len(loop)))
log('groesster Radiussprung zwischen Nachbarpunkten: %.4f' % dmax)
raw_min = min(r for _, r in loop); raw_max = max(r for _, r in loop)
cut_loop = [(th, r * SCALE) for th, r in loop]
cut_r = [r for _, r in cut_loop]
log('Randkantenschleife: %d Punkte (echte Kontur, keine Interpolation)' % len(loop))
log('Ring-1-Bruchkante  r %.4f .. %.4f' % (raw_min, raw_max))
log('Trennkante x0.82   r %.4f .. %.4f   (Mittel %.5f)'
    % (min(cut_r), max(cut_r), sum(cut_r) / len(cut_r)))

# ── 2) Arena laden, PlayFloor isolieren ─────────────────────────────────────
clear()
bpy.ops.import_scene.gltf(filepath=ARENA)
scene = bpy.context.scene
floor = next((o for o in scene.objects if o.type == 'MESH' and o.name == 'PlayFloor'), None)
if floor is None:
    log('FEHLER: PlayFloor nicht gefunden'); sys.exit(1)
log('PlayFloor: %d Verts, %d Polygone, Materialien: %s'
    % (len(floor.data.vertices), len(floor.data.polygons),
       [m.name for m in floor.data.materials]))

# ── 3) Schneidkoerper aus der Trennkurve ────────────────────────────────────
# Prisma mit exakt der Trennkontur, hoch genug um PlayFloor voll zu durchdringen.
bm = bmesh.new()
zlo, zhi = -3.0, 3.0
low, up = [], []
N = len(cut_loop)
for th, r in cut_loop:
    low.append(bm.verts.new((r * math.cos(th), r * math.sin(th), zlo)))
    up.append(bm.verts.new((r * math.cos(th), r * math.sin(th), zhi)))
bm.verts.ensure_lookup_table()
for i in range(N):
    j = (i + 1) % N
    try:
        bm.faces.new((low[i], low[j], up[j], up[i]))
    except ValueError:
        pass
bmesh.ops.contextual_create(bm, geom=low)      # Deckel schliessen -> dichter Koerper
bmesh.ops.contextual_create(bm, geom=up)
me = bpy.data.meshes.new('Stage2_Cutter')
bm.to_mesh(me); bm.free()
cutter = bpy.data.objects.new('Stage2_Cutter', me)
scene.collection.objects.link(cutter)
log('Schneidkoerper: %d Verts' % len(me.vertices))

# ── 4) Boolean-Split ────────────────────────────────────────────────────────
def boolean(src, name, op):
    ob = src.copy(); ob.data = src.data.copy(); ob.name = name
    scene.collection.objects.link(ob)
    m = ob.modifiers.new('split', 'BOOLEAN')
    m.object = cutter; m.operation = op; m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    return ob

core = boolean(floor, 'PlayFloor_Core', 'INTERSECT')
ring = boolean(floor, 'PlayFloor_Stage2', 'DIFFERENCE')
log('PlayFloor_Core   : %d Verts, %d Polygone' % (len(core.data.vertices), len(core.data.polygons)))
log('PlayFloor_Stage2 : %d Verts, %d Polygone' % (len(ring.data.vertices), len(ring.data.polygons)))

def radial_range(ob):
    mw = ob.matrix_world
    rs = [math.hypot((mw @ v.co).x, (mw @ v.co).y) for v in ob.data.vertices]
    return (min(rs), max(rs)) if rs else (0, 0)
log('Kern   r %.3f .. %.3f' % radial_range(core))
log('Ring   r %.3f .. %.3f' % radial_range(ring))

# ── Topologiepruefung: keine Loecher, keine offenen/non-manifold Kanten ──────
def audit(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    open_e = sum(1 for e in bm.edges if len(e.link_faces) < 2)
    nonm_e = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    nonm_v = sum(1 for v in bm.verts if not v.is_manifold)
    loose = sum(1 for v in bm.verts if not v.link_faces)
    bm.free()
    log('  %-18s offene Kanten=%d  non-manifold Kanten=%d  non-manifold Verts=%d  lose Verts=%d'
        % (ob.name, open_e, nonm_e, nonm_v, loose))
    return open_e + nonm_e + nonm_v + loose
bad = audit(core) + audit(ring)
log('Topologie: %s' % ('SAUBER' if bad == 0 else 'PROBLEME (%d)' % bad))

# ── UVs NUR fuer die neu entstandenen vertikalen Schnittwandflaechen ────────
# Die Boolean-Wand erbt UVs vom Deckel-n-Gon: Ober- und Unterkante liegen bei
# gleichem x/y, also praktisch identische UVs -> entartete Flaeche, flaches Grau.
# Texeldichte wird aus der VORHANDENEN PlayFloor-Aussenwand gemessen, damit die
# Groessenwirkung uebereinstimmt. Material bleibt M_Marble, keine neue Textur.
def wall_density(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    uvl = bm.loops.layers.uv.active
    du, dv = [], []
    for f in bm.faces:
        if abs(f.normal.z) > 0.35:
            continue                                  # keine Wandflaeche
        if (sum(math.hypot(v.co.x, v.co.y) for v in f.verts) / len(f.verts)) < 8.0:
            continue                                  # nur die aeussere Originalwand
        ls = f.loops[:]
        for i in range(len(ls)):
            a, b = ls[i], ls[(i + 1) % len(ls)]
            w = (b.vert.co - a.vert.co)
            t = (b[uvl].uv - a[uvl].uv).length
            if w.length < 1e-6 or t < 1e-9:
                continue
            if abs(w.z) > 0.7 * w.length:
                dv.append(t / abs(w.z))               # vertikal
            elif abs(w.z) < 0.3 * w.length:
                du.append(t / w.length)               # horizontal
    bm.free()
    med = lambda a: sorted(a)[len(a) // 2] if a else 0.0
    return med(du), med(dv)

DU, DV = wall_density(floor)
log('Texeldichte der vorhandenen PlayFloor-Aussenwand: U=%.5f  V=%.5f  (UV je Welteinheit)' % (DU, DV))
if DU <= 0 or DV <= 0:
    log('FEHLER: Texeldichte nicht messbar'); sys.exit(1)

R_MEAN = sum(cut_r) / len(cut_r)
CIRC = 2 * math.pi * R_MEAN
# ISOTROP: horizontale Kachelgroesse = vertikale (1/DV). Der Umfang traegt damit
# rechnerisch CIRC*DV = 17.8 Kacheln -> auf 18 gerundet, dadurch nahtlos umlaufend
# bei nur 1.1 % Abweichung von der exakten Isotropie.
TILES = 18
DU_W = TILES / CIRC
log('Wand-UV isotrop: Umfang %.3f  Kacheln %d  -> horizontal 1 Kachel je %.3f, vertikal je %.3f Einheiten'
    % (CIRC, TILES, CIRC / TILES, 1.0 / DV))

def uv_cut_wall(ob):
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
    uvl = bm.loops.layers.uv.active
    n = 0
    zs = [v.co.z for v in bm.verts]
    z0 = min(zs)
    for f in bm.faces:
        if abs(f.normal.z) > 0.35:
            continue
        rm = sum(math.hypot(v.co.x, v.co.y) for v in f.verts) / len(f.verts)
        if rm > 8.0:
            continue                                  # Originalaussenwand nicht anfassen
        thc = math.atan2(sum(v.co.y for v in f.verts), sum(v.co.x for v in f.verts))
        for l in f.loops:
            c = l.vert.co
            th = math.atan2(c.y, c.x)
            th = thc + ((th - thc + math.pi) % (2 * math.pi) - math.pi)   # um Flaechenmitte entrollen
            l[uvl].uv = (th * R_MEAN * DU_W, (c.z - z0) * DV)
        n += 1
    bm.to_mesh(me); bm.free()
    return n

for ob in (core, ring):
    n = uv_cut_wall(ob)
    log('  %-18s neu abgewickelte Wandflaechen: %d' % (ob.name, n))

# Kontrolle: keine entarteten UV-Flaechen mehr auf der Schnittwand
def uv_audit(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    degen = 0; checked = 0
    for f in bm.faces:
        rm = sum(math.hypot(v.co.x, v.co.y) for v in f.verts) / len(f.verts)
        if abs(f.normal.z) > 0.35 or rm > 8.0:
            continue
        checked += 1
        uvs = [l[uvl].uv for l in f.loops]
        a = 0.0
        for i in range(len(uvs)):
            p, q = uvs[i], uvs[(i + 1) % len(uvs)]
            a += p.x * q.y - q.x * p.y
        if abs(a) * 0.5 < 1e-9:
            degen += 1
    bm.free()
    log('  %-18s Schnittwandflaechen=%d  entartete UV-Flaechen=%d' % (ob.name, checked, degen))
    return degen
uvbad = uv_audit(core) + uv_audit(ring)
log('Wand-UVs: %s' % ('SAUBER' if uvbad == 0 else 'ENTARTET (%d)' % uvbad))

# Original und Schneidkoerper entfernen
for o in (floor, cutter):
    bpy.data.objects.remove(o, do_unlink=True)

# ── 5) Export ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='AUTO')
log('exportiert: %s (%.2f MB)' % (OUT, os.path.getsize(OUT) / 1048576))
json.dump({'cut_min': min(cut_r), 'cut_max': max(cut_r), 'cut_mean': sum(cut_r) / len(cut_r), 'loop_pts': len(cut_loop),
           'ring1_edge_min': raw_min, 'ring1_edge_max': raw_max, 'scale': SCALE},
          open(os.path.join(ROOT, 'artifacts', 'stage2_probe', 'cut.json'), 'w'), indent=1)
log('DONE')
