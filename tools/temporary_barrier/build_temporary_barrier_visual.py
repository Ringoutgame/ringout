# build_temporary_barrier_visual_polish2.py — RingOut temporary barrier, polish pass 2
#
# Visual polish over polish 1. Geometry contract is FROZEN: position on the
# collider arc, 30-degree span, height, curvature and the two-pylon layout are
# identical to polish 1 / v1. Polish 2 targets believability only:
#   1. field reads as controlled energy, not milky glass: faint large-scale
#      density variation, near-invisible vertical flux, two-tone emission
#   2. seams/edges less uniform: emission strength/color gently modulated
#   3. wall<->pylon junction: slim metal docking channel with a glowing inner
#      face replaces the free-floating vertical emitter strip
#   4. pylons: two-scale marble veining, micro bump, roughness variation,
#      crisper neck ring under the gold band
#   5. seat: slim metal base track on the walkway under the field bottom edge
#
# Usage:
#   blender -b -P build_temporary_barrier_visual_polish2.py -- --out <dir> [--quick]
#
# Geometry contract (read from the project, NOT modified here):
#   - Game maps arena radius R (px) onto GLB radius 10.1  (index.html: GLB_R=10.1,
#     sc=R/GLB_R; barrier debug mesh: scale.set(R, BARRIER_H, R) -> arc radius = R
#     -> 10.1 in GLB units).
#   - BARRIER_SEG_COUNT=12 -> segment span 30 deg (BARRIER_SPAN), half 15 deg.
#   - Ball radius BR = 32 px -> 32 * 10.1/485 = 0.6663 GLB units.
#   - Walkway top z=+0.16, playfield top z=0 (BLENDER_ASSET_SPEC.md).
#
# The segment is built centered on the +X axis (arc from -15 deg to +15 deg).

import bpy
import bmesh
import math
import os
import sys

# ----------------------------------------------------------------------------- args
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_DIR = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.dirname(os.path.abspath(__file__))
QUICK = '--quick' in argv
os.makedirs(OUT_DIR, exist_ok=True)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
ARENA_GLB = os.path.join(REPO, 'assets', 'arena_platform.glb')

# ------------------------------------------------------------------- constants (contract)
ARC_R      = 10.1                 # barrier collider radius in GLB units (= game R)
SEG_HALF   = math.radians(15.0)   # half segment span (30 deg total)
BALL_R     = 32.0 * ARC_R / 485.0 # 0.6663 — ball radius in GLB units
WALK_TOP   = 0.16                 # walkway surface height
FIELD_Z0   = WALK_TOP + 0.06      # energy plane bottom
FIELD_Z1   = 1.90                 # energy plane top  (1.74 above walkway, ~2.6 x ball r)
PYLON_TOP  = 2.14                 # pylon cap top
CYAN       = (0.055, 0.62, 0.85)  # linear approx of game barrier accent #35e0ff
CYAN_DEEP  = (0.040, 0.50, 0.78)  # slightly deeper energy tone (field depth)
CYAN_PALE  = (0.16, 0.74, 0.93)   # slightly paler energy tone (field depth)
FIELD_SEGS = 48                   # arc resolution of the energy plane

# ----------------------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.samples = 32 if QUICK else 128
scn.cycles.use_denoising = True
scn.render.resolution_x = 960 if QUICK else 1600
scn.render.resolution_y = 540 if QUICK else 900
scn.render.film_transparent = False
scn.view_settings.view_transform = 'Filmic'
scn.view_settings.look = 'Medium High Contrast'
scn.view_settings.exposure = -0.45

# GPU if available, else CPU
prefs = bpy.context.preferences.addons.get('cycles')
if prefs:
    cp = prefs.preferences
    for backend in ('OPTIX', 'CUDA', 'HIP', 'NONE'):
        try:
            cp.compute_device_type = backend
        except Exception:
            continue
        cp.get_devices()
        gpus = [d for d in cp.devices if d.type != 'CPU']
        if backend != 'NONE' and gpus:
            for d in cp.devices:
                d.use = True
            scn.cycles.device = 'GPU'
            print(f'[build] Cycles GPU backend: {backend}')
            break
    else:
        scn.cycles.device = 'CPU'
if scn.cycles.device != 'GPU':
    scn.cycles.device = 'CPU'
    print('[build] Cycles on CPU')


def collection(name):
    col = bpy.data.collections.new(name)
    scn.collection.children.link(col)
    return col


