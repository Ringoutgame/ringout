# Ring-Collapse — SEG06 SIMPLIFIED GATE (last visual cleanup, preview).
#
# Owner decision: the central break pocket still reads as a round eye /
# low-poly crater. Hero and Joint are REMOVED entirely (no further shaping),
# and the small isolated bright point left of the main break — located at
# theta 369.5 / r 9.4 = the separate chip Chip06_seamC — is removed too.
# What remains: the accepted crack channel, natural break lips, the accepted
# rim bite, and the seamA gold-trim break. No new chips, no new cutters,
# atlas recipe unchanged (re-bake of the seg06 half is unavoidable because
# the UV layout changes with the geometry).
#
# Based on the accepted correction-pass-1 design. Diagnosed causes of the
# remaining black dots / pinholes (read-only GLB scan vs the old stand):
#   * 25 new open-edge slits at theta 369.58 / r 8.60 — Chip06_seamB tore the
#     thin inner gold-trim band
#   * 9 new slits under the rim bite (theta 333.8) + canal slits at the
#     splinter chips (340/342/346)
#   * +194 down-facing top slivers and +152 needle triangles in the changed
#     zones (read as black dots from above)
# Fixes in this pass (rim silhouette and crack route stay unchanged):
#   * splinter field: satellites removed, hero/joint strongly shrunk and sunk
#     deeper (1-2 small embedded chips remain)
#   * Chip06_seamB moved off the inner trim band onto the marble edge and
#     shrunk (organic nick instead of a torn band)
#   * new micro_repair pass: dissolve degenerate slivers, weld boolean
#     double-verts in the changed zones, fill remaining micro-slits away from
#     the native arc-end borders
#   * adaptive consume loop until artifact thin-groups == 0 (hard gate)
#   * atlas: cavity floor lighter (gray 0.58), basecolor x0.93, roughness
#     x1.12+0.05 — closer to the marble, no near-black pits, matte finish
#
# Rebuilds ONLY Segment06_Cracked_BALANCED with the corrected break design:
#   * the single large rim chip (read as a drilled half-circle) is replaced
#     by four smaller stepped spall chips (irregular, asymmetric silhouette,
#     no larger total extent)
#   * hero/joint chips shrink and sink deeper (integrated splinters instead
#     of a pale low-poly crystal pile)
#   * the crack channel gains a third hero widening (no painted-line read)
#   * three small spall chips break the gold trim + marble organically just
#     before the 010 boundary (staggered, asymmetric; seg01 side is
#     byte-protected and untouched)
#   * the seg06 atlas half is re-baked onto the EXISTING pair-3 atlas
#     (seg03 half texel-identical) and then darkened/roughened slightly
#     toward the surrounding marble
# Segment 03 is NOT rebuilt (protected); output is a 1-root GLB.
#
# Basis: the approved four-segment cleanup builder (this file is its direct
# derivation). Segments 03 and 06 are cracked with the FULL cleanup-grade
# recipe proven on Segments 01/04:
#   * blade + branch routes in the frozen language (zigzag top course,
#     dogleg branch, rim crossing, wall descent, hero zones)
#   * tip floor 0.30, data-driven consuming cuts, island removal
#   * material-slot fix (boolean_fracture_cut), BALANCED cavity floor 0.50
#   * pair-3 atlas seg36_frac_* (2048x2048, seg03 U[0.010..0.485],
#     seg06 U[0.515..0.990]) — identical recipe/structure to the approved
#     pair-1/2 atlases
# NOTHING of the production blend or any approved stand is modified; the
# output is a NEW 2-root GLB (Segment03/06_Cracked_BALANCED, PRE-taper,
# PRE-harmonization) that the six-segment rollout stage consumes.
#
# Run:
#   "D:/Blender/blender.exe" --background --factory-startup \
#       --python tools/validate_ring_collapse_seg06_simplified_gate.py
import bpy
import bmesh
import math
import os
import time
import json
import struct
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

T0 = time.time()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
BLEND_SRC = os.path.join(ROOT, 'assets', 'ring_collapse', 'source',
                         'ring_collapse.blend')
VAL_DIR = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                       'seg36_gate')
ART_DIR = os.path.join(ROOT, 'artifacts', 'ring_collapse', 'seg36_gate')
TEX_DIR = os.path.join(VAL_DIR, 'textures')
os.makedirs(VAL_DIR, exist_ok=True)
os.makedirs(ART_DIR, exist_ok=True)
os.makedirs(TEX_DIR, exist_ok=True)
GLB_OUT = os.path.join(VAL_DIR, 'ring_collapse_seg06_simplified.glb')

# APPROVED production recipe (frozen art direction) — identical to the pilot.
BALANCED = {'dist': 0.32, 'lo': 0.20, 'hi': 0.85, 'gray': 0.58}
OCC_STRENGTH = 0.5
ATLAS_RES = 2048
ATLAS_U3 = {'seg03': (0.010, 0.485), 'seg06': (0.515, 0.990)}   # pair 3

# cleanup tuning (data-driven from diagnostic_islands.json)
THIN_DIST = 0.014          # opposite surface closer than 14 mm -> thin wall
CLUSTER_MERGE = 0.18       # merge thin clusters closer than this (world)
TAIL_PROTECT = 0.25        # never cut this close to a route tip (length!)
TAIL_SOFT = 0.45           # inside this radius: cap the cut small
TIP_FLOOR_CLEAN = 0.30     # blade taper floor for seg01/04 (was 0.12)
MAX_CUTS_PER_SEG = 14     # owner pass: many SMALL flat dishes instead
CONSUME_MAX_R = 0.15      # of two 0.34 craters (no round pocket read)
CONSUME_JITTER = 0.08      # compact, low-facet consuming chips
# The cleanup may ONLY touch the crack zone. The intact architecture has its
# own legitimately thin features (gold trim bands, pillar shells, segment
# side faces) — run 1 proved that an unrestricted scan bites into them.
CRACK_CORRIDOR = 0.55      # max distance from the blade/branch route
CRACK_Z_MIN = -0.70        # ring body only — never below (pillars!)
CRACK_Z_MAX = 0.10

STATS = {'timings': {}, 'fix': {}, 'geometry': {}, 'cleanup': {},
         'atlas': {}, 'glb': {}, 'regression': {}, 'assertions': []}
ASSERTS = []


def log(msg):
    print('[cleanup] %s (%.1fs)' % (msg, time.time() - T0), flush=True)


def check(name, ok, detail=''):
    ASSERTS.append({'name': name, 'ok': bool(ok), 'detail': detail})
    log('ASSERT %s: %s %s' % ('OK ' if ok else 'FAIL', name, detail))
    return ok


# ───────────────────────────────────────────────── open production (RO) ────
log('open production blend (read-only use — never saved back)')
bpy.ops.wm.open_mainfile(filepath=BLEND_SRC)
scene = bpy.context.scene
scene.frame_set(1)

SEGS = {n: bpy.data.objects['Collapse_Segment_%02d' % n] for n in range(1, 7)}
M_TOP = bpy.data.materials['M_ArenaTop']
M_FRAC = bpy.data.materials['M_Fracture']


def img_by_name(name):
    return bpy.data.images.get(name)


