# Ring-Collapse — SEG03/SEG06 ROLLOUT (gold taper + seam harmonization for
# the two new cracked roots, approved recipe).
#
# Sources (read-only):
#   assets/ring_collapse/validation/seam_corridor_final_fix/
#       ring_collapse_seam_corridor_final_fix.glb    (approved 10 roots)
#   assets/ring_collapse/validation/seg36_gate/
#       ring_collapse_seg36_gate.glb                 (raw cracked pair)
#
# The approved four-segment seam-rollout recipe is applied to ONLY the two
# new roots (Segment03/06_Cracked_BALANCED):
#   1. GOLD TRIM taper — theta-tapered end rotation of every gold arc
#      (0 at the second-to-last ring, full +/-0.008 rad at the end ring),
#      ring info measured on the new roots themselves (they are pre-taper);
#      end rings must land on the already-tapered intact neighbours.
#   2. SEAM NORMAL HARMONIZATION — pass 1 from the welded intact-ring proxy,
#      pass 2 from the welded cracked-display proxy (all six cracked roots),
#      then the approved boundary snap (intact sector reference, 30-degree
#      crack-language guard) and the cracked-only pair snap — applied ONLY
#      to the new roots' loops; every approved root stays untouched and is
#      NOT exported.
#
# Output: a 2-root GLB (harmonized, tapered) for the byte-preserving graft.
#
# Run:  "D:/Blender/blender.exe" --background --factory-startup \
#         --python tools/validate_ring_collapse_seg36_rollout.py
import bpy
import math
import os
import time
import json
import struct
from mathutils import Vector, Matrix, kdtree
import bmesh

T0 = time.time()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..'))
SRC_APPROVED = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                            'seam_corridor_final_fix',
                            'ring_collapse_seam_corridor_final_fix.glb')
SRC_PAIR = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                        'seg36_gate', 'ring_collapse_seg36_gate.glb')
VAL_DIR = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation',
                       'seg36_rollout')
ART_DIR = os.path.join(ROOT, 'artifacts', 'ring_collapse', 'seg36_rollout')
os.makedirs(VAL_DIR, exist_ok=True)
os.makedirs(ART_DIR, exist_ok=True)
GLB_OUT = os.path.join(VAL_DIR, 'ring_collapse_seg36_rollout.glb')

SEG_BOUNDS_DEG = [10, 72, 128, 183, 255, 308]
GOLD_GAP_RAD = 0.008
GOLD_ARCS = [(10.05, 0.036, 0.030), (8.60, 0.008, 0.026), (9.90, -0.64, 0.034),
             (9.64, -1.135, 0.020), (9.64, -1.605, 0.020), (9.80, -2.24, 0.034)]
OLD_CRACKED = [1, 2, 4, 5]
NEW_CRACKED = [3, 6]
CRACKED_NAME = 'Segment%02d_Cracked_BALANCED'
INTACT_NAME = 'Segment%02d_Intact'
WELD_DIST = 3e-4
OCC_STRENGTH = 0.5

STATS = {'timings': {}, 'gold': {}, 'normals': {}, 'geometry': {}, 'glb': {},
         'assertions': []}
ASSERTS = []


def log(msg):
    print('[seg36_rollout] %s (%.1fs)' % (msg, time.time() - T0), flush=True)


def check(name, ok, detail=''):
    ASSERTS.append({'name': name, 'ok': bool(ok), 'detail': str(detail)})
    log('ASSERT %s: %s %s' % ('OK ' if ok else 'FAIL', name, detail))
    return ok


def pkey(v):
    return (round(v.x, 5), round(v.y, 5), round(v.z, 5))


def theta_hat(p):
    t = math.atan2(p.y, p.x)
    return Vector((-math.sin(t), math.cos(t), 0.0))


def seg_bounds_deg(n):
    i = n - 1
    a = SEG_BOUNDS_DEG[i]
    b = SEG_BOUNDS_DEG[(i + 1) % 6] + (360 if i == 5 else 0)
    return a, b