COL_REF     = collection('REF_Arena')        # read-only reference import
COL_BARRIER = collection('Barrier')          # the deliverable design
COL_BALLS   = collection('REF_Balls')        # scale-reference balls (hidden in renders)
COL_LIGHTS  = collection('Lights')
COL_CAMS    = collection('Cameras')


def link_to(obj, col):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    col.objects.link(obj)

# ----------------------------------------------------------------------------- materials

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m


def principled(m):
    return m.node_tree.nodes['Principled BSDF']


# Pylon marble — polish2: two-scale veining (fine veins + broad tonal clouds),
# micro bump and vein-driven roughness variation so the stone stops reading
# as smooth plastic under grazing light.
M_PylonMarble = new_mat('M_BarrierMarble')
_nt = M_PylonMarble.node_tree
_p = principled(M_PylonMarble)
_p.inputs['Metallic'].default_value = 0.02
_p.inputs['Coat Weight'].default_value = 0.15
_noise = _nt.nodes.new('ShaderNodeTexNoise')          # fine veining (as polish1)
_noise.inputs['Scale'].default_value = 6.0
_noise.inputs['Detail'].default_value = 8.0
_ramp = _nt.nodes.new('ShaderNodeValToRGB')
_ramp.color_ramp.elements[0].position = 0.35
_ramp.color_ramp.elements[0].color = (0.760, 0.788, 0.775, 1)   # ~#dfe3e0
_ramp.color_ramp.elements[1].position = 0.78
_ramp.color_ramp.elements[1].color = (0.672, 0.703, 0.712, 1)   # softer vein gray
_nt.links.new(_noise.outputs['Fac'], _ramp.inputs['Fac'])
_cloud = _nt.nodes.new('ShaderNodeTexNoise')          # broad tonal clouds
_cloud.inputs['Scale'].default_value = 1.5
_cloud.inputs['Detail'].default_value = 3.0
_cmap = _nt.nodes.new('ShaderNodeMapRange')           # keep the effect faint
_cmap.inputs['From Min'].default_value = 0.0
_cmap.inputs['From Max'].default_value = 1.0
_cmap.inputs['To Min'].default_value = 0.0
_cmap.inputs['To Max'].default_value = 0.30
_cmix = _nt.nodes.new('ShaderNodeMix')
_cmix.data_type = 'RGBA'
_cmix.inputs['B'].default_value = (0.700, 0.718, 0.706, 1)      # warm-gray cloud tone
_nt.links.new(_cloud.outputs['Fac'], _cmap.inputs['Value'])
_nt.links.new(_cmap.outputs['Result'], _cmix.inputs['Factor'])
_nt.links.new(_ramp.outputs['Color'], _cmix.inputs['A'])
_nt.links.new(_cmix.outputs['Result'], _p.inputs['Base Color'])
_rmap = _nt.nodes.new('ShaderNodeMapRange')           # veins slightly less polished
_rmap.inputs['From Min'].default_value = 0.0
_rmap.inputs['From Max'].default_value = 1.0
_rmap.inputs['To Min'].default_value = 0.30
_rmap.inputs['To Max'].default_value = 0.38
_nt.links.new(_noise.outputs['Fac'], _rmap.inputs['Value'])
_nt.links.new(_rmap.outputs['Result'], _p.inputs['Roughness'])
_bnoise = _nt.nodes.new('ShaderNodeTexNoise')         # micro surface relief
_bnoise.inputs['Scale'].default_value = 22.0
_bnoise.inputs['Detail'].default_value = 6.0
_bump = _nt.nodes.new('ShaderNodeBump')
_bump.inputs['Strength'].default_value = 0.035
_nt.links.new(_bnoise.outputs['Fac'], _bump.inputs['Height'])
_nt.links.new(_bump.outputs['Normal'], _p.inputs['Normal'])

# Restrained gold — same tone as arena M_Gold (0.52, 0.42, 0.2), thin bands only.
M_Gold = new_mat('M_BarrierGold')
_g = principled(M_Gold)
_g.inputs['Base Color'].default_value = (0.52, 0.42, 0.2, 1)
_g.inputs['Metallic'].default_value = 1.0
_g.inputs['Roughness'].default_value = 0.33

