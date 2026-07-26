# RingOut ring-collapse prototype — deterministic Blender asset build.
#
# Builds the full collapse sequence as a self-contained visual asset:
#   Arena_Core           — remaining smaller arena (static, gameplay radius x 0.82)
#   Collapse_Ring        — outer annulus split into 6 controlled segments
#   Collapse_Segment_NN  — solid marble slabs (top plate + drum wall + fracture faces)
#   Debris_Small_NN      — small visual-only companion chunks
#   Animation clip       — 'Collapse_Active' (300 frames @ 30 fps, baked keyframes)
#
# Phases (frames): A intact 1-36 · B fine cracks 36-102 · C heavy cracks 102-168
#                  D release 168-228 · E fall 168-282 · F final 282-300
#
# Run headless (Blender 4.4):
#   "D:\Blender\blender.exe" --background --factory-startup --python tools/build_ring_collapse_blender.py -- --stage build
#   stages: build (blend+glb+stats) | stills | video | all      extra: --quick (low-res test renders)
#
# WARNING — every stage WRITES build outputs. There is currently no
# render-only stage: 'stills' and 'video' rebuild the scene first and
# therefore also save/overwrite the blend, the exported GLB and the stats
# just like 'build' does. Do not run any stage if the on-disk build outputs
# must stay untouched (separating render-only stages from mutating build
# stages is a tracked follow-up task in TODO.md).
#
# Dimensional contract copied from tools/build_arena_v2_blender.py (edge truth of the 3D adapter):
#   play floor top z=0, r<=8.55 · outer band top z=+0.045, r 8.78..10.1 · visible edge r=10.1
#   COLLAPSE_RADIUS_FACTOR=0.82 (index.html) -> new visible edge r = 8.282
# Coordinate system: Blender Z-up; glTF exporter converts to +Y-up.

import bpy, bmesh, math, os, sys, json, struct, time
import numpy as np
from mathutils import Vector, Quaternion

# ── args / paths ─────────────────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGE = argv[argv.index('--stage') + 1] if '--stage' in argv else 'build'
QUICK = '--quick' in argv
FSTEP = int(argv[argv.index('--fstep') + 1]) if '--fstep' in argv else 1

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'assets', 'ring_collapse', 'source')
TEX_DIR = os.path.join(SRC_DIR, 'textures')
EXP_DIR = os.path.join(ROOT, 'assets', 'ring_collapse', 'export')
EXP_TEX = os.path.join(EXP_DIR, 'textures')
ART_DIR = os.path.join(ROOT, 'artifacts', 'ring_collapse')
for d in (SRC_DIR, TEX_DIR, EXP_DIR, EXP_TEX, ART_DIR):
    os.makedirs(d, exist_ok=True)
# same HDRI family as the in-game default environment profile ('dawn' uses
# qwantani_sunset_puresky_2k.hdr as both lighting and visible background)
HDRI_PATH = os.path.join(ROOT, 'assets', 'hdri', 'qwantani_sunset_puresky_2k.hdr')
HDRI_ROT_DEG = 225.0    # warm glow band sits top-left behind the arena (probe-picked)

T0 = time.time()
def log(msg):
    print('[ring_collapse %6.1fs] %s' % (time.time() - T0, msg), flush=True)

# ── gameplay-derived dimensions ──────────────────────────────────────────
R_OUT = 10.1                      # visible outer edge (gameplay R maps here)
COLLAPSE_FACTOR = 0.82            # COLLAPSE_RADIUS_FACTOR in index.html
R_BREAK = R_OUT * COLLAPSE_FACTOR # 8.282 — new visible edge after collapse
INLAY_RADII = (2.86, 4.70, 6.55)  # gold inlay grooves (all survive on the core)
GROOVE_D = 0.024
Z_SLAB_BOT = -2.66                # slab underside = cove end of the arena drum
FPS = 30
F_END = 300
# phase keys
F_B0, F_B1 = 36, 66               # crack stage 1 ramp
F_C0, F_C1 = 102, 138             # crack stage 2 ramp
SEG_BOUNDS_DEG = [10, 72, 128, 183, 255, 308]   # 6 segments, varied widths
SEG_RELEASE = [168, 178, 187, 197, 208, 218]    # release frames (assigned shuffled)

rng = np.random.default_rng(7)

# ── deterministic smooth field helpers (2*pi-periodic in theta) ──────────
def _harm(seed_rng, ks, amps):
    ph = seed_rng.uniform(0, 2 * math.pi, len(ks))
    ks = list(ks); amps = list(amps)
    def f(t):
        return sum(a * math.sin(k * t + p) for k, a, p in zip(ks, amps, ph))
    return f

_edge_f = _harm(rng, (3, 5, 8, 13), (0.010, 0.0065, 0.0045, 0.0028))
def r_edge(theta):
    """Irregular new-edge radius (2*pi-periodic). Also drives the stage-2 ring crack."""
    return R_BREAK * (1.0 + _edge_f(theta))

_rockA = _harm(rng, (17, 29, 47), (0.050, 0.028, 0.016))
_rockB = _harm(rng, (2.1, 5.3, 9.7), (1.0, 0.55, 0.3))
_rockC = _harm(rng, (61, 103), (0.020, 0.012))   # high-freq chunking for facets
def rock(theta, z):
    """Fracture-face radial noise, periodic in theta, varying with depth."""
    return (_rockA(theta + 0.35 * _rockB(z)) * (0.75 + 0.25 * math.sin(3.1 * z + 1.3))
            + _rockC(theta + 0.9 * z))

def r_inner(theta, z):
    """Slab inner fracture face; the core rim uses the same field minus a 0.02 inset.
    Slight inward taper with depth keeps the remaining core silhouette deliberate."""
    return r_edge(theta) + rock(theta, z) + 0.045 * z

JAG = []  # one jag function per segment boundary (shared by both neighbours)
for _ in SEG_BOUNDS_DEG:
    JAG.append(_harm(rng, (2.6, 6.1, 11.0), (0.011, 0.007, 0.004)))
def jag(bi, r, z):
    return JAG[bi](z - 0.30 * r)

# shoulder curve of the arena underbase (arena_v2 body profile) — slabs break off
# along it, so their undersides follow this surface down to the fracture face
def _sh_pt(t):
    return ((1 - t) ** 2 * 9.00 + 2 * (1 - t) * t * 8.35 + t ** 2 * 6.95,
            (1 - t) ** 2 * -2.66 + 2 * (1 - t) * t * -3.16 + t ** 2 * -3.72)
