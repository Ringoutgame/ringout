# export_temporary_barrier.py — RingOut temporary barrier polish2 -> GLB
#
# Loads the APPROVED and FROZEN polish2 .blend (source of truth), strips every
# non-barrier object, bakes the approved procedural materials into textures
# (nothing may be lost silently on glTF export), re-orients the wall to the
# canonical in-game segment 0 and exports a single self-contained GLB.
#
# Usage (canonical location tools/temporary_barrier/):
#   blender -b -P export_temporary_barrier.py -- --out <scratch-dir>
#   (--blend defaults to assets/temporary_barrier/source/temporary_barrier_polish2.blend;
#    ALWAYS pass --out: the run writes GLB + textures/ + bake report + export
#    scene there. Copy the verified GLB to assets/temporary_barrier/export/.)
#
# Canonical orientation (derived from index.html, NOT invented):
#   - barrierSegMid(k) = -PI/2 + k*BARRIER_SPAN   (arena angle of segment mid)
#   - debug barrier k=0 shell: cylinder theta in [PI-15deg, PI+15deg]
#     with x=sin(theta), z=cos(theta)  -> center direction (0, 0, -1) in three.js
#   - arena GLB is added UNROTATED (platform.add(glb.scene)), so Blender
#     authoring angle alpha maps to arena angle a = -alpha
#     (glTF Y-up export: Blender (x,y,z) -> glTF (x, z, -y))
#   - polish2 wall is authored centered on Blender +X (alpha = 0) which would
#     land on arena angle 0 = segment 3. We bake a +90deg Blender-Z rotation
#     into the vertex data: wall center alpha=+90deg -> arena angle -90deg
#     -> SEGMENT 0. Placement in game is then IDENTICAL to the debug shells:
#         mesh.rotation.y = -k * BARRIER_SPAN
#         mesh.position   = (cx, bob, cy); mesh.scale = R / 10.1
#
# Geometry contract (frozen, only re-oriented as a whole):
#   arc r=10.1, span 30deg, field z 0.22..1.90, pylons on the segment borders.

import bpy
import bmesh
import json
import math
import os
import sys
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BLEND = os.path.abspath(arg('--blend', os.path.join(
    REPO_ROOT, 'assets', 'temporary_barrier', 'source',
    'temporary_barrier_polish2.blend')))
OUT_DIR = os.path.abspath(arg('--out', os.getcwd()))
TEX_DIR = os.path.join(OUT_DIR, 'textures')
os.makedirs(TEX_DIR, exist_ok=True)
GLB_PATH = os.path.join(OUT_DIR, 'temporary_barrier_polish2.glb')

report = {'source_blend': BLEND, 'glb': GLB_PATH, 'canonical_segment': 0,
          'rotation_formula': 'mesh.rotation.y = -k * BARRIER_SPAN (identical to debug barrier)',
          'baked_textures': [], 'materials': {}, 'nodes': [], 'deviations': []}

print('[export] opening', BLEND)
bpy.ops.wm.open_mainfile(filepath=BLEND)
scn = bpy.context.scene

