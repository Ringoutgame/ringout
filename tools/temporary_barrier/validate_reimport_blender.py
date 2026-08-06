# validate_reimport_blender.py — GLB round-trip check in a FRESH scene (validation 2)
#
#   blender -b --factory-startup -P validate_reimport_blender.py -- --glb <file> --out <dir>
#
# Imports the exported GLB, measures the geometry against the frozen polish2
# contract (values in canonical segment-0 orientation, Blender Z-up:
# wall centered on +Y axis, arc r=10.1, span 30deg, field z 0.22..1.90),
# checks materials, and renders three verification views.
# Results -> reimport_report.json (merged into validation_report.json).

import bpy
import json
import math
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
ASSET_DIR = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'temporary_barrier'))
GLB = os.path.abspath(arg('--glb', os.path.join(ASSET_DIR, 'export', 'temporary_barrier_polish2.glb')))
OUT = os.path.abspath(arg('--out', os.path.join(ASSET_DIR, 'validation')))
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)

checks = []


def check(name, ok, detail=''):
    checks.append({'check': name, 'pass': bool(ok), 'detail': str(detail)})
    print(f'[{"PASS" if ok else "FAIL"}] {name}  {detail}')


objs = {o.name: o for o in bpy.data.objects}
check('objects = root + 6 meshes', len(objs) == 7, sorted(objs))
root = objs.get('TemporaryBarrier')
check('root exists and is an empty', root is not None and root.type == 'EMPTY')
if root:
    ident = (tuple(root.location) == (0, 0, 0) and tuple(root.scale) == (1, 1, 1)
             and tuple(root.rotation_euler) == (0, 0, 0))
    check('root pivot at arena center, identity transform', ident,
          f'loc {tuple(root.location)} rot {tuple(root.rotation_euler)} scale {tuple(root.scale)}')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