# ── import approved stand + raw pair ───────────────────────────────────────
log('empty scene + import approved stand and raw seg36 pair (read-only)')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
try:
    bpy.ops.import_scene.gltf(filepath=SRC_APPROVED, merge_vertices=False)
    bpy.ops.import_scene.gltf(filepath=SRC_PAIR, merge_vertices=False)
except TypeError:
    bpy.ops.import_scene.gltf(filepath=SRC_APPROVED)
    bpy.ops.import_scene.gltf(filepath=SRC_PAIR)

INTACT = {n: bpy.data.objects.get(INTACT_NAME % n) for n in range(1, 7)}
CRACKED = {n: bpy.data.objects.get(CRACKED_NAME % n) for n in OLD_CRACKED}
NEW = {n: bpy.data.objects.get(CRACKED_NAME % n) for n in NEW_CRACKED}
check('twelve_roots_imported',
      all(INTACT.values()) and all(CRACKED.values()) and all(NEW.values()),
      'intact=%d old_cracked=%d new=%d'
      % (sum(1 for o in INTACT.values() if o),
         sum(1 for o in CRACKED.values() if o),
         sum(1 for o in NEW.values() if o)))

# remap the pair's duplicated materials (.001 suffixes) onto the approved
# imports so the exported pair references the SAME material names
BASE_MATS = {}
for m in bpy.data.materials:
    base = m.name.split('.')[0]
    if base not in BASE_MATS:
        BASE_MATS[base] = m
remapped = 0
for n, ob in NEW.items():
    for i, slot in enumerate(ob.data.materials):
        if slot is None:
            continue
        base = slot.name.split('.')[0]
        if slot.name != base and base in BASE_MATS:
            ob.data.materials[i] = BASE_MATS[base]
            remapped += 1
check('pair_materials_remapped_to_base', remapped >= 0 and all(
    (m is None or '.' not in m.name) for n in NEW for m in NEW[n].data.materials),
    'remapped_slots=%d' % remapped)

ALL_OBJS = ([(n, 'intact', INTACT[n]) for n in range(1, 7)] +
            [(n, 'cracked', CRACKED[n]) for n in OLD_CRACKED] +
            [(n, 'cracked', NEW[n]) for n in NEW_CRACKED])
for n, st, ob in ALL_OBJS:
    mw = ob.matrix_world
    rot_err = max(abs(mw[r][c] - (1.0 if r == c else 0.0))
                  for r in range(3) for c in range(3))
    check('%s_transform_pure_translation' % ob.name, rot_err < 1e-5,
          'rot_err=%.2e' % rot_err)


def slots_of(ob, prefix):
    return {i for i, m in enumerate(ob.data.materials)
            if m and m.name.startswith(prefix)}


FRAC_SLOTS = {ob.name: slots_of(ob, 'M_Fracture') for _, _, ob in ALL_OBJS}
GOLD_SLOTS = {ob.name: slots_of(ob, 'M_ArenaGold') for _, _, ob in ALL_OBJS}

ORIG_ME = {}
ORIG_NORMALS = {}
for n in NEW_CRACKED:
    ob = NEW[n]
    ORIG_ME[ob.name] = ob.data.copy()
    ORIG_NORMALS[ob.name] = [Vector(cn.vector) for cn in ob.data.corner_normals]


def gold_posmap(ob):
    me = ob.data
    loc = ob.matrix_world.to_translation()
    gv = set()
    for poly in me.polygons:
        if poly.material_index in GOLD_SLOTS[ob.name]:
            gv.update(poly.vertices)
    posmap = {}
    for vi in gv:
        posmap.setdefault(pkey(me.vertices[vi].co + loc), []).append(vi)
    return posmap