_SH = [_sh_pt(k / 24) for k in range(25)]
def shoulder_r(z):
    for k in range(1, len(_SH)):
        if _SH[k][1] <= z:
            (r0, z0), (r1, z1) = _SH[k - 1], _SH[k]
            t = (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return _SH[-1][0]

def z_bot(theta):
    """Depth where the inner fracture face meets the shoulder surface."""
    lo, hi = -2.68, -3.60      # f(lo) > 0, f(hi) < 0
    for _ in range(20):
        mid = (lo + hi) * 0.5
        if shoulder_r(mid) - r_inner(theta, mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) * 0.5

# chipped-bite mask along the final rim: broad noise gate + discrete notches.
# Applied to the core fracture band (hidden while the ring is intact), so the
# post-collapse arris silhouette reads bitten instead of mathematically round.
_chip_g = _harm(np.random.default_rng(83), (7, 13, 23), (1.0, 0.8, 0.6))
_CHIP_ANGS = np.random.default_rng(84).uniform(0, 2 * math.pi, 10)
def chip(theta):
    c = max(0.0, _chip_g(theta) - 0.9) * 0.8
    for a in _CHIP_ANGS:
        d = (theta - a + math.pi) % (2 * math.pi) - math.pi
        c += math.exp(-(d / 0.05) ** 2)
    return min(1.0, c)

# ── clean scene ──────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, F_END
coll_main = bpy.data.collections.new('RingCollapse')
coll_prev = bpy.data.collections.new('PreviewOnly')
coll_studio = bpy.data.collections.new('Studio')
for c in (coll_main, coll_prev, coll_studio):
    scene.collection.children.link(c)

# ═════════════════════════ TEXTURES (numpy, seeded) ══════════════════════
log('textures: generating')

def vnoise(size, period, r):
    g = r.random((period, period))
    idx = np.arange(size) * period / size
    i0 = np.floor(idx).astype(int) % period
    i1 = (i0 + 1) % period
    f = idx - np.floor(idx)
    f = f * f * f * (f * (f * 6 - 15) + 10)
    A = g[np.ix_(i0, i0)]; B = g[np.ix_(i0, i1)]
    C = g[np.ix_(i1, i0)]; D = g[np.ix_(i1, i1)]
    fx = f[None, :]; fy = f[:, None]
    return A * (1 - fx) * (1 - fy) + B * fx * (1 - fy) + C * (1 - fx) * fy + D * fx * fy

def fbm(size, periods, weights, r):
    out = np.zeros((size, size))
    for p, w in zip(periods, weights):
        out += vnoise(size, p, r) * w
    return out / sum(weights)

def marble_maps(size, r, vein_strength, gold_strength):
    """Calacatta-style marble (arena_v2 recipe family, reworked for a clear
    vein hierarchy: few bold directional primaries + calm secondaries instead
    of uniform micro-squiggle)."""
    X, Y = np.meshgrid(np.arange(size), np.arange(size), indexing='xy')
    def dir_veins(dir_ab, bands, amp, sharp, gate_lo):
        u = (dir_ab[0] * X + dir_ab[1] * Y) / size
        w1 = fbm(size, (2, 4, 8), (1.0, 0.55, 0.3), r) - 0.5
        w2 = fbm(size, (9, 18), (1.0, 0.5), r) - 0.5
        phase = u * bands + w1 * amp + w2 * amp * 0.30
        v = np.exp(-np.abs(np.sin(np.pi * phase)) * sharp)
        gate = fbm(size, (3, 7, 14), (1.0, 0.6, 0.3), r)
        return v * np.clip((gate - gate_lo) * 3.0, 0, 1)
    v_prim = dir_veins((1, 2), 1.6, 1.1, 3.4, 0.34)      # 2-3 bold primary veins
    v_main = dir_veins((1, 2), 2.4, 1.3, 7.0, 0.26)      # same flow direction
    v_sec = dir_veins((2, -1), 5, 2.2, 14.0, 0.44)
    v_fine = dir_veins((1, 3), 9, 2.2, 26.0, 0.62)
    veins = np.clip(v_prim * 0.95 + v_main * 0.55 + v_sec * 0.20 + v_fine * 0.05, 0, 1)
    v_gold = dir_veins((2, 1), 3, 1.6, 13.0, 0.55)
    grain = fbm(size, (64, 128, 256), (1.0, 0.6, 0.35), r)
    tint = fbm(size, (3, 6), (1.0, 0.5), r)
    cloud = fbm(size, (2, 5), (1.0, 0.5), r)
    lowf = fbm(size, (2, 4), (1.0, 0.5), r)              # broad sheen drift
    base = np.zeros((size, size, 3))
    base[..., 0] = 0.930; base[..., 1] = 0.908; base[..., 2] = 0.866
    warm = (tint - 0.5) * 0.050
    base[..., 0] += warm; base[..., 1] += warm * 0.8; base[..., 2] += warm * 0.4
    vein_col = np.array([0.535, 0.522, 0.508])           # warm-neutral grey
    gold_vein_col = np.array([0.762, 0.652, 0.462])
    cloud_col = np.array([0.772, 0.770, 0.782])
    mc = np.clip((cloud - 0.50) * 1.4, 0, 0.42)[..., None] * 0.42
    m = (veins * vein_strength)[..., None]
    g = (v_gold * gold_strength)[..., None]
    col = base * (1 - m) + vein_col[None, None, :] * m
    col = col * (1 - g) + gold_vein_col[None, None, :] * g
    col = col * (1 - mc) + cloud_col[None, None, :] * mc
    col += (grain[..., None] - 0.5) * 0.016
    rough = np.clip(0.32 - veins * 0.07 + (lowf - 0.5) * 0.22
                    + (grain - 0.5) * 0.04 + (tint - 0.5) * 0.03, 0.20, 0.50)
    height = -veins * 0.55 - (grain - 0.5) * 0.15 + (cloud - 0.5) * 0.22
    return np.clip(col, 0, 1), rough, height

def height_to_normal(height, s):
    # array row 0 lands on the image bottom row (Blender fills pixels from
    # bottom-left), so +row == +v == +y: both gradients need negating for an
    # OpenGL-style normal map — otherwise grooves light up as raised welts
    gy, gx = np.gradient(height)
    nx = -gx * s; ny = -gy * s; nz = np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5

def box_blur(a, n):
    for _ in range(3):
        k = 2 * n + 1
        c = np.cumsum(np.pad(a, ((n + 1, n), (0, 0)), mode='edge'), axis=0)
        a = (c[k:] - c[:-k]) / k
        c = np.cumsum(np.pad(a, ((0, 0), (n + 1, n)), mode='edge'), axis=1)
        a = (c[:, k:] - c[:, :-k]) / k
    return a

# ── crack masks (unique, planar disc space: uv = xy/21.2 + 0.5) ──────────
TEX_TOP = 2048
PX = TEX_TOP / 21.2      # world units -> pixels (r=10.1 -> 976 px)

def stamp(mask, x, y, w, val):
    n = int(math.ceil(w)) + 1
    x0, y0 = int(x), int(y)
    for j in range(-n, n + 1):
        yy = y0 + j
        if yy < 0 or yy >= mask.shape[0]:
            continue
        for i in range(-n, n + 1):
            xx = x0 + i
            if xx < 0 or xx >= mask.shape[1]:
                continue
            d = math.hypot(xx - x, yy - y)
            v = val * max(0.0, 1.0 - (d / (w + 0.6)) ** 2)
            if v > mask[yy, xx]:
                mask[yy, xx] = v

def crack_paths(r, roots, r_lo, r_hi, ln_lo, ln_hi, w_lo, w_hi):
    """Deterministic branching crack trees marching inward from the rim.
    Returns polylines [(points, base_width)]. Stage 2 re-rasterizes the SAME
    trees wider and longer, so heavy damage reads as escalation of stage 1."""
    cx = cy = TEX_TOP / 2
    paths = []
    for _ in range(roots):
        a = r.uniform(0, 2 * math.pi)
        rr = r.uniform(r_lo, r_hi)
        stack = [(cx + rr * math.cos(a), cy + rr * math.sin(a),
                  a + math.pi + r.uniform(-0.4, 0.4),
                  r.uniform(ln_lo, ln_hi), r.uniform(w_lo, w_hi), 0)]
        while stack:
            x, y, h, length, w, depth = stack.pop()
            pts = [(x, y)]
            steps = int(length / 2.0)
            for s in range(steps):
                x += 2.0 * math.cos(h); y += 2.0 * math.sin(h)
                h += r.uniform(-0.10, 0.10)      # smooth curves, no scribble
                ang_in = math.atan2(cy - y, cx - x)
                d = (ang_in - h + math.pi) % (2 * math.pi) - math.pi
                h += 0.09 * d
                pts.append((x, y))
                if depth < 1 and r.random() < 0.010 and (steps - s) > 30:
                    blen = (steps - s) * 2.0 * r.uniform(0.40, 0.65)
                    if blen > 60:                # only long, shallow-angle branches
                        stack.append((x, y, h + r.choice([-1, 1]) * r.uniform(0.30, 0.55),
                                      blen, w * 0.55, depth + 1))
            paths.append((pts, w))
    return paths

def raster_paths(mask, paths, wmul, frac, r_min_px, taper=0.40, min_w=0.0):
    """Stamp a fraction of each polyline; width tapers toward the tip.
    min_w skips branch polylines so a stage can show trunks only."""
    cx = cy = TEX_TOP / 2
    for pts, w in paths:
        if w < min_w:
            continue
        n = max(2, int(len(pts) * frac))
        for i in range(n):
            x, y = pts[i]
            if math.hypot(x - cx, y - cy) < r_min_px:
                break
            stamp(mask, x, y, max(1.2, w * wmul * (1.0 - taper * i / max(1, n - 1))), 1.0)

def ring_crack(mask, r):
    """Nearly continuous hairline groove tracing the future fracture edge —
    the release line telegraphs as one structural separation, not as dashes."""
    cx = cy = TEX_TOP / 2
    gate = _harm(np.random.default_rng(41), (2, 5, 9), (1.0, 0.7, 0.5))
    wmod = _harm(np.random.default_rng(42), (3, 8, 17), (1.0, 0.6, 0.4))
    t = 0.0
    while t < 2 * math.pi:
        rr = r_edge(t) * PX
        if gate(t) > -0.60:
            stamp(mask, cx + rr * math.cos(t), cy + rr * math.sin(t),
                  3.4 + 2.0 * max(0.0, wmod(t) + 0.9), 0.85)
        t += 1.6 / rr

# stress-fissure language: FEW long radial cracks. Stage 1 shows only the main
# trunks (partial length); stage 2 escalates the SAME fissures (wider, full
# length, branches appear) plus a nearly continuous ring groove at the future
# break line. No hairline scribble sets — depth comes from relief, not ink.
PATHS_MAIN = crack_paths(np.random.default_rng(21), 6, 930, 985, 380, 560, 6.0, 8.0)
PATHS_SIDE = crack_paths(np.random.default_rng(23), 3, 880, 960, 260, 380, 4.0, 5.0)
mask1 = np.zeros((TEX_TOP, TEX_TOP))
raster_paths(mask1, PATHS_MAIN, 1.0, 0.70, 780, taper=0.55, min_w=5.5)
mask2 = np.zeros((TEX_TOP, TEX_TOP))
raster_paths(mask2, PATHS_MAIN, 1.6, 1.0, 700, taper=0.45)
raster_paths(mask2, PATHS_SIDE, 1.0, 1.0, 740, taper=0.50, min_w=3.5)
ring_crack(mask2, np.random.default_rng(24))
mask1 = np.clip(box_blur(mask1, 1) * 1.5, 0, 1)
mask2 = np.clip(box_blur(mask2, 1) * 1.5, 0, 1)
ao1 = np.clip(box_blur(mask1, 9) * 1.6, 0, 1)
ao2 = np.clip(box_blur(mask2, 12) * 1.8, 0, 1)

log('textures: marble fields')
col_top, rough_top, h_top = marble_maps(TEX_TOP, np.random.default_rng(11), 0.42, 0.22)
# groove semantics, not ink: a fissure is a shadowed depression in the stone.
# Albedo only dims moderately toward grey — visible depth comes from the
# carved normal relief plus the matte roughness halo.
CRACK_SHOULDER = np.array([0.640, 0.622, 0.600])   # shadowed groove shoulder
CRACK_DEPTH = np.array([0.370, 0.356, 0.340])      # fissure interior (grey)
def crack_compose(col, rough, m, ao):
    feather = np.clip(m * 1.2, 0, 1)
    core = np.clip((m - 0.70) * 3.3, 0, 1)     # stamp profile ~1 at centre
    c = col * (1 - 0.60 * feather[..., None]) + CRACK_SHOULDER[None, None, :] * (0.60 * feather[..., None])
    c = c * (1 - 0.90 * core[..., None]) + CRACK_DEPTH[None, None, :] * (0.90 * core[..., None])
    c = c * (1 - 0.15 * ao[..., None])         # soft grey damage halo
    rg = np.clip(rough + feather * 0.30 + ao * 0.15, 0.2, 0.9)
    return np.clip(c, 0, 1), rg

col_top_s1, rough_top_s1 = crack_compose(col_top, rough_top, mask1, ao1)
col_top_s2, rough_top_s2 = crack_compose(col_top, rough_top, mask2, ao2)

# settled dust band along the future break line (stage 2 only)
_yy, _xx = np.mgrid[0:TEX_TOP, 0:TEX_TOP]
_rpix = np.hypot(_xx - TEX_TOP / 2, _yy - TEX_TOP / 2)
_band = np.clip(1 - np.abs(_rpix - (R_BREAK * PX - 16)) / 36.0, 0, 1)
_band *= np.clip(fbm(TEX_TOP, (24, 48), (1.0, 0.6), np.random.default_rng(29)) * 1.7 - 0.30, 0, 1)
_band = box_blur(_band, 3)
DUST_COL = np.array([0.78, 0.75, 0.70])
col_top_s2 = col_top_s2 * (1 - 0.12 * _band[..., None]) + DUST_COL[None, None, :] * (0.12 * _band[..., None])
rough_top_s2 = np.clip(rough_top_s2 + _band * 0.10, 0.2, 0.9)

# crack relief carved into per-stage normal maps: narrow V-groove inside a
# broad soft depression — the raking key sun reads it as real material damage
h_crk1 = -(box_blur(mask1, 2) * 0.55 + box_blur(mask1, 6) * 0.55 + box_blur(mask1, 12) * 0.35)
h_crk2 = -(box_blur(mask2, 2) * 0.55 + box_blur(mask2, 6) * 0.55 + box_blur(mask2, 12) * 0.35)
nrm_top = height_to_normal(h_top, 1.6)
nrm_top_s1 = height_to_normal(h_top + h_crk1 * 6.0, 1.6)
nrm_top_s2 = height_to_normal(h_top + h_crk2 * 6.0, 1.6)

# body marble (tiling 1024, same family as arena_v2 body; calmer than before
# so the drum silhouette reads as solid stone, not drippy plaster)
TEXB = 1024
col_body, rough_body, h_body = marble_maps(TEXB, np.random.default_rng(12), 0.40, 0.22)
nrm_body = height_to_normal(h_body, 1.8)

def cellular(size, g, r):
    """Seamless jittered-grid Worley noise. Returns (F1, F2-F1 edge distance,
    per-cell random id) — the basis for angular fracture facets."""
    pts = r.random((g, g, 2)) * 0.85 + 0.075
    idv = r.random((g, g))
    ys, xs = np.mgrid[0:size, 0:size]
    fx = xs * g / size; fy = ys * g / size
    ix = np.floor(fx).astype(int); iy = np.floor(fy).astype(int)
    fx -= ix; fy -= iy
    F1 = np.full((size, size), 9.0); F2 = np.full((size, size), 9.0)
    ID = np.zeros((size, size))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            jx = (ix + dx) % g; jy = (iy + dy) % g
            d = np.hypot(pts[jy, jx, 0] + dx - fx, pts[jy, jx, 1] + dy - fy)
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, idv[jy, jx], ID)
            F1 = np.where(closer, d, F1)
    return F1, F2 - F1, ID