# Pale technical metal for rails/channels — polish2: gentle roughness variation
# so the brushed metal stops reading as a perfect CG mirror band.
M_Rail = new_mat('M_BarrierRail')
_r = principled(M_Rail)
_r.inputs['Base Color'].default_value = (0.55, 0.58, 0.62, 1)
_r.inputs['Metallic'].default_value = 1.0
_rn = M_Rail.node_tree.nodes.new('ShaderNodeTexNoise')
_rn.inputs['Scale'].default_value = 4.0
_rn.inputs['Detail'].default_value = 4.0
_rrm = M_Rail.node_tree.nodes.new('ShaderNodeMapRange')
_rrm.inputs['From Min'].default_value = 0.0
_rrm.inputs['From Max'].default_value = 1.0
_rrm.inputs['To Min'].default_value = 0.32
_rrm.inputs['To Max'].default_value = 0.42
M_Rail.node_tree.links.new(_rn.outputs['Fac'], _rrm.inputs['Value'])
M_Rail.node_tree.links.new(_rrm.outputs['Result'], _r.inputs['Roughness'])


def emitter_material(name, strength, color_a=CYAN, color_b=(0.30, 0.84, 1.0)):
    """Emissive cyan whose strength/tone drifts gently along world position —
    the terminator strips stop being one perfectly uniform neon bar."""
    m = new_mat(name)
    p = principled(m)
    p.inputs['Base Color'].default_value = (*color_a, 1)
    p.inputs['Roughness'].default_value = 0.4
    ntree = m.node_tree
    tc = ntree.nodes.new('ShaderNodeTexCoord')
    n = ntree.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 1.1
    n.inputs['Detail'].default_value = 3.0
    smod = ntree.nodes.new('ShaderNodeMapRange')     # strength drift +-15%
    smod.inputs['From Min'].default_value = 0.0
    smod.inputs['From Max'].default_value = 1.0
    smod.inputs['To Min'].default_value = strength * 0.82
    smod.inputs['To Max'].default_value = strength * 1.12
    cmod = ntree.nodes.new('ShaderNodeMapRange')     # subtle whiter-core drift
    cmod.inputs['From Min'].default_value = 0.0
    cmod.inputs['From Max'].default_value = 1.0
    cmod.inputs['To Min'].default_value = 0.10
    cmod.inputs['To Max'].default_value = 0.40
    cmix = ntree.nodes.new('ShaderNodeMix')
    cmix.data_type = 'RGBA'
    cmix.inputs['A'].default_value = (*color_a, 1)
    cmix.inputs['B'].default_value = (*color_b, 1)
    ntree.links.new(tc.outputs['Object'], n.inputs['Vector'])
    ntree.links.new(n.outputs['Fac'], smod.inputs['Value'])
    ntree.links.new(n.outputs['Fac'], cmod.inputs['Value'])
    ntree.links.new(cmod.outputs['Result'], cmix.inputs['Factor'])
    ntree.links.new(cmix.outputs['Result'], p.inputs['Emission Color'])
    ntree.links.new(smod.outputs['Result'], p.inputs['Emission Strength'])
    return m


M_Emit     = emitter_material('M_BarrierEmit', 9.0)      # top/bottom terminators
M_EmitDock = emitter_material('M_BarrierEmitDock', 4.5)  # glowing docking-channel face

# Energy field — Transparent+Emission mix. Polish2 keeps the polish1 alpha
# budget (clear center, readable rims) and layers three near-invisible cues on
# top so the plane stops reading as uniform milky glass:
#   - density clouds: broad, slow alpha variation (+ two-tone emission color)
#   - vertical flux: faint elongated streaks, energy has a direction
#   - seam drift: rim brightness varies gently along the arc
M_Field = new_mat('M_BarrierField')
M_Field.blend_method = 'BLEND'
M_Field.use_backface_culling = False
nt = M_Field.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
mix = nt.nodes.new('ShaderNodeMixShader')
transp = nt.nodes.new('ShaderNodeBsdfTransparent')
transp.inputs['Color'].default_value = (0.90, 0.985, 1.0, 1)  # near-clear, faint cyan
emit = nt.nodes.new('ShaderNodeEmission')
emit.inputs['Strength'].default_value = 1.0
uv = nt.nodes.new('ShaderNodeUVMap')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')