# ───────────────────────────────────── glTF-clean top material (frozen) ────
def build_top_clean():
    m = bpy.data.materials.new('M_ArenaTop_Val')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bc = nt.nodes.new('ShaderNodeTexImage'); bc.image = img_by_name('rc_top_basecolor_clean')
    orm = nt.nodes.new('ShaderNodeTexImage'); orm.image = img_by_name('rc_top_orm_clean')
    nrm = nt.nodes.new('ShaderNodeTexImage'); nrm.image = img_by_name('rc_top_normal')
    nt.links.new(bc.outputs['Color'], bsdf.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(nrm.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


M_TOP_VAL = build_top_clean()


def swap_top(ob):
    for i, slot in enumerate(ob.data.materials):
        if slot is M_TOP:
            ob.data.materials[i] = M_TOP_VAL


# ───────────────────────────────────── BALANCED bake-source material ────────
def build_bake_source():
    m = M_FRAC.copy()
    m.name = 'M_Frac_BALANCED_bakeSrc'
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.42, 0.42, 0.42)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE':
            n.projection = 'BOX'
            n.projection_blend = 0.35
            nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    sep = next(n for n in nt.nodes if n.type == 'SEPARATE_COLOR')
    rr = nt.nodes.new('ShaderNodeMapRange')
    rr.inputs['To Min'].default_value = 0.58
    rr.inputs['To Max'].default_value = 0.85
    nt.links.new(sep.outputs['Green'], rr.inputs['Value'])
    nt.links.new(rr.outputs['Result'], bsdf.inputs['Roughness'])
    for lk in list(bsdf.inputs['Metallic'].links):
        nt.links.remove(lk)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.22
    bsdf.inputs['Coat Weight'].default_value = 0.0
    bc_in = bsdf.inputs['Base Color']
    bc_src = bc_in.links[0].from_socket
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
    ao.samples = 16; ao.only_local = True; ao.inside = False
    ao.inputs['Distance'].default_value = BALANCED['dist']
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.interpolation_type = 'SMOOTHSTEP'; mr.clamp = True
    mr.inputs['From Min'].default_value = BALANCED['lo']
    mr.inputs['From Max'].default_value = BALANCED['hi']
    mr.inputs['To Min'].default_value = 0.0
    mr.inputs['To Max'].default_value = 1.0
    nt.links.new(ao.outputs['AO'], mr.inputs['Value'])
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    nt.links.new(mr.outputs['Result'], inv.inputs[1])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.clamp_result = False

    def sock(node, ident):
        return next(s for s in node.inputs if s.identifier == ident)
    nt.links.new(inv.outputs['Value'], sock(mix, 'Factor_Float'))
    nt.links.new(bc_src, sock(mix, 'A_Color'))
    sock(mix, 'B_Color').default_value = (BALANCED['gray'],) * 3 + (1.0,)
    res = next(s for s in mix.outputs if s.identifier == 'Result_Color')
    nt.links.new(res, bc_in)
    return m


M_SRC = build_bake_source()


def build_occ_source():
    m = bpy.data.materials.new('M_Frac_occ')
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes['Material Output']
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
    ao.samples = 64; ao.only_local = True; ao.inside = False
    ao.inputs['Distance'].default_value = BALANCED['dist']
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.interpolation_type = 'SMOOTHSTEP'; mr.clamp = True
    mr.inputs['From Min'].default_value = BALANCED['lo']
    mr.inputs['From Max'].default_value = BALANCED['hi']
    nt.links.new(ao.outputs['AO'], mr.inputs['Value'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(mr.outputs['Result'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


M_OCC = build_occ_source()


# ───────────────────────────────────── crack geometry helpers (frozen) ──────
def wall_r(z):
    return float(np.interp(z, [-0.56, -0.26, -0.205, -0.145, 0.045],
                           [10.02, 10.02, 9.98, 10.10, 10.10]))


def pol(th_deg, r, z):
    th = math.radians(th_deg)
    return np.array([r * math.cos(th), r * math.sin(th), z])


TOP_Z = 0.045


def down_vec(p, mode):
    radial = np.array([p[0], p[1], 0.0]); radial /= (np.linalg.norm(radial) + 1e-9)
    if mode == 't':
        return np.array([0.0, 0.0, -1.0])
    if mode == 'w':
        return -radial
    t = mode[1]
    d = (1 - t) * np.array([0.0, 0.0, -1.0]) + t * (-radial)
    return d / (np.linalg.norm(d) + 1e-9)


def mode_phase(mode):
    if mode == 't':
        return 0.0
    if mode == 'w':
        return 1.0
    return float(mode[1])


def resample(coarse, step=0.045):
    pts, dns, phs = [], [], []
    for (pa, ma), (pb, mb) in zip(coarse[:-1], coarse[1:]):
        seg_len = float(np.linalg.norm(pb - pa))
        n = max(2, int(seg_len / step))
        for k in range(n):
            f = k / n
            pts.append(pa + (pb - pa) * f)
            da = down_vec(pa, ma); db = down_vec(pb, mb)
            d = (1 - f) * da + f * db
            dns.append(d / (np.linalg.norm(d) + 1e-9))
            phs.append((1 - f) * mode_phase(ma) + f * mode_phase(mb))
    pts.append(coarse[-1][0].copy())
    dns.append(down_vec(coarse[-1][0], coarse[-1][1]))
    phs.append(mode_phase(coarse[-1][1]))
    return np.array(pts), np.array(dns), np.array(phs)


def sm_noise(rng, n, k=9, passes=3):
    a = rng.normal(0, 1.0, n)
    for _ in range(passes):
        a = np.convolve(a, np.ones(k) / k, mode='same')
    return a / (np.std(a) + 1e-9)


def build_blade(name, coarse, w0, d0, hero_s=None, rng_seed=41,
                start_taper=0.05, end_taper=0.90, tip_floor=0.12):
    """Frozen pilot blade builder. `tip_floor` is the ONLY cleanup knob:
    0.12 = approved pilot value (used verbatim for Segments 02/05);
    0.30 for the cleaned Segments 01/04 so the taper tails end as blunt
    stone breaks instead of paper-thin needles. Only the taper zones at
    the route ends are affected — route, length and width elsewhere are
    bit-identical (same seeds, same section math)."""
    rng = np.random.default_rng(rng_seed)
    p, dn, phase = resample(coarse)
    m = len(p)
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))])
    s /= max(s[-1], 1e-9)
    open_n = sm_noise(rng, m, 11); depth_n = sm_noise(rng, m, 13)
    asym_n = sm_noise(rng, m, 15); cham_l = sm_noise(rng, m, 5, 2)
    cham_r = sm_noise(rng, m, 5, 2); lat_n = sm_noise(rng, m, 9)
    o_mod = np.clip(0.56 + 0.18 * open_n, 0.36, 0.82)
    d_mod = np.clip(1.00 + 0.28 * depth_n, 0.66, 1.45)
    asym = np.clip(0.30 * asym_n, -0.45, 0.45)
    ce_l = np.clip(0.13 + 0.09 * cham_l, 0.04, 0.26)
    ce_r = np.clip(0.13 + 0.09 * cham_r, 0.04, 0.26)
    hero = np.zeros(m)
    if hero_s is not None:
        for s0, amp, sig in hero_s:
            hero += amp * np.exp(-((s - s0) / sig) ** 2)
    hero_n = np.clip(hero, 0, 1.2)
    ns_pts = 11
    rag = rng.normal(0, 1.0, (m, ns_pts))
    for _ in range(2):
        rag = np.apply_along_axis(
            lambda a: np.convolve(a, np.ones(5) / 5, mode='same'), 0, rag)
    rag /= (np.std(rag) + 1e-9)
    verts = []
    for j in range(m):
        tap = 1.0
        if s[j] < start_taper:
            tap = max(tip_floor, s[j] / start_taper)
        elif s[j] > end_taper:
            tap = max(tip_floor, (1 - s[j]) / (1 - end_taper))
        wj = w0 * tap; dj = d0 * tap; wall_k = phase[j]
        wt = wj * o_mod[j] * (1 + 0.35 * hero_n[j]) * (1 + 0.35 * wall_k)
        D = dj * d_mod[j] * (1 + 0.55 * hero_n[j]) * (1 + 0.30 * wall_k)
        bulb_k = (1.0 + 0.45 * hero_n[j]) * (1.48 / 1.35)
        bL = 1.35 * bulb_k * (1 + 0.30 * asym[j])
        bR = 1.30 * bulb_k * (1 - 0.30 * asym[j])
        sec = [
            (-(wt + ce_l[j] * wj), 0.03), (-wt * 0.85, -0.05 * D),
            (-wt * bL, -0.30 * D), (-wt * 0.55, -0.62 * D),
            (-wt * 0.14, -0.86 * D), (0.0, -1.00 * D),
            (wt * 0.13, -0.84 * D), (wt * 0.52, -0.60 * D),
            (wt * bR, -0.28 * D), (wt * 0.80, -0.05 * D),
            ((wt + ce_r[j] * wj), 0.03),
        ]
        ja, jb = max(0, j - 1), min(m - 1, j + 1)
        tang = p[jb] - p[ja]; tang /= (np.linalg.norm(tang) + 1e-9)
        lat = np.cross(tang, dn[j]); lat /= (np.linalg.norm(lat) + 1e-9)
        loff = lat_n[j] * 0.04 * wj
        for si, (sx, sz) in enumerate(sec):
            lx = sx + loff; lz = sz
            if 0 < si < ns_pts - 1:
                lx += rag[j, si] * 0.005 * tap
                lz += rag[j, (si + 4) % ns_pts] * 0.003 * tap
            verts.append(p[j] + lat * lx + dn[j] * (-lz))
    faces = []
    for j in range(m - 1):
        for k in range(ns_pts):
            k2 = (k + 1) % ns_pts
            faces.append([j * ns_pts + k, j * ns_pts + k2,
                          (j + 1) * ns_pts + k2, (j + 1) * ns_pts + k])
    faces.append(list(range(ns_pts - 1, -1, -1)))
    faces.append([(m - 1) * ns_pts + k for k in range(ns_pts)])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate(); me.update(calc_edges=True)
    me.materials.append(M_SRC)
    bm2 = bmesh.new(); bm2.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
    bm2.to_mesh(me); bm2.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def build_chip(name, center, radii, rng_seed, sink=0.35, jitter=0.18):
    """Frozen chip builder; jitter 0.18 = approved chips (verbatim),
    jitter 0.08 = compact low-facet consuming chips for the cleanup."""
    rng = np.random.default_rng(rng_seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    bm.verts.ensure_lookup_table()
    vs = np.array([v.co[:] for v in bm.verts])
    fs = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    vs = vs * (1 + rng.uniform(-jitter, jitter, (len(vs), 1)))
    ang = rng.uniform(0, math.pi); ca, sa = math.cos(ang), math.sin(ang)
    sx = vs[:, 0] * radii[0]; sy = vs[:, 1] * radii[1]
    vs2 = np.stack([sx * ca - sy * sa, sx * sa + sy * ca, vs[:, 2] * radii[2]], axis=1)
    base = np.array(center) - np.array([0, 0, radii[2] * sink])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in (vs2 + base)], [], fs)
    me.validate(); me.update(calc_edges=True)
    me.materials.append(M_SRC)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# ───────────────────────────── material-slot fix (validated helper) ─────────