# fracture stone (tiling 1024): fresh marble break — bright, angular Worley
# facet plates with sharp crevice seams and sparse crystalline glints
rf = np.random.default_rng(13)
_f1a, _edge_a, _id_a = cellular(TEXB, 9, rf)      # large facet plates
_f1b, _edge_b, _id_b = cellular(TEXB, 26, rf)     # fine crystalline grain
crev = np.clip(1.0 - _edge_a / 0.085, 0, 1) ** 1.8          # sharp plate seams
# only part of the seam network reads — kills the bathroom-mosaic uniformity
crev_gate = np.clip(fbm(TEXB, (5, 11), (1.0, 0.55), rf) * 2.1 - 0.55, 0.15, 1.0)
crev = crev * crev_gate
crev_f = np.clip(1.0 - _edge_b / 0.16, 0, 1) ** 2.0 * 0.22  # fine grain seams
micro = fbm(TEXB, (48, 96, 192), (1.0, 0.6, 0.35), rf)
facet = (_id_a - 0.5) * 0.055 + (_id_b - 0.5) * 0.03         # flat per-plate luma
spark = (np.random.default_rng(14).random((TEXB, TEXB)) > 0.986).astype(float)
spark = np.maximum(spark, np.roll(spark, 1, axis=0))         # 1-2 px clusters
fr_l = 0.925 + facet - crev * 0.10 - crev_f * 0.045 + (micro - 0.5) * 0.06
fr_l = np.where(crev > 0.80, fr_l - 0.07, fr_l)              # deep pits stay dark
col_frac = np.stack([fr_l * 0.975, fr_l * 0.955, fr_l * 0.920], axis=-1)
col_frac = np.clip(col_frac + spark[..., None] * 0.04, 0, 1)
rough_frac = np.clip(0.58 - facet * 0.7 + crev * 0.14 + crev_f * 0.06
                     - spark * 0.40 + (micro - 0.5) * 0.10, 0.18, 0.80)
h_frac = facet * 2.4 - crev * 1.5 - crev_f * 0.5 + (micro - 0.5) * 0.4
nrm_frac = height_to_normal(h_frac, 2.2)