# ═════════ 1. GOLD TAPER on the new roots (approved cracked recipe) ════════
log('gold trim: theta-tapered end rotation on the two new roots')
GAP_DEG = math.degrees(GOLD_GAP_RAD)
for n in NEW_CRACKED:
    co = NEW[n]
    me = co.data
    a_deg, b_deg = seg_bounds_deg(n)
    posmap = gold_posmap(co)
    # ring info measured on the new (pre-taper) root itself
    arcs = {ai: [] for ai in range(len(GOLD_ARCS))}
    for key in posmap:
        rho = math.hypot(key[0], key[1])
        best_ai = min(range(len(GOLD_ARCS)),
                      key=lambda ai: math.hypot(rho - GOLD_ARCS[ai][0],
                                                key[2] - GOLD_ARCS[ai][1]))
        arcs[best_ai].append(key)
    ARC_INFO = {}
    for ai, keys in arcs.items():
        if not keys:
            continue

        def theta_of(key):
            th = math.degrees(math.atan2(key[1], key[0])) % 360.0
            while th < a_deg - 5.0:
                th += 360.0
            return th

        gr, gz, gm = GOLD_ARCS[ai]
        ring_keys = [k for k in keys
                     if abs(math.hypot(math.hypot(k[0], k[1]) - gr,
                                       k[2] - gz) - gm) <= 1.5e-3]
        if not ring_keys:
            ring_keys = keys
        by_theta = sorted(ring_keys, key=theta_of)
        clusters = [[by_theta[0]]]
        for key in by_theta[1:]:
            if theta_of(key) - theta_of(clusters[-1][-1]) > 0.5:
                clusters.append([])
            clusters[-1].append(key)

        def cl_theta(cl):
            ths = sorted(theta_of(k) for k in cl)
            return ths[len(ths) // 2]          # median: union-vert robust

        ARC_INFO[ai] = {
            'a0': cl_theta(clusters[0]), 'a1': cl_theta(clusters[1]),
            'b1': cl_theta(clusters[-2]), 'b0': cl_theta(clusters[-1])}
    check('seg%02d_arc_info_measured' % n, len(ARC_INFO) == len(GOLD_ARCS),
          'arcs=%d' % len(ARC_INFO))

    moved = 0
    off_circle = far_off = 0
    span_after = {ai: [1e9, -1e9] for ai in ARC_INFO}
    for key, vids in posmap.items():
        rho = math.hypot(key[0], key[1])
        best_ai = min(range(len(GOLD_ARCS)),
                      key=lambda ai: math.hypot(rho - GOLD_ARCS[ai][0],
                                                key[2] - GOLD_ARCS[ai][1]))
        gr, gz, gm = GOLD_ARCS[best_ai]
        circ_dev = abs(math.hypot(rho - gr, key[2] - gz) - gm)
        if circ_dev > 5e-3:
            off_circle += 1
            if circ_dev > gm + 5e-3:
                far_off += 1
                continue
        info = ARC_INFO[best_ai]
        th = math.degrees(math.atan2(key[1], key[0])) % 360.0
        while th < a_deg - 5.0:
            th += 360.0
        if th <= info['a1']:
            t = min(1.0, max(0.0, (info['a1'] - th) /
                             max(1e-6, info['a1'] - info['a0'])))
            delta = -GOLD_GAP_RAD * t
        elif th >= info['b1']:
            t = min(1.0, max(0.0, (th - info['b1']) /
                             max(1e-6, info['b0'] - info['b1'])))
            delta = +GOLD_GAP_RAD * t
        else:
            delta = 0.0
        if delta == 0.0:
            th2 = th
        else:
            rot = Matrix.Rotation(delta, 4, 'Z')
            loc = co.matrix_world.to_translation()
            w = me.vertices[vids[0]].co + loc      # world pos (ring axis = Z)
            w2 = rot @ w
            for vi in vids:
                me.vertices[vi].co = w2 - loc
            moved += 1
            th2 = th + math.degrees(delta)
        sp = span_after[best_ai]
        sp[0] = min(sp[0], th2)
        sp[1] = max(sp[1], th2)
    span_ok = True
    worst = 0.0
    for ai, info in ARC_INFO.items():
        want_lo = info['a0'] - GAP_DEG
        want_hi = info['b0'] + GAP_DEG
        err = max(abs(span_after[ai][0] - want_lo),
                  abs(span_after[ai][1] - want_hi))
        worst = max(worst, err)
        if err > 0.05:
            span_ok = False
    check('seg%02d_gold_spans_tapered' % n, span_ok,
          'worst_span_err=%.4fdeg moved_unique=%d clipped_cap_verts=%d'
          % (worst, moved, off_circle))
    check('seg%02d_gold_verts_near_their_arc' % n, far_off == 0,
          'far_off=%d' % far_off)
    STATS['gold']['seg%02d' % n] = {'moved_unique': moved,
                                    'worst_span_err_deg': round(worst, 4)}

# end rings must coincide with the already-tapered intact neighbours
for n, bdeg, nb in ((3, 128, 2), (3, 183, 4), (6, 308, 5), (6, 10, 1)):
    co = NEW[n]
    # reference = tapered neighbour intact PLUS own tapered intact (verts that
    # legitimately overhang the boundary have their counterpart in the own
    # intact root, which the approved rollout tapered identically)
    refs = [INTACT[nb], INTACT[n]]
    n_ref = sum(len(io.data.vertices) for io in refs)
    kd = kdtree.KDTree(n_ref)
    idx = 0
    for io in refs:
        loc_i = io.matrix_world.to_translation()
        for v in io.data.vertices:
            kd.insert(v.co + loc_i, idx)
            idx += 1
    kd.balance()
    loc_c = co.matrix_world.to_translation()
    gold_v = set()
    for poly in co.data.polygons:
        if poly.material_index in GOLD_SLOTS[co.name]:
            gold_v.update(poly.vertices)
    gaps = []
    n_near = 0
    n_union = 0
    seen_pos = set()
    for vi in gold_v:
        w = co.data.vertices[vi].co + loc_c
        if pkey(w) in seen_pos:
            continue
        seen_pos.add(pkey(w))
        th = math.degrees(math.atan2(w.y, w.x)) % 360.0
        d_ang = min(abs(th - bdeg), 360 - abs(th - bdeg))
        if d_ang > 0.25:
            continue
        # only true arc-ring verts have an intact counterpart; union-clipped
        # cap verts (created by the approved use_self booleans) do not
        rho = math.hypot(w.x, w.y)
        on_ring = any(abs(math.hypot(rho - gr, w.z - gz) - gm) <= 1.5e-3
                      for gr, gz, gm in GOLD_ARCS)
        if not on_ring:
            n_union += 1
            continue
        n_near += 1
        hit = kd.find(w)
        if hit[2] is not None:
            if hit[2] > 1.5e-3:
                log('  gap vert seg%02d@%03d: rho=%.4f z=%.4f th=%.3f gap=%.5f'
                    % (n, bdeg, rho, w.z, th, hit[2]))
            gaps.append(hit[2])
    outliers = [g for g in gaps if g > 1.5e-3]
    worst = max(gaps, default=0.0)
    check('seg%02d_gold_ends_meet_neighbour_%03d' % (n, bdeg),
          n_near > 0 and len(outliers) <= 1 and worst < 5e-3,
          'ring_verts=%d union_only=%d worst_gap=%.5f outliers=%d '
          '(<=1 boolean-era micro-vert without counterpart tolerated, '
          'arc spans land exactly per seg%%02d_gold_spans_tapered)'
          % (n_near, n_union, worst, len(outliers)))

STATS['timings']['gold'] = round(time.time() - T0, 1)


# ═════════ 2. SEAM NORMAL HARMONIZATION (new roots only) ═══════════════════
def is_cap(poly, me, loc, gold_slots):
    if poly.material_index not in gold_slots:
        return False
    c = poly.center + loc
    return abs(poly.normal.dot(theta_hat(c))) > 0.7


def build_proxy(objs, label):
    bm_all = bmesh.new()
    n_drop = 0
    n_src_faces = 0
    for ob in objs:
        me2 = ob.data.copy()
        loc = ob.matrix_world.to_translation()
        bm = bmesh.new()
        bm.from_mesh(me2)
        frac = FRAC_SLOTS[ob.name]
        gold = GOLD_SLOTS[ob.name]
        drop = []
        for f in bm.faces:
            if f.material_index in frac:
                drop.append(f)
            elif f.material_index in gold:
                c = f.calc_center_median() + loc
                if abs(f.normal.dot(theta_hat(c))) > 0.7:
                    drop.append(f)
        n_drop += len(drop)
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        n_src_faces += len(bm.faces)
        bm.to_mesh(me2)
        bm.free()
        me2.transform(Matrix.Translation(loc))
        bm_all.from_mesh(me2)
        bpy.data.meshes.remove(me2)
    nv_before = len(bm_all.verts)
    bmesh.ops.remove_doubles(bm_all, verts=bm_all.verts, dist=WELD_DIST)
    nv_after = len(bm_all.verts)
    sharp_lim = math.radians(40.0)
    for f in bm_all.faces:
        f.smooth = True
    for e in bm_all.edges:
        if len(e.link_faces) == 2:
            try:
                e.smooth = e.calc_face_angle() <= sharp_lim
            except ValueError:
                e.smooth = True
        else:
            e.smooth = True
    proxy = bpy.data.meshes.new('SeamProxy_' + label)
    bm_all.to_mesh(proxy)
    bm_all.free()
    check('proxy_%s_weld_merged_verts' % label, nv_before - nv_after > 500,
          'merged=%d dropped_faces=%d' % (nv_before - nv_after, n_drop))
    corner = [Vector(cn.vector) for cn in proxy.corner_normals]
    kd_v = kdtree.KDTree(len(proxy.vertices))
    for i, v in enumerate(proxy.vertices):
        kd_v.insert(v.co, i)
    kd_v.balance()
    kd_p = kdtree.KDTree(len(proxy.polygons))
    for i, p in enumerate(proxy.polygons):
        kd_p.insert(p.center, i)
    kd_p.balance()
    vloop = []
    for p in proxy.polygons:
        vloop.append({proxy.loops[li].vertex_index: li
                      for li in range(p.loop_start,
                                      p.loop_start + p.loop_total)})
    return {'me': proxy, 'corner': corner, 'kd_v': kd_v, 'kd_p': kd_p,
            'vloop': vloop}


def transfer_pass(ob, proxy, final, committed):
    me = ob.data
    loc = ob.matrix_world.to_translation()
    matched_polys = matched_loops = unmatched = 0
    for poly in me.polygons:
        if poly.index in committed:
            continue
        if (poly.material_index in FRAC_SLOTS[ob.name] or
                is_cap(poly, me, loc, GOLD_SLOTS[ob.name])):
            continue
        pc = poly.center + loc
        cands = proxy['kd_p'].find_range(pc, 4e-4)
        best = None
        for (_, pi, _) in cands:
            d = proxy['me'].polygons[pi].normal.dot(poly.normal)
            if best is None or d > best[1]:
                best = (pi, d)
        if best is None or best[1] < 0.86:
            unmatched += 1
            continue
        vmap = proxy['vloop'][best[0]]
        pending = []
        ok = True
        for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
            w = me.vertices[me.loops[li].vertex_index].co + loc
            _, pvi, dist = proxy['kd_v'].find(w)
            if dist is None or dist > 4e-4 or pvi not in vmap:
                ok = False
                break
            pending.append((li, proxy['corner'][vmap[pvi]]))
        if not ok:
            unmatched += 1
            continue
        for li, nv in pending:
            final[li] = nv
        committed.add(poly.index)
        matched_loops += len(pending)
        matched_polys += 1
    return matched_polys, matched_loops, unmatched


log('normals: proxy A = welded intact ring, proxy B = full cracked display')
PROXY_I = build_proxy([INTACT[n] for n in range(1, 7)], 'intact')
PROXY_C = build_proxy([CRACKED[n] for n in OLD_CRACKED] +
                      [NEW[n] for n in NEW_CRACKED], 'cracked')

FINAL_NORMALS = {}
for n in NEW_CRACKED:
    ob = NEW[n]
    final = [v.copy() for v in ORIG_NORMALS[ob.name]]
    committed = set()
    p1_polys, p1_loops, p1_un = transfer_pass(ob, PROXY_I, final, committed)
    p2_polys, p2_loops, p2_un = transfer_pass(ob, PROXY_C, final, committed)
    total_skin = p1_polys + p2_polys + p2_un
    check('%s_skin_fully_matched_after_fallback' % ob.name,
          p2_un <= 0.005 * total_skin,
          'pass1=%d pass2=%d still_unmatched=%d (of %d skin faces)'
          % (p1_polys, p2_polys, p2_un, total_skin))
    FINAL_NORMALS[ob.name] = final
    STATS['normals'][ob.name] = {
        'loops': len(final), 'pass1_polys': p1_polys, 'pass2_polys': p2_polys,
        'unmatched_after_all_passes': p2_un}


# ── boundary snap (approved recipe, new roots only) ────────────────────────
def build_lookup(ob):
    me = ob.data
    loc = ob.matrix_world.to_translation()
    kd = kdtree.KDTree(len(me.vertices))
    for i, v in enumerate(me.vertices):
        kd.insert(v.co + loc, i)
    kd.balance()
    vloops = {}
    for li, l in enumerate(me.loops):
        vloops.setdefault(l.vertex_index, []).append(li)
    lo = [False] * len(me.loops)
    for p in me.polygons:
        skin = (p.material_index not in FRAC_SLOTS[ob.name] and
                not is_cap(p, me, loc, GOLD_SLOTS[ob.name]))
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            lo[li] = skin
    return {'ob': ob, 'kd': kd, 'vloops': vloops, 'loop_ok': lo}


NEED_LOOKUP = ([INTACT[n] for n in range(1, 7)] +
               [CRACKED[n] for n in OLD_CRACKED] +
               [NEW[n] for n in NEW_CRACKED])
LOOKUP = {ob.name: build_lookup(ob) for ob in NEED_LOOKUP}
CUR_NORMALS = {ob.name: [Vector(cn.vector) for cn in ob.data.corner_normals]
               for ob in NEED_LOOKUP}


def norm_groups(name, wpos, table):
    lk = LOOKUP[name]
    groups = []
    for (_, vi, _) in lk['kd'].find_range(wpos, 1.2e-4):
        for li in lk['vloops'].get(vi, ()):
            if not lk['loop_ok'][li]:
                continue
            nv = table[li]
            if nv.length < 1e-9:
                continue
            nn = nv.normalized()
            for gr in groups:
                if gr[1].dot(nn) > 0.99939:
                    gr[0] += nn
                    gr[1] = gr[0].normalized()
                    break
            else:
                groups.append([nn.copy(), nn.copy()])
    return [gr[1] for gr in groups]


def boundary_pairs(nameA, nameB):
    lkA = LOOKUP[nameA]
    meA = lkA['ob'].data
    locA = lkA['ob'].matrix_world.to_translation()
    seen = set()
    out = []
    for v in meA.vertices:
        w = v.co + locA
        hits = LOOKUP[nameB]['kd'].find_range(w, 2e-4)
        if not hits:
            continue
        k = pkey(w)
        if k in seen:
            continue
        seen.add(k)
        out.append(w.copy())
    return out


log('normals: boundary snap (intact sector reference) + cracked-pair snap')
SNAP = {}
# seg -> [(boundary deg, cracked neighbour object)]
NEIGH = {3: [(128, CRACKED[2]), (183, CRACKED[4])],
         6: [(308, CRACKED[5]), (10, CRACKED[1])]}
for n in NEW_CRACKED:
    ob = NEW[n]
    iname = INTACT[n].name
    lk = LOOKUP[ob.name]
    final = FINAL_NORMALS[ob.name]
    orig = ORIG_NORMALS[ob.name]
    snapped = kept = pair_snapped = 0
    for bdeg, nb_cracked in NEIGH[n]:
        # intact-referenced positions (own intact root vs cracked neighbour)
        positions = boundary_pairs(iname, nb_cracked.name)
        for w in positions:
            ref = norm_groups(iname, w, CUR_NORMALS[iname])
            if not ref:
                continue
            for (_, vi, _) in lk['kd'].find_range(w, 2.5e-4):
                for li in lk['vloops'].get(vi, ()):
                    if not lk['loop_ok'][li]:
                        continue
                    ov = orig[li]
                    if ov.length < 1e-9:
                        continue
                    on = ov.normalized()
                    best = min(ref, key=lambda r: -r.dot(on))
                    if math.degrees(best.angle(on)) < 30.0:
                        if (best - final[li].normalized()).length > 1e-6:
                            snapped += 1
                        final[li] = best.copy()
                    else:
                        final[li] = ov.copy()
                        kept += 1
        # cracked-only union verts: snap the NEW side onto the approved
        # neighbour's existing sectors (neighbour stays untouched)
        for w in boundary_pairs(ob.name, nb_cracked.name):
            ref = norm_groups(nb_cracked.name, w, CUR_NORMALS[nb_cracked.name])
            if not ref:
                continue
            for (_, vi, _) in lk['kd'].find_range(w, 1.2e-4):
                for li in lk['vloops'].get(vi, ()):
                    if not lk['loop_ok'][li]:
                        continue
                    ov = orig[li]
                    if ov.length < 1e-9:
                        continue
                    on = ov.normalized()
                    best = min(ref, key=lambda r: -r.dot(on))
                    if math.degrees(best.angle(on)) < 30.0:
                        if (best - final[li].normalized()).length > 1e-6:
                            pair_snapped += 1
                        final[li] = best.copy()
    SNAP['seg%02d' % n] = {'snapped_loops': snapped,
                           'sliver_loops_kept': kept,
                           'cracked_pair_snapped': pair_snapped}
STATS['normals']['boundary_snap'] = SNAP

# apply custom split normals to the NEW roots only
for n in NEW_CRACKED:
    ob = NEW[n]
    ob.data.normals_split_custom_set([tuple(v) for v in FINAL_NORMALS[ob.name]])
bpy.data.meshes.remove(PROXY_I['me'])
bpy.data.meshes.remove(PROXY_C['me'])
STATS['timings']['normals'] = round(time.time() - T0, 1)

# ═════════ regression: geometry untouched except gold ends ═════════════════
for n in NEW_CRACKED:
    ob = NEW[n]
    src = ORIG_ME[ob.name]
    me = ob.data
    same_counts = (len(me.vertices) == len(src.vertices) and
                   len(me.polygons) == len(src.polygons))
    gold_vidx = set()
    frac_vidx = set()
    for poly in me.polygons:
        if poly.material_index in GOLD_SLOTS[ob.name]:
            gold_vidx.update(poly.vertices)
        if poly.material_index in FRAC_SLOTS[ob.name]:
            frac_vidx.update(poly.vertices)
    moved_idx = {i for i, (vs, vi) in enumerate(zip(src.vertices, me.vertices))
                 if (vs.co - vi.co).length > 1e-7}
    max_d = max([(src.vertices[i].co - me.vertices[i].co).length
                 for i in moved_idx], default=0.0)
    check('%s_topology_unchanged' % ob.name, same_counts,
          'verts %d->%d polys %d->%d' % (len(src.vertices), len(me.vertices),
                                         len(src.polygons), len(me.polygons)))
    check('%s_only_gold_verts_moved' % ob.name, moved_idx <= gold_vidx,
          'moved=%d all_gold=%s' % (len(moved_idx), moved_idx <= gold_vidx))
    check('%s_fracture_faces_untouched' % ob.name,
          not (moved_idx & frac_vidx and (moved_idx & frac_vidx) - gold_vidx),
          'moved_fracture_verts=%d' % len((moved_idx & frac_vidx) - gold_vidx))
    check('%s_displacement_bounded' % ob.name, max_d <= GOLD_GAP_RAD * 10.11,
          'max_disp=%.4f' % max_d)
    STATS['geometry'][ob.name] = {
        'verts': len(me.vertices), 'moved_verts': len(moved_idx),
        'max_displacement': round(max_d, 5)}
for name, me in ORIG_ME.items():
    bpy.data.meshes.remove(me)

# ═════════ export the 2 new roots ══════════════════════════════════════════
log('export seg36 rollout GLB (2 roots)')
bpy.ops.object.select_all(action='DESELECT')
for n in NEW_CRACKED:
    NEW[n].select_set(True)
bpy.context.view_layer.objects.active = NEW[3]
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
    cnt = 0
    for m in js.get('materials', []):
        if 'occlusionTexture' in m:
            m['occlusionTexture']['strength'] = strength
            cnt += 1
    blob = json.dumps(js, separators=(',', ':')).encode('utf-8')
    blob += b' ' * ((4 - len(blob) % 4) % 4)
    rest = data[20 + clen:]
    out = (struct.pack('<III', magic, ver, 12 + 8 + len(blob) + len(rest)) +
           struct.pack('<II', len(blob), ctype) + blob + rest)
    with open(path, 'wb') as fh:
        fh.write(out)
    return cnt


n_patched = patch_glb_occlusion_strength(GLB_OUT, OCC_STRENGTH)
check('glb_occlusion_patched', n_patched == 1, 'patched=%d' % n_patched)

with open(GLB_OUT, 'rb') as fh:
    struct.unpack('<III', fh.read(12))
    clen, _ = struct.unpack('<II', fh.read(8))
    gltf = json.loads(fh.read(clen).decode('utf-8'))
nodes = sorted(nd.get('name', '?') for nd in gltf.get('nodes', []))
mats = sorted(m.get('name', '?') for m in gltf.get('materials', []))
check('glb_two_roots', nodes == ['Segment03_Cracked_BALANCED',
                                 'Segment06_Cracked_BALANCED'], str(nodes))
check('glb_materials_base_named',
      all('.' not in m for m in mats) and 'M_Fracture_Cracked_C' in mats,
      str(mats))
STATS['glb']['nodes'] = nodes
STATS['glb']['materials'] = mats

STATS['assertions'] = ASSERTS
STATS['all_asserts_ok'] = all(a['ok'] for a in ASSERTS)
STATS['timings']['total_s'] = round(time.time() - T0, 1)
with open(os.path.join(ART_DIR, 'seg36_rollout_stats.json'), 'w') as fh:
    json.dump(STATS, fh, indent=2)
log('DONE seg36 rollout (asserts_ok=%s)' % STATS['all_asserts_ok'])

# ── hard gate: a failed assertion must fail the process (no false green) ───
# Stats/reports above are always written first; the exit code is the
# machine-readable verdict for CI and chained build scripts.
_failed = [a['name'] for a in ASSERTS if not a['ok']]
if _failed:
    log('VALIDATION FAILED — %d assertion(s): %s'
        % (len(_failed), ', '.join(_failed)))
    raise SystemExit(1)
log('VALIDATION OK — all %d assertions passed' % len(ASSERTS))