def apply_boolean(target, cutter, solver='EXACT', use_self=False):
    mod = target.modifiers.new('cut', 'BOOLEAN')
    mod.object = cutter; mod.operation = 'DIFFERENCE'; mod.solver = solver
    if solver == 'EXACT':
        mod.use_self = use_self; mod.use_hole_tolerant = True
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    try:
        bpy.ops.object.modifier_apply(modifier='cut')
        return len(target.data.polygons) > 0
    except Exception as exc:
        log('boolean %s [%s]: apply exception (%s)' % (cutter.name, solver, exc))
        try:
            target.modifiers.clear()
        except Exception:
            pass
        return False


def boolean_fracture_cut(target, cutter, frac_mat, solver='EXACT', use_self=False):
    """Difference-cut with the validated material-slot fix: register the
    fracture material as a real slot on the TARGET before the cut so the new
    interior faces land on it instead of falling back to slot 0."""
    names = [m.name if m else '' for m in target.data.materials]
    if frac_mat.name not in names:
        target.data.materials.append(frac_mat)
    frac_idx = list(target.data.materials).index(frac_mat)
    ok = apply_boolean(target, cutter, solver, use_self)
    if not ok:
        return -1
    return frac_idx


def slot0_and_frac_counts(ob, frac_mat):
    slot0 = sum(1 for p in ob.data.polygons if p.material_index == 0)
    idx = list(ob.data.materials).index(frac_mat) if frac_mat.name in \
        [m.name if m else '' for m in ob.data.materials] else -1
    fracn = sum(1 for p in ob.data.polygons if p.material_index == idx) if idx >= 0 else 0
    return slot0, fracn


def slot_face_counts(ob):
    counts = {}
    names = [m.name if m else '?' for m in ob.data.materials]
    for p in ob.data.polygons:
        nm = names[p.material_index] if p.material_index < len(names) else '?'
        counts[nm] = counts.get(nm, 0) + 1
    return counts


# ───────────────────────────── cleanup mesh analysis helpers ────────────────
def mesh_islands(ob):
    """Connected face components, world-space stats, largest first."""
    mat = ob.matrix_world
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    seen = [False] * len(bm.faces)
    islands = []
    for f0 in bm.faces:
        if seen[f0.index]:
            continue
        stack = [f0]; seen[f0.index] = True; comp = []
        while stack:
            f = stack.pop(); comp.append(f.index)
            for e in f.edges:
                for f2 in e.link_faces:
                    if not seen[f2.index]:
                        seen[f2.index] = True; stack.append(f2)
        vs = np.array([(mat @ v.co)[:] for i in comp
                       for v in bm.faces[i].verts])
        mn, mx = vs.min(axis=0), vs.max(axis=0)
        islands.append({'face_idx': comp, 'faces': len(comp),
                        'bbox_dim': [round(float(v), 3) for v in (mx - mn)],
                        'centroid': [round(float(v), 3) for v in vs.mean(axis=0)]})
    bm.free()
    islands.sort(key=lambda i: -i['faces'])
    return islands


def edge_counts(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    nonman = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    bm.free()
    return boundary, nonman


def world_max_z(ob):
    mat = ob.matrix_world
    return max((mat @ v.co).z for v in ob.data.vertices)


def remove_small_islands(ob, corridor):
    """Delete loose fragments in the crack corridor (real material loss —
    floating shells and snapped-off pieces are gone, not left hovering).
    The largest component always survives; a loose island OUTSIDE the crack
    zone would mean damaged intact architecture — it is left in place so the
    single-island assertion fails loudly instead of hiding the problem."""
    islands = mesh_islands(ob)
    removed = [isl for isl in islands[1:] if in_crack_zone(isl, corridor)]
    if removed:
        drop = set(i for isl in removed for i in isl['face_idx'])
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in drop], context='FACES')
        bm.to_mesh(ob.data); bm.free()
        ob.data.update()
    return [{'faces': i['faces'], 'bbox_dim': i['bbox_dim'],
             'centroid': i['centroid']} for i in removed]


def thin_clusters(ob):
    """Paper-thin regions (opposite surface < THIN_DIST along -normal),
    adjacency-clustered, then merged across CLUSTER_MERGE gaps. World stats."""
    mat = ob.matrix_world
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table(); bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    thin = set()
    for f in bm.faces:
        c = f.calc_center_median(); n = f.normal
        if n.length < 0.5:
            continue
        loc, _, idx, _ = tree.ray_cast(c - n * 0.0015, -n, THIN_DIST)
        if loc is not None and idx != f.index:
            thin.add(f.index)
    seen = set(); raw = []
    for fi in thin:
        if fi in seen:
            continue
        stack = [fi]; seen.add(fi); comp = []
        while stack:
            i = stack.pop(); comp.append(i)
            for e in bm.faces[i].edges:
                for f2 in e.link_faces:
                    if f2.index in thin and f2.index not in seen:
                        seen.add(f2.index); stack.append(f2.index)
        vs = np.array([(mat @ v.co)[:] for i in comp
                       for v in bm.faces[i].verts])
        raw.append({'faces': len(comp), 'verts': vs})
    bm.free()
    # merge nearby clusters (a faceted clump shows up as many small ones)
    merged = []
    for cl in sorted(raw, key=lambda c: -c['faces']):
        cen = cl['verts'].mean(axis=0)
        for mg in merged:
            if np.linalg.norm(mg['verts'].mean(axis=0) - cen) < CLUSTER_MERGE:
                mg['faces'] += cl['faces']
                mg['verts'] = np.concatenate([mg['verts'], cl['verts']])
                break
        else:
            merged.append({'faces': cl['faces'], 'verts': cl['verts']})
    out = []
    for mg in merged:
        mn, mx = mg['verts'].min(axis=0), mg['verts'].max(axis=0)
        out.append({'faces': mg['faces'],
                    'centroid': mg['verts'].mean(axis=0),
                    'bbox_min': mn, 'bbox_max': mx, 'bbox_dim': mx - mn})
    out.sort(key=lambda c: -float(max(c['bbox_dim'])))
    return out


def is_artifact(cl):
    """Plate/spike/clump rule (from the diagnostic): a merged thin group is a
    cleanup target if it is a large paper plate, a big thin sheet/spike, or a
    dense faceted thin-wall group. Small ragged lip bits (the approved crack
    language on 02/05) stay untouched."""
    dims = sorted(float(v) for v in cl['bbox_dim'])
    plate = dims[0] <= 0.020 and dims[2] >= 0.22
    sheet = cl['faces'] >= 10 and dims[2] >= 0.45
    clump = cl['faces'] >= 22 and dims[2] >= 0.30
    return plate or sheet or clump


def tip_dist(cl, route):
    tips = [route[0][0], route[-1][0]]
    return min(float(np.linalg.norm(cl['centroid'] - t)) for t in tips)


def route_corridor_pts(blade_def, branch_def):
    """Dense polyline of the blade + branch routes (crack-zone reference)."""
    pts = [resample(blade_def['coarse'])[0], resample(branch_def['coarse'])[0]]
    return np.concatenate(pts)


def in_crack_zone(cl, corridor):
    """The cleanup is confined to the crack corridor. Thin features of the
    intact architecture (trim bands, pillar shells, segment side faces) are
    NOT cleanup targets and must never be cut."""
    cen = cl['centroid']
    if not (CRACK_Z_MIN <= float(cen[2]) <= CRACK_Z_MAX):
        return False
    return float(np.min(np.linalg.norm(corridor - cen, axis=1))) < CRACK_CORRIDOR