def save_img(name, arr3, colorspace, folder=TEX_DIR):
    size = arr3.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., :3] = arr3
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(folder, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.colorspace_settings.name = colorspace
    return img

def orm(rough_arr):
    return np.stack([np.ones_like(rough_arr), rough_arr, np.zeros_like(rough_arr)], axis=-1)

log('textures: saving PNGs')
img_top_clean = save_img('rc_top_basecolor_clean', col_top, 'sRGB')
img_top_s1 = save_img('rc_top_basecolor_stage1', col_top_s1, 'sRGB')
img_top_s2 = save_img('rc_top_basecolor_stage2', col_top_s2, 'sRGB')
img_top_orm_clean = save_img('rc_top_orm_clean', orm(rough_top), 'Non-Color')
img_top_orm_s1 = save_img('rc_top_orm_stage1', orm(rough_top_s1), 'Non-Color')
img_top_orm_s2 = save_img('rc_top_orm_stage2', orm(rough_top_s2), 'Non-Color')
img_top_nrm = save_img('rc_top_normal', nrm_top, 'Non-Color')
img_top_nrm_s1 = save_img('rc_top_normal_stage1', nrm_top_s1, 'Non-Color')
img_top_nrm_s2 = save_img('rc_top_normal_stage2', nrm_top_s2, 'Non-Color')
img_body = save_img('rc_body_basecolor', col_body, 'sRGB')
img_body_orm = save_img('rc_body_orm', orm(rough_body), 'Non-Color')
img_body_nrm = save_img('rc_body_normal', nrm_body, 'Non-Color')
img_frac = save_img('rc_fracture_basecolor', col_frac, 'sRGB')
img_frac_orm = save_img('rc_fracture_orm', orm(rough_frac), 'Non-Color')
img_frac_nrm = save_img('rc_fracture_normal', nrm_frac, 'Non-Color')
# runtime crack-stage masks (for later in-game material blending, not used by the GLB)
save_img('rc_crack_mask_stage1', np.stack([mask1] * 3, axis=-1), 'Non-Color', EXP_TEX)
save_img('rc_crack_mask_stage2', np.stack([mask2] * 3, axis=-1), 'Non-Color', EXP_TEX)

# ═════════════════════════ MATERIALS ═════════════════════════════════════
def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']

def tex_node(nt, img):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    return n

def wire_orm(nt, bsdf, orm_out):
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm_out, sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return sep

def wire_normal(nt, bsdf, img, strength):
    tn = tex_node(nt, img)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = strength
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

# Top material: preview mode blends clean->stage1->stage2 via keyed factors;
# export mode wires the stage-2 maps directly (single glTF-clean texture set).
M_Top, nt_top, bsdf_top = new_mat('M_ArenaTop')
t_c = tex_node(nt_top, img_top_clean); t_1 = tex_node(nt_top, img_top_s1); t_2 = tex_node(nt_top, img_top_s2)
o_c = tex_node(nt_top, img_top_orm_clean); o_1 = tex_node(nt_top, img_top_orm_s1); o_2 = tex_node(nt_top, img_top_orm_s2)
f1 = nt_top.nodes.new('ShaderNodeValue'); f1.name = f1.label = 'CrackStage1'
f2 = nt_top.nodes.new('ShaderNodeValue'); f2.name = f2.label = 'CrackStage2'
def mixrgb(nt, fac_out, a_out, b_out):
    # ShaderNodeMix RGBA sockets are only reachable by index: in 6=A, 7=B, out 2=Result
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    nt.links.new(fac_out, mx.inputs[0])
    nt.links.new(a_out, mx.inputs[6])
    nt.links.new(b_out, mx.inputs[7])
    return mx
mx_c1 = mixrgb(nt_top, f1.outputs[0], t_c.outputs['Color'], t_1.outputs['Color'])
mx_c2 = mixrgb(nt_top, f2.outputs[0], mx_c1.outputs[2], t_2.outputs['Color'])
mx_o1 = mixrgb(nt_top, f1.outputs[0], o_c.outputs['Color'], o_1.outputs['Color'])
mx_o2 = mixrgb(nt_top, f2.outputs[0], mx_o1.outputs[2], o_2.outputs['Color'])
sep_top = wire_orm(nt_top, bsdf_top, mx_o2.outputs[2])
nt_top.links.new(mx_c2.outputs[2], bsdf_top.inputs['Base Color'])
# per-stage normal maps: crack relief (V-groove + shoulder) blends in with damage
n_c = tex_node(nt_top, img_top_nrm); n_1 = tex_node(nt_top, img_top_nrm_s1)
n_2 = tex_node(nt_top, img_top_nrm_s2)
mx_n1 = mixrgb(nt_top, f1.outputs[0], n_c.outputs['Color'], n_1.outputs['Color'])
mx_n2 = mixrgb(nt_top, f2.outputs[0], mx_n1.outputs[2], n_2.outputs['Color'])
nm_top = nt_top.nodes.new('ShaderNodeNormalMap')
nm_top.inputs['Strength'].default_value = 0.5
nt_top.links.new(mx_n2.outputs[2], nm_top.inputs['Color'])
nt_top.links.new(nm_top.outputs['Normal'], bsdf_top.inputs['Normal'])
try:  # subtle polished-stone sheen (exports as KHR_materials_clearcoat)
    bsdf_top.inputs['Coat Weight'].default_value = 0.12
    bsdf_top.inputs['Coat Roughness'].default_value = 0.10
except KeyError:
    pass

def top_material_mode(mode):
    """'preview' = animated crack mix; 'export' = static stage-2 maps (glTF-safe)."""
    def unlink(to_node, sock_name):
        while True:  # remove one at a time — removal invalidates other link references
            found = None
            for l in nt_top.links:
                if l.to_node == to_node and l.to_socket.name == sock_name:
                    found = l
                    break
            if found is None:
                return
            nt_top.links.remove(found)
    unlink(bsdf_top, 'Base Color')
    unlink(sep_top, 'Color')
    unlink(nm_top, 'Color')
    if mode == 'export':
        nt_top.links.new(t_2.outputs['Color'], bsdf_top.inputs['Base Color'])
        nt_top.links.new(o_2.outputs['Color'], sep_top.inputs['Color'])
        nt_top.links.new(n_2.outputs['Color'], nm_top.inputs['Color'])
    else:
        nt_top.links.new(mx_c2.outputs[2], bsdf_top.inputs['Base Color'])
        nt_top.links.new(mx_o2.outputs[2], sep_top.inputs['Color'])
        nt_top.links.new(mx_n2.outputs[2], nm_top.inputs['Color'])

M_Marble, nt_b, bsdf_b = new_mat('M_ArenaMarble')
tb = tex_node(nt_b, img_body); ob = tex_node(nt_b, img_body_orm)
nt_b.links.new(tb.outputs['Color'], bsdf_b.inputs['Base Color'])
wire_orm(nt_b, bsdf_b, ob.outputs['Color'])
wire_normal(nt_b, bsdf_b, img_body_nrm, 0.5)
try:
    bsdf_b.inputs['Coat Weight'].default_value = 0.06
    bsdf_b.inputs['Coat Roughness'].default_value = 0.15
except KeyError:
    pass

M_Frac, nt_f, bsdf_f = new_mat('M_Fracture')
tf = tex_node(nt_f, img_frac); of = tex_node(nt_f, img_frac_orm)
nt_f.links.new(tf.outputs['Color'], bsdf_f.inputs['Base Color'])
wire_orm(nt_f, bsdf_f, of.outputs['Color'])
wire_normal(nt_f, bsdf_f, img_frac_nrm, 1.0)

def plain_mat(name, col, rough_v, metal):
    m, nt, bsdf = new_mat(name)
    bsdf.inputs['Base Color'].default_value = (*col, 1)
    bsdf.inputs['Roughness'].default_value = rough_v
    bsdf.inputs['Metallic'].default_value = metal
    return m

M_Gold = plain_mat('M_ArenaGold', (0.830, 0.580, 0.220), 0.22, 1.0)
M_Dark = plain_mat('M_ArenaDark', (0.070, 0.068, 0.074), 0.55, 0.0)
MATS = [M_Top, M_Marble, M_Dark, M_Gold, M_Frac]
S_TOP, S_MARBLE, S_DARK, S_GOLD, S_FRAC = range(5)

# ═════════════════════════ GEOMETRY HELPERS ══════════════════════════════
def rounded(pts, seg=3):
    out = [np.array(pts[0][:2], float)]
    for i in range(1, len(pts) - 1):
        p = np.array(pts[i][:2], float)
        f = pts[i][2] if len(pts[i]) > 2 else 0.0
        if f <= 0:
            out.append(p); continue
        a = np.array(pts[i - 1][:2], float); b = np.array(pts[i + 1][:2], float)
        da = a - p; db = b - p
        la = np.linalg.norm(da); lb = np.linalg.norm(db)
        t = min(f, la * 0.45, lb * 0.45)
        pa = p + da / la * t; pb = p + db / lb * t
        for k in range(seg + 1):
            u = k / seg
            out.append((1 - u) ** 2 * pa + 2 * (1 - u) * u * p + u ** 2 * pb)
    out.append(np.array(pts[-1][:2], float))
    res = [out[0]]
    for q in out[1:]:
        if np.linalg.norm(q - res[-1]) > 1e-6:
            res.append(q)
    return res

def bez(p0, ctrl, p1, n):
    p0 = np.array(p0, float); c = np.array(ctrl, float); p1 = np.array(p1, float)
    return [tuple((1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t ** 2 * p1)
            for t in [k / n for k in range(1, n + 1)]]

def mark_sharp(bm, angle=40.0):
    lim = math.radians(angle)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle() > lim:
                    e.smooth = False
            except ValueError:
                pass

def finish(bm, name, collection, pivot=(0, 0, 0)):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:                 # flat-shade all fracture faces: angular
        if f.material_index == S_FRAC:  # facets instead of dough-smooth rock
            f.smooth = False
    mark_sharp(bm)
    if pivot != (0, 0, 0):
        for v in bm.verts:
            v.co.x -= pivot[0]; v.co.y -= pivot[1]; v.co.z -= pivot[2]
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in MATS:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    ob.location = pivot
    collection.objects.link(ob)
    return ob

# UV modes: 'planar' (disc space, crack continuity), 'cyl' (angle/arc), 'frac' (theta*r/z)
# 'cyl' is aspect-corrected (~6.4 world units per tile both ways) so wall marble
# features stay isotropic; 'frac' takes a per-object offset to de-correlate the
# tiling fracture texture between neighbouring segments.
def uv_for(mode, x, y, z, theta, arcv, off=(0.0, 0.0)):
    if mode == 'planar':
        return (x / 21.2 + 0.5, y / 21.2 + 0.5)
    if mode == 'cyl':
        return (theta / (2 * math.pi) * 10.0, arcv * 1.15)
    return (theta * 3.0 + off[0], z / 2.2 + off[1])

# ── drum skin profile (const rows, copied from arena_v2 top+body contract) ─
SKIN_PTS = [
    (8.55, 0.0, 0.055), (8.78, 0.045, 0.045), (10.10, 0.045, 0.028),
    (10.10, -0.145, 0.015), (9.98, -0.205, 0.02), (10.02, -0.26, 0.02),
    (10.02, -0.56, 0.02), (9.87, -0.60, 0.012), (9.87, -0.68, 0.012),
    (10.00, -0.72, 0.02), (10.00, -1.06, 0.025), (9.55, -1.12),
    (9.55, -1.62), (9.97, -1.68, 0.025), (9.97, -1.80, 0.02),
    (9.88, -2.18, 0.03), (9.76, -2.27, 0.025),
]
SKIN = rounded(SKIN_PTS, 3) + bez((9.76, -2.27), (9.30, -2.44), (9.00, Z_SLAB_BOT), 5)
SKIN_ARC = [0.0]
for j in range(1, len(SKIN)):
    SKIN_ARC.append(SKIN_ARC[-1] + float(np.linalg.norm(np.array(SKIN[j]) - np.array(SKIN[j - 1]))))

def skin_slot(rm, zm):
    if zm > -0.150:
        return S_TOP
    if -0.70 < zm < -0.58 and rm < 9.92:
        return S_DARK
    if -1.64 < zm < -1.10 and rm < 9.65:
        return S_DARK
    return S_MARBLE

INNER_Z = [-2.30, -1.85, -1.40, -0.90, -0.45]   # inner face rows above the shoulder meet

# ═════════════════════════ COLLAPSE SEGMENTS ═════════════════════════════
def build_segment(idx, a_deg, b_deg, bi_a, bi_b):
    th_a, th_b = math.radians(a_deg), math.radians(b_deg)
    ncols = max(15, int(round((b_deg - a_deg) / 2.5))) + 1
    fo = (idx * 0.73, idx * 1.37)      # de-correlate tiling fracture texture
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')

    # cycle rows: A(theta) -> skin -> bottom -> B -> inner(up) -> back to A
    def col_theta(u, r, z):
        return (1 - u) * (th_a + jag(bi_a, r, z)) + u * (th_b + jag(bi_b, r, z))

    cols = []          # per column: list of (BMVert, uvmode, theta, arcv)
    for ci in range(ncols):
        u = ci / (ncols - 1)
        cyc = []
        def add(r, z, mode, arcv=0.0):
            th = col_theta(u, r, z)
            v = bm.verts.new((r * math.cos(th), r * math.sin(th), z))
            cyc.append((v, mode, th, arcv))
        re = r_edge(col_theta(u, R_BREAK, 0))
        add(re, 0.0, 'planar')                                   # A
        add((re + 8.55) * 0.5, 0.0, 'planar')
        for j, (r, z) in enumerate(SKIN):
            add(r, z, 'cyl', SKIN_ARC[j] / SKIN_ARC[-1])
        # curved underside following the shoulder, trimmed at the fracture meet
        zb = z_bot(col_theta(u, R_BREAK, -3.0))
        for k in (1, 2):
            zk = Z_SLAB_BOT + (zb - Z_SLAB_BOT) * k / 3
            add(shoulder_r(zk), zk, 'cyl', 1.0 + 0.04 * k)
        add(shoulder_r(zb), zb, 'frac')                          # B — meets inner face
        for z in INNER_Z:
            th = col_theta(u, R_BREAK, z)
            add(r_inner(th, z), z, 'frac')
        cols.append(cyc)

    L = len(cols[0])
    # strip slots parallel to cycle pairs
    slots = [S_TOP]                                              # A -> mid floor strip
    slots.append(S_TOP)                                          # mid -> skin[0]
    for j in range(len(SKIN) - 1):
        rm = (SKIN[j][0] + SKIN[j + 1][0]) * 0.5
        zm = (SKIN[j][1] + SKIN[j + 1][1]) * 0.5
        slots.append(skin_slot(rm, zm))
    slots += [S_MARBLE, S_MARBLE, S_MARBLE]                      # cove end -> shoulder -> B
    for _ in INNER_Z:
        slots.append(S_FRAC)                                     # B -> inner face upward
    slots.append(S_FRAC)                                         # closing pair: last inner row -> A
    assert len(slots) == L, (len(slots), L)

    for ci in range(ncols - 1):
        ca, cb = cols[ci], cols[ci + 1]
        for j in range(L):
            j2 = (j + 1) % L
            va, ma, ta, aa = ca[j]; vb, mb, tb2, ab = cb[j]
            vc, mc2, tc2, ac = cb[j2]; vd, md, td, ad = ca[j2]
            try:
                f = bm.faces.new((va, vb, vc, vd))
            except ValueError:
                continue
            f.smooth = True
            f.material_index = slots[j]
            for l, (vv, mm, tt, av) in zip(f.loops, ((va, ma, ta, aa), (vb, mb, tb2, ab),
                                                     (vc, mc2, tc2, ac), (vd, md, td, ad))):
                l[uvl].uv = uv_for(mm, vv.co.x, vv.co.y, vv.co.z, tt, av, fo)

    # jagged radial cut faces: centroid fan over each boundary column cycle.
    # The centroid is tucked into the segment so the two neighbouring fans can
    # never poke through each other's skin while the ring is intact.
    for ci in (0, ncols - 1):
        cyc = cols[ci]
        cen = Vector((0, 0, 0))
        for v, *_ in cyc:
            cen += v.co
        cen /= len(cyc)
        thc = math.atan2(cen.y, cen.x)
        cen += Vector((-math.sin(thc), math.cos(thc), 0)) * (0.30 if ci == 0 else -0.30)
        cen -= Vector((math.cos(thc), math.sin(thc), 0)) * 0.10
        vcen = bm.verts.new(cen)
        for j in range(L):
            v1 = cyc[j][0]; v2 = cyc[(j + 1) % L][0]
            try:
                f = bm.faces.new((v1, v2, vcen) if ci == 0 else (v2, v1, vcen))
            except ValueError:
                continue
            f.smooth = True
            f.material_index = S_FRAC
            for l in f.loops:
                co = l.vert.co
                l[uvl].uv = (math.hypot(co.x, co.y) / 2.2 + fo[0], co.z / 2.2 + fo[1])

    # channel piers that belong to this segment (arena_v2 layout: 12 at k*30+15 deg)
    for k in range(12):
        ang = math.radians(k * 30 + 15)
        if not (th_a + 0.07 < ang < th_b - 0.07):
            continue
        rot = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
        for (bw, bd, z0, z1) in ((0.72, 0.31, -1.63, -1.55), (0.62, 0.26, -1.56, -1.18),
                                 (0.72, 0.31, -1.19, -1.11)):
            res = bmesh.ops.create_cube(bm, size=1.0)
            for v in res['verts']:
                x, y, z = v.co.x * bd, v.co.y * bw, v.co.z * (z1 - z0)
                x += 9.72
                v.co.x = rot[0, 0] * x + rot[0, 1] * y
                v.co.y = rot[1, 0] * x + rot[1, 1] * y
                v.co.z = z + (z0 + z1) * 0.5
            for v in res['verts']:
                for fc in v.link_faces:
                    fc.material_index = S_MARBLE
                    fc.smooth = False
                    for l in fc.loops:
                        l[uvl].uv = ((l.vert.co.x + l.vert.co.y) * 0.09, l.vert.co.z * 0.09)

    # gold trim arcs — visibly interrupted at the jagged cuts (gap before each cut)
    GOLD_ARCS = [(10.05, 0.036, 0.030), (8.60, 0.008, 0.026), (9.90, -0.64, 0.034),
                 (9.64, -1.135, 0.020), (9.64, -1.605, 0.020), (9.80, -2.24, 0.034)]
    for (gr, gz, gm) in GOLD_ARCS:
        # tiny end gap: reads as an expansion joint while intact, as a clean
        # break once the slab separates (no gold crossing the fracture face)
        pa = th_a + jag(bi_a, gr, gz) + 0.008
        pb = th_b + jag(bi_b, gr, gz) - 0.008
        nseg = max(8, int((pb - pa) / math.radians(4)))
        rings = []
        for s in range(nseg + 1):
            th = pa + (pb - pa) * s / nseg
            cx, cy = gr * math.cos(th), gr * math.sin(th)
            nr = Vector((math.cos(th), math.sin(th), 0))
            ring = []
            for q in range(6):
                al = q / 6 * 2 * math.pi
                p = Vector((cx, cy, gz)) + nr * (gm * math.cos(al)) + Vector((0, 0, gm * math.sin(al)))
                ring.append(bm.verts.new(p))
            rings.append(ring)
        for s in range(nseg):
            for q in range(6):
                q2 = (q + 1) % 6
                try:
                    f = bm.faces.new((rings[s][q], rings[s + 1][q], rings[s + 1][q2], rings[s][q2]))
                except ValueError:
                    continue
                f.smooth = True
                f.material_index = S_GOLD
                for l in f.loops:
                    l[uvl].uv = (0.5, 0.5)
        for ring, flip in ((rings[0], False), (rings[-1], True)):
            try:
                f = bm.faces.new(ring if flip else list(reversed(ring)))
            except ValueError:
                continue
            f.material_index = S_GOLD
            for l in f.loops:
                l[uvl].uv = (0.5, 0.5)

    th_m = (th_a + th_b) * 0.5
    pivot = (10.0 * math.cos(th_m), 10.0 * math.sin(th_m), Z_SLAB_BOT)
    ob = finish(bm, 'Collapse_Segment_%02d' % (idx + 1), coll_main, pivot)
    ob['theta_mid'] = th_m
    return ob

# ═════════════════════════ ARENA CORE ════════════════════════════════════
def build_core():
    N = 96
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')

    rows = []   # (kind, data, mode, slot-of-strip-below)
    def R(rk, data, mode, slot):
        rows.append((rk, data, mode, slot))
    # top plate (planar): grooves keep the three gold inlays
    R('fan', (0.0, 0.0), 'planar', S_TOP)
    for r in (0.7, 1.4, 2.1):
        R('c', (r, 0.0), 'planar', S_TOP)
    for ir in INLAY_RADII:
        R('c', (ir - 0.058, 0.0), 'planar', S_TOP)
        R('c', (ir - 0.044, -GROOVE_D), 'planar', S_TOP)
        R('c', (ir + 0.044, -GROOVE_D), 'planar', S_TOP)
        R('c', (ir + 0.058, 0.0), 'planar', S_TOP)
        if ir < 6.0:
            R('c', (ir + 0.9, 0.0), 'planar', S_TOP)
    R('c', (7.15, 0.0), 'planar', S_TOP)
    R('c', (7.75, 0.0), 'planar', S_TOP)
    R('edge_mid', None, 'planar', S_TOP)          # r_edge - 0.15
    R('edge', None, 'planar', S_FRAC)             # r_edge - 0.012, chip-modulated
    # fracture band down the new rim (matches the slab inner faces minus inset),
    # ends where the slabs' shoulder undersides met the fracture face; the rows
    # near the arris carry the chip() bites for a broken silhouette
    for z in (-0.12, -0.30, -0.70, -1.15, -1.65, -2.15, -2.55):
        R('band', z, 'frac', S_FRAC)
    R('bandbot', None, 'frac', S_FRAC)
    # remaining chalice (arena_v2 body profile, shifted -0.012 to avoid z-fighting)
    chal = [(7.35, -3.566), (6.95, -3.744)]
    chal += [tuple(p[:2]) for p in rounded([(6.95, -3.744), (6.74, -3.832, 0.02), (6.88, -3.952, 0.015),
                                            (6.58, -4.092, 0.02), (5.30, -4.632)], 2)][1:]
    chal += bez((5.30, -4.632), (4.60, -5.09), (4.28, -5.452), 4)
    chal += [(4.10, -5.572)]
    chal += bez((4.10, -5.572), (3.15, -6.032), (2.54, -6.592), 5)
    chal += [(2.40, -6.732), (1.70, -6.95), (0.90, -7.06)]
    arc = 0.0
    prev = (7.35, -3.566)
    for (r, z) in chal:
        arc += math.hypot(r - prev[0], z - prev[1]); prev = (r, z)
        R('c', (r, z, arc), 'cyl', S_MARBLE)
    R('fan_end', (0.0, -7.10), 'cyl', S_MARBLE)

    ring_rows = []
    center_first = center_last = None
    for (rk, data, mode, slot) in rows:
        if rk == 'fan':
            center_first = bm.verts.new((0, 0, data[1])); ring_rows.append(None); continue
        if rk == 'fan_end':
            center_last = bm.verts.new((0, 0, data[1])); ring_rows.append(None); continue
        ring = []
        for i in range(N):
            th = 2 * math.pi * i / N
            if rk == 'c':
                r, z = data[0], data[1]
                av = data[2] / 7.5 if len(data) > 2 else 0.0
            elif rk == 'edge_mid':
                r, z, av = r_edge(th) - 0.15, 0.0, 0.0
            elif rk == 'edge':
                cb = chip(th)
                r, z, av = r_edge(th) - 0.012 - 0.012 * cb, -0.0015 - 0.003 * cb, 0.0
            elif rk == 'band':
                z = data
                dep = 0.20 * max(0.0, 1.0 - abs(z + 0.45) / 0.95)
                r, av = r_inner(th, z) - 0.02 - dep * chip(th), 0.0
            elif rk == 'bandbot':
                zb = z_bot(th)
                r, z, av = r_inner(th, zb) - 0.02, zb - 0.012, 0.0
            ring.append((bm.verts.new((r * math.cos(th), r * math.sin(th), z)), mode, th, av))
        ring_rows.append(ring)

    for j in range(len(rows) - 1):
        a, b = ring_rows[j], ring_rows[j + 1]
        slot = rows[j][3]
        if a is None or b is None:
            ring = b if a is None else a
            cv = center_first if a is None else center_last
            for i in range(N):
                i2 = (i + 1) % N
                tri = (cv, ring[i][0], ring[i2][0]) if a is None else (ring[i2][0], ring[i][0], cv)
                try:
                    f = bm.faces.new(tri)
                except ValueError:
                    continue
                f.smooth = True; f.material_index = slot
                for l in f.loops:
                    co = l.vert.co
                    th = math.atan2(co.y, co.x) % (2 * math.pi)
                    l[uvl].uv = uv_for(rows[j][2], co.x, co.y, co.z, th, 0.0)
            continue
        for i in range(N):
            i2 = (i + 1) % N
            va, vb = a[i], a[i2]; vc, vd = b[i2], b[i]
            try:
                f = bm.faces.new((va[0], vb[0], vc[0], vd[0]))
            except ValueError:
                continue
            f.smooth = True; f.material_index = slot
            for l, vv in zip(f.loops, (va, vb, vc, vd)):
                l[uvl].uv = uv_for(vv[1], vv[0].co.x, vv[0].co.y, vv[0].co.z, vv[2], vv[3])

    ob = finish(bm, 'Arena_Core', coll_main)
    return ob

def add_torus(name, r, minor, z, zscale=1.0, maj=None):
    maj = maj or (96 if r > 7 else 64 if r > 2.4 else 40)
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=minor, location=(0, 0, z),
                                     major_segments=maj, minor_segments=6)
    o = bpy.context.object
    o.name = name
    o.scale = (1, 1, zscale)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(M_Gold)
    return o

def build_core_gold(core):
    parts = []
    for rr in INLAY_RADII:
        # near-flush bead: crown catches direct sun instead of hiding in groove shadow
        parts.append(add_torus('GoldInlay', rr, 0.046, -0.010, 0.60))
    parts.append(add_torus('GoldCollarRing', 6.86, 0.038, -3.952))
    parts.append(add_torus('GoldLedgeRing', 4.08, 0.040, -5.562))
    # center medallion
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    # domed medallion: normals sweep toward the warm horizon instead of
    # mirror-reflecting the sky zenith (which read as a grey-green puck)
    prof = rounded([(0.0, 0.052), (0.24, 0.040, 0.06), (0.34, 0.010, 0.04), (0.40, -0.012)], 3)
    ring_prev = None
    cenv = bm.verts.new((0, 0, prof[0][1]))
    for (r, z) in prof[1:]:
        ring = [bm.verts.new((r * math.cos(2 * math.pi * i / 48), r * math.sin(2 * math.pi * i / 48), z))
                for i in range(48)]
        if ring_prev is None:
            for i in range(48):
                try:
                    f = bm.faces.new((cenv, ring[i], ring[(i + 1) % 48]))
                except ValueError:
                    continue
                f.smooth = True
                for l in f.loops:
                    l[uvl].uv = (0.5, 0.5)
        else:
            for i in range(48):
                i2 = (i + 1) % 48
                try:
                    f = bm.faces.new((ring_prev[i], ring_prev[i2], ring[i2], ring[i]))
                except ValueError:
                    continue
                f.smooth = True
                for l in f.loops:
                    l[uvl].uv = (0.5, 0.5)
        ring_prev = ring
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('GoldMedallion')
    bm.to_mesh(me); bm.free()
    me.materials.append(M_Gold)
    med = bpy.data.objects.new('GoldMedallion', me)
    coll_main.objects.link(med)
    parts.append(med)

    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        if o.name not in coll_main.objects:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            coll_main.objects.link(o)
        o.select_set(True)
    core.select_set(True)
    bpy.context.view_layer.objects.active = core
    bpy.ops.object.join()
    return core

# ═════════════════════════ DEBRIS ════════════════════════════════════════
def build_debris(name, size, seed):
    r = np.random.default_rng(seed)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_icosphere(bm, subdivisions=2 if size >= 0.28 else 1, radius=size)
    # thickness clamp (sz >= 0.7): no paper-thin slivers
    sx, sy, sz = 1 + r.uniform(-0.3, 0.5), 1 + r.uniform(-0.3, 0.4), 1 + r.uniform(-0.30, 0.2)
    fr = _harm(np.random.default_rng(seed + 1), (2.2, 4.7, 8.3), (0.22, 0.13, 0.08))
    uo = r.uniform(0, 4, 2)            # per-chunk UV offset against visible tiling
    for v in bm.verts:
        n = v.co.normalized()
        d = 1.0 + fr(n.x * 3 + n.y * 5 + n.z * 7)
        v.co = Vector((v.co.x * sx * d, v.co.y * sy * d, v.co.z * sz * d))
    for f in bm.faces:
        f.smooth = False
        f.material_index = S_FRAC
        for l in f.loops:
            l[uvl].uv = ((l.vert.co.x + l.vert.co.z) * 0.8 + uo[0],
                         (l.vert.co.y - l.vert.co.z) * 0.8 + uo[1])
    return finish(bm, name, coll_main)

# ═════════════════════════ BUILD ═════════════════════════════════════════
log('geometry: segments')
segments = []
for i in range(6):
    a = SEG_BOUNDS_DEG[i]
    b = SEG_BOUNDS_DEG[(i + 1) % 6] + (360 if i == 5 else 0)
    segments.append(build_segment(i, a, b, i, (i + 1) % 6))

log('geometry: core')
core = build_core()
core = build_core_gold(core)
core.name = 'Arena_Core'
core.data.name = 'Arena_Core'

ring_root = bpy.data.objects.new('Collapse_Ring', None)
coll_main.objects.link(ring_root)
for s in segments:
    s.parent = ring_root
debris_root = bpy.data.objects.new('Debris_Root', None)
coll_main.objects.link(debris_root)

log('geometry: debris')
# 0-13: original mix (chips + fall companions) · 14-22: fine splinters + one
# mid chunk (extra fall companions) · 23-25: chips that land and stay (final
# set dressing near the new edge)
DEBRIS_SIZES = [0.10, 0.16, 0.14, 0.20, 0.24, 0.28, 0.18, 0.26, 0.34, 0.22, 0.30, 0.38,
                0.20, 0.26, 0.07, 0.10, 0.06, 0.13, 0.08, 0.30, 0.09, 0.12, 0.07,
                0.11, 0.15, 0.09]
debris = []
for i, size in enumerate(DEBRIS_SIZES):
    d = build_debris('Debris_Small_%02d' % (i + 1), size, 100 + i)
    d.parent = debris_root
    debris.append(d)

# preview-only props (NOT exported): gold hoop below the arena + dust motes
hoopM = add_torus('Preview_GoldHoop', 8.35, 0.16, -6.9)
for c in list(hoopM.users_collection):
    c.objects.unlink(hoopM)
coll_prev.objects.link(hoopM)

def dust_mat(name, alpha):
    m = plain_mat(name, (0.86, 0.83, 0.78), 1.0, 0.0)
    try:
        m.blend_method = 'BLEND'
    except Exception:
        pass
    m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = alpha
    return m

# three opacity tiers (shared materials, preview only)
M_DustA = dust_mat('M_Dust_A', 0.22)
M_DustB = dust_mat('M_Dust_B', 0.15)
M_DustC = dust_mat('M_Dust_C', 0.10)

def build_dust(name, radius, mat, seed):
    r = np.random.default_rng(seed)
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    fr = _harm(np.random.default_rng(seed + 1), (2.3, 5.1), (0.18, 0.10))
    for v in bm.verts:
        n = v.co.normalized()
        v.co *= 1.0 + fr(n.x * 2 + n.y * 4 + n.z * 6)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    coll_prev.objects.link(o)
    try:
        o.visible_shadow = False       # soft puffs must not cast shadow blobs
    except AttributeError:
        pass
    return o

# 0-17: 3 puffs per release site (2 round + 1 column) · 18-21: chip pufflets
# in phases B/C · 22-24: residual wisps that linger at the broken rim
dust = []
_drng_geo = np.random.default_rng(400)
for i in range(25):
    if i < 18:
        rad = 0.60 + _drng_geo.uniform(0, 0.35) if i % 3 != 2 else 0.62
        mat = (M_DustA, M_DustB, M_DustB)[i % 3]
    elif i < 22:
        rad, mat = 0.26, M_DustB
    else:
        rad, mat = 0.55, M_DustC
    dust.append(build_dust('Dust_Mote_%02d' % (i + 1), rad, mat, 300 + i))

# ═════════════════════════ ANIMATION (baked, deterministic) ══════════════
log('animation: baking keyframes')

def key_tr(ob, frame, loc=None, quat=None, scl=None):
    if loc is not None:
        ob.location = loc
        ob.keyframe_insert('location', frame=frame)
    if quat is not None:
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = quat
        ob.keyframe_insert('rotation_quaternion', frame=frame)
    if scl is not None:
        ob.scale = scl
        ob.keyframe_insert('scale', frame=frame)

# crack stage factors (preview material only; not part of the glTF clip)
for node, fa, fb in ((f1, F_B0, F_B1), (f2, F_C0, F_C1)):
    sock = node.outputs[0]
    sock.default_value = 0.0
    sock.keyframe_insert('default_value', frame=1)
    sock.keyframe_insert('default_value', frame=fa)
    sock.default_value = 1.0
    sock.keyframe_insert('default_value', frame=fb)

def _crack_ramp(f, a, b):
    return 0.0 if f <= a else (1.0 if f >= b else (f - a) / (b - a))

def _crack_drive(sc, depsgraph=None):
    # belt-and-suspenders: node-tree animation is not always evaluated in
    # headless renders, so drive the crack factors explicitly per frame
    f = sc.frame_current
    f1.outputs[0].default_value = _crack_ramp(f, F_B0, F_B1)
    f2.outputs[0].default_value = _crack_ramp(f, F_C0, F_C1)

bpy.app.handlers.frame_change_post.append(_crack_drive)

order = [3, 0, 4, 1, 5, 2]                 # spatially staggered release order
G0 = 13.2
arng = np.random.default_rng(55)
seg_params = []
for k, si in enumerate(order):
    seg_params.append((si, SEG_RELEASE[k],
                       math.radians(arng.uniform(5.5, 10.0)),   # hinge tilt
                       G0 + arng.uniform(-0.8, 1.6),            # gravity
                       arng.uniform(0.45, 0.95),                # outward drift
                       arng.uniform(0.55, 1.15) * arng.choice([-1, 1]),   # tumble rate
                       arng.uniform(-0.35, 0.35)))              # secondary spin

for (si, rel, tilt, G, vd, wt, ws) in seg_params:
    ob = segments[si]
    th_m = ob['theta_mid']
    tang = Vector((-math.sin(th_m), math.cos(th_m), 0))
    radial = Vector((math.cos(th_m), math.sin(th_m), 0))
    base = Vector(ob.location)
    key_tr(ob, 1, loc=base, quat=Quaternion((1, 0, 0, 0)), scl=(1, 1, 1))
    key_tr(ob, rel - 14, loc=base, quat=Quaternion((1, 0, 0, 0)))
    jr = np.random.default_rng(200 + si)
    for f in range(rel - 12, rel, 2):       # pre-release tremor
        j = Vector((jr.uniform(-1, 1) * 0.014, jr.uniform(-1, 1) * 0.014, jr.uniform(-1, 0) * 0.008))
        key_tr(ob, f, loc=base + j, quat=Quaternion(tang, math.radians(jr.uniform(-0.25, 0.25))))
    key_tr(ob, rel, loc=base, quat=Quaternion((1, 0, 0, 0)))
    hinge_f = 10
    f = rel
    while True:
        f += 2
        t = (f - rel) / FPS
        th = hinge_f / FPS
        if t <= th:                          # hinge phase: tilt outward, slow slip
            ph = tilt * (t / th) ** 2
            dz = -0.55 * t * t * G * 0.12
            dr = 0.15 * vd * t
            q = Quaternion(tang, ph)
        else:                                # free fall with tumble
            tf = t - th
            dz = -0.55 * th * th * G * 0.12 - (0.30 + 0.9 * G * 0.5 * tf) * tf * 2
            dr = 0.15 * vd * th + vd * tf
            q = Quaternion(tang, tilt + wt * tf) @ Quaternion(radial, ws * tf)
        pos = base + radial * dr + Vector((0, 0, dz))
        if pos.z < -46:                          # safely below the camera frustum
            key_tr(ob, f, loc=base + radial * dr + Vector((0, 0, -46)), quat=q)
            break
        key_tr(ob, f, loc=pos, quat=q)

# debris: 2 phase-B chips, 4 phase-C chips, 17 fall companions (incl. splinters)
drng = np.random.default_rng(66)
spawns = []
for i, f in enumerate((72, 88)):
    spawns.append((f, drng.uniform(0, 2 * math.pi), 10.02, 0.55))
for i, f in enumerate((108, 124, 141, 158)):
    spawns.append((f, drng.uniform(0, 2 * math.pi), drng.uniform(9.2, 10.0), 0.7))
for k in range(17):
    si, rel = seg_params[k % 6][0], seg_params[k % 6][1]
    th_m = segments[si]['theta_mid']
    spawns.append((rel + 4 + int(drng.uniform(0, 6)),
                   th_m + drng.uniform(-0.3, 0.3), drng.uniform(8.4, 9.6), 1.0))

for d, (f0, th, r0, vig) in zip(debris, spawns):
    p0 = Vector((r0 * math.cos(th), r0 * math.sin(th), drng.uniform(-0.4, 0.05)))
    radial = Vector((math.cos(th), math.sin(th), 0))
    key_tr(d, 1, loc=p0, quat=Quaternion((1, 0, 0, 0)), scl=(0.001, 0.001, 0.001))
    key_tr(d, f0 - 1, scl=(0.001, 0.001, 0.001))
    key_tr(d, f0 + 1, scl=(1, 1, 1))
    G = 14.5 * vig
    vr = drng.uniform(0.4, 1.3)
    ax = Vector((drng.uniform(-1, 1), drng.uniform(-1, 1), drng.uniform(-1, 1))).normalized()
    w = drng.uniform(2.0, 6.0)
    f = f0
    while True:
        f += 3
        t = (f - f0) / FPS
        dz = -(0.4 * t + 0.5 * G * t * t)
        pos = p0 + radial * (vr * t) + Vector((0, 0, dz))
        q = Quaternion(ax, w * t)
        if pos.z < -46 or f > 296:
            key_tr(d, f, loc=Vector((pos.x, pos.y, max(pos.z, -46))), quat=q)
            break
        key_tr(d, f, loc=pos, quat=q)

# 3 chips that land near the new edge and stay — final-state set dressing
rrng = np.random.default_rng(77)
for k, d in enumerate(debris[23:26]):
    si, rel = seg_params[k * 2][0], seg_params[k * 2][1]
    th = segments[si]['theta_mid'] + rrng.uniform(-0.5, 0.5)
    r_rest = R_BREAK - rrng.uniform(0.6, 1.2)
    p_air = Vector(((R_BREAK + 0.05) * math.cos(th), (R_BREAK + 0.05) * math.sin(th), 0.30))
    p_rest = Vector((r_rest * math.cos(th), r_rest * math.sin(th), 0.03))
    f0 = rel + 2 + int(rrng.uniform(0, 4))
    ax = Vector((rrng.uniform(-1, 1), rrng.uniform(-1, 1), rrng.uniform(-1, 1))).normalized()
    key_tr(d, 1, loc=p_air, quat=Quaternion(ax, rrng.uniform(0, 6.2)), scl=(0.001,) * 3)
    key_tr(d, f0 - 1, scl=(0.001,) * 3)
    key_tr(d, f0 + 1, loc=p_air, scl=(1, 1, 1))
    key_tr(d, f0 + 7, loc=p_rest + Vector((0, 0, 0.10)))
    key_tr(d, f0 + 10, loc=p_rest)
    key_tr(d, f0 + 13, loc=p_rest + Vector((0, 0, 0.03)))     # tiny settle bounce
    key_tr(d, f0 + 16, loc=p_rest)
    key_tr(d, F_END, loc=p_rest)

# dust motes (preview only): release puffs + columns, chip pufflets, rim wisps
def key_puff(o, f0, p0, drift, grow, life, zstretch=1.0, hold=False):
    key_tr(o, 1, loc=p0, scl=(0.001,) * 3)
    key_tr(o, f0 - 1, scl=(0.001,) * 3)
    key_tr(o, f0 + 4, loc=p0, scl=(0.55, 0.55, 0.55 * zstretch))
    key_tr(o, f0 + int(life * 0.45), loc=p0 + drift * 0.55,
           scl=(grow * 0.8, grow * 0.8, grow * 0.8 * zstretch))
    if hold:
        key_tr(o, F_END, loc=p0 + drift, scl=(grow, grow, grow * zstretch))
    else:
        key_tr(o, f0 + life, loc=p0 + drift, scl=(0.001,) * 3)

pr = np.random.default_rng(88)
for s in range(6):                      # 2 round puffs + 1 column per release
    si, rel = seg_params[s][0], seg_params[s][1]
    th_m = segments[si]['theta_mid']
    for j in range(2):
        th = th_m + pr.uniform(-0.35, 0.35)
        p0 = Vector(((R_BREAK + 0.7) * math.cos(th), (R_BREAK + 0.7) * math.sin(th),
                     pr.uniform(-0.5, -0.1)))
        drift = Vector((math.cos(th), math.sin(th), 0)) * pr.uniform(0.6, 1.3) + Vector((0, 0, -2.6))
        key_puff(dust[s * 3 + j], rel + int(pr.uniform(0, 5)), p0, drift,
                 pr.uniform(1.9, 2.5), int(pr.uniform(34, 46)))
    th = th_m + pr.uniform(-0.25, 0.25)
    p0 = Vector(((R_BREAK + 0.9) * math.cos(th), (R_BREAK + 0.9) * math.sin(th), -1.7))
    key_puff(dust[s * 3 + 2], rel + 8 + int(pr.uniform(0, 5)), p0,
             Vector((0, 0, -4.2)), pr.uniform(1.7, 2.1), int(pr.uniform(40, 52)),
             zstretch=2.4)
for j, f0 in enumerate((72, 88, 108, 124)):     # pufflets where rim chips pop
    th = spawns[j][1]                            # same angle as the chip itself
    p0 = Vector((9.9 * math.cos(th), 9.9 * math.sin(th), -0.05))
    key_puff(dust[18 + j], f0 + 1, p0,
             Vector((math.cos(th), math.sin(th), 0)) * 0.5 + Vector((0, 0, -1.2)),
             1.5, 26)
for k in range(3):                              # residual wisps at the broken rim
    th = pr.uniform(0, 2 * math.pi)
    p0 = Vector(((R_BREAK + 0.3) * math.cos(th), (R_BREAK + 0.3) * math.sin(th), -0.5))
    key_puff(dust[22 + k], 240 + k * 9, p0, Vector((0, 0, -0.5)), 1.35, 60, hold=True)

# push exported-object actions onto one shared NLA track name -> single glTF clip
for ob in segments + debris:
    ad = ob.animation_data
    if ad and ad.action:
        act = ad.action
        act.name = 'Collapse_Active_' + ob.name
        tr = ad.nla_tracks.new()
        tr.name = 'Collapse_Active'
        tr.strips.new(act.name, int(act.frame_range[0]), act)
        ad.action = None

# ═════════════════════════ STUDIO (world, lights, camera) ════════════════
world = bpy.data.worlds.new('W')
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes['Background']
if os.path.exists(HDRI_PATH):
    env = wn.nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(HDRI_PATH)
    mp = wn.nodes.new('ShaderNodeMapping')
    tc = wn.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Rotation'].default_value = (0, 0, math.radians(HDRI_ROT_DEG))
    wn.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    wn.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    wn.links.new(env.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.85   # ambient must not drown the sun
else:
    bg.inputs['Color'].default_value = (0.75, 0.80, 0.88, 1)
    bg.inputs['Strength'].default_value = 1.0

log('world: %s' % ('HDRI ' + os.path.basename(HDRI_PATH) if os.path.exists(HDRI_PATH) else 'fallback gradient'))
target = bpy.data.objects.new('Target', None)
coll_studio.objects.link(target)
target.location = (0, 0, -1.5)

def track(ob):
    c = ob.constraints.new('TRACK_TO')
    c.target = target
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'

# key sun: warm, raking, from the HDRI glow direction (back-left) so shadow
# and visible sky agree; picks up crack/fracture relief across the top
sun_d = bpy.data.lights.new('Key', 'SUN')
sun_d.energy = 9.3
sun_d.color = (1.0, 0.82, 0.60)
sun_d.angle = math.radians(5.0)
sun = bpy.data.objects.new('Key', sun_d)
coll_studio.objects.link(sun)
sun.location = (-14, 16, 13)
track(sun)

# broad warm fill from camera side: lifts the front drum wall and gives every
# gold curve a wide warm specular band (kills the olive-gold read)
fill_d = bpy.data.lights.new('WarmFill', 'SUN')
fill_d.energy = 3.4
fill_d.color = (1.0, 0.86, 0.68)
fill_d.angle = math.radians(18.0)
fill = bpy.data.objects.new('WarmFill', fill_d)
coll_studio.objects.link(fill)
fill.location = (20, -16, 10)
track(fill)

cam_d = bpy.data.cameras.new('Cam')
cam_d.lens = 45
cam = bpy.data.objects.new('Cam', cam_d)
coll_studio.objects.link(cam)
cam.location = (0.8, -23.8, 12.8)
track(cam)
scene.camera = cam
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.view_settings.exposure = -0.15   # pull whites off the AgX shoulder
scene.render.dither_intensity = 2.0    # break 8-bit banding in the sky gradient

# subtle fog-glow bloom so gold glints and sun speculars bloom instead of clip
try:
    scene.use_nodes = True
    cn = scene.node_tree
    rl = next(n for n in cn.nodes if n.type == 'R_LAYERS')
    cp = next(n for n in cn.nodes if n.type == 'COMPOSITE')
    glare = cn.nodes.new('CompositorNodeGlare')
    glare.glare_type = 'FOG_GLOW'
    for attr, val in (('threshold', 0.90), ('size', 7), ('mix', -0.5),
                      ('quality', 'MEDIUM')):
        try:
            setattr(glare, attr, val)
        except Exception:
            for sock in glare.inputs:      # Blender 4.4 socket-based options
                if sock.name.lower() == str(attr):
                    try:
                        sock.default_value = val
                    except Exception:
                        pass
                    break
    cn.links.new(rl.outputs['Image'], glare.inputs[0])
    cn.links.new(glare.outputs[0], cp.inputs['Image'])
    log('compositor: fog-glow glare enabled')
except Exception as e:
    log('compositor glare skipped: %s' % e)

scene.render.engine = 'CYCLES'
scene.cycles.samples = 24 if QUICK else 96
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA', 'HIP'):
        try:
            prefs.compute_device_type = dt
            prefs.get_devices()
            if any(d.type != 'CPU' for d in prefs.devices):
                for d in prefs.devices:
                    d.use = True
                scene.cycles.device = 'GPU'
                log('cycles GPU: ' + dt)
                break
        except Exception:
            continue
except Exception as e:
    log('cycles GPU unavailable, CPU used: %s' % e)

# ═════════════════════════ STATS ═════════════════════════════════════════
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

stat_objs = [core] + segments + debris
stats = {
    'objects': {o.name: {'tris': tri_count(o), 'mats': len(o.data.materials)} for o in stat_objs},
    'total_tris': sum(tri_count(o) for o in stat_objs),
    'segments': len(segments), 'debris': len(debris),
    'materials': [m.name for m in MATS],
    'textures': {
        'top (unique disc)': '2048 stage2 set in GLB (basecolor+ORM+crack normal); clean/stage1 sets on disk',
        'body (tiling)': '1024 basecolor+ORM+normal (calm marble)',
        'fracture (tiling)': '1024 basecolor+ORM+normal (Worley facet break)',
        'runtime crack masks': '2048 stage1+stage2 (export/textures, not in GLB)',
    },
    'animation': {'clip': 'Collapse_Active', 'frames': F_END, 'fps': FPS,
                  'phases': {'A_intact': [1, F_B0], 'B_fine_cracks': [F_B0, F_C0],
                             'C_heavy_cracks': [F_C0, SEG_RELEASE[0]],
                             'D_release': [SEG_RELEASE[0], SEG_RELEASE[-1] + 10],
                             'E_fall': [SEG_RELEASE[0], 282], 'F_final': [282, F_END]},
                  'release_frames': SEG_RELEASE},
}
# draw call estimate: count actually used material slots per object
def used_slots(ob):
    return len({p.material_index for p in ob.data.polygons})
stats['est_draw_calls'] = sum(used_slots(o) for o in stat_objs)
log('stats: total tris = %d, est draw calls = %d' % (stats['total_tris'], stats['est_draw_calls']))

# ═════════════════════════ RENDER STAGES ═════════════════════════════════
SHOTS = [('A_intact', 20), ('B_fine_cracks', 78), ('C_heavy_cracks', 142),
         ('D_release', 196), ('E_fall', 238), ('F_final', 296)]

if STAGE in ('stills', 'all'):
    res = 640 if QUICK else 1200
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.image_settings.file_format = 'PNG'
    for name, frame in SHOTS:
        scene.frame_set(frame)
        log('frame %d: crack f1=%.2f f2=%.2f' % (frame, f1.outputs[0].default_value,
                                                 f2.outputs[0].default_value))
        scene.render.filepath = os.path.join(ART_DIR, 'ring_collapse_%s.png' % name)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        log('rendered %s (frame %d) in %.1fs' % (name, frame, time.time() - t))

if STAGE in ('video', 'all'):
    res = 480 if QUICK else 768
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.cycles.samples = 16 if QUICK else 36
    scene.render.image_settings.file_format = 'FFMPEG'
    scene.render.ffmpeg.format = 'MPEG4'
    scene.render.ffmpeg.codec = 'H264'
    scene.render.ffmpeg.constant_rate_factor = 'HIGH'
    scene.render.ffmpeg.audio_codec = 'NONE'
    scene.frame_step = FSTEP
    scene.render.fps = FPS // FSTEP
    scene.render.filepath = os.path.join(ART_DIR, 'rc_video_')
    t = time.time()
    bpy.ops.render.render(animation=True)
    log('video rendered in %.1fs' % (time.time() - t))
    for fn in os.listdir(ART_DIR):
        if fn.startswith('rc_video_') and fn.endswith('.mp4'):
            dst = os.path.join(ART_DIR, 'ring_collapse_preview.mp4')
            if os.path.exists(dst):
                os.remove(dst)
            os.rename(os.path.join(ART_DIR, fn), dst)
            log('video: ' + dst)
    scene.frame_step = 1
    scene.render.fps = FPS

# ═════════════════════════ EXPORT GLB ════════════════════════════════════
log('export: GLB')
scene.frame_set(F_END)
top_material_mode('export')
for o in bpy.context.selected_objects:
    o.select_set(False)
export_objs = [core, ring_root, debris_root] + segments + debris
for o in export_objs:
    o.select_set(True)
GLB_PATH = os.path.join(EXP_DIR, 'ring_collapse.glb')
bpy.ops.export_scene.gltf(
    filepath=GLB_PATH, use_selection=True,
    export_format='GLB', export_yup=True, export_apply=True,
    export_image_format='AUTO', export_animation_mode='NLA_TRACKS',
)
stats['glb_bytes'] = os.path.getsize(GLB_PATH)
log('GLB exported: %s (%.2f MB)' % (GLB_PATH, stats['glb_bytes'] / 1e6))
top_material_mode('preview')

# verify GLB structure (own parser — no external validators installed)
with open(GLB_PATH, 'rb') as fh:
    magic, ver, total = struct.unpack('<III', fh.read(12))
    clen, ctype = struct.unpack('<II', fh.read(8))
    gltf = json.loads(fh.read(clen).decode('utf-8'))
check = {
    'meshes': sorted(m['name'] for m in gltf.get('meshes', [])),
    'nodes': sorted(n.get('name', '?') for n in gltf.get('nodes', [])),
    'materials': sorted(m['name'] for m in gltf.get('materials', [])),
    'images': len(gltf.get('images', [])),
    'animations': [{'name': a.get('name'), 'channels': len(a.get('channels', [])),
                    'samplers': len(a.get('samplers', []))} for a in gltf.get('animations', [])],
}
stats['glb_check'] = check
log('GLB check: %d meshes, %d materials, %d images, animations=%s' %
    (len(check['meshes']), len(check['materials']), check['images'],
     [(a['name'], a['channels']) for a in check['animations']]))

with open(os.path.join(ART_DIR, 'stats.json'), 'w') as fh:
    json.dump(stats, fh, indent=2)

md = ['# Ring-Collapse Prototype — Build Stats', '',
      '| Object | Triangles | Used slots |', '|---|---|---|']
for o in stat_objs:
    md.append('| %s | %d | %d |' % (o.name, tri_count(o), used_slots(o)))
md += ['', 'Total triangles: **%d**' % stats['total_tris'],
       'Estimated draw calls: **%d**' % stats['est_draw_calls'],
       'GLB size: **%.2f MB**' % (stats['glb_bytes'] / 1e6),
       'Animation: 1 clip `Collapse_Active`, %d frames @ %d fps' % (F_END, FPS),
       'Materials: %s' % ', '.join(stats['materials'])]
with open(os.path.join(ART_DIR, 'stats.md'), 'w') as fh:
    fh.write('\n'.join(md) + '\n')

# ═════════════════════════ SAVE BLEND ════════════════════════════════════
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC_DIR, 'ring_collapse.blend'))
log('DONE stage=%s' % STAGE)