# v rim: |v-0.5| -> ^3 curve
vsub = nt.nodes.new('ShaderNodeMath'); vsub.operation = 'SUBTRACT'; vsub.inputs[1].default_value = 0.5
vabs = nt.nodes.new('ShaderNodeMath'); vabs.operation = 'ABSOLUTE'
vmul = nt.nodes.new('ShaderNodeMath'); vmul.operation = 'MULTIPLY'; vmul.inputs[1].default_value = 2.0
vpow = nt.nodes.new('ShaderNodeMath'); vpow.operation = 'POWER'; vpow.inputs[1].default_value = 3.0
# u rim: |u-0.5| -> ^5 curve
usub = nt.nodes.new('ShaderNodeMath'); usub.operation = 'SUBTRACT'; usub.inputs[1].default_value = 0.5
uabs = nt.nodes.new('ShaderNodeMath'); uabs.operation = 'ABSOLUTE'
umul = nt.nodes.new('ShaderNodeMath'); umul.operation = 'MULTIPLY'; umul.inputs[1].default_value = 2.0
upow = nt.nodes.new('ShaderNodeMath'); upow.operation = 'POWER'; upow.inputs[1].default_value = 5.0
rimadd = nt.nodes.new('ShaderNodeMath'); rimadd.operation = 'ADD'
# seam drift: rims are not perfectly even along the arc (+-~14%)
drift = nt.nodes.new('ShaderNodeTexNoise')
drift.inputs['Scale'].default_value = 5.0
drift.inputs['Detail'].default_value = 2.0
dmap = nt.nodes.new('ShaderNodeMapRange')
dmap.inputs['From Min'].default_value = 0.0
dmap.inputs['From Max'].default_value = 1.0
dmap.inputs['To Min'].default_value = 0.86
dmap.inputs['To Max'].default_value = 1.14
rimmod = nt.nodes.new('ShaderNodeMath'); rimmod.operation = 'MULTIPLY'
facing = nt.nodes.new('ShaderNodeLayerWeight'); facing.inputs['Blend'].default_value = 0.65
fmul = nt.nodes.new('ShaderNodeMath'); fmul.operation = 'MULTIPLY'; fmul.inputs[1].default_value = 0.25
shimmer = nt.nodes.new('ShaderNodeTexNoise')
shimmer.inputs['Scale'].default_value = 9.0
shimmer.inputs['Detail'].default_value = 4.0
smap = nt.nodes.new('ShaderNodeMapRange')
smap.inputs['From Min'].default_value = 0.0
smap.inputs['From Max'].default_value = 1.0
smap.inputs['To Min'].default_value = 0.010
smap.inputs['To Max'].default_value = 0.040
# density clouds: broad, slow variation — the field has faint internal body
dens = nt.nodes.new('ShaderNodeTexNoise')
dens.inputs['Scale'].default_value = 1.7
dens.inputs['Detail'].default_value = 3.0
densmap = nt.nodes.new('ShaderNodeMapRange')
densmap.inputs['From Min'].default_value = 0.0
densmap.inputs['From Max'].default_value = 1.0
densmap.inputs['To Min'].default_value = -0.010
densmap.inputs['To Max'].default_value = 0.018
# vertical flux: strongly elongated noise -> faint vertical energy streaks
fluxmap_v = nt.nodes.new('ShaderNodeMapping')
fluxmap_v.inputs['Scale'].default_value = (26.0, 2.2, 1.0)
flux = nt.nodes.new('ShaderNodeTexNoise')
flux.inputs['Scale'].default_value = 1.0
flux.inputs['Detail'].default_value = 2.5
fluxmap = nt.nodes.new('ShaderNodeMapRange')
fluxmap.inputs['From Min'].default_value = 0.0
fluxmap.inputs['From Max'].default_value = 1.0
fluxmap.inputs['To Min'].default_value = 0.004
fluxmap.inputs['To Max'].default_value = 0.020
# two-tone emission: deeper cyan in dense zones, paler in thin zones
tone = nt.nodes.new('ShaderNodeMapRange')
tone.inputs['From Min'].default_value = 0.0
tone.inputs['From Max'].default_value = 1.0
tone.inputs['To Min'].default_value = 0.25
tone.inputs['To Max'].default_value = 0.75
tmix = nt.nodes.new('ShaderNodeMix')
tmix.data_type = 'RGBA'
tmix.inputs['A'].default_value = (*CYAN_DEEP, 1)
tmix.inputs['B'].default_value = (*CYAN_PALE, 1)
total = nt.nodes.new('ShaderNodeMath'); total.operation = 'ADD'
total2 = nt.nodes.new('ShaderNodeMath'); total2.operation = 'ADD'
total3 = nt.nodes.new('ShaderNodeMath'); total3.operation = 'ADD'
total4 = nt.nodes.new('ShaderNodeMath'); total4.operation = 'ADD'
base = nt.nodes.new('ShaderNodeMath'); base.operation = 'ADD'; base.inputs[1].default_value = 0.025
clamp = nt.nodes.new('ShaderNodeClamp')
clamp.inputs['Min'].default_value = 0.02
clamp.inputs['Max'].default_value = 0.44