def count_open_artifacts(ob, route, corridor, protect_pts=None):
    """Artifact-class thin groups in the crack zone, outside the protected
    route tails — the quantity the cleanup must drive to zero. Tail-zone
    groups are protected (crack length frozen); out-of-zone thin features
    belong to the intact architecture and are reported separately."""
    open_n = tail_n = outside_n = 0
    for cl in thin_clusters(ob):
        if not is_artifact(cl):
            continue
        if not in_crack_zone(cl, corridor):
            outside_n += 1
        elif tip_dist(cl, route) < TAIL_PROTECT or (
                protect_pts is not None and len(protect_pts) and
                float(np.min(np.linalg.norm(protect_pts - cl['centroid'],
                                            axis=1))) < 0.5):
            tail_n += 1
        else:
            open_n += 1
    return open_n, tail_n, outside_n


def consume_cuts_for(ob, key, route, corridor, seed_base, passes=2,
                     protect_pts=None):
    """Snap off detected plates/spikes/clumps with compact low-jitter
    ellipsoid chips (real material loss). Only inside the crack corridor;
    route tails protected so the crack length never shrinks.
    Returns (cut records, removed islands)."""
    applied = []
    removed_all = []
    for pass_no in range(passes):
        clusters = thin_clusters(ob)
        todo = []
        for cl in clusters:
            if not is_artifact(cl) or not in_crack_zone(cl, corridor):
                continue
            td = tip_dist(cl, route)
            if td < TAIL_PROTECT:
                continue                      # crack length is frozen
            if protect_pts is not None and len(protect_pts) and float(np.min(
                    np.linalg.norm(protect_pts - cl['centroid'], axis=1))) < 0.5:
                continue                      # seam-break zone: never consume
            cap = 0.12 if td < TAIL_SOFT else CONSUME_MAX_R
            dims = [float(d) for d in cl['bbox_dim']]
            radii = [min(cap, max(0.05, 0.5 * d * 1.3 + 0.02)) for d in dims]
            # a flat pancake cut slices a thin floor lamella under itself
            # (run-1 finding) — flat plates get a real bite depth instead
            if min(dims) <= 0.03:
                radii[dims.index(min(dims))] = max(
                    radii[dims.index(min(dims))], 0.08)
            radii = tuple(radii)
            todo.append((cl, cl['centroid'], radii, td))
            if len(todo) + len(applied) >= MAX_CUTS_PER_SEG:
                break
        if not todo:
            break
        for i, (cl, cen, radii, td) in enumerate(todo):
            nm = 'Consume_%s_p%d_%d' % (key, pass_no, i)
            chip = build_chip(nm, cen, radii, seed_base + pass_no * 10 + i,
                              sink=0.0, jitter=CONSUME_JITTER)
            idx = boolean_fracture_cut(ob, chip, M_SRC, 'EXACT')
            if idx < 0:
                idx = boolean_fracture_cut(ob, chip, M_SRC, 'FAST')
            applied.append({
                'name': nm, 'ok': idx >= 0,
                'centroid': [round(float(v), 3) for v in cen],
                'radii': [round(float(r), 3) for r in radii],
                'faces_in_cluster': cl['faces'],
                'bbox_dim': [round(float(v), 3) for v in cl['bbox_dim']],
                'tip_dist': round(td, 3)})
            log('  consume %s: r=%s cluster=%d faces tip_d=%.2f -> ok=%s'
                % (nm, applied[-1]['radii'], cl['faces'], td, idx >= 0))
            me = chip.data
            bpy.data.objects.remove(chip, do_unlink=True)
            bpy.data.meshes.remove(me)
        # islands created by snapped-off pieces are removed before re-scan
        removed_all += remove_small_islands(ob, corridor)
    return applied, removed_all


def thicken_thin_plates(ob, route, corridor, protect_pts,
                        min_gap=0.016, max_rounds=6):
    """Owner pass replacement for the consume dishes: artifact thin plates
    are thickened INVISIBLY. Each thin face's hidden counterpart sits within
    THIN_DIST behind it; pushing the concealed skin apart (along +normal,
    away from the partner) makes the slab >= min_gap thick without touching
    the visible plateau (verts near TOP_Z are never moved), without new
    cutters and without any carved dish. Returns per-round stats."""
    stats = []
    for _round in range(max_rounds):
        mat = ob.matrix_world
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        tree = BVHTree.FromBMesh(bm)
        thin = {}
        for f in bm.faces:
            c = f.calc_center_median()
            n = f.normal
            if n.length < 0.5:
                continue
            loc, _, idx, _ = tree.ray_cast(c - n * 0.0015, -n, THIN_DIST)
            if loc is not None and idx != f.index:
                thin[f.index] = ((c - loc).length + 0.0015, idx, -n.normalized())
        seen = set()
        comps = []
        for fi in thin:
            if fi in seen:
                continue
            stack = [fi]
            seen.add(fi)
            comp = []
            while stack:
                i = stack.pop()
                comp.append(i)
                for e in bm.faces[i].edges:
                    for f2 in e.link_faces:
                        if f2.index in thin and f2.index not in seen:
                            seen.add(f2.index)
                            stack.append(f2.index)
            comps.append(comp)
        merged = []
        for comp in sorted(comps, key=lambda c: -len(c)):
            vs = np.array([(mat @ v.co)[:] for i in comp
                           for v in bm.faces[i].verts])
            cen = vs.mean(axis=0)
            for mg in merged:
                if np.linalg.norm(mg['vs'].mean(axis=0) - cen) < CLUSTER_MERGE:
                    mg['ids'] += comp
                    mg['vs'] = np.concatenate([mg['vs'], vs])
                    break
            else:
                merged.append({'ids': list(comp), 'vs': vs})
        move = {}
        n_faces = 0
        for mg in merged:
            mn, mx = mg['vs'].min(axis=0), mg['vs'].max(axis=0)
            cl = {'faces': len(mg['ids']), 'centroid': mg['vs'].mean(axis=0),
                  'bbox_min': mn, 'bbox_max': mx, 'bbox_dim': mx - mn}
            if not is_artifact(cl) or not in_crack_zone(cl, corridor):
                continue
            if tip_dist(cl, route) < TAIL_PROTECT:
                continue
            if protect_pts is not None and len(protect_pts) and float(np.min(
                    np.linalg.norm(protect_pts - cl['centroid'],
                                   axis=1))) < 0.5:
                continue
            n_faces += len(mg['ids'])
            for fi in mg['ids']:
                f = bm.faces[fi]
                gap, partner, ray_dir = thin[fi]
                need = min_gap - gap
                if need <= 0:
                    continue
                n = f.normal
                movable = [v for v in f.verts
                           if (mat @ v.co).z <= TOP_Z - 0.004]
                if movable:
                    for v in movable:
                        d = move.get(v.index)
                        if d is None or need > d[1]:
                            move[v.index] = (n.copy(), need)
                else:
                    # pinned visible skin (e.g. the plateau over a shallow
                    # canal overhang): push the hidden PARTNER away along
                    # the ray direction instead
                    pf = bm.faces[partner]
                    for v in pf.verts:
                        if (mat @ v.co).z > TOP_Z - 0.004:
                            continue
                        d = move.get(v.index)
                        if d is None or need > d[1]:
                            move[v.index] = (ray_dir.copy(), need)
            if len(stats) < 24:
                stats.append({'round': _round, 'faces': len(mg['ids']),
                              'centroid': [round(float(v), 3)
                                           for v in cl['centroid']],
                              'bbox_dim': [round(float(v), 3)
                                           for v in cl['bbox_dim']]})
        if not move:
            bm.free()
            break
        bm.verts.ensure_lookup_table()
        # coincident duplicate verts (split normals/UV seams) must move as
        # one point, or the weld census tears a new hairline open
        key2vi = {}
        for v in bm.verts:
            key2vi.setdefault(
                tuple(np.round(np.array(v.co) / 1e-5).astype(np.int64)),
                []).append(v.index)
        expanded = {}
        for vi, mv in move.items():
            k = tuple(np.round(
                np.array(bm.verts[vi].co) / 1e-5).astype(np.int64))
            for vj in key2vi.get(k, [vi]):
                old_mv = expanded.get(vj)
                if old_mv is None or mv[1] > old_mv[1]:
                    expanded[vj] = mv
        for vi, (n, need) in expanded.items():
            v = bm.verts[vi]
            v.co += n * need
            wz = (mat @ v.co).z
            if wz > TOP_Z - 0.004:        # clamp: never rise into the skin
                v.co.z -= (wz - (TOP_Z - 0.004))
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
        log('  thicken: %d thin-plate faces, %d hidden verts moved (round %d)'
            % (n_faces, len(move), _round))
        if _round >= 1 and len(move) <= 8:
            break                        # stalled: zero-thickness fin(s)
    # No destructive fallback: a residual cluster is reported and the gate
    # decides. (An earlier delete+fill fallback tore a 36-edge hole into the
    # visible skin — deletion of surface faces is never safe here.)
    resid = 0
    for cl in thin_clusters(ob):
        if not is_artifact(cl) or not in_crack_zone(cl, corridor):
            continue
        if tip_dist(cl, route) < TAIL_PROTECT:
            continue
        if protect_pts is not None and len(protect_pts) and float(np.min(
                np.linalg.norm(protect_pts - cl['centroid'], axis=1))) < 0.5:
            continue
        resid += 1
        log('  thicken residual cluster: %d faces at %s'
            % (cl['faces'], [round(float(v), 3) for v in cl['centroid']]))
    if resid == 0:
        log('  thicken: all artifact thin plates resolved')
    return stats


