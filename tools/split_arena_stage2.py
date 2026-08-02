# Teilt AUSSCHLIESSLICH das bestehende PlayFloor-Mesh der Arena in
#   PlayFloor_Core             — verbleibender innerer Kern (r < Trennkante)
#   PlayFloor_Stage2_Wedge_01..06 — der Aussenring (Trennkante .. 8.70), aufgeteilt
#                                in sechs Boden-Keile, deren Winkelgrenzen den
#                                sechs Ring-Collapse-Segmenten entsprechen
# entlang der SKALIERTEN Ring-1-Bruchkante (x0.82). Es wird keine Silhouette
# erfunden: die Trennkurve wird aus der inneren Bruchflaeche des freigegebenen
# Collapse-GLB ausgelesen und mit 0.82 skaliert; die sechs Fugenmitten stammen aus
# DEMSELBEN Asset (Winkelgrenzen der Segmente) — keine hart kodierten Winkel.
#
# WARUM SECHS KEILE: ein Rotationskoerper kann nicht segmentweise zerfallen. Als
# monolithischer Ring bliebe der Stage-2-Boden unter den fallenden Segmenten als
# geschlossene Flaeche stehen und muesste spaeter global ausgeblendet werden —
# sichtbar als zweiter Pop. Jeder Keil faellt stattdessen mit genau dem Segment,
# unter dem er liegt (identische Transformation zur Laufzeit).
#
# PlayFloor ist ein geschlossener Koerper (Deckel-n-Gon, Randwand, Boden bei
# y=-1.2). Ein Boolean-Schnitt liefert deshalb auf beiden Seiten geschlossene
# Koerper — die neue Innenwand des Kerns entsteht dabei automatisch mit
# demselben Material; UVs werden vom Solver interpoliert.
#
# Aufruf:
#   "D:\Blender\blender.exe" --background --factory-startup --python tools/split_arena_stage2.py
#   ... --python tools/split_arena_stage2.py -- --out assets/<vorschau>.glb
#
# Schreibt NUR die Zieldatei (Default: das Produktasset). arena_platform.glb und
# das Ring-1-Collapse-GLB bleiben unberuehrt. --out schreibt in eine Vorschau-
# datei, wenn eine Aenderung erst visuell abgenommen werden soll.

import bpy, bmesh, math, os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARENA = os.path.join(ROOT, 'assets', 'arena_platform.glb')
COLL = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                    'six_segment_rollout', 'ring_collapse_six_segment_simplified.glb')
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.join(ROOT, 'assets', 'arena_platform_stage2.glb')
if '--out' in _argv:
    OUT = os.path.join(ROOT, _argv[_argv.index('--out') + 1])

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

# ── 1b) Sechs Fugenmitten aus DENSELBEN Segmenten ───────────────────────────
# Die Segmentflanken sind nicht plan, sondern verzahnt: benachbarte Segmente
# ueberlappen winkelmaessig um rund 1.5 Grad. Die Bodenfuge liegt genau in der
# Mitte dieses Ueberlappungsbands — damit liegt jeder Keil unter seinem Segment
# und die Abweichung ist auf beiden Seiten gleich klein. Alles aus dem Asset
# gemessen; kein Winkel steht hier als Konstante.
TAU = 2 * math.pi

def angular_extent(ob):
    """Winkelbereich (start, end) eines Segments; wrapt korrekt ueber 0 Grad,
    weil die Grenze an der GROESSTEN Winkelluecke der Punktwolke gesucht wird."""
    ths = []
    for ch in [ob] + list(ob.children_recursive):
        if ch.type != 'MESH':
            continue
        mw = ch.matrix_world
        for v in ch.data.vertices:
            w = mw @ v.co
            if math.hypot(w.x, w.y) > 1e-6:
                ths.append(math.atan2(w.y, w.x) % TAU)
    ths.sort()
    gi, gap = 0, 0.0
    for i in range(len(ths)):
        d = (ths[(i + 1) % len(ths)] - ths[i]) % TAU
        if d > gap:
            gap, gi = d, i
    return ths[(gi + 1) % len(ths)], ths[gi], gap

SEG_NAMES = sorted({o.name.split('_')[0] for o in segs})
if len(SEG_NAMES) != 6:
    log('FEHLER: %d statt 6 Segmente im Collapse-GLB (%s)' % (len(SEG_NAMES), SEG_NAMES)); sys.exit(1)
