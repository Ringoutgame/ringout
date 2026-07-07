# Builds assets/arena_platform.glb per BLENDER_ASSET_SPEC.md.
# Run headless:  "D:\Blender\blender.exe" --background --factory-startup --python tools/build_arena_platform.py
# Blender 4.4 / Python API. Coordinate system: Blender Z-up; glTF exporter converts to +Y-up.

import bpy, math, os, random
import numpy as np

random.seed(7)
np.random.seed(7)

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'arena_platform.glb')

# ── clean scene ──────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)

# ── real CC0 PBR textures (ambientCG, 2K JPG) — packed into .blend/.glb ─
TEXDIR = os.path.join(os.path.dirname(OUT), 'textures')

def load_img(path, noncolor=False):
    img = bpy.data.images.load(path)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    img.pack()
    return img

def load_color_with_ao(color_path, ao_path, tint=None, ao_mix=0.65):
    """Pre-multiply AO (and optional cool tint) into the color map (robust for glTF export)."""
    c = bpy.data.images.load(color_path, check_existing=True)
    need = (ao_path and os.path.exists(ao_path)) or tint
    if need:
        n = c.size[0] * c.size[1] * 4
        cp = np.empty(n, np.float32); c.pixels.foreach_get(cp)
        cp = cp.reshape(-1, 4)
        if ao_path and os.path.exists(ao_path):
            a = bpy.data.images.load(ao_path)
            if tuple(a.size) == tuple(c.size):
                ap = np.empty(n, np.float32); a.pixels.foreach_get(ap)
                cp[:, :3] *= ((1.0 - ao_mix) + ao_mix * ap.reshape(-1, 4)[:, :1])
            bpy.data.images.remove(a)
        if tint:
            cp[:, :3] *= np.array(tint, np.float32)
        c.pixels.foreach_set(np.clip(cp, 0, 1).ravel()); c.update()
    c.pack()
    return c

def texset(folder, base, with_ao=False, tint=None, ao_mix=0.65):
    d = os.path.join(TEXDIR, folder)
    col = load_color_with_ao(os.path.join(d, base + '_Color.jpg'),
                             os.path.join(d, base + '_AmbientOcclusion.jpg') if with_ao else None, tint, ao_mix)
    nrm = load_img(os.path.join(d, base + '_NormalGL.jpg'), noncolor=True)
    rgh = load_img(os.path.join(d, base + '_Roughness.jpg'), noncolor=True)
    return col, nrm, rgh

def texset_ph(folder, base, with_ao=True, tint=None, ao_mix=0.65):
    """Poly-Haven-Namensschema (diff/nor_gl/rough/ao)."""
    d = os.path.join(TEXDIR, folder)
    col = load_color_with_ao(os.path.join(d, base + '_diff_2k.jpg'),
                             os.path.join(d, base + '_ao_2k.jpg') if with_ao else None, tint, ao_mix)
    nrm = load_img(os.path.join(d, base + '_nor_gl_2k.jpg'), noncolor=True)
    rgh = load_img(os.path.join(d, base + '_rough_2k.jpg'), noncolor=True)
    return col, nrm, rgh