# ───────────────────────────────────── crack routes ────────────────────────
# Pair 3 — NEW structural routes for Segments 03 and 06, authored in the
# frozen crack language (zigzag top course inner->outer, dogleg branch, rim
# crossing at r 10.11..10.13, wall descent to z -0.55, five chips: rim /
# hero / joint / 2x wall). Directions mirror the approved spread: seg03 runs
# theta-increasing (like seg04/05), seg06 theta-decreasing (like seg01/02).
COARSE03 = [
    (pol(137.0, 8.93, TOP_Z), 't'), (pol(139.1, 9.21, TOP_Z), 't'),
    (pol(140.8, 9.13, TOP_Z), 't'), (pol(143.0, 9.41, TOP_Z), 't'),
    (pol(144.9, 9.36, TOP_Z), 't'), (pol(147.1, 9.31, TOP_Z), 't'),
    (pol(149.2, 9.57, TOP_Z), 't'), (pol(150.7, 9.52, TOP_Z), 't'),
    (pol(152.9, 9.79, TOP_Z), 't'), (pol(154.8, 9.93, TOP_Z), 't'),
    (pol(156.1, 10.05, TOP_Z), 't'),
    (pol(156.5, 10.11, 0.01), ('c', 0.40)), (pol(156.7, 10.13, -0.05), ('c', 0.75)),
    (pol(156.9, 10.11, -0.12), ('c', 1.0)),
    (pol(157.2, wall_r(-0.20), -0.20), 'w'), (pol(157.5, wall_r(-0.30), -0.30), 'w'),
    (pol(157.8, wall_r(-0.40), -0.40), 'w'), (pol(158.0, wall_r(-0.48), -0.48), 'w'),
    (pol(158.1, wall_r(-0.55), -0.55), 'w'),
]
BRANCH03 = [(pol(147.1, 9.33, TOP_Z), 't'), (pol(148.2, 9.01, TOP_Z), 't'),
            (pol(148.9, 8.83, TOP_Z), 't')]
COARSE06 = [
    (pol(352.0, 8.95, TOP_Z), 't'), (pol(350.2, 9.24, TOP_Z), 't'),
    (pol(348.6, 9.15, TOP_Z), 't'), (pol(346.5, 9.44, TOP_Z), 't'),
    (pol(344.9, 9.39, TOP_Z), 't'), (pol(342.9, 9.27, TOP_Z), 't'),
    (pol(340.6, 9.52, TOP_Z), 't'), (pol(338.9, 9.47, TOP_Z), 't'),
    (pol(336.9, 9.76, TOP_Z), 't'), (pol(335.2, 9.95, TOP_Z), 't'),
    (pol(334.1, 10.06, TOP_Z), 't'),
    (pol(333.8, 10.11, 0.01), ('c', 0.40)), (pol(333.6, 10.13, -0.05), ('c', 0.75)),
    (pol(333.4, 10.11, -0.12), ('c', 1.0)),
    (pol(333.1, wall_r(-0.20), -0.20), 'w'), (pol(332.7, wall_r(-0.30), -0.30), 'w'),
    (pol(332.3, wall_r(-0.40), -0.40), 'w'), (pol(332.0, wall_r(-0.48), -0.48), 'w'),
    (pol(331.8, wall_r(-0.55), -0.55), 'w'),
]
BRANCH06 = [(pol(342.9, 9.29, TOP_Z), 't'), (pol(344.0, 8.99, TOP_Z), 't'),
            (pol(344.7, 8.81, TOP_Z), 't')]

SEG06_BOUNDS_DEG = (308.0, 370.0)   # native arc-end borders (never fill)
MICRO_MERGE_DIST = 2.5e-4           # boolean double-vert weld distance


def micro_repair(ob, zone_pts, fill_pts):
    """Close the black-dot sources inside the changed zones only:
    degenerate slivers, boolean double-vert hairline slits, and remaining
    micro-slit loops — while native arc-end borders stay untouched."""
    mw = ob.matrix_world
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1.2e-4, edges=bm.edges[:])
    bm.verts.ensure_lookup_table()
    zp = np.array(zone_pts)
    # zone_pts / fill_pts are WORLD coordinates — v.co is object space, so
    # every zone test must go through the object's world matrix
    sel = [v for v in bm.verts
           if np.min(np.linalg.norm(zp - np.array(mw @ v.co), axis=1)) < 0.30]
    if sel:
        bmesh.ops.remove_doubles(bm, verts=sel, dist=MICRO_MERGE_DIST)
    fp = np.array(fill_pts)
    fsel = []
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        mid = mw @ ((e.verts[0].co + e.verts[1].co) / 2)
        if (e.verts[0].co - e.verts[1].co).length > 0.05:
            continue
        if np.min(np.linalg.norm(fp - np.array(mid), axis=1)) > 0.22:
            continue
        th = math.degrees(math.atan2(-mid.z, mid.x)) % 360
        if th < 90:
            th += 360
        r = math.hypot(mid.x, mid.z)
        d_end = min(abs(th - b) for b in SEG06_BOUNDS_DEG)
        if math.radians(d_end) * r < 0.30:
            continue                      # native arc-end border zone
        fsel.append(e)
    if fsel:
        res = bmesh.ops.holes_fill(bm, edges=fsel, sides=8)
        for f in res.get('faces', []):
            # inherit material + smoothing from an adjacent face so the fill
            # never introduces a new material seam
            for e in f.edges:
                nb = [g for g in e.link_faces if g is not f]
                if nb:
                    f.material_index = nb[0].material_index
                    f.smooth = nb[0].smooth
                    break

    def in_repair_zone(mid_obj):
        mid = mw @ Vector(mid_obj)        # object -> world
        if np.min(np.linalg.norm(fp - np.array(mid), axis=1)) > 0.22:
            return False
        th = math.degrees(math.atan2(-mid.z, mid.x)) % 360
        if th < 90:
            th += 360
        r = math.hypot(mid.x, mid.z)
        return math.radians(min(abs(th - b)
                                for b in SEG06_BOUNDS_DEG)) * r >= 0.30

    # Census stitch: the validator's weld metric (1e-5 position grid) sees
    # slits the topology does not — T-junctions (a vert of one face fan lies
    # ON the long edge of the other) and micro-offset duplicates. Close them
    # at census level: subdivide the long edge exactly at the T-vert, snap
    # offset pairs together. Positions move <= 0.4 mm, silhouette unchanged.
    n_split = n_snap = 0
    for _round in range(12):
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        key2vs = {}
        for v in bm.verts:
            k = tuple(np.round(np.array(v.co) / 1e-5).astype(np.int64))
            key2vs.setdefault(k, []).append(v)
        v2c = {v: k for k, vs2 in key2vs.items() for v in vs2}
        from collections import defaultdict as _dd
        ecount = _dd(int)
        for f in bm.faces:
            ks = [v2c[v] for v in f.verts]
            for i in range(len(ks)):
                a, b = ks[i], ks[(i + 1) % len(ks)]
                if a == b:
                    continue
                ecount[(min(a, b), max(a, b))] += 1
        open_ce = [e for e, c in ecount.items() if c == 1]
        open_ck = {k for e in open_ce for k in e}
        did = False
        for e in bm.edges:
            ka, kb = v2c[e.verts[0]], v2c[e.verts[1]]
            if ka == kb:
                continue
            if ecount.get((min(ka, kb), max(ka, kb)), 0) != 1:
                continue
            mid = (e.verts[0].co + e.verts[1].co) / 2
            if not in_repair_zone(mid):
                continue
            pa = e.verts[0].co.copy()
            ab = e.verts[1].co - pa
            L2 = ab.length_squared
            if L2 < 1e-12:
                continue
            # T-junction: another open-census vert on this open edge
            hit = None
            for k in open_ck:
                if k in (ka, kb):
                    continue
                pv = Vector(k) * 1e-5
                t = (pv - pa).dot(ab) / L2
                if t < 0.03 or t > 0.97:
                    continue
                if (pa + ab * t - pv).length < 2.5e-4:
                    hit = (t, key2vs[k][0].co.copy())
                    break
            if hit is not None:
                mid_before = pa + ab * 0.5
                res = bmesh.ops.subdivide_edges(bm, edges=[e], cuts=1)
                new_vs = [g for kk in ('geom_inner', 'geom_split', 'geom')
                          for g in res.get(kk, [])
                          if isinstance(g, bmesh.types.BMVert)]
                if new_vs:
                    nv = min(new_vs,
                             key=lambda v2: (v2.co - mid_before).length)
                    nv.co = hit[1]
                n_split += 1
                did = True
                break
        if not did:
            # micro-offset duplicates: snap open-census vert pairs <= 0.4 mm
            snapped = 0
            keys = [k for k in open_ck
                    if in_repair_zone(Vector(k) * 1e-5)]
            for i, k1 in enumerate(keys):
                p1 = Vector(k1) * 1e-5
                for k2 in keys[i + 1:]:
                    p2 = Vector(k2) * 1e-5
                    if 0 < (p1 - p2).length <= 4e-4:
                        tgt = key2vs[k1][0].co.copy()
                        for v in key2vs[k2]:
                            v.co = tgt
                        snapped += 1
            n_snap += snapped
            if snapped == 0:
                break
    log('  micro_repair census stitch: %d T-splits, %d snaps'
        % (n_split, n_snap))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