seg_span = {}
for sn in SEG_NAMES:
    ob = next(o for o in segs if o.name.startswith(sn) and '_Cracked' not in o.name)
    st, en, gp = angular_extent(ob)
    seg_span[sn] = (st, en)
    log('%s  Winkel %8.3f .. %8.3f Grad  (Spanne %6.3f, Luecke %6.3f)'
        % (sn, math.degrees(st), math.degrees(en), math.degrees((en - st) % TAU), math.degrees(gp)))

# Fuge zwischen Segment i und i+1 = Mitte des Ueberlappungsbands [start_{i+1}, end_i].
joint = []                      # joint[i] = Fuge zwischen SEG_NAMES[i] und SEG_NAMES[i+1]
for i in range(6):
    en = seg_span[SEG_NAMES[i]][1]
    st = seg_span[SEG_NAMES[(i + 1) % 6]][0]
    ov = (en - st) % TAU
    if ov > math.radians(10.0):
        log('FEHLER: Ueberlappung %s/%s betraegt %.2f Grad — Fugenmitte unsicher'
            % (SEG_NAMES[i], SEG_NAMES[(i + 1) % 6], math.degrees(ov))); sys.exit(1)
    joint.append((st + ov * 0.5) % TAU)
    log('Fuge %s|%s: Ueberlappung %.3f Grad  ->  Fugenmitte %8.4f Grad'
        % (SEG_NAMES[i], SEG_NAMES[(i + 1) % 6], math.degrees(ov), math.degrees(joint[-1])))

# Keil i liegt zwischen der Fuge VOR und der Fuge NACH Segment i.
wedge_arc = {}
for i, sn in enumerate(SEG_NAMES):
    a, b = joint[(i - 1) % 6], joint[i]
    wedge_arc[sn] = (a, b)
    log('Keil zu %s: %8.4f .. %8.4f Grad  (Spanne %7.4f)'
        % (sn, math.degrees(a), math.degrees(b), math.degrees((b - a) % TAU)))
_sum = sum(math.degrees((wedge_arc[sn][1] - wedge_arc[sn][0]) % TAU) for sn in SEG_NAMES)
log('Summe der sechs Keilspannen: %.6f Grad' % _sum)
if abs(_sum - 360.0) > 1e-6:
    log('FEHLER: Keilspannen ergeben nicht 360 Grad'); sys.exit(1)

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

# ── 6) Aussenring in sechs Boden-Keile teilen ───────────────────────────────
# Ein Dreiecksprisma je Keil: Zentrum + zwei Strahlen auf den Fugenmitten. Die
# Flankenpunkte benachbarter Prismen stammen aus DERSELBEN Fugenzahl, sind also
# bitgleich — der EXACT-Solver schneidet beide Nachbarn auf exakt derselben
# Ebene. Deshalb entsteht weder ein Spalt noch eine Ueberlappung, und es gibt
# keine zwei fast-koplanaren Flaechen, die Z-Fighting erzeugen koennten.
R_BIG = 20.0        # weit ausserhalb r_max=8.70; die Sehne liegt selbst bei der
                    # groessten Spanne (74 Grad) noch bei r=15.97
def sector_prism(a, b, name):
    bm = bmesh.new()
    lo, up = [], []
    for (x, y) in ((0.0, 0.0), (R_BIG * math.cos(a), R_BIG * math.sin(a)),
                   (R_BIG * math.cos(b), R_BIG * math.sin(b))):
        lo.append(bm.verts.new((x, y, zlo)))
        up.append(bm.verts.new((x, y, zhi)))
    bm.verts.ensure_lookup_table()
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((lo[i], lo[j], up[j], up[i]))
    bmesh.ops.contextual_create(bm, geom=lo)
    bmesh.ops.contextual_create(bm, geom=up)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob

def volume(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    v = bm.calc_volume(signed=False); bm.free()
    return v

def top_area(ob):
    """Flaeche der Deckflaechen (z ~ 0) — die im Spiel sichtbare Bodenflaeche."""
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    a = sum(f.calc_area() for f in bm.faces if f.normal.z > 0.7)
    bm.free()
    return a

ring_vol, ring_top = volume(ring), top_area(ring)
log('Aussenring vor der Teilung: Volumen %.6f  Deckflaeche %.6f' % (ring_vol, ring_top))

wedges = []
for i, sn in enumerate(SEG_NAMES):
    a, b = wedge_arc[sn]
    cut = sector_prism(a, b, 'Wedge_Cutter_%s' % sn)
    w = ring.copy(); w.data = ring.data.copy()
    w.name = 'PlayFloor_Stage2_Wedge_%02d' % (i + 1)
    scene.collection.objects.link(w)
    m = w.modifiers.new('wedge', 'BOOLEAN')
    m.object = cut; m.operation = 'INTERSECT'; m.solver = 'EXACT'
    bpy.context.view_layer.objects.active = w
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cut, do_unlink=True)
    wedges.append((sn, w))
    log('%-28s <- %s  %5d Verts  %5d Polygone'
        % (w.name, sn, len(w.data.vertices), len(w.data.polygons)))

# ── 6a) UVs der NEUEN Radialflanken ─────────────────────────────────────────
# Die Flanken erben UVs von der Deckflaeche (Ober-/Unterkante bei gleichem x/y
# -> entartet). Sie sind im geschlossenen Zustand unsichtbar, werden aber beim
# Fall zur Bruchflaeche. Abwicklung: u laeuft radial, v ueber die Hoehe, beides
# mit der bereits gemessenen Texeldichte der Original-Aussenwand.
def is_joint_wall(f):
    if abs(f.normal.z) > 0.35:
        return False
    c = f.calc_center_median()
    rl = math.hypot(c.x, c.y)
    if rl < 1e-6:
        return False
    # Normale einer Radialflanke steht senkrecht auf der Radialrichtung.
    return abs((f.normal.x * c.x + f.normal.y * c.y) / rl) < 0.35

def uv_joint_wall(ob, z0):
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
    uvl = bm.loops.layers.uv.active
    n = 0
    for f in bm.faces:
        if not is_joint_wall(f):
            continue
        for l in f.loops:
            c = l.vert.co
            l[uvl].uv = (math.hypot(c.x, c.y) * DU_W, (c.z - z0) * DV)
        n += 1
    bm.to_mesh(me); bm.free()
    return n

Z0 = min(v.co.z for v in ring.data.vertices)
for sn, w in wedges:
    log('  %-28s neu abgewickelte Radialflanken: %d' % (w.name, uv_joint_wall(w, Z0)))

# ── 6b) Pflichtpruefungen der Keilzerlegung ─────────────────────────────────
fail = 0
vs = sum(volume(w) for _, w in wedges)
ts = sum(top_area(w) for _, w in wedges)
# Relative Toleranz: die Summe einzeln triangulierter Keile weicht durch reine
# Float-Akkumulation um ~1e-7 relativ ab. Eine ECHTE Fuge waere Groessenordnungen
# groesser — schon 0.01 Grad Spalt entfernen 3e-5 relativ.
AREA_TOL = 1e-6
dv, dt = abs(vs - ring_vol) / ring_vol, abs(ts - ring_top) / ring_top
log('Summe Keile: Volumen %.6f (rel. Abweichung %.3e)  Deckflaeche %.6f (rel. Abweichung %.3e)'
    % (vs, dv, ts, dt))
if dv > AREA_TOL or dt > AREA_TOL:
    log('FEHLER: Keile decken den Ring nicht exakt ab (Luecke oder Ueberlappung)'); fail += 1

# Gemeinsame Fugenebene: die Flankenpunkte beider Nachbarn muessen deckungsgleich
# sein — das schliesst Spalt UND Ueberlappung punktgenau aus.
PLANE_TOL = 1e-5

def flank(ob, th):
    """Punkte des Keils auf der Fugenebene durch die z-Achse in Richtung th."""
    nx, ny = -math.sin(th), math.cos(th)
    rx, ry = math.cos(th), math.sin(th)
    pts, dmax = [], 0.0
    for v in ob.data.vertices:
        c = v.co
        d = c.x * nx + c.y * ny
        if abs(d) < PLANE_TOL and (c.x * rx + c.y * ry) > 1e-6:
            pts.append((round(c.x, 6), round(c.y, 6), round(c.z, 6)))
            dmax = max(dmax, abs(d))
    return sorted(set(pts)), dmax