check('no cameras/lights imported',
      not [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')])
check('all meshes parented to root', all(o.parent == root for o in meshes))
check('no animations', not bpy.data.actions, list(bpy.data.actions))


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


# field: exact collider arc ------------------------------------------------------
field = objs.get('BarrierField')
if field:
    vs = world_verts(field)
    radii = [math.hypot(v.x, v.y) for v in vs]
    zs = [v.z for v in vs]
    angs = [math.degrees(math.atan2(v.y, v.x)) for v in vs]
    check('field radius == 10.1 (tol 1e-4)',
          abs(min(radii) - 10.1) < 1e-4 and abs(max(radii) - 10.1) < 1e-4,
          f'r {min(radii):.6f}..{max(radii):.6f}')
    check('field z span 0.22..1.90 (tol 1e-4)',
          abs(min(zs) - 0.22) < 1e-4 and abs(max(zs) - 1.90) < 1e-4,
          f'z {min(zs):.6f}..{max(zs):.6f}')
    check('field arc = canonical segment 0 (Blender 75..105 deg, tol 0.01)',
          abs(min(angs) - 75.0) < 0.01 and abs(max(angs) - 105.0) < 0.01,
          f'angles {min(angs):.4f}..{max(angs):.4f} deg (span {max(angs)-min(angs):.4f})')
    check('field vertex count preserved (2*(48+1)=98)', len(vs) == 98, len(vs))

# pylons on the segment borders --------------------------------------------------
pyl = objs.get('BarrierPylons')
if pyl:
    vs = world_verts(pyl)
    a_pos = [math.degrees(math.atan2(v.y, v.x)) for v in vs]
    lo = [a for a in a_pos if a < 90]
    hi = [a for a in a_pos if a >= 90]
    mid_lo = (min(lo) + max(lo)) / 2
    mid_hi = (min(hi) + max(hi)) / 2
    check('pylon centers on segment borders 75/105 deg (tol 0.15 deg)',
          abs(mid_lo - 75.0) < 0.15 and abs(mid_hi - 105.0) < 0.15,
          f'centers {mid_lo:.3f} / {mid_hi:.3f} deg')
    zs = [v.z for v in vs]
    check('pylon height: shoe 0.16 -> cap 2.14 (tol 1e-3)',
          abs(min(zs) - 0.16) < 1e-3 and abs(max(zs) - 2.14) < 1e-3,
          f'z {min(zs):.5f}..{max(zs):.5f}')

# whole-asset containment --------------------------------------------------------
all_r = []
all_z = []
for o in meshes:
    for v in world_verts(o):
        all_r.append(math.hypot(v.x, v.y))
        all_z.append(v.z)
check('nothing enters the playfield (min r >= 9.7, walkway band)',
      min(all_r) >= 9.7, f'min r {min(all_r):.4f}')
check('nothing below the walkway top - seat tolerance (z >= 0.159)',
      min(all_z) >= 0.1589, f'min z {min(all_z):.5f}')

# materials ----------------------------------------------------------------------
mats = {m.name: m for m in bpy.data.materials}
check('6 materials with expected names',
      sorted(mats) == ['M_BarrierDock', 'M_BarrierEmit', 'M_BarrierField',
                       'M_BarrierFrame', 'M_BarrierGold', 'M_BarrierMarble'], sorted(mats))
mf = mats.get('M_BarrierField')
check('field material: blend mode + double sided after round trip',
      mf and mf.blend_method == 'BLEND' and not mf.use_backface_culling,
      f'blend={getattr(mf, "blend_method", None)} backface_culling={getattr(mf, "use_backface_culling", None)}')
imgs = sorted(i.name for i in bpy.data.images if i.name != 'Render Result')
check('7 textures arrived', len(imgs) == 7, imgs)
slot_map = {o.name: [m.name if m else None for m in o.data.materials] for o in meshes}
expected_slots = {
    'BarrierField': ['M_BarrierField'], 'BarrierPylons': ['M_BarrierMarble'],
    'BarrierEmitters': ['M_BarrierEmit'], 'BarrierDockGlow': ['M_BarrierDock'],
    'BarrierFrame': ['M_BarrierFrame'], 'BarrierGold': ['M_BarrierGold']}
check('material slots as expected', slot_map == expected_slots, slot_map)

# renders ------------------------------------------------------------------------
scn.render.engine = 'BLENDER_EEVEE_NEXT'
scn.render.resolution_x = 1280
scn.render.resolution_y = 720
scn.render.film_transparent = False
w = bpy.data.worlds.new('W')
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
bg.inputs['Color'].default_value = (0.28, 0.32, 0.38, 1)
bg.inputs['Strength'].default_value = 0.7
scn.world = w
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (math.radians(50), 0, math.radians(160))
scn.collection.objects.link(sun)


def look_at(obj, target):
    d = (target[0] - obj.location[0], target[1] - obj.location[1], target[2] - obj.location[2])
    yaw = math.atan2(d[1], d[0])
    pitch = math.atan2(d[2], math.hypot(d[0], d[1]))
    obj.rotation_euler = (math.pi / 2 + pitch, 0, yaw - math.pi / 2)


def shoot(name, loc, target, lens=40):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    cam.data.lens = lens
    scn.collection.objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    scn.camera = cam
    scn.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('[reimport] rendered', name)


# canonical seg 0: wall centered on Blender +Y
shoot('reimport_1_overview', (-9.0, -4.5, 7.5), (0.0, 8.0, 0.8), 32)
shoot('reimport_2_front', (0.0, 2.2, 1.2), (0.0, 10.1, 1.0), 38)
shoot('reimport_3_dock_detail', (-2.35, 7.4, 1.75), (-2.55, 9.72, 1.65), 45)

rep = {'passed': all(c['pass'] for c in checks), 'checks': checks,
       'renders': ['reimport_1_overview.png', 'reimport_2_front.png', 'reimport_3_dock_detail.png']}
with open(os.path.join(OUT, 'reimport_report.json'), 'w') as f:
    json.dump(rep, f, indent=2)
rp = os.path.join(OUT, 'validation_report.json')
full = {}
if os.path.exists(rp):
    with open(rp) as f:
        full = json.load(f)
full['blender_reimport'] = rep
with open(rp, 'w') as f:
    json.dump(full, f, indent=2)
print(f'[reimport] {sum(c["pass"] for c in checks)}/{len(checks)} checks passed')