# ---------------------------------------------------------------- strip non-barrier content
for colname in ('REF_Arena', 'REF_Balls', 'Lights', 'Cameras'):
    col = bpy.data.collections.get(colname)
    if col:
        for o in list(col.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(col)
scn.world = None
scn.camera = None
print('[export] reference/lights/cameras/world removed')

# ---------------------------------------------------------------- evaluated world-space meshes
dg = bpy.context.evaluated_depsgraph_get()


def world_mesh(obj_name):
    """Evaluated mesh (modifiers applied, curves converted) in world space."""
    obj = bpy.data.objects[obj_name]
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(obj.matrix_world)
    return me


def joined_mesh(name, sources, keep_uv=False):
    """Join world meshes of several source objects into one mesh, slot 0 only."""
    bm = bmesh.new()
    for s in sources:
        me = world_mesh(s)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for f in bm.faces:
        f.material_index = 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def dock_part(name, want_glow):
    """Split the docking channels by material: frame metal (0) vs glow face (1)."""
    bm = bmesh.new()
    for src in ('PylonDock_A', 'PylonDock_B'):
        me = world_mesh(src)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        doomed = [f for f in tmp.faces if (f.material_index == 1) != want_glow]
        bmesh.ops.delete(tmp, geom=doomed, context='FACES')
        tmp2 = bpy.data.meshes.new('tmp')
        tmp.to_mesh(tmp2)
        tmp.free()
        bm.from_mesh(tmp2)
        bpy.data.meshes.remove(tmp2)
        bpy.data.meshes.remove(me)
    for f in bm.faces:
        f.material_index = 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


M = bpy.data.materials
export_col = bpy.data.collections.new('Export')
scn.collection.children.link(export_col)


def add_export_obj(name, mesh, mat):
    o = bpy.data.objects.new(name, mesh)
    export_col.objects.link(o)
    mesh.materials.clear()
    mesh.materials.append(mat)
    return o


obj_field = add_export_obj('BarrierField', joined_mesh('BarrierField', ['BarrierField'], keep_uv=True), M['M_BarrierField'])
obj_pylon = add_export_obj('BarrierPylons', joined_mesh('BarrierPylons', [
    'PylonShoe_A', 'Pylon_A', 'PylonCap_A', 'PylonShoe_B', 'Pylon_B', 'PylonCap_B']), M['M_BarrierMarble'])
obj_emit = add_export_obj('BarrierEmitters', joined_mesh('BarrierEmitters', [
    'BarrierEmitBottom', 'BarrierEmitTop']), M['M_BarrierEmit'])
obj_dockg = add_export_obj('BarrierDockGlow', dock_part('BarrierDockGlow', True), M['M_BarrierEmitDock'])
obj_frame = add_export_obj('BarrierFrame', joined_mesh('BarrierFrame_src', [
    'BarrierRail', 'BarrierBase', 'PylonNeck_A', 'PylonNeck_B']), M['M_BarrierRail'])
# dock frames share the rail material -> merge into the frame object
_dockframe = dock_part('BarrierDockFrame', False)
bmj = bmesh.new()
bmj.from_mesh(obj_frame.data)
bmj.from_mesh(_dockframe)
for f in bmj.faces:
    f.material_index = 0
me_frame = bpy.data.meshes.new('BarrierFrame')
bmj.to_mesh(me_frame)
bmj.free()
old = obj_frame.data
obj_frame.data = me_frame
bpy.data.meshes.remove(old)
bpy.data.meshes.remove(_dockframe)
me_frame.materials.clear()
me_frame.materials.append(M['M_BarrierRail'])
obj_gold = add_export_obj('BarrierGold', joined_mesh('BarrierGold', ['PylonGold_A', 'PylonGold_B']), M['M_BarrierGold'])

EXPORT_OBJS = [obj_field, obj_pylon, obj_emit, obj_dockg, obj_frame, obj_gold]

# remove the original source objects (their data lives on in the export meshes)
for o in list(bpy.data.objects):
    if o not in EXPORT_OBJS:
        bpy.data.objects.remove(o, do_unlink=True)
for col in list(scn.collection.children):
    if col.name != 'Export' and not col.objects:
        bpy.data.collections.remove(col)
# source objects are gone now -> claim the clean names (no .001 suffixes)
for o in EXPORT_OBJS:
    o.name = o.name.split('.')[0]
    o.data.name = o.name
print('[export] export objects built:', [o.name for o in EXPORT_OBJS])

# ---------------------------------------------------------------- UVs for bake targets
def smart_uv(obj, margin=0.02):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


smart_uv(obj_pylon)
smart_uv(obj_emit)
smart_uv(obj_dockg)
print('[export] UVs projected (pylons, emitters, dock glow); field keeps authored UVs')

# ---------------------------------------------------------------- bake setup
scn.render.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 8
scn.render.bake.margin = 8
scn.render.bake.use_clear = True


def new_img(name, w, h, colorspace, alpha=False):
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    img.colorspace_settings.name = colorspace
    if alpha:
        img.alpha_mode = 'CHANNEL_PACKED'
    return img


def bake_to(obj, mat, img, bake_type, pass_filter=None):
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    nt.nodes.active = node
    node.select = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kwargs = {'type': bake_type}
    if pass_filter:
        kwargs['pass_filter'] = pass_filter
    bpy.ops.object.bake(**kwargs)
    nt.nodes.remove(node)
    print(f'[export] baked {img.name} ({bake_type})')


def save_img(img):
    path = os.path.join(TEX_DIR, img.name + '.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    report['baked_textures'].append({'name': img.name, 'size': list(img.size),
                                     'colorspace': img.colorspace_settings.name,
                                     'file': os.path.relpath(path, OUT_DIR)})
    return img