L = nt.links.new
L(uv.outputs['UV'], sep.inputs['Vector'])
L(sep.outputs['Y'], vsub.inputs[0]); L(vsub.outputs[0], vabs.inputs[0])
L(vabs.outputs[0], vmul.inputs[0]); L(vmul.outputs[0], vpow.inputs[0])
L(sep.outputs['X'], usub.inputs[0]); L(usub.outputs[0], uabs.inputs[0])
L(uabs.outputs[0], umul.inputs[0]); L(umul.outputs[0], upow.inputs[0])
L(vpow.outputs[0], rimadd.inputs[0]); L(upow.outputs[0], rimadd.inputs[1])
L(uv.outputs['UV'], drift.inputs['Vector'])
L(drift.outputs['Fac'], dmap.inputs['Value'])
L(rimadd.outputs[0], rimmod.inputs[0]); L(dmap.outputs['Result'], rimmod.inputs[1])
L(facing.outputs['Facing'], fmul.inputs[0])
L(uv.outputs['UV'], shimmer.inputs['Vector'])
L(shimmer.outputs['Fac'], smap.inputs['Value'])
L(uv.outputs['UV'], dens.inputs['Vector'])
L(dens.outputs['Fac'], densmap.inputs['Value'])
L(uv.outputs['UV'], fluxmap_v.inputs['Vector'])
L(fluxmap_v.outputs['Vector'], flux.inputs['Vector'])
L(flux.outputs['Fac'], fluxmap.inputs['Value'])
L(dens.outputs['Fac'], tone.inputs['Value'])
L(tone.outputs['Result'], tmix.inputs['Factor'])
L(tmix.outputs['Result'], emit.inputs['Color'])
L(rimmod.outputs[0], total.inputs[0]); L(fmul.outputs[0], total.inputs[1])
L(total.outputs[0], total2.inputs[0]); L(smap.outputs['Result'], total2.inputs[1])
L(total2.outputs[0], total3.inputs[0]); L(densmap.outputs['Result'], total3.inputs[1])
L(total3.outputs[0], total4.inputs[0]); L(fluxmap.outputs['Result'], total4.inputs[1])
L(total4.outputs[0], base.inputs[0])
L(base.outputs[0], clamp.inputs['Value'])
L(clamp.outputs['Result'], mix.inputs['Fac'])
L(transp.outputs['BSDF'], mix.inputs[1])
L(emit.outputs['Emission'], mix.inputs[2])
L(mix.outputs['Shader'], out.inputs['Surface'])

# Ball materials — 3D colors from PCOLS m3 (index.html): blue/red/yellow.
def ball_mat(name, hexv):
    r = ((hexv >> 16) & 255) / 255
    g = ((hexv >> 8) & 255) / 255
    b = (hexv & 255) / 255
    m = new_mat(name)
    p = principled(m)
    p.inputs['Base Color'].default_value = (r ** 2.2, g ** 2.2, b ** 2.2, 1)
    p.inputs['Roughness'].default_value = 0.07
    p.inputs['Metallic'].default_value = 0.05
    p.inputs['Coat Weight'].default_value = 1.0
    p.inputs['Coat Roughness'].default_value = 0.07
    return m

M_BallBlue = ball_mat('M_BallBlue', 0x0a6db8)
M_BallRed = ball_mat('M_BallRed', 0xa81e0e)
M_BallYellow = ball_mat('M_BallYellow', 0xc9971c)

# ----------------------------------------------------------------------------- helpers

def add_obj(name, mesh, col, mat=None):
    o = bpy.data.objects.new(name, mesh)
    col.objects.link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def arc_shell(name, r, a0, a1, z0, z1, segs, mat, col):
    """Curved vertical shell (cylinder sector) with UVs: u along arc, v along height."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    rows = []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        x, y = r * math.cos(a), r * math.sin(a)
        rows.append((bm.verts.new((x, y, z0)), bm.verts.new((x, y, z1))))
    for i in range(segs):
        v00, v01 = rows[i]
        v10, v11 = rows[i + 1]
        f = bm.faces.new((v00, v10, v11, v01))
        us = (i / segs, (i + 1) / segs, (i + 1) / segs, i / segs)
        vs = (0.0, 0.0, 1.0, 1.0)
        for loop, u_, v_ in zip(f.loops, us, vs):
            loop[uv_layer].uv = (u_, v_)
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = add_obj(name, me, col, mat)
    o.data.shade_smooth()
    return o


def arc_tube(name, r, a0, a1, z, minor, segs, mat, col):
    """Thin tube following the arc (top rail / base track)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = minor
    cu.bevel_resolution = 6
    cu.resolution_u = 4
    sp = cu.splines.new('POLY')
    sp.points.add(segs)
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        sp.points[i].co = (r * math.cos(a), r * math.sin(a), z, 1)
    o = bpy.data.objects.new(name, cu)
    col.objects.link(o)
    o.data.materials.append(mat)
    return o


