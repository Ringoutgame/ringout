# Six-segment rollout — validation battery.
#
# Validates the byte-preserving graft + field pass that adds
# Segment03/06_Cracked_BALANCED to the approved seam-corridor-final-fix
# stand:
#   BEFORE = approved 10-root GLB   (must be a verbatim prefix)
#   AFTER  = 12-root six-segment rollout GLB
#
# Default profile = the APPROVED PNG stand (2026-07-26):
#   AFTER  = ring_collapse_six_segment_simplified.glb  (committed, all-PNG)
#   PAIR06 = ring_collapse_seg06_simplified_rollout.glb (canonical output of
#            tools/validate_ring_collapse_seg06_simplified_rollout.py)
# The KTX2 variant does not exist yet for this stand (separate follow-up
# task) — the KTX2 consistency check is therefore OFF by default and can be
# enabled explicitly with CHECK_KTX2=1 (optionally KTX_GLB=<path>).
#
# Run (approved PNG profile, no env vars needed):
#   "D:/Blender/blender.exe" --background --factory-startup \
#         --python tools/validate_ring_collapse_six_segment_rollout.py
import json
import math
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAL = os.path.join(ROOT, 'assets', 'ring_collapse', 'validation')
ART = os.path.join(ROOT, 'artifacts', 'ring_collapse', 'six_segment_rollout')
GLB_BEFORE = os.path.join(VAL, 'seam_corridor_final_fix', 'ring_collapse_seam_corridor_final_fix.glb')
GLB_PAIR = os.path.join(VAL, 'seg36_rollout', 'ring_collapse_seg36_rollout.glb')
GLB_PAIR06 = os.environ.get('PAIR06_GLB') or os.path.join(
    VAL, 'seg36_rollout', 'ring_collapse_seg06_simplified_rollout.glb')
GLB_AFTER = os.environ.get('SIX_GLB') or os.path.join(
    VAL, 'six_segment_rollout', 'ring_collapse_six_segment_simplified.glb')
CHECK_KTX2 = os.environ.get('CHECK_KTX2') == '1'
GLB_AFTER_KTX = os.environ.get('KTX_GLB') or os.path.join(
    VAL, 'six_segment_rollout', 'ring_collapse_six_segment_rollout_all_ktx2.glb')

# The two pair GLBs are regenerated build artifacts (intentionally not
# committed). Fail early with the exact build steps instead of a raw
# FileNotFoundError deep inside the run.
_MISSING = [p for p in (GLB_PAIR, GLB_PAIR06) if not os.path.isfile(p)]
if _MISSING:
    print('MISSING generated build input(s):')
    for p in _MISSING:
        print('  - ' + p)
    print('Run the build chain first (see assets/ring_collapse/README.md):')
    print('  1. blender --background --factory-startup --python tools/validate_ring_collapse_seg36_gate.py')
    print('  2. blender --background --factory-startup --python tools/validate_ring_collapse_seg36_rollout.py')
    print('  3. blender --background --factory-startup --python tools/validate_ring_collapse_seg06_simplified_gate.py')
    print('  4. blender --background --factory-startup --python tools/validate_ring_collapse_seg06_simplified_rollout.py')
    raise SystemExit(2)

NEW_ROOTS = ['Segment03_Cracked_BALANCED', 'Segment06_Cracked_BALANCED']
INTACT = ['Segment01_Intact', 'Segment02_Intact', 'Segment03_Intact',
          'Segment04_Intact', 'Segment05_Intact', 'Segment06_Intact']
TOP_MAT = 'M_ArenaTop_Val'
results = []


def check(name, ok, detail):
    results.append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ' :: ' + detail)


def load_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    jlen = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jlen].decode('utf8'))
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    return j, data[20 + jlen + 8:20 + jlen + 8 + blen]