def find_output(nt):
    return next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')

# --- field bakes: alpha factor (view-independent) + emissive color -----------
mat_field = M['M_BarrierField']
nt = mat_field.node_tree
out = find_output(nt)
mixsh = out.inputs['Surface'].links[0].from_node               # Mix Shader
clampn = mixsh.inputs['Fac'].links[0].from_node                # Clamp (alpha factor)
emisn = mixsh.inputs[2].links[0].from_node                     # Emission
tmix = emisn.inputs['Color'].links[0].from_node                # two-tone color mix
lw = next(n for n in nt.nodes if n.type == 'LAYER_WEIGHT')     # facing term
fmul = lw.outputs['Facing'].links[0].to_node
fmul.inputs[1].default_value = 0.0     # facing is view-dependent -> cannot be baked;
report['deviations'].append(
    'field facing-glow term (LayerWeight*0.25) is view-dependent and not '
    'representable in glTF core; excluded from the baked alpha, to be restored '
    'as a runtime shader override in the game integration')

bake_em = nt.nodes.new('ShaderNodeEmission')
nt.links.new(bake_em.outputs['Emission'], out.inputs['Surface'])

img_alpha = new_img('T_BarrierField_Alpha', 1024, 512, 'Non-Color')
nt.links.new(clampn.outputs['Result'], bake_em.inputs['Strength'])  # white * fac
bake_to(obj_field, mat_field, img_alpha, 'EMIT')
save_img(img_alpha)

img_femis = new_img('T_BarrierField_Emissive', 1024, 512, 'sRGB')
nt.links.new(tmix.outputs['Result'], bake_em.inputs['Color'])       # color * fac
bake_to(obj_field, mat_field, img_femis, 'EMIT')
save_img(img_femis)

# compose base-color RGBA: RGB=0 (pure "hole" for alpha blending), A=fac
w, h = img_alpha.size
buf = np.empty(w * h * 4, dtype=np.float32)
img_alpha.pixels.foreach_get(buf)
base = np.zeros(w * h * 4, dtype=np.float32)
base[3::4] = buf[0::4]
img_fbase = new_img('T_BarrierField_BaseColor', w, h, 'sRGB', alpha=True)
img_fbase.pixels.foreach_set(base)
save_img(img_fbase)

# --- marble bakes: color / roughness / normal(bump) ---------------------------
mat_marble = M['M_BarrierMarble']
img_mcol = new_img('T_BarrierMarble_BaseColor', 1024, 1024, 'sRGB')
bake_to(obj_pylon, mat_marble, img_mcol, 'DIFFUSE', pass_filter={'COLOR'})
save_img(img_mcol)
img_mrgh = new_img('T_BarrierMarble_Roughness', 1024, 1024, 'Non-Color')
bake_to(obj_pylon, mat_marble, img_mrgh, 'ROUGHNESS')
save_img(img_mrgh)
img_mnrm = new_img('T_BarrierMarble_Normal', 1024, 1024, 'Non-Color')
bake_to(obj_pylon, mat_marble, img_mnrm, 'NORMAL')
save_img(img_mnrm)

