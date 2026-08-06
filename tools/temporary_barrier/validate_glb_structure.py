# validate_glb_structure.py — GLB manifest + hard structural checks (validation 1)
#
# Pure-python GLB parsing (no bpy, no external deps). Run with any Python 3,
# e.g. Blender's bundled interpreter:
#   blender -b --factory-startup -P validate_glb_structure.py -- [--glb <file>] [--out <dir>]
#
# Defaults (canonical location tools/temporary_barrier/):
#   --glb assets/temporary_barrier/export/temporary_barrier_polish2.glb
#   --out assets/temporary_barrier/validation
# Writes glb_manifest.json (full inventory) and merges pass/fail results into
# validation_report.json.

import json
import math
import os
import struct
import sys
from array import array

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
HERE = os.path.dirname(os.path.abspath(__file__))
ASSET_DIR = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'temporary_barrier'))
GLB = os.path.abspath(argv[argv.index('--glb') + 1] if '--glb' in argv
                      else os.path.join(ASSET_DIR, 'export', 'temporary_barrier_polish2.glb'))
OUT = os.path.abspath(argv[argv.index('--out') + 1] if '--out' in argv
                      else os.path.join(ASSET_DIR, 'validation'))
os.makedirs(OUT, exist_ok=True)

with open(GLB, 'rb') as f:
    data = f.read()

magic, version, length = struct.unpack_from('<III', data, 0)
assert magic == 0x46546C67, 'not a GLB file'
chunks = []
off = 12
while off < length:
    clen, ctype = struct.unpack_from('<II', data, off)
    chunks.append((ctype, data[off + 8: off + 8 + clen]))
    off += 8 + clen
gltf = json.loads(chunks[0][1])
binbuf = chunks[1][1] if len(chunks) > 1 else b''