SEG_DEFS = {
    'seg06': {
        'src': SEGS[6], 'num': '06', 'pair': 3, 'clean': True,
        'root_cracked': 'Segment06_Cracked_BALANCED',
        'root_intact': 'Segment06_Intact',
        'route': COARSE06, 'consume_seed': 911, 'consume_passes': 8,
        'blade': dict(coarse=COARSE06, w0=0.056, d0=0.128,
                      # the big s=0.58 hero bulge (the round "eye" pocket)
                      # is removed with the hero chips; the two moderate
                      # widenings stay so the channel keeps its irregular read
                      hero_s=[(0.32, 0.55, 0.05),
                              (0.76, 0.65, 0.052)],
                      rng_seed=541, start_taper=0.06, end_taper=0.90,
                      tip_floor=TIP_FLOOR_CLEAN),
        'branch': dict(coarse=BRANCH06, w0=0.027, d0=0.041,
                       rng_seed=543, start_taper=0.18, end_taper=0.70,
                       tip_floor=TIP_FLOOR_CLEAN),
        'chips': [
            # rim: four stepped spalls replace the old 0.20-ellipsoid notch
            ('Chip06_rim_a', pol(334.05, 10.095, 0.005), (0.105, 0.075, 0.06), 711, 0.30),
            ('Chip06_rim_b', pol(333.82, 10.075, -0.045), (0.075, 0.06, 0.05), 712, 0.22),
            ('Chip06_rim_c', pol(334.22, 10.06, -0.02), (0.05, 0.042, 0.038), 713, 0.28),
            ('Chip06_rim_d', pol(333.65, 10.10, 0.0), (0.045, 0.038, 0.032), 714, 0.30),
            # splinter field: smaller, sunk deeper (integrated, not a pile)
            # hero/joint removed entirely (owner decision: no pocket)
            # wall chips unchanged (approved look)
            ('Chip06_wall', pol(333.0, 10.045, -0.29), (0.11, 0.08, 0.08), 704, 0.0),
            ('Chip06_wall2', pol(332.4, 10.035, -0.47), (0.12, 0.085, 0.09), 705, 0.0),
            # seam 010: staggered organic breaks over trim + marble on the
            # seg06 side only (seg01 is byte-protected)
            # seamB removed: any cut near the thin inner trim band tears it
            # into open slivers (measured 20-25 open edges = the black dot
            # next to the inner trim); outer trim break (seamA) + marble
            # step (seamC) carry the organic seam masking alone
            ('Chip06_seamA', pol(369.35, 10.05, 0.02), (0.07, 0.05, 0.042), 721, 0.25),
            # seamC removed (the isolated bright point on the plateau)
        ],
    },
}
ATLAS_U = dict(ATLAS_U3)