# --- emitter strips: emissive color with drift, normalized to <=1 -------------
def bake_emissive_drift(mat, obj, img, peak_strength):
    """Bake emission color*strength/peak so the 8-bit texture never clips;
    the peak goes back in via KHR_materials_emissive_strength."""
    nt = mat.node_tree
    out = find_output(nt)
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    smod = p.inputs['Emission Strength'].links[0].from_node
    cmix = p.inputs['Emission Color'].links[0].from_node
    div = nt.nodes.new('ShaderNodeMath')
    div.operation = 'DIVIDE'
    div.inputs[1].default_value = peak_strength
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(smod.outputs['Result'], div.inputs[0])
    nt.links.new(div.outputs[0], em.inputs['Strength'])
    nt.links.new(cmix.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    bake_to(obj, mat, img, 'EMIT')
    save_img(img)


EMIT_PEAK = 9.0 * 1.12       # top of the polish2 drift band
DOCK_PEAK = 4.5 * 1.12
img_emis = new_img('T_BarrierEmit_Emissive', 512, 512, 'sRGB')
bake_emissive_drift(M['M_BarrierEmit'], obj_emit, img_emis, EMIT_PEAK)
img_dock = new_img('T_BarrierDock_Emissive', 256, 256, 'sRGB')
bake_emissive_drift(M['M_BarrierEmitDock'], obj_dockg, img_dock, DOCK_PEAK)

# ---------------------------------------------------------------- export materials (glTF-clean)
for m in list(M):
    m.name = m.name + '_SRC'


def clean_mat(name, blend='OPAQUE', double_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.blend_method = 'BLEND' if blend == 'BLEND' else 'OPAQUE'
    m.use_backface_culling = not double_sided
    return m, m.node_tree.nodes['Principled BSDF'], m.node_tree


def tex_node(nt, img, colorspace=None):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    if colorspace:
        img.colorspace_settings.name = colorspace
    return n


# field: alpha-blend "hole" + baked emissive == polish2 mix(transparent, emission, fac)
X_Field, p, nt = clean_mat('M_BarrierField', blend='BLEND', double_sided=True)
tb = tex_node(nt, img_fbase)
te = tex_node(nt, img_femis)
p.inputs['Base Color'].default_value = (0, 0, 0, 1)
p.inputs['Roughness'].default_value = 1.0
p.inputs['Specular IOR Level'].default_value = 0.0
p.inputs['Emission Strength'].default_value = 1.0
nt.links.new(tb.outputs['Color'], p.inputs['Base Color'])
nt.links.new(tb.outputs['Alpha'], p.inputs['Alpha'])
nt.links.new(te.outputs['Color'], p.inputs['Emission Color'])
obj_field.data.materials[0] = X_Field
report['materials']['M_BarrierField'] = {
    'alphaMode': 'BLEND', 'doubleSided': True,
    'baseColor': 'T_BarrierField_BaseColor (RGB=0, A=baked mix factor)',
    'emissive': 'T_BarrierField_Emissive (baked two-tone * factor), strength 1.0'}

X_Marble, p, nt = clean_mat('M_BarrierMarble')
tc = tex_node(nt, img_mcol)
tr = tex_node(nt, img_mrgh)
tn = tex_node(nt, img_mnrm)
nm = nt.nodes.new('ShaderNodeNormalMap')
p.inputs['Metallic'].default_value = 0.02
p.inputs['Coat Weight'].default_value = 0.15
nt.links.new(tc.outputs['Color'], p.inputs['Base Color'])
nt.links.new(tr.outputs['Color'], p.inputs['Roughness'])
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
obj_pylon.data.materials[0] = X_Marble
report['materials']['M_BarrierMarble'] = {
    'alphaMode': 'OPAQUE', 'textures': ['BaseColor', 'Roughness', 'Normal'],
    'coat': 0.15, 'note': 'two-scale veining + micro bump baked'}

CYAN = (0.055, 0.62, 0.85, 1)
X_Emit, p, nt = clean_mat('M_BarrierEmit')
tt = tex_node(nt, img_emis)
p.inputs['Base Color'].default_value = CYAN
p.inputs['Roughness'].default_value = 0.4
p.inputs['Emission Strength'].default_value = EMIT_PEAK
nt.links.new(tt.outputs['Color'], p.inputs['Emission Color'])
obj_emit.data.materials[0] = X_Emit
report['materials']['M_BarrierEmit'] = {
    'alphaMode': 'OPAQUE', 'emissive': 'T_BarrierEmit_Emissive',
    'emissiveStrength(KHR)': EMIT_PEAK, 'note': 'drift baked into texture, peak in extension'}

X_Dock, p, nt = clean_mat('M_BarrierDock')
td = tex_node(nt, img_dock)
p.inputs['Base Color'].default_value = CYAN
p.inputs['Roughness'].default_value = 0.4
p.inputs['Emission Strength'].default_value = DOCK_PEAK
nt.links.new(td.outputs['Color'], p.inputs['Emission Color'])
obj_dockg.data.materials[0] = X_Dock
report['materials']['M_BarrierDock'] = {
    'alphaMode': 'OPAQUE', 'emissive': 'T_BarrierDock_Emissive',
    'emissiveStrength(KHR)': DOCK_PEAK}

X_Frame, p, nt = clean_mat('M_BarrierFrame')
p.inputs['Base Color'].default_value = (0.55, 0.58, 0.62, 1)
p.inputs['Metallic'].default_value = 1.0
p.inputs['Roughness'].default_value = 0.37
obj_frame.data.materials[0] = X_Frame
report['materials']['M_BarrierFrame'] = {
    'alphaMode': 'OPAQUE', 'constant': True, 'roughness': 0.37}
report['deviations'].append(
    'rail/base/neck metal: procedural roughness drift 0.32-0.42 flattened to '
    'constant 0.37 (sub-perceptual on the thin profiles; avoids a bake pass on '
    'curve-derived UVs)')

X_Gold, p, nt = clean_mat('M_BarrierGold')
p.inputs['Base Color'].default_value = (0.52, 0.42, 0.2, 1)
p.inputs['Metallic'].default_value = 1.0
p.inputs['Roughness'].default_value = 0.33
obj_gold.data.materials[0] = X_Gold
report['materials']['M_BarrierGold'] = {'alphaMode': 'OPAQUE', 'constant': True}
report['deviations'].append(
    'field transparent-BSDF tint (0.90,0.985,1.0) not representable in glTF '
    'alpha blending (would need KHR_materials_transmission); effect on the '
    'blended background is <=10% in blue channels at alpha<=0.44 -> dropped')

# ---------------------------------------------------------------- canonical rotation + root
ROT = Matrix.Rotation(math.radians(90.0), 4, 'Z')
for o in EXPORT_OBJS:
    o.data.transform(ROT)
print('[export] +90deg Z rotation baked into vertex data -> canonical segment 0')

root = bpy.data.objects.new('TemporaryBarrier', None)
export_col.objects.link(root)
for o in EXPORT_OBJS:
    o.parent = root

# ---------------------------------------------------------------- purge + export
for _ in range(4):
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

leftover_mats = [m.name for m in bpy.data.materials]
leftover_imgs = [i.name for i in bpy.data.images]
print('[export] materials in file:', leftover_mats)
print('[export] images in file:', leftover_imgs)

debug_blend = os.path.join(OUT_DIR, 'temporary_barrier_polish2_exportscene.blend')
bpy.ops.wm.save_as_mainfile(filepath=debug_blend)

bpy.ops.export_scene.gltf(
    filepath=GLB_PATH,
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_image_format='AUTO',
)
size = os.path.getsize(GLB_PATH)
print(f'[export] GLB written: {GLB_PATH} ({size} bytes)')

for o in EXPORT_OBJS:
    bb = [tuple(round(c, 4) for c in (o.matrix_world @ v.co)) for v in
          (o.data.vertices[0],)]  # spot sample only; full check in validation
    report['nodes'].append({'name': o.name, 'verts': len(o.data.vertices),
                            'material': o.data.materials[0].name})
report['glb_bytes'] = size
report['root'] = {'name': 'TemporaryBarrier', 'location': list(root.location),
                  'rotation_euler': list(root.rotation_euler),
                  'scale': list(root.scale)}
report['pylon_arena_angles_deg'] = [-105.0, -75.0]
report['segment_mapping'] = {
    'canonical_segment': 0,
    'wall_center_three_dir': [0.0, 0.0, -1.0],
    'wall_center_arena_angle_deg': -90.0,
    'per_segment': 'rotation.y = -k * BARRIER_SPAN  (k = 0..11)'}
with open(os.path.join(OUT_DIR, 'export_bake_report.json'), 'w') as f:
    json.dump(report, f, indent=2)
print('[export] DONE')