def mat_new(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree.nodes['Principled BSDF']

def pbr_mat(name, tset, scale=(1, 1, 1), metal=0.0):
    m, b = mat_new(name)
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = scale
    nt.links.new(tc.outputs['UV'], mp.inputs['Vector'])
    def img_node(img):
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n
    col, nrm, rgh = tset
    nt.links.new(img_node(col).outputs['Color'], b.inputs['Base Color'])
    nt.links.new(img_node(rgh).outputs['Color'], b.inputs['Roughness'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(img_node(nrm).outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = metal
    return m

def mat_plain(name, color, rough, metal):
    m, b = mat_new(name)
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

# Marmor-Set einmal laden, zwei Materialien daraus (Boden fein, Unterbau groeber skaliert)
_marble = texset('Marble012_2K', 'Marble012_2K-JPG')
M_Marble     = pbr_mat('M_Marble',     _marble, scale=(4, 4, 1))
# polierter heiliger Marmor: dezente Clearcoat-Schicht (exportiert als KHR_materials_clearcoat)
_mb = M_Marble.node_tree.nodes['Principled BSDF']
_mb.inputs['Coat Weight'].default_value = 0.22
_mb.inputs['Coat Roughness'].default_value = 0.2
M_MarbleWall = pbr_mat('M_MarbleWall', _marble, scale=(2.2, 2.2, 1))
# helles, kuehles Steinmauerwerk — sanftes AO, aufgehellt: sauber-massiv statt dunkel-schmutzig
M_Stone  = pbr_mat('M_Stone', texset_ph('stone_brick_wall_001_2K', 'stone_brick_wall_001',
                                        tint=(1.04, 1.09, 1.17), ao_mix=0.45), scale=(6, 2, 1))
M_Rock   = pbr_mat('M_Rock',  texset('Rock030_2K', 'Rock030_2K-JPG', with_ao=True,
                                     tint=(0.96, 1.02, 1.14), ao_mix=0.5), scale=(3, 2, 1))
M_Gold   = mat_plain('M_Gold', (0.52, 0.42, 0.2), 0.33, 1.0)   # edles, klar reflektierendes Gold
M_Crystal, cb = mat_new('M_Crystal')
cb.inputs['Base Color'].default_value = (0.42, 0.74, 0.94, 1)
cb.inputs['Roughness'].default_value = 0.02
cb.inputs['IOR'].default_value = 1.5
cb.inputs['Transmission Weight'].default_value = 0.92

# ── geometry helpers ─────────────────────────────────────────────────────
def setmat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)

def cyl(r, depth, z, mat, verts=96, name='cyl'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(0, 0, z))
    o = bpy.context.object; o.name = name; setmat(o, mat); return o

def cone(r1, r2, depth, z, mat, verts=48, name='cone', loc=None, rot=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                    location=loc or (0, 0, z))
    o = bpy.context.object; o.name = name
    if rot: o.rotation_euler = rot
    setmat(o, mat); return o

def torus(r, minor, z, mat, name='torus'):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=minor, location=(0, 0, z),
                                     major_segments=128, minor_segments=12)
    o = bpy.context.object; o.name = name; setmat(o, mat); return o

def box(sx, sy, sz, loc, rz, mat, name='box'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name
    o.scale = (sx, sy, sz); o.rotation_euler = (0, 0, rz)
    setmat(o, mat); return o

def bevel(o, width=0.04, segs=2):
    m = o.modifiers.new('bv', 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'

def displace(o, strength, size):
    t = bpy.data.textures.new('dtx', 'CLOUDS'); t.noise_scale = size
    m = o.modifiers.new('dp', 'DISPLACE'); m.texture = t; m.strength = strength

# ── build: top surfaces ──────────────────────────────────────────────────
play = cyl(8.7, 1.2, -0.6, M_Marble, verts=128, name='PlayFloor')      # top exactly z=0
bevel(play, 0.03)

walk = cyl(10.1, 0.32, 0.0, M_Marble, verts=128, name='Walkway')       # top z=+0.16
bevel(walk, 0.05)
cutter = cyl(8.7, 2.0, 0.0, M_Marble, verts=128, name='cutter')
bo = walk.modifiers.new('bool', 'BOOLEAN'); bo.operation = 'DIFFERENCE'; bo.object = cutter
bpy.context.view_layer.objects.active = walk
bpy.ops.object.modifier_apply(modifier='bool')
bpy.data.objects.remove(cutter, do_unlink=True)

# gold inlays: duenn und in die Oberflaeche VERSENKT (nur Oberkante sichtbar) -> Inlay statt Brettspiel-Linie
for f in (0.34, 0.56, 0.78):
    torus(8.4 * f, 0.032, -0.016, M_Gold, name=f'GoldRing_{f}')   # tiefer versenkt -> flaches Inlay-Band
torus(0.45, 0.03, -0.016, M_Gold, name='GoldMedallion')
# Heiliges Emblem: praeziser, subtiler 8-strahliger Stern als flaches Inlay + feiner Begleitring
for k in range(8):
    a = math.radians(k * 45)
    ln = 1.3 if k % 2 == 0 else 0.85
    box(ln, 0.06, 0.026, (math.cos(a) * (0.52 + ln / 2), math.sin(a) * (0.52 + ln / 2), -0.014),
        a, M_Gold, name=f'StarRay_{k}')
torus(2.1, 0.018, -0.016, M_Gold, name='GoldStarRing')
torus(8.7, 0.045, 0.146, M_Gold, name='GoldStepEdge')
torus(9.35, 0.04, 0.146, M_Gold, name='GoldWalkRing')

# ── cornice / profile edge ───────────────────────────────────────────────
c1 = cyl(10.28, 0.26, -1.28, M_MarbleWall, name='Cornice1'); bevel(c1, 0.05)
c2 = cyl(10.50, 0.30, -1.55, M_MarbleWall, name='Cornice2'); bevel(c2, 0.06)
c3 = cyl(10.15, 0.26, -1.83, M_MarbleWall, name='Cornice3'); bevel(c3, 0.05)
torus(10.45, 0.05, -1.12, M_Gold, name='GoldCornice1')
torus(9.80, 0.045, -2.0, M_Gold, name='GoldCornice2')

# ── wall ring + 16 pillars ───────────────────────────────────────────────
wall = cyl(9.6, 1.15, -2.55, M_Stone, name='WallRing')
torus(10.15, 0.05, -1.99, M_Gold, name='GoldCapital')            # Goldband unter dem Gesims
for i in range(16):
    a = i * math.pi / 8
    px, py = math.cos(a) * 9.86, math.sin(a) * 9.86
    p = box(0.62, 0.5, 1.05, (px, py, -2.55), a, M_MarbleWall, name=f'Pillar_{i}'); bevel(p, 0.03)
    box(0.8, 0.64, 0.16, (px, py, -1.96), a, M_MarbleWall, name=f'PillarCap_{i}')
    box(0.8, 0.64, 0.16, (px, py, -3.14), a, M_MarbleWall, name=f'PillarBase_{i}')
# breiter Uebergangsring: verbindet Wandzone und Tiers -> massiv statt duenn
tb = cyl(9.95, 0.5, -3.3, M_MarbleWall, name='TierBridge'); bevel(tb, 0.06)

# ── underside: schwebender Stein-/Tempel-Sockel (klar gestufte Tiers statt Zufalls-Geroell) ──
t1 = cyl(9.1, 1.0, -3.8, M_MarbleWall, name='Tier1'); bevel(t1, 0.08)
# 8 Pilaster-Rippen mit Gold-Nieten am obersten Tier -> Tempel-Charakter statt glattem Ring
for k in range(8):
    a = math.radians(k * 45)
    px, py = math.cos(a) * 9.12, math.sin(a) * 9.12
    rib = box(0.26, 0.64, 0.92, (px, py, -3.8), a, M_MarbleWall, name=f'TierRib_{k}'); bevel(rib, 0.03)
    box(0.14, 0.2, 0.2, (math.cos(a) * 9.27, math.sin(a) * 9.27, -3.8), a, M_Gold, name=f'TierStud_{k}')
t2 = cyl(7.8, 1.0, -4.8, M_MarbleWall, name='Tier2');  bevel(t2, 0.08)
t3 = cyl(6.4, 1.0, -5.8, M_MarbleWall, name='Tier3'); bevel(t3, 0.08)
torus(9.1, 0.045, -4.32, M_Gold, name='GoldTier1')
torus(7.8, 0.045, -5.32, M_Gold, name='GoldTier2')
torus(6.45, 0.05, -6.32, M_Gold, name='GoldTipBand')             # Goldband am Uebergang zur Spitze
# umgedrehte Tempel-Spitze: breiter und massiver, klare Form, mildes Relief
tip = cone(0.35, 6.1, 3.3, -7.95, M_Rock, verts=48, name='TempleTip')
displace(tip, 0.28, 3.0)
tipend = cone(0.02, 0.5, 0.9, -9.85, M_Gold, verts=8, name='TipGold')   # goldener Abschluss-Spike

# ── 8 Tempel-Sockel + Kristalle auf dem Randweg (r 9.35, 22.5deg + k*45deg) ──
# Aufbau je Sockel: Doppel-Plinthe mit Gold-Fussleiste -> achteckiger konischer Schaft
# -> Gold-Kragen -> auskragende Deckplatte mit Fase -> Gold-Fassungsring -> Kristall
for k in range(8):
    a = math.radians(22.5 + k * 45)
    px, py = math.cos(a) * 9.35, math.sin(a) * 9.35
    b1 = box(1.45, 1.45, 0.14, (px, py, 0.16 + 0.07), a, M_MarbleWall, name=f'PedPlinth_{k}'); bevel(b1, 0.03)
    box(1.28, 1.28, 0.05, (px, py, 0.16 + 0.165), a, M_Gold, name=f'PedFoot_{k}')       # Gold-Fussleiste
    b2 = box(1.18, 1.18, 0.12, (px, py, 0.16 + 0.25), a, M_MarbleWall, name=f'PedStep_{k}'); bevel(b2, 0.025)
    shaft = cone(0.54, 0.40, 0.5, 0, M_MarbleWall, verts=8, loc=(px, py, 0.16 + 0.56),
                 rot=(0, 0, a), name=f'PedShaft_{k}')                                   # schlanker achteckiger Marmor-Schaft
    bevel(shaft, 0.02)
    kragen = cone(0.46, 0.52, 0.06, 0, M_Gold, verts=8, loc=(px, py, 0.16 + 0.84),
                  rot=(0, 0, a), name=f'PedCollar_{k}')                                 # feiner Gold-Kragen
    b3 = box(1.06, 1.06, 0.12, (px, py, 0.16 + 0.94), a, M_MarbleWall, name=f'PedTop_{k}'); bevel(b3, 0.035)
    # Marmor-Fassung: Kristall sitzt IN einem Sockelkelch statt frei zu schweben
    cup = cone(0.44, 0.3, 0.18, 0, M_MarbleWall, verts=8, loc=(px, py, 0.16 + 1.09),
               rot=(0, 0, a), name=f'PedSocket_{k}')
    bevel(cup, 0.02)
    torus(0.32, 0.03, 0, M_Gold, name=f'PedRing_{k}_a')                                 # Goldring auf der Fassung
    bpy.context.object.location = (px, py, 0.16 + 1.18)
    # Kristalle im Rhythmus: 4 Haupt- (gross) und 4 Nebenkristalle (schlanker) -> weniger repetitiv
    big = (k % 2 == 0)
    cr, ch = (0.40, 1.3) if big else (0.30, 0.95)
    cone(cr, 0.0, ch, 0, M_Crystal, verts=6, loc=(px, py, 0.16 + 1.28 + ch / 2), name=f'CrystalTop_{k}')
    cone(cr, 0.0, ch * 0.45, 0, M_Crystal, verts=6, loc=(px, py, 0.16 + 1.28 - ch * 0.225), name=f'CrystalBot_{k}',
         rot=(math.pi, 0, 0))

# ── export ───────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(OUT), exist_ok=True)
# native .blend daneben speichern -> direkt in Blender oeffnen und pruefen
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('arena_platform.glb', 'arena_platform.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', export_apply=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_yup=True
)
print('EXPORTED:', OUT, os.path.getsize(OUT), 'bytes')