# ── crack both new segments with the fix + cleanup-grade pipeline ──────────
CRACKED = {}
INTACT = {}
for key, sd in SEG_DEFS.items():
    log('crack %s (%s)%s' % (key, sd['root_cracked'],
                             ' + cleanup' if sd['clean'] else ' (frozen)'))
    blade = build_blade('Blade_' + key, **sd['blade'])
    branch = build_blade('Branch_' + key, **sd['branch'])
    chips = [build_chip(nm, c, r, seed, sink)
             for (nm, c, r, seed, sink) in sd['chips']]
    cutters = [blade, branch] + chips

    ob = sd['src'].copy(); ob.data = sd['src'].data.copy()
    ob.name = sd['root_cracked']; ob.data.name = sd['root_cracked']
    for coll in sd['src'].users_collection:
        coll.objects.link(ob)
    swap_top(ob)
    slots_before = slot_face_counts(ob)
    slot0_before, _ = slot0_and_frac_counts(ob, M_SRC)
    ob.data.calc_loop_triangles()
    tris_intact = len(ob.data.loop_triangles)
    intact_max_z = world_max_z(ob)
    frac_slot = -1
    for cut_ob in cutters:
        idx = boolean_fracture_cut(ob, cut_ob, M_SRC, 'EXACT',
                                   use_self=(cut_ob in (blade, branch)))
        if idx < 0:
            idx = boolean_fracture_cut(ob, cut_ob, M_SRC, 'FAST')
        if idx >= 0:
            frac_slot = idx
        log('  cut %s -> %d polys' % (cut_ob.name, len(ob.data.polygons)))
    for cut_ob in cutters:
        me = cut_ob.data
        bpy.data.objects.remove(cut_ob, do_unlink=True); bpy.data.meshes.remove(me)

    if sd['clean']:
        # ---- geometry cleanup (Segment 01 / 04 only, crack corridor only) --
        corridor = route_corridor_pts(sd['blade'], sd['branch'])
        chip_centers = np.array([c for (_, c, _, _, _) in sd['chips']])
        corridor = np.concatenate([corridor, chip_centers])
        seam_protect = np.array([c for (nm2, c, _, _, _) in sd['chips']
                                 if 'seam' in nm2])
        isl_before = mesh_islands(ob)
        bnd_before, nm_before = edge_counts(ob)
        art_before, tail_before, out_before = \
            count_open_artifacts(ob, sd['route'], corridor, seam_protect)
        log('  before cleanup: %d islands, boundary %d, nonman %d, '
            'artifact thin-groups %d open + %d tail-protected + %d '
            'outside crack zone (intact architecture, untouched)'
            % (len(isl_before), bnd_before, nm_before, art_before,
               tail_before, out_before))
        removed = remove_small_islands(ob, corridor)   # floating shells first
        # Owner pass: consume dishes DISABLED (their exposed faceted
        # interiors were the two dark blue bodies). Thin plates are thickened
        # invisibly from below instead — the plateau surface stays pristine.
        cuts = thicken_thin_plates(ob, sd['route'], corridor, seam_protect)
        zone_pts = np.concatenate([corridor, chip_centers])
        fill_pts = np.concatenate(
            [route_corridor_pts(sd['blade'], sd['branch']),
             np.array([c for (nm2, c, _, _, _) in sd['chips']
                       if 'seam' not in nm2]),
             # measured residual slit under the rim bite (theta 333.8,
             # r 10.03, y -0.10) — give the fill an explicit anchor there
             np.array([pol(333.8, 10.03, -0.10)])])
        micro_repair(ob, zone_pts, fill_pts)
        micro_repair(ob, zone_pts, fill_pts)
        art_now, _, _ = count_open_artifacts(ob, sd['route'], corridor,
                                             seam_protect)
        extra = 0
        while art_now > 0 and extra < 3:
            extra += 1
            log('  residual artifact thin-groups %d -> extra thicken pass %d'
                % (art_now, extra))
            cuts += thicken_thin_plates(ob, sd['route'], corridor,
                                        seam_protect)
            micro_repair(ob, zone_pts, fill_pts)
            art_now, _, _ = count_open_artifacts(ob, sd['route'], corridor,
                                                 seam_protect)
        isl_after = mesh_islands(ob)
        bnd_after, nm_after = edge_counts(ob)
        art_after, tail_after, out_after = \
            count_open_artifacts(ob, sd['route'], corridor, seam_protect)
        max_z_after = world_max_z(ob)
        STATS['cleanup'][key] = {
            'islands_before': len(isl_before), 'islands_after': len(isl_after),
            'islands_removed': removed,
            'boundary_edges_before': bnd_before, 'boundary_edges_after': bnd_after,
            'nonmanifold_before': nm_before, 'nonmanifold_after': nm_after,
            'artifact_groups_open_before': art_before,
            'artifact_groups_open_after': art_after,
            'artifact_groups_tail_before': tail_before,
            'artifact_groups_tail_after': tail_after,
            'artifact_groups_outside_zone_before': out_before,
            'artifact_groups_outside_zone_after': out_after,
            'consume_cuts': cuts,
            'intact_max_z': round(intact_max_z, 4),
            'cracked_max_z': round(max_z_after, 4),
            'tip_floor': TIP_FLOOR_CLEAN,
        }
        check('%s_single_island_after_cleanup' % key, len(isl_after) == 1,
              '%d -> %d islands (removed: %s)'
              % (len(isl_before), len(isl_after),
                 [r['faces'] for r in removed]))
        check('%s_no_open_borders_added' % key, bnd_after <= bnd_before,
              'boundary edges %d -> %d (intact baseline 0)'
              % (bnd_before, bnd_after))
        check('%s_no_nonmanifold_added' % key, nm_after <= nm_before,
              'non-manifold edges %d -> %d' % (nm_before, nm_after))
        check('%s_artifact_thin_groups_zero' % key, art_after == 0,
              'open plate/spike/clump groups %d -> %d (hard gate 0; '
              'tail-protected: %d -> %d, tip floor %.2f)'
              % (art_before, art_after, tail_before, tail_after,
                 TIP_FLOOR_CLEAN))
        check('%s_intact_architecture_untouched' % key,
              out_after == out_before,
              'thin features outside the crack zone (trim/pillars/side '
              'faces): %d -> %d (must be untouched)' % (out_before, out_after))
        check('%s_silhouette_not_above_intact' % key,
              max_z_after <= intact_max_z + 1e-4,
              'cracked max z %.4f vs intact %.4f'
              % (max_z_after, intact_max_z))

    slot0_after, fracn = slot0_and_frac_counts(ob, M_SRC)
    slots_after = slot_face_counts(ob)
    growth = slot0_after - slot0_before
    check('%s_fix_frac_slot_exists' % key, frac_slot >= 0, 'slot %d' % frac_slot)
    check('%s_fix_frac_faces_present' % key, fracn > 0,
          '%d cut faces carry the fracture material' % fracn)
    check('%s_fix_diverts_interior_off_top' % key,
          fracn > 0 and growth < 0.25 * max(fracn, 1),
          'fix: %d interior faces -> fracture slot; slot0 grew only +%d; '
          'approved cleanup neg-control reference: +155' % (fracn, growth))
    kept = all(slots_after.get(nm if nm != M_TOP.name else M_TOP_VAL.name, 0) > 0
               for nm in slots_before if slots_before[nm] > 0)
    check('%s_original_materials_kept' % key, kept,
          'before=%s after=%s' % (slots_before, slots_after))

    log('  unwrap crack faces + remap into atlas half U%s (pair %d)'
        % (str(ATLAS_U[key]), sd['pair']))
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for p in ob.data.polygons:
        p.select = (p.material_index == frac_slot)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.03, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    u0, u1 = ATLAS_U[key]
    uvd = ob.data.uv_layers.active.data
    umin, umax = 2.0, -1.0
    for poly in ob.data.polygons:
        if poly.material_index != frac_slot:
            continue
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            uv = uvd[li].uv
            uv.x = u0 + max(0.0, min(1.0, uv.x)) * (u1 - u0)
            uv.y = max(0.0, min(1.0, uv.y))
            umin = min(umin, uv.x); umax = max(umax, uv.x)
    check('%s_uv_inside_atlas_half' % key,
          umin >= u0 - 1e-4 and umax <= u1 + 1e-4,
          'U range %.4f..%.4f in half %.3f..%.3f' % (umin, umax, u0, u1))

    ob.data.calc_loop_triangles()
    STATS['geometry'][key] = {
        'tris_intact': tris_intact,
        'tris_cracked': len(ob.data.loop_triangles),
        'tris_added': len(ob.data.loop_triangles) - tris_intact,
        'fracture_faces': fracn, 'frac_slot': frac_slot,
        'slot_faces_after': slots_after,
    }
    STATS['fix'][key] = {'frac_slot': frac_slot, 'frac_faces': fracn,
                         'slot0_growth': growth}
    CRACKED[key] = (ob, frac_slot)

    io = sd['src'].copy(); io.data = sd['src'].data.copy()
    io.name = sd['root_intact']; io.data.name = sd['root_intact']
    for coll in sd['src'].users_collection:
        coll.objects.link(io)
    swap_top(io)
    INTACT[key] = io
    check('%s_same_world_scale' % key,
          tuple(round(v, 6) for v in io.matrix_world.to_scale()) ==
          tuple(round(v, 6) for v in ob.matrix_world.to_scale()),
          'intact %s cracked %s'
          % (tuple(round(v, 4) for v in io.matrix_world.to_scale()),
             tuple(round(v, 4) for v in ob.matrix_world.to_scale())))

# ───────────────────────────────────── pair-3 atlas bake ─────────────────────
log('bake pair-3 atlas (%dx%d, seg03 + seg06)' % (ATLAS_RES, ATLAS_RES))
scene.render.engine = 'CYCLES'
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    scene.cycles.device = 'GPU'
    log('render/bake: OPTIX GPU')
except Exception as exc:
    log('render/bake: CPU fallback (%s)' % exc)
scene.render.bake.margin = 6
scene.render.bake.use_clear = False
scene.render.bake.use_selected_to_active = False

DUMMY = bpy.data.images.new('seg36_bake_dummy', 8, 8, alpha=False)


def new_atlas_img(name, non_color):
    img = bpy.data.images.new(name, ATLAS_RES, ATLAS_RES, alpha=False,
                              float_buffer=False)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    img.filepath_raw = os.path.join(TEX_DIR, name + '.png')
    img.file_format = 'PNG'
    return img


def load_atlas_img(name, non_color):
    img = bpy.data.images.load(os.path.join(TEX_DIR, name + '.png'))
    img.name = name
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    img.filepath_raw = os.path.join(TEX_DIR, name + '.png')
    img.file_format = 'PNG'
    return img


IMG_BC = load_atlas_img('seg36_frac_basecolor', False)
IMG_R = load_atlas_img('seg36_frac_rough', True)
IMG_N = load_atlas_img('seg36_frac_normal', True)
IMG_OCC = load_atlas_img('seg36_frac_occ', True)

PAIR3 = [k for k, sd in SEG_DEFS.items() if sd['pair'] == 3]
BAKES = {}
for key in PAIR3:
    ob, frac_slot = CRACKED[key]
    bk = ob.copy(); bk.data = ob.data.copy(); bk.name = 'Bake_' + key
    scene.collection.objects.link(bk)
    BAKES[key] = (bk, frac_slot)


def bake_pass(bk, target_mat, img, btype, samples, **kw):
    refs = []
    for slot in bk.data.materials:
        if slot is None:
            continue
        nt = slot.node_tree
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img if slot is target_mat else DUMMY
        nt.nodes.active = tn
        refs.append((nt, tn))
    bpy.ops.object.select_all(action='DESELECT')
    bk.select_set(True)
    bpy.context.view_layer.objects.active = bk
    scene.cycles.samples = samples
    bpy.ops.object.bake(type=btype, **kw)
    for nt, tn in refs:
        nt.nodes.remove(tn)


for key in PAIR3:
    bk, frac_slot = BAKES[key]
    log('bake %s: basecolor (cavity floor %.2f)' % (key, BALANCED['gray']))
    bake_pass(bk, M_SRC, IMG_BC, 'DIFFUSE', 24, pass_filter={'COLOR'})
    log('bake %s: roughness' % key)
    bake_pass(bk, M_SRC, IMG_R, 'ROUGHNESS', 8)
    log('bake %s: normal (tangent)' % key)
    bake_pass(bk, M_SRC, IMG_N, 'NORMAL', 8)
    log('bake %s: occlusion (openness mask)' % key)
    bk.data.materials[frac_slot] = M_OCC
    bake_pass(bk, M_OCC, IMG_OCC, 'EMIT', 64)
    bk.data.materials[frac_slot] = M_SRC
for img in (IMG_BC, IMG_R, IMG_N, IMG_OCC):
    img.save()
for key in PAIR3:
    bk, _ = BAKES[key]
    me = bk.data; bpy.data.objects.remove(bk, do_unlink=True); bpy.data.meshes.remove(me)