for i in range(6):
    th = joint[i]
    pa, da = flank(wedges[i][1], th)
    pb, db = flank(wedges[(i + 1) % 6][1], th)
    same = pa == pb and len(pa) > 0
    log('Fuge %d (%8.4f Grad): %s %3d Punkte | %s %3d Punkte  deckungsgleich=%s  max|d|=%.2e'
        % (i + 1, math.degrees(th), wedges[i][1].name[-2:], len(pa),
           wedges[(i + 1) % 6][1].name[-2:], len(pb), same, max(da, db)))
    if not same:
        log('FEHLER: Fugenebene %d ist nicht deckungsgleich' % (i + 1)); fail += 1

# Zuordnung geometrisch bestaetigen: der Winkelbereich des Keils muss innerhalb
# des Winkelbereichs SEINES Segments liegen.
def dsigned(a, b):
    """b - a, auf (-pi, pi] normiert."""
    return (b - a + math.pi) % TAU - math.pi

for i, (sn, w) in enumerate(wedges):
    st, en, _ = angular_extent(w)
    a, b = wedge_arc[sn]
    ss, se = seg_span[sn]
    e_a, e_b = math.degrees(dsigned(a, st)), math.degrees(dsigned(b, en))
    m_a, m_b = math.degrees(dsigned(ss, st)), math.degrees(dsigned(en, se))
    ok = abs(e_a) < 1e-3 and abs(e_b) < 1e-3 and m_a > -1e-6 and m_b > -1e-6
    log('%-28s -> %s  Keil %8.4f..%8.4f Grad  Sollabweichung %+.5f/%+.5f  Rand im Segment %+.4f/%+.4f  %s'
        % (w.name, sn, math.degrees(st), math.degrees(en), e_a, e_b, m_a, m_b,
           'OK' if ok else 'AUSSERHALB'))
    if not ok:
        log('FEHLER: %s liegt nicht vollstaendig unter %s' % (w.name, sn)); fail += 1

# Entartete UVs auf den neuen Radialflanken (uv_audit deckt nur die Innenwand ab)
def uv_joint_audit(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.normal_update()
    uvl = bm.loops.layers.uv.active
    checked = degen = 0
    for f in bm.faces:
        if not is_joint_wall(f):
            continue
        checked += 1
        uvs = [l[uvl].uv for l in f.loops]
        a = sum(uvs[k].x * uvs[(k + 1) % len(uvs)].y - uvs[(k + 1) % len(uvs)].x * uvs[k].y
                for k in range(len(uvs)))
        if abs(a) * 0.5 < 1e-9:
            degen += 1
    bm.free()
    log('  %-28s Radialflanken=%d  entartete UV-Flaechen=%d' % (ob.name, checked, degen))
    return degen

for _, w in wedges:
    fail += 1 if audit(w) else 0
for _, w in wedges:
    fail += 1 if (uv_audit(w) + uv_joint_audit(w)) else 0
log('Keilzerlegung: %s' % ('BESTANDEN' if fail == 0 else 'FEHLGESCHLAGEN (%d)' % fail))
if fail:
    sys.exit(1)

# Original, Monolith-Ring und Schneidkoerper entfernen
for o in (floor, cutter, ring):
    bpy.data.objects.remove(o, do_unlink=True)

# ── 7) Export ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_image_format='AUTO')
log('exportiert: %s (%.2f MB)' % (OUT, os.path.getsize(OUT) / 1048576))
probe = os.path.join(ROOT, 'artifacts', 'stage2_probe')
os.makedirs(probe, exist_ok=True)
json.dump({'cut_min': min(cut_r), 'cut_max': max(cut_r), 'cut_mean': sum(cut_r) / len(cut_r), 'loop_pts': len(cut_loop),
           'ring1_edge_min': raw_min, 'ring1_edge_max': raw_max, 'scale': SCALE,
           'joints_deg': [math.degrees(t) for t in joint],
           'wedges': {w.name: {'segment': sn,
                               'arc_deg': [math.degrees(wedge_arc[sn][0]), math.degrees(wedge_arc[sn][1])],
                               'verts': len(w.data.vertices), 'polys': len(w.data.polygons)}
                      for sn, w in wedges},
           'ring_volume': ring_vol, 'wedge_volume_sum': vs,
           'ring_top_area': ring_top, 'wedge_top_area_sum': ts},
          open(os.path.join(probe, 'cut.json'), 'w'), indent=1)
log('DONE')