def acc_floats(j, b, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    ofs = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    return struct.unpack_from('<%df' % n, b, ofs)


def acc_bytes(j, b, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    ofs = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = {5123: 2, 5125: 4, 5126: 4}[a['componentType']]
    n = a['count'] * {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    return b[ofs:ofs + n * size]


def acc_indices(j, b, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    ofs = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return struct.unpack_from('<%d%s' % (a['count'], {5123: 'H', 5125: 'I'}[a['componentType']]), b, ofs)


def node_of(j, name):
    return next(n for n in j['nodes'] if n['name'] == name)


def prims_of(j, name):
    return j['meshes'][node_of(j, name)['mesh']]['primitives']


def mat_name(j, prim):
    return j['materials'][prim['material']]['name']


print('=== Part 1: GLB-level assertions ===')
jb, bb = load_glb(GLB_BEFORE)
jp, bp = load_glb(GLB_PAIR)
PAIR_FOR = {r: (jp, bp) for r in NEW_ROOTS}
PAIR_FOR['Segment06_Cracked_BALANCED'] = load_glb(GLB_PAIR06)
ja, ba = load_glb(GLB_AFTER)

# 1. approved stand is a verbatim prefix (bin + every JSON array)
check('approved_bin_is_prefix', ba[:len(bb)] == bb,
      'approved bin %d bytes verbatim at offset 0 of the new bin' % len(bb))
pref_ok = True
for key in ('bufferViews', 'accessors', 'materials', 'textures', 'images',
            'meshes', 'nodes'):
    if json.dumps(ja[key][:len(jb[key])], sort_keys=True) != \
            json.dumps(jb[key], sort_keys=True):
        pref_ok = False
check('approved_json_arrays_are_prefixes', pref_ok,
      'all approved bufferViews/accessors/materials/textures/images/meshes/'
      'nodes verbatim -> the 10 approved roots are byte-identical')

# 2. twelve roots, new roots share their intact twin's translation
names = sorted(n['name'] for n in ja['nodes'])
check('twelve_roots', len(names) == 12 and all(r in names for r in NEW_ROOTS),
      str(names))
tr_ok = True
for r in NEW_ROOTS:
    tw = 'Segment%s_Intact' % r[7:9]
    if node_of(ja, r).get('translation') != node_of(ja, tw).get('translation'):
        tr_ok = False
check('new_roots_translation_matches_intact', tr_ok,
      'Segment03/06 cracked translations equal their intact twins')

# 3. exactly one new material + three new images
new_mats = [m['name'] for m in ja['materials'][len(jb['materials']):]]
occs = [(m['name'], m['occlusionTexture']['strength'])
        for m in ja['materials'] if 'occlusionTexture' in m]
check('one_new_material_occ05',
      new_mats == ['M_Fracture_Cracked_C'] and len(occs) == 3 and
      all(s == 0.5 for _, s in occs),
      'new=%s occ=%s' % (new_mats, occs))
new_imgs = [im['name'] for im in ja['images'][len(jb['images']):]]
check('three_new_atlas_images', sorted(new_imgs) ==
      ['seg36_frac_basecolor', 'seg36_frac_normal', 'seg36_frac_orm'],
      str(sorted(new_imgs)))

# 4. fracture normals of the new roots byte-equal to the harmonized pair GLB
frac_ok = True
for r in NEW_ROOTS:
    for prim in prims_of(ja, r):
        if not mat_name(ja, prim).startswith('M_Fracture'):
            continue
        jr, br = PAIR_FOR[r]
        pj = next(p for p in prims_of(jr, r)
                  if mat_name(jr, p) == mat_name(ja, prim))
        if acc_bytes(ja, ba, prim['attributes']['NORMAL']) != \
                acc_bytes(jr, br, pj['attributes']['NORMAL']):
            frac_ok = False
check('new_fracture_normals_match_harmonized_pair', frac_ok,
      'fracture prim normals byte-equal to the seg36 rollout output '
      '(field pass touched only pure-horizontal top loops)')

# 5. weld metrics per new root
def weld_metrics(j2, b2, root):
    edge_faces = {}
    weld = {}
    wpos = []
    for prim in prims_of(j2, root):
        pos = acc_floats(j2, b2, prim['attributes']['POSITION'])
        idx = acc_indices(j2, b2, prim['indices'])
        local = []
        for i in range(len(pos) // 3):
            key = (round(pos[i*3]*1e5), round(pos[i*3+1]*1e5), round(pos[i*3+2]*1e5))
            w = weld.setdefault(key, len(wpos))
            if w == len(wpos):
                wpos.append(key)
            local.append(w)
        for t in range(0, len(idx), 3):
            tri = [local[idx[t]], local[idx[t+1]], local[idx[t+2]]]
            for k in range(3):
                va, vb2 = tri[k], tri[(k+1) % 3]
                if va == vb2:
                    continue
                e = (va, vb2) if va < vb2 else (vb2, va)
                edge_faces[e] = edge_faces.get(e, 0) + 1
    parent = list(range(len(wpos)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for (a2, b3) in edge_faces:
        ra, rb2 = find(a2), find(b3)
        if ra != rb2:
            parent[ra] = rb2
    islands = len({find(i) for i in range(len(wpos))})
    open_e = sum(1 for c in edge_faces.values() if c == 1)
    nonman = sum(1 for c in edge_faces.values() if c > 2)
    return open_e, nonman, islands


WM = {}
for r in NEW_ROOTS:
    WM[r] = weld_metrics(ja, ba, r)
check('new_roots_single_island',
      all(WM[r][2] == 1 for r in NEW_ROOTS),
      'islands: %s' % {r: WM[r][2] for r in NEW_ROOTS})
check('new_roots_open_edges_documented',
      WM[NEW_ROOTS[0]][0] <= 130 and WM[NEW_ROOTS[1]][0] <= 150,
      'weld-metric open edges seg03=%d seg06=%d (same class as the approved '
      'cracked roots: 107-109 incl. approved gold-lip separations; '
      'corrected seg06 bar 150: stepped spalls+seam breaks add canal slits)'
      % (WM[NEW_ROOTS[0]][0], WM[NEW_ROOTS[1]][0]))

# 6. field formula on the new roots' pure-horizontal plateau verts
SEG_BOUNDS_DEG = [10, 72, 128, 183, 255, 308]


def classify(j2, b2, root):
    prim = next(p for p in prims_of(j2, root) if mat_name(j2, p) == TOP_MAT)
    P = acc_floats(j2, b2, prim['attributes']['POSITION'])
    I = acc_indices(j2, b2, prim['indices'])
    nv = len(P) // 3
    y_max = max(P[i] for i in range(1, len(P), 3))
    horiz = [False] * nv
    dam = [False] * nv
    for f in range(0, len(I), 3):
        tri = I[f:f+3]
        pa, pb2, pc = (P[v*3:v*3+3] for v in tri)
        u = [pb2[k]-pa[k] for k in range(3)]
        w = [pc[k]-pa[k] for k in range(3)]
        cr = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]
        ln = math.sqrt(sum(c*c for c in cr))
        if ln < 2e-12:
            continue
        plateau = cr[1]/ln > 0.9 and (pa[1]+pb2[1]+pc[1])/3 > y_max - 0.02
        for v in tri:
            (horiz if plateau else dam)[v] = True
    return prim, P, horiz, dam


knots = {}
for seg_i in INTACT:
    nd = node_of(ja, seg_i)
    t = nd['translation']
    prim, P, horiz, dam = classify(ja, ba, seg_i)
    N = acc_floats(ja, ba, prim['attributes']['NORMAL'])
    for i in range(len(P)//3):
        if not horiz[i]:
            continue
        wx, wz = P[i*3]+t[0], P[i*3+2]+t[2]
        r = math.hypot(wx, wz)
        knots.setdefault('%.3f' % r, []).append(
            math.atan2(N[i*3]*wx/r + N[i*3+2]*wz/r, N[i*3+1]))
profile = sorted((float(k), sum(v)/len(v)) for k, v in knots.items()
                 if len(v) >= 50)


def field_tilt(r):
    if r <= profile[0][0]:
        return profile[0][1]
    for i in range(1, len(profile)):
        if r <= profile[i][0]:
            t = (r - profile[i-1][0]) / (profile[i][0] - profile[i-1][0])
            return profile[i-1][1] * (1-t) + profile[i][1] * t
    return profile[-1][1]


field_ok = True
unit_ok = True
max_err = 0.0
counts = {}
for r in NEW_ROOTS:
    nd = node_of(ja, r)
    t = nd['translation']
    prim, P, horiz, dam = classify(ja, ba, r)
    N = acc_floats(ja, ba, prim['attributes']['NORMAL'])
    n_field = 0
    for i in range(len(P)//3):
        if not horiz[i] or dam[i]:
            continue
        n_field += 1
        wx, wz = P[i*3]+t[0], P[i*3+2]+t[2]
        rr = math.hypot(wx, wz)
        a_t = field_tilt(rr)
        tgt = [wx/rr*math.sin(a_t), math.cos(a_t), wz/rr*math.sin(a_t)]
        tl = math.sqrt(sum(c*c for c in tgt))
        na = N[i*3:i*3+3]
        ln = math.sqrt(sum(c*c for c in na))
        if not all(math.isfinite(c) for c in na) or abs(ln-1) > 1e-3:
            unit_ok = False
        err = math.degrees(math.acos(max(-1.0, min(1.0,
            sum(na[k]/ln*tgt[k]/tl for k in range(3))))))
        max_err = max(max_err, err)
        if err > 0.05:
            field_ok = False
    counts[r] = n_field
check('new_plateau_normals_exact_field', field_ok and unit_ok,
      'pure-horizontal plateau verts on exact intact radial field: '
      '%s · max deviation %.4f deg' % (counts, max_err))

# 7. KTX2 variant consistency — OFF by default: the approved PNG stand has
# no KTX2 variant yet (separate follow-up task). Enable with CHECK_KTX2=1
# once that task produced the KTX2 GLB (override its path via KTX_GLB).
if not CHECK_KTX2:
    print('SKIP ktx2_variant_consistent :: approved PNG profile — enable with CHECK_KTX2=1 after the KTX2 follow-up task')
if CHECK_KTX2:
    jk, bk = load_glb(GLB_AFTER_KTX)
if CHECK_KTX2:
    ktx_imgs = [im for im in jk['images'] if im.get('mimeType') == 'image/ktx2']
    png_imgs = [im['name'] for im in jk['images'] if im.get('mimeType') == 'image/png']
    knorm_ok = all(
        acc_bytes(jk, bk, next(p for p in prims_of(jk, r) if mat_name(jk, p) == TOP_MAT)['attributes']['NORMAL']) ==
        acc_bytes(ja, ba, next(p for p in prims_of(ja, r) if mat_name(ja, p) == TOP_MAT)['attributes']['NORMAL'])
        for r in NEW_ROOTS)
    check('ktx2_variant_consistent',
          len(ktx_imgs) == 15 and len(jk['nodes']) == 12 and knorm_ok and
          sorted(png_imgs) == ['seg36_frac_basecolor', 'seg36_frac_normal', 'seg36_frac_orm'],
          '15 ktx2 + 3 png (pair-3 atlas, documented), 12 roots, normals byte-equal')

# ---------- Part 2: bpy import cross-check ----------
print('=== Part 2: bpy import cross-check ===')
import bpy  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB_AFTER)
objs = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
check('bpy_import_12_roots', len(objs) == 12,
      '%d mesh objects' % len(objs))
tr_ok = cnt_ok = val_ok = True
for name in [n['name'] for n in ja['nodes']]:
    ob = objs.get(name)
    if ob is None:
        tr_ok = cnt_ok = val_ok = False
        continue
    gt = node_of(ja, name).get('translation', [0, 0, 0])
    exp = (gt[0], -gt[2], gt[1])
    if not all(abs(ob.location[i] - exp[i]) < 1e-6 for i in range(3)):
        tr_ok = False
    exp_v = sum(ja['accessors'][p['attributes']['POSITION']]['count'] for p in prims_of(ja, name))
    if len(ob.data.vertices) != exp_v:
        cnt_ok = False
    if ob.data.validate(verbose=False):
        val_ok = False
check('bpy_transforms_ok', tr_ok, 'all 12 translations correct')
check('bpy_counts_match_glb', cnt_ok, 'vertex counts match GLB')
check('bpy_mesh_validate_clean', val_ok, 'mesh.validate() clean on all roots')

n_ok = sum(1 for r in results if r['ok'])
print('\n=== %d/%d assertions green ===' % (n_ok, len(results)))
with open(os.path.join(ART, 'six_validation_stats.json'), 'w') as f:
    json.dump({'assertions': results,
               'weld_metrics': {r: {'open': WM[r][0], 'nonmanifold': WM[r][1],
                                    'islands': WM[r][2]} for r in NEW_ROOTS}},
              f, indent=1)
print('wrote six_validation_stats.json')
if n_ok != len(results):
    sys.exit(1)