log('post-bake: darken/roughen the seg06 half toward the marble')
u0_px = int(0.515 * ATLAS_RES)
for img, kind in ((IMG_BC, 'bc'), (IMG_R, 'r')):
    buf = np.empty(ATLAS_RES * ATLAS_RES * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(ATLAS_RES, ATLAS_RES, 4)
    if kind == 'bc':
        px[:, u0_px:, :3] *= 0.93          # moderate: close to the marble value
    else:
        px[:, u0_px:, :3] = np.clip(px[:, u0_px:, :3] * 1.12 + 0.05, 0, 1)
    img.pixels.foreach_set(px.reshape(-1))
    img.save()

log('compose pair-3 atlas ORM')
npx = ATLAS_RES * ATLAS_RES
occ = np.empty(npx * 4, dtype=np.float32); IMG_OCC.pixels.foreach_get(occ)
rgh = np.empty(npx * 4, dtype=np.float32); IMG_R.pixels.foreach_get(rgh)
orm = np.ones(npx * 4, dtype=np.float32)
orm[0::4] = occ[0::4]
orm[1::4] = rgh[1::4]
orm[2::4] = 0.0
IMG_ORM = bpy.data.images.new('seg36_frac_orm', ATLAS_RES, ATLAS_RES, alpha=False)
IMG_ORM.colorspace_settings.name = 'Non-Color'
IMG_ORM.pixels.foreach_set(orm)
IMG_ORM.filepath_raw = os.path.join(TEX_DIR, 'seg36_frac_orm.png')
IMG_ORM.file_format = 'PNG'; IMG_ORM.save()
STATS['atlas'] = {
    'resolution': ATLAS_RES, 'pair3_halves': ATLAS_U3,
    'maps': ['seg36_frac_basecolor.png', 'seg36_frac_orm.png',
             'seg36_frac_normal.png'],
    'note': 'identical recipe/structure as the approved pair-1/2 atlases',
}

# ── runtime crack materials (ONE per pair) ─────────────────────────────────
def build_runtime_mat(name, img_bc, img_orm, img_n):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    n_bc = nt.nodes.new('ShaderNodeTexImage'); n_bc.image = img_bc
    nt.links.new(n_bc.outputs['Color'], bsdf.inputs['Base Color'])
    n_orm = nt.nodes.new('ShaderNodeTexImage'); n_orm.image = img_orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(n_orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    n_nrm = nt.nodes.new('ShaderNodeTexImage'); n_nrm.image = img_n
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n_nrm.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    gset = bpy.data.node_groups.get('glTF Settings')
    if gset is None:
        gset = bpy.data.node_groups.new('glTF Settings', 'ShaderNodeTree')
        gset.interface.new_socket('Occlusion', in_out='INPUT',
                                  socket_type='NodeSocketFloat')
    grp = nt.nodes.new('ShaderNodeGroup'); grp.node_tree = gset
    n_occ2 = nt.nodes.new('ShaderNodeTexImage'); n_occ2.image = img_orm
    sep_o = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(n_occ2.outputs['Color'], sep_o.inputs['Color'])
    nt.links.new(sep_o.outputs['Red'], grp.inputs['Occlusion'])
    return m


M_RUN_P3 = build_runtime_mat('M_Fracture_Cracked_C', IMG_BC, IMG_ORM, IMG_N)
for key, sd in SEG_DEFS.items():
    ob, frac_slot = CRACKED[key]
    ob.data.materials[frac_slot] = M_RUN_P3

# ───────────────────────────────────── export cleanup GLB (10 roots) ───────
log('export seg06 simplified GLB (1 root: Segment06_Cracked_BALANCED)')
bpy.ops.object.select_all(action='DESELECT')
EXPORT_OBJS = [CRACKED[k][0] for k in SEG_DEFS]
for ob in EXPORT_OBJS:
    ob.select_set(True)
bpy.context.view_layer.objects.active = EXPORT_OBJS[0]
bpy.ops.export_scene.gltf(
    filepath=GLB_OUT, use_selection=True, export_format='GLB',
    export_yup=True, export_apply=True, export_image_format='AUTO')
STATS['glb']['bytes'] = os.path.getsize(GLB_OUT)
log('GLB exported: %.2f MB' % (STATS['glb']['bytes'] / 1e6))


def patch_glb_occlusion_strength(path, strength):
    with open(path, 'rb') as fh:
        data = fh.read()
    magic, ver, _ = struct.unpack_from('<III', data, 0)
    clen, ctype = struct.unpack_from('<II', data, 12)
    js = json.loads(data[20:20 + clen].decode('utf-8'))
    n = 0
    for m in js.get('materials', []):
        if 'occlusionTexture' in m:
            m['occlusionTexture']['strength'] = strength
            n += 1
    blob = json.dumps(js, separators=(',', ':')).encode('utf-8')
    blob += b' ' * ((4 - len(blob) % 4) % 4)
    rest = data[20 + clen:]
    out = (struct.pack('<III', magic, ver, 12 + 8 + len(blob) + len(rest)) +
           struct.pack('<II', len(blob), ctype) + blob + rest)
    with open(path, 'wb') as fh:
        fh.write(out)
    return n


n_patched = patch_glb_occlusion_strength(GLB_OUT, OCC_STRENGTH)
STATS['glb']['bytes_patched'] = os.path.getsize(GLB_OUT)
log('patched occlusionTexture.strength=%.2f into %d material(s)'
    % (OCC_STRENGTH, n_patched))

with open(GLB_OUT, 'rb') as fh:
    struct.unpack('<III', fh.read(12))
    clen, _ = struct.unpack('<II', fh.read(8))
    gltf = json.loads(fh.read(clen).decode('utf-8'))
occ_strengths = [m['occlusionTexture'].get('strength', 1.0)
                 for m in gltf.get('materials', []) if 'occlusionTexture' in m]
STATS['glb']['check'] = {
    'nodes': sorted(n.get('name', '?') for n in gltf.get('nodes', [])),
    'materials': sorted(m.get('name', '?') for m in gltf.get('materials', [])),
    'images': len(gltf.get('images', [])),
    'image_names': sorted(i.get('name', '?') for i in gltf.get('images', [])),
    'occlusion_strengths': occ_strengths,
}
ROOT_NAMES = ['Segment06_Cracked_BALANCED']
check('glb_one_root',
      all(r in STATS['glb']['check']['nodes'] for r in ROOT_NAMES) and
      len(STATS['glb']['check']['nodes']) == 1,
      str(STATS['glb']['check']['nodes']))
check('glb_one_fracture_material',
      sum(1 for m in STATS['glb']['check']['materials']
          if 'Fracture_Cracked' in m) == 1,
      str(STATS['glb']['check']['materials']))
check('glb_occlusion_strength_patched',
      len(occ_strengths) == 1 and
      all(abs(v - OCC_STRENGTH) < 1e-6 for v in occ_strengths),
      'strengths=%s' % occ_strengths)
check('glb_no_studio_content',
      not any(k in ' '.join(STATS['glb']['check']['nodes'])
              for k in ('Dust', 'Debris', 'Hoop', 'Preview', 'Studio', 'Cam',
                        'Light', 'Key', 'Fill')),
      str(STATS['glb']['check']['nodes']))
check('glb_twelve_images', STATS['glb']['check']['images'] == 12,
      'images=%d %s' % (STATS['glb']['check']['images'],
                        STATS['glb']['check']['image_names']))

# ── meta ──
META = {'glb': 'assets/ring_collapse/validation/seg36_gate/ring_collapse_seg36_gate.glb',
        'atlas_halves': ATLAS_U3,
        'note': 'seg06 micro-cleanup gate — raw corrected seg06 (pre-taper, pre-harmonization)'}
with open(os.path.join(ART_DIR, 'seg06_simplified_gate_meta.json'), 'w') as fh:
    json.dump(META, fh, indent=2)

# ───────────────────────────────────── finish ─────────────────────────────
STATS['assertions'] = ASSERTS
STATS['all_asserts_ok'] = all(a['ok'] for a in ASSERTS)
STATS['timings']['total_s'] = round(time.time() - T0, 1)
with open(os.path.join(ART_DIR, 'seg06_simplified_gate_stats.json'), 'w') as fh:
    json.dump(STATS, fh, indent=2)
log('DONE cleanup build (asserts_ok=%s)' % STATS['all_asserts_ok'])

# ── hard gate: a failed assertion must fail the process (no false green) ───
# Stats/reports above are always written first; the exit code is the
# machine-readable verdict for CI and chained build scripts.
_failed = [a['name'] for a in ASSERTS if not a['ok']]
if _failed:
    log('VALIDATION FAILED — %d assertion(s): %s'
        % (len(_failed), ', '.join(_failed)))
    raise SystemExit(1)
log('VALIDATION OK — all %d assertions passed' % len(ASSERTS))