CTYPE_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
CTYPE_FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor_data(idx):
    acc = gltf['accessors'][idx]
    bv = gltf['bufferViews'][acc['bufferView']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    n = acc['count'] * NCOMP[acc['type']]
    fmt = CTYPE_FMT[acc['componentType']]
    stride = bv.get('byteStride')
    if stride and stride != NCOMP[acc['type']] * CTYPE_SIZE[acc['componentType']]:
        out = array(fmt)
        step = NCOMP[acc['type']] * CTYPE_SIZE[acc['componentType']]
        for i in range(acc['count']):
            out.frombytes(binbuf[start + i * stride: start + i * stride + step])
        return out
    return array(fmt, binbuf[start: start + n * CTYPE_SIZE[acc['componentType']]])


def png_size(blob):
    if blob[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack('>II', blob[16:24])
        return [w, h]
    return None


manifest = {'file': GLB, 'bytes': os.path.getsize(GLB), 'gltf_version': gltf['asset']['version'],
            'generator': gltf['asset'].get('generator', '')}
checks = []


def check(name, ok, detail=''):
    checks.append({'check': name, 'pass': bool(ok), 'detail': str(detail)})
    print(f'[{"PASS" if ok else "FAIL"}] {name}  {detail}')


# scenes / nodes -----------------------------------------------------------------
scenes = gltf.get('scenes', [])
nodes = gltf.get('nodes', [])
manifest['scenes'] = [{'name': s.get('name'), 'roots': s.get('nodes', [])} for s in scenes]
manifest['nodes'] = []
for i, n in enumerate(nodes):
    manifest['nodes'].append({k: n[k] for k in
                              ('name', 'mesh', 'children', 'translation', 'rotation', 'scale', 'matrix')
                              if k in n})
check('exactly one scene', len(scenes) == 1, f'{len(scenes)} scene(s)')
roots = scenes[0].get('nodes', []) if scenes else []
check('single root node', len(roots) == 1, [nodes[r].get('name') for r in roots])
root = nodes[roots[0]] if roots else {}
ident = ('matrix' not in root and root.get('translation', [0, 0, 0]) == [0, 0, 0]
         and root.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1]
         and root.get('scale', [1, 1, 1]) == [1, 1, 1])
check('root transform identity (pos 0/0/0, rot 0, scale 1)', ident,
      {k: root.get(k) for k in ('translation', 'rotation', 'scale', 'matrix')})
child_ident = all('matrix' not in nodes[c] and 'translation' not in nodes[c]
                  and 'rotation' not in nodes[c] and 'scale' not in nodes[c]
                  for c in root.get('children', []))
check('all child transforms identity', child_ident)
neg_scale = any(any(s < 0 for s in n.get('scale', [1, 1, 1])) for n in nodes)
check('no negative scales', not neg_scale)

# meshes / primitives / geometry --------------------------------------------------
meshes = gltf.get('meshes', [])
tot_v = tot_i = 0
mesh_rows = []
gmin = [math.inf] * 3
gmax = [-math.inf] * 3
nan_found = []
min_r = math.inf
max_r = 0.0
for mi, m in enumerate(meshes):
    for pi, prim in enumerate(m.get('primitives', [])):
        pos_i = prim['attributes']['POSITION']
        acc = gltf['accessors'][pos_i]
        nv = acc['count']
        ni = gltf['accessors'][prim['indices']]['count'] if 'indices' in prim else 0
        tot_v += nv
        tot_i += ni
        pos = accessor_data(pos_i)
        for k in range(0, len(pos), 3):
            x, y, z = pos[k], pos[k + 1], pos[k + 2]
            if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(z)):
                nan_found.append((m.get('name'), k // 3))
                continue
            gmin = [min(gmin[0], x), min(gmin[1], y), min(gmin[2], z)]
            gmax = [max(gmax[0], x), max(gmax[1], y), max(gmax[2], z)]
            r_ = math.hypot(x, z)
            min_r = min(min_r, r_)
            max_r = max(max_r, r_)
        amin, amax = acc.get('min'), acc.get('max')
        mesh_rows.append({'mesh': m.get('name'), 'primitive': pi, 'vertices': nv,
                          'indices': ni, 'material': prim.get('material'),
                          'mode': prim.get('mode', 4),
                          'accessor_min': amin, 'accessor_max': amax})
manifest['meshes'] = mesh_rows
manifest['totals'] = {'vertices': tot_v, 'indices': tot_i, 'triangles': tot_i // 3}
manifest['bounding_box'] = {'min': [round(v, 5) for v in gmin], 'max': [round(v, 5) for v in gmax]}
manifest['min_horizontal_radius'] = round(min_r, 5)
manifest['max_horizontal_radius'] = round(max_r, 5)
check('no NaN/Infinity in POSITION data', not nan_found, f'{len(nan_found)} bad vertices')
acc_bad = [i for i, a in enumerate(gltf.get('accessors', []))
           for v in (a.get('min', []) + a.get('max', []))
           if not math.isfinite(v)]
check('no NaN/Infinity in accessor min/max', not acc_bad)

# expected geometry contract (glTF Y-up: height=Y, arena plane=XZ)
check('bbox height matches contract (y 0.159..2.14 +-0.01)',
      abs(gmin[1] - 0.159) < 0.01 and abs(gmax[1] - 2.14) < 0.01,
      f'y {gmin[1]:.4f}..{gmax[1]:.4f}')
check('max vertex radius within 10.1 + pylon shoe (<=10.46)',
      max_r <= 10.46, f'max r = {max_r:.4f}')
check('no geometry inside playfield (min horizontal radius >= 9.7)',
      min_r >= 9.7, f'min r = {min_r:.4f}')
check('wall sits on segment 0 side (z<0 half-plane)', gmax[2] < 0,
      f'z range {gmin[2]:.3f}..{gmax[2]:.3f}')

# materials -----------------------------------------------------------------------
mats = gltf.get('materials', [])
mat_rows = []
for m in mats:
    row = {'name': m.get('name'), 'alphaMode': m.get('alphaMode', 'OPAQUE'),
           'doubleSided': m.get('doubleSided', False),
           'emissiveFactor': m.get('emissiveFactor'),
           'extensions': sorted((m.get('extensions') or {}).keys())}
    pbr = m.get('pbrMetallicRoughness', {})
    row['baseColorFactor'] = pbr.get('baseColorFactor')
    row['baseColorTexture'] = 'baseColorTexture' in pbr
    row['metallicFactor'] = pbr.get('metallicFactor')
    row['roughnessFactor'] = pbr.get('roughnessFactor')
    row['emissiveTexture'] = 'emissiveTexture' in m
    row['normalTexture'] = 'normalTexture' in m
    mat_rows.append(row)
manifest['materials'] = mat_rows
field = next((m for m in mat_rows if m['name'] == 'M_BarrierField'), None)
check('M_BarrierField alphaMode BLEND + doubleSided',
      field and field['alphaMode'] == 'BLEND' and field['doubleSided'], field)
check('exactly 6 materials, all named M_Barrier*',
      len(mats) == 6 and all((m.get('name') or '').startswith('M_Barrier') for m in mats),
      [m.get('name') for m in mats])

# textures ------------------------------------------------------------------------
tex_rows = []
for i, img in enumerate(gltf.get('images', [])):
    entry = {'index': i, 'name': img.get('name'), 'mimeType': img.get('mimeType')}
    if 'bufferView' in img:
        bv = gltf['bufferViews'][img['bufferView']]
        blob = binbuf[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        entry['bytes'] = bv['byteLength']
        entry['size'] = png_size(blob)
        entry['embedded'] = True
    else:
        entry['embedded'] = False
        entry['uri'] = img.get('uri')
    tex_rows.append(entry)
manifest['images'] = tex_rows
manifest['textures'] = len(gltf.get('textures', []))
manifest['samplers'] = len(gltf.get('samplers', []))
check('all images embedded (no external URIs)', all(t['embedded'] for t in tex_rows))
ext_buf = [b for b in gltf.get('buffers', []) if 'uri' in b]
check('single embedded buffer, no external buffer URIs', not ext_buf and len(gltf.get('buffers', [])) == 1)

# absent content ------------------------------------------------------------------
check('no cameras', not gltf.get('cameras'), gltf.get('cameras'))
check('no lights (KHR_lights_punctual)',
      'KHR_lights_punctual' not in gltf.get('extensionsUsed', []))
check('no animations', not gltf.get('animations'))
check('no skins', not gltf.get('skins'))
manifest['extensionsUsed'] = gltf.get('extensionsUsed', [])
manifest['extensionsRequired'] = gltf.get('extensionsRequired', [])
# specular ext comes from Specular IOR Level = 0 on the field (kills the
# specular sheen of the alpha "hole") — intentional, supported by three r170
allowed_ext = {'KHR_materials_emissive_strength', 'KHR_materials_clearcoat',
               'KHR_materials_specular'}
check('only expected extensions', set(manifest['extensionsUsed']) <= allowed_ext,
      manifest['extensionsUsed'])
check('no required extensions (loader-safe)', not manifest['extensionsRequired'])

# write ---------------------------------------------------------------------------
with open(os.path.join(OUT, 'glb_manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
rep_path = os.path.join(OUT, 'validation_report.json')
rep = {}
if os.path.exists(rep_path):
    with open(rep_path) as f:
        rep = json.load(f)
rep['glb_structure'] = {'passed': all(c['pass'] for c in checks), 'checks': checks}
with open(rep_path, 'w') as f:
    json.dump(rep, f, indent=2)
print(f'[validate] {sum(c["pass"] for c in checks)}/{len(checks)} checks passed')
print('[validate] manifest written: glb_manifest.json')