def frustum4(name, r_bot, r_top, z0, z1, cx_, cy_, rz, mat, col, bevel=0.0):
    """Square-section tapering column (4-vert cone), rotated so faces are radial/tangential."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4,
                          radius1=r_bot, radius2=r_top, depth=(z1 - z0))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = add_obj(name, me, col, mat)
    o.location = (cx_, cy_, (z0 + z1) / 2)
    o.rotation_euler = (0, 0, rz + math.pi / 4)   # +45deg -> flat faces radial/tangential
    if bevel > 0:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.harden_normals = True
        o.data.shade_smooth()
    return o


def docking_channel(name, a, sgn, col):
    """Slim vertical docking channel on the pylon's field-side face.

    Bridges the tapering marble column and the energy plane so the field reads
    as constructively held by the pylon instead of floating next to it. The
    face toward the field glows softly (the light sits IN the joint). Local
    axes before rotation: X radial, Y tangential, Z up. Field side is local -Y
    for the +15deg pylon and +Y for the -15deg pylon.
    """
    rad_half = 0.045    # radial half-depth  -> 0.09 deep, centered on the arc
    tan_half = 0.05     # tangential half-width
    off      = 0.16     # tangential offset from the pylon axis (overlaps column)
    z0 = FIELD_Z0 - 0.015
    z1 = FIELD_Z1 + 0.015
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= rad_half * 2
        v.co.y *= tan_half * 2
        v.co.z *= (z1 - z0)
    bm.normal_update()
    field_side = -1.0 if sgn > 0 else 1.0
    for f in bm.faces:
        f.material_index = 1 if f.normal.y * field_side > 0.5 else 0
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    col.objects.link(o)
    o.data.materials.append(M_Rail)
    o.data.materials.append(M_EmitDock)
    tx, ty = sgn * math.sin(a), -sgn * math.cos(a)    # tangential unit toward field
    o.location = (ARC_R * math.cos(a) + tx * off,
                  ARC_R * math.sin(a) + ty * off,
                  (z0 + z1) / 2)
    o.rotation_euler = (0, 0, a)
    mod = o.modifiers.new('bevel', 'BEVEL')
    mod.width = 0.006
    mod.segments = 2
    mod.harden_normals = True
    return o


def look_at(obj, target):
    """Aim a camera/light (-Z forward, +Y up) at a world-space target."""
    d = (target[0] - obj.location[0], target[1] - obj.location[1], target[2] - obj.location[2])
    yaw = math.atan2(d[1], d[0])
    pitch = math.atan2(d[2], math.hypot(d[0], d[1]))
    obj.rotation_euler = (math.pi / 2 + pitch, 0, yaw - math.pi / 2)

# ----------------------------------------------------------------------------- arena reference (read-only)
if os.path.isfile(ARENA_GLB):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ARENA_GLB)
    for o in set(bpy.data.objects) - before:
        link_to(o, COL_REF)
    print('[build] arena reference imported:', os.path.basename(ARENA_GLB))
else:
    print('[build] WARNING: arena GLB not found, previews lack context:', ARENA_GLB)

# ----------------------------------------------------------------------------- barrier build
# Energy field: exactly the collider arc — r=10.1, full 30 deg span.
field = arc_shell('BarrierField', ARC_R, -SEG_HALF, SEG_HALF, FIELD_Z0, FIELD_Z1,
                  FIELD_SEGS, M_Field, COL_BARRIER)

# Emitter strips top/bottom (slightly outward: +0.012 -> no z-fight, no arc
# distortion). Same footprint as polish1; brightness now drifts gently.
arc_shell('BarrierEmitBottom', ARC_R + 0.012, -SEG_HALF, SEG_HALF,
          FIELD_Z0 - 0.018, FIELD_Z0 + 0.010, FIELD_SEGS, M_Emit, COL_BARRIER)
arc_shell('BarrierEmitTop', ARC_R + 0.012, -SEG_HALF, SEG_HALF,
          FIELD_Z1 - 0.010, FIELD_Z1 + 0.012, FIELD_SEGS, M_Emit, COL_BARRIER)

# Top rail: unchanged silhouette from polish1.
arc_tube('BarrierRail', ARC_R, -SEG_HALF, SEG_HALF, FIELD_Z1 + 0.028, 0.022,
         FIELD_SEGS, M_Rail, COL_BARRIER)

# Base track (polish2): slim metal housing resting on the walkway under the
# field's bottom edge — grounds the wall instead of letting it hover. Ends
# vanish inside the pylon shoes; stays on the wall line, no footprint change.
arc_tube('BarrierBase', ARC_R, -SEG_HALF, SEG_HALF, WALK_TOP + 0.023, 0.024,
         FIELD_SEGS, M_Rail, COL_BARRIER)

# Pylons on the exact segment boundaries (+/-15 deg), standing on the walkway.
for sgn, tag in ((1, 'A'), (-1, 'B')):
    a = sgn * SEG_HALF
    px, py = ARC_R * math.cos(a), ARC_R * math.sin(a)
    # base shoe: low, flat, stays on the walkway
    frustum4(f'PylonShoe_{tag}', 0.30, 0.26, WALK_TOP, WALK_TOP + 0.10,
             px, py, a, M_PylonMarble, COL_BARRIER, bevel=0.02)
    # main column: slim tapering marble prism — same footprint/height as v1
    frustum4(f'Pylon_{tag}', 0.225, 0.165, WALK_TOP + 0.10, PYLON_TOP - 0.12,
             px, py, a, M_PylonMarble, COL_BARRIER, bevel=0.02)
    # crisp neck ring right below the gold band (polish2 detail edge)
    frustum4(f'PylonNeck_{tag}', 0.171, 0.169, PYLON_TOP - 0.117, PYLON_TOP - 0.105,
             px, py, a, M_Rail, COL_BARRIER)
    # thin gold band under the cap (the only gold accent, unchanged)
    frustum4(f'PylonGold_{tag}', 0.174, 0.170, PYLON_TOP - 0.105, PYLON_TOP - 0.085,
             px, py, a, M_Gold, COL_BARRIER)
    # cap
    frustum4(f'PylonCap_{tag}', 0.185, 0.10, PYLON_TOP - 0.085, PYLON_TOP,
             px, py, a, M_PylonMarble, COL_BARRIER, bevel=0.02)
    # docking channel replaces the free-floating vertical emitter strip of
    # polish1 — the field now visibly plugs into the pylon
    docking_channel(f'PylonDock_{tag}', a, sgn, COL_BARRIER)

# ----------------------------------------------------------------------------- scale-reference balls
for (bx, by, mat, tag) in (
        (9.55, 0.65, M_BallBlue, 'Blue'),
        (8.85, -1.05, M_BallRed, 'Red'),
        (8.25, 1.95, M_BallYellow, 'Yellow')):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=26, radius=BALL_R)
    me = bpy.data.meshes.new(f'Ball{tag}')
    bm.to_mesh(me)
    bm.free()
    o = add_obj(f'Ball{tag}', me, COL_BALLS, mat)
    # cosmetic floor: walkway step at r>8.7 (game lifts balls onto the step)
    rr = math.hypot(bx, by)
    o.location = (bx, by, (WALK_TOP if rr > 8.7 else 0.0) + BALL_R)
    o.data.shade_smooth()

# ----------------------------------------------------------------------------- lighting rigs

def world_background(w):
    """Return the Background node of a world, creating the node pair if absent."""
    wn = w.node_tree
    bg = next((n for n in wn.nodes if n.type == 'BACKGROUND'), None)
    if bg is None:
        bg = wn.nodes.new('ShaderNodeBackground')
        wout = next((n for n in wn.nodes if n.type == 'OUTPUT_WORLD'), None)
        if wout is None:
            wout = wn.nodes.new('ShaderNodeOutputWorld')
        wn.links.new(bg.outputs['Background'], wout.inputs['Surface'])
    return bg


def clear_lights():
    for o in list(COL_LIGHTS.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def rig_arena():
    """Bright day-sky look approximating the in-game environment."""
    clear_lights()
    w = bpy.data.worlds.new('W_Arena')
    w.use_nodes = True
    wn = w.node_tree
    bg = world_background(w)
    tc = wn.nodes.new('ShaderNodeTexCoord')
    sep_ = wn.nodes.new('ShaderNodeSeparateXYZ')
    mr = wn.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.4
    mr.inputs['From Max'].default_value = 0.7
    ramp = wn.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.42, 0.50, 0.58, 1)   # soft ground bounce
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.12, 0.36, 0.72, 1)   # blue zenith
    horizon = ramp.color_ramp.elements.new(0.36)
    horizon.color = (0.60, 0.78, 0.96, 1)                        # pale horizon
    wn.links.new(tc.outputs['Generated'], sep_.inputs['Vector'])
    wn.links.new(sep_.outputs['Z'], mr.inputs['Value'])
    wn.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    wn.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.9
    scn.world = w
    sun = bpy.data.lights.new('SunKey', 'SUN')
    sun.energy = 2.2
    sun.angle = math.radians(1.2)
    sun.color = (1.0, 0.96, 0.88)
    so = bpy.data.objects.new('SunKey', sun)
    COL_LIGHTS.objects.link(so)
    so.rotation_euler = (math.radians(48), 0, math.radians(215 - 90))
    fill = bpy.data.lights.new('FillCool', 'AREA')
    fill.energy = 170
    fill.size = 14
    fill.color = (0.75, 0.85, 1.0)
    fo = bpy.data.objects.new('FillCool', fill)
    COL_LIGHTS.objects.link(fo)
    fo.location = (2, -12, 9)
    look_at(fo, (9, 0, 1))


def rig_neutral():
    """Even gray studio light for material judgement."""
    clear_lights()
    w = bpy.data.worlds.new('W_Neutral')
    w.use_nodes = True
    bg = world_background(w)
    bg.inputs['Color'].default_value = (0.42, 0.42, 0.42, 1)
    bg.inputs['Strength'].default_value = 0.85
    scn.world = w
    for name, loc, e, sz in (
            ('KeyN', (5, -8, 7), 900, 8),
            ('FillN', (3, 9, 5), 420, 8),
            ('RimN', (16, 0, 4), 350, 6)):
        li = bpy.data.lights.new(name, 'AREA')
        li.energy = e
        li.size = sz
        lo = bpy.data.objects.new(name, li)
        COL_LIGHTS.objects.link(lo)
        lo.location = loc
        look_at(lo, (9.7, 0, 1.0))

# ----------------------------------------------------------------------------- cameras

def cam(name, loc, target, lens=45):
    c = bpy.data.cameras.new(name)
    c.lens = lens
    o = bpy.data.objects.new(name, c)
    COL_CAMS.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


cam_overview = cam('cam_overview', (-13.5, -9.0, 8.5), (3.5, 0.5, 0.4), 38)
cam_front    = cam('cam_front', (2.0, 0.0, 1.25), (10.1, 0.0, 1.0), 40)
cam_inner    = cam('cam_inner', (1.8, -5.8, 2.6), (9.8, 1.2, 0.95), 40)
cam_outer    = cam('cam_outer', (14.6, 5.6, 2.5), (9.5, -0.6, 1.0), 45)
cam_top      = cam('cam_top', (9.4, 0.0, 15.0), (9.4, 0.0, 0.2), 45)
cam_mount    = cam('cam_mount', (6.7, 0.6, 1.7), (9.76, 2.61, 1.05), 32)
cam_material = cam('cam_material', (5.4, -4.4, 1.7), (9.9, 0.6, 1.0), 45)
cam_field    = cam('cam_field', (8.3, 0.3, 1.35), (9.72, 2.35, 1.75), 60)

# ----------------------------------------------------------------------------- save + render
blend_path = os.path.join(OUT_DIR, 'temporary_barrier_final_visual_polish2.blend')

RENDERS = [
    # (file, camera, rig, balls_visible)
    ('preview_1_overview_arena', cam_overview, 'arena', False),
    ('preview_2_front', cam_front, 'arena', False),
    ('preview_3_inner_player_view', cam_inner, 'arena', False),
    ('preview_4_outer_oblique', cam_outer, 'arena', False),
    ('preview_5_top', cam_top, 'arena', False),
    ('preview_6_pylon_detail', cam_mount, 'arena', False),
    ('preview_7_field_detail', cam_field, 'arena', False),
    ('preview_8_neutral_light', cam_material, 'neutral', False),
    ('preview_9_arena_light', cam_material, 'arena', False),
]

rig_arena()   # default state saved in the .blend
COL_BALLS.hide_render = False
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print('[build] saved', blend_path)

current_rig = 'arena'
for fname, camera, rig, balls in RENDERS:
    if rig != current_rig:
        (rig_arena if rig == 'arena' else rig_neutral)()
        current_rig = rig
    COL_BALLS.hide_render = not balls
    for o in COL_BALLS.objects:
        o.hide_render = not balls
    scn.camera = camera
    scn.render.filepath = os.path.join(OUT_DIR, fname + '.png')
    bpy.ops.render.render(write_still=True)
    print('[build] rendered', fname)

print('[build] DONE')
