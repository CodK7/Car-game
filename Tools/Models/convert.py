"""BeamNG vehicle mod (cached.dts + jbeam + .pc config)  ->  game GLB for public/local (local use only).

Written for the kn0z "Patrol Y61" mod the user owns; the output must never be committed (see public/local/README.md).

Output frame = the game's body frame: x right (left = -x), y up, front = -z. Origin = midpoint between the front
and rear hub centres, at hub height. Each glTF material carries `extras` {kind, color, gloss, emissive, opacity,
shadow, interior} that src/vehicle/modelBody.ts maps to objMaterial; the painted skin is baked into one texture.

Usage:
  uv run --no-project --with numpy --with pillow python Tools/Models/convert.py <mod>/vehicles/kn0z_y61 "<config>.pc" public/local/patrol_vtc.glb
"""
import argparse, collections, glob, io, json, os, re, shutil, struct, subprocess, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dts, jbeam, mats  # noqa: E402

# parts we do not draw: engine-bay internals (hidden under the closed bonnet), logos / lettering, dealer stickers
EXCLUDE = re.compile(r'(engine|intake|pulley|coolingfan|engbay|emblem|lettering|STIKER|stiker|kn0z_Mas3ood|FOR_LAZER)', re.I)
INTERIOR = re.compile(r'(dash|seat|steer|needle|pedal|parkingbrake|shifter|signalstalk|RADIO|TLBYSH|ALD_WOOD|decals_gauges)', re.I)
DROP_MATS = {'NISSAN_LOG', 'NONE'}
SKINNED = {'kn0z_y61'}  # material that the paint design (skin) replaces

# material name -> (kind, colour or None = from the material / paint)
KIND = {
    'kn0z_y61': ('paint', None), 'Cube_D_Body_Colour': ('paint', None), 'kn0z_paint3': ('paint3', None),
    'kn0z_y61_plastic': ('black', '#202224'), 'NEW_PLAS': ('black', '#1c1d1f'), 'RADIO_black': ('black', '#101112'),
    'ALDHAHERI_TLBYSH': ('trim', '#5a5b5c'), 'trucks_mechanical': ('under', '#2a2a2a'), 'gavril_v8': ('under', '#3a3a3a'),
    'kn0z_y61_chrome': ('chrome', None), 'mirror': ('mirror', None), 'kn0z_y61_r9a9': ('chrome', None), 'Rimspec': ('chrome', None),
    'ALD_MUF': ('alu', None), 'white_ALD': ('trim', '#d8d8d8'),
    'glass_swag2': ('glass', None), 'miramar_glass': ('glass', None), 'pickup_glass': ('glass', None),
    'kn0z_y61_lowbeam': ('lens', None), 'kn0z_y61_foglight': ('lens', None), 'kn0z_lights': ('lens', None), 'highbeam': ('lens', None),
    'lowbeam': ('lens', None), 'kn0z_y61_reverselight': ('lens', None),
    'kn0z_y61_brakelight': ('tail', None), 'kn0z_y61_glasred': ('tail', None), 'red_kn': ('tail', None), 'FLASHH': ('tail', None),
    'kn0z_y61_signal_R': ('amber', None), 'kn0z_y61_signal_L': ('amber', None), 'LIGHT_ALDHAHERI': ('amber', None), 'boslh_ALD': ('amber', None),
    'Yellow_ALD': ('amber', None), 'signal_L': ('amber', None), 'signal_R': ('amber', None),
    'roamer_interior': ('interior', '#55575a'), 'grey_ALDH': ('interior', None), 'kn0z_y61_wood': ('wood', '#5a3a22'),
    'kn0z_y61_fqWOOD': ('wood', '#5a3a22'), 'kn0z_y61_farmun': ('interior', None), 'kn0z_y61_fqkn0z_y61int': ('interior', '#3c3d3f'),
    'RED_ALD_GAUGES': ('gauge', '#ff2a10'), 'roamer': ('trim', '#3a3b3d'), 'image0_removebg_preview': ('trim', '#b4b4b4'),
}
#            gloss, emissive, opacity, casts shadow
KIND_STYLE = {
    'paint': (0.6, 0, 1, True), 'paint3': (0.45, 0, 1, True), 'black': (0.12, 0, 1, True), 'trim': (0.2, 0, 1, True),
    'under': (0.05, 0, 1, True), 'chrome': (0.9, 0, 1, True), 'mirror': (0.95, 0, 1, True), 'alu': (0.6, 0, 1, True),
    'glass': (0.9, 0, 0.42, False), 'lens': (0.9, 0.18, 0.55, False), 'tail': (0.7, 0.12, 1, False), 'amber': (0.7, 0.12, 1, False),
    'interior': (0.05, 0, 1, False), 'wood': (0.4, 0, 1, False), 'gauge': (0.2, 0.6, 1, False),
}
KIND_COLOR = {'chrome': '#c9ccd0', 'mirror': '#9aa3ab', 'alu': '#8c8f92', 'glass': '#1c252c', 'lens': '#d7e0e6', 'tail': '#9a1010',
              'amber': '#d9790f', 'interior': '#4a4b4d', 'black': '#202224', 'trim': '#555555', 'under': '#2a2a2a'}
# decimation (fraction of triangles kept); meshoptimizer keeps the silhouette and seams
RATIO = {'paint': 0.55, 'paint3': 0.5, 'chrome': 0.4, 'black': 0.4, 'glass': 0.5, 'interior': 0.22, 'wood': 0.3, 'gauge': 1.0}
DEFAULT_RATIO = 0.4
SKIN_TEX = 2048
ROOT = '.'


def to_hex(c):
    return '#%02x%02x%02x' % tuple(int(max(0, min(1, float(v))) * 255 + 0.5) for v in c[:3])


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def factor_color(d):
    if not d:
        return None
    st = d.get('Stages')
    st = st[0] if isinstance(st, list) and st and isinstance(st[0], dict) else {}
    for k in ('baseColorFactor', 'diffuseColor'):
        v = st.get(k, d.get(k))
        if isinstance(v, list) and len(v) >= 3:
            return to_hex(v)
        if isinstance(v, str):
            return to_hex([float(x) for x in v.split()[:3]])
    return None


def tri_indices(m):
    """Triangles per material index (handles strips and fans)."""
    out = collections.defaultdict(list)
    inds = m['inds']
    for start, n, mi in m['prims']:
        start, n, mi = int(start), int(n), int(mi) & 0xFFFFFFFF
        mat = -1 if (mi & 0x10000000) else (mi & 0x0FFFFFFF)
        ty = mi & 0xC0000000
        seg = inds[start:start + n]
        if ty == 0:
            out[mat].append(seg.reshape(-1, 3))
        elif ty == 0x40000000:
            t = [(seg[i], seg[i + 1], seg[i + 2]) if i % 2 == 0 else (seg[i + 1], seg[i], seg[i + 2]) for i in range(n - 2)]
            out[mat].append(np.array(t, dtype=np.int64).reshape(-1, 3))
        else:
            t = [(seg[0], seg[i], seg[i + 1]) for i in range(1, n - 1)]
            out[mat].append(np.array(t, dtype=np.int64).reshape(-1, 3))
    return {k: np.concatenate(v) for k, v in out.items()}


def node_matrix(s, ni):
    """Object node chain -> 4x4 (standard x, y, z, w quaternions; checked on the tilted steering-wheel node)."""
    M = np.eye(4)
    while ni >= 0:
        x, y, z, w = s['rots'][ni]
        q = np.array([x, y, z, w]); q /= np.linalg.norm(q) or 1
        x, y, z, w = q
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        L = np.eye(4); L[:3, :3] = R; L[:3, 3] = s['trans'][ni]
        M = L @ M
        ni = s['nodes'][ni][1]
    return M


def find_node(parts, sel, name):
    # selected parts first, then any part (hub parts can sit behind slot variants the resolver skips)
    for p in list(sel) + [k for k in parts if k not in sel]:
        rows = parts[p].get('nodes') or []
        for r in rows:
            if isinstance(r, list) and len(r) >= 4 and r[0] == name and all(isinstance(v, (int, float)) for v in r[1:4]):
                return [float(v) for v in r[1:4]]
    # fallback: plain text search (some jbeam files trip the tolerant parser)
    pat = re.compile(r'\[\s*"' + re.escape(name) + r'"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)')
    for f in glob.glob(os.path.join(ROOT, '**', '*.jbeam'), recursive=True):
        mm = pat.search(open(f, encoding='utf-8', errors='replace').read())
        if mm:
            return [float(v) for v in mm.groups()]
    raise SystemExit(f'node {name} not found')


def res_path(root, ref):
    """BeamNG resource path (/vehicles/<model>/x.png) -> file inside the mod folder (case-insensitive)."""
    ref = ref.replace('\\', '/').lstrip('/')
    rel = ref.split('/', 2)[2] if ref.lower().startswith('vehicles/') and ref.count('/') >= 2 else ref
    cand = os.path.join(root, rel)
    if os.path.exists(cand):
        return cand
    lo = rel.lower()
    for f in glob.glob(os.path.join(root, '**', '*'), recursive=True):
        if os.path.relpath(f, root).replace('\\', '/').lower() == lo:
            return f
    return None


def bake_skin(root, defs, pc, parts):
    """Paint design -> RGB texture: lerp(base, palette paint, weight) as BeamNG's colour palette does."""
    from PIL import Image
    design = pc['parts'].get('paint_design')
    skin = parts.get(design, {}).get('globalSkin') if design else None
    paints = [hex_rgb(to_hex(p['baseColor'])) for p in pc.get('paints', [])] or [hex_rgb('#d8d4ca')]
    while len(paints) < 3:
        paints.append(paints[-1])
    if not skin:
        return None, paints
    d = defs.get(f"{pc['model']}.skin.{skin}")
    st = (d or {}).get('Stages', [{}])[0]
    base_p, pal_p = res_path(root, st.get('baseColorMap', '')), res_path(root, st.get('colorPaletteMap', ''))
    if not base_p or not pal_p:
        print('skin textures missing; using flat paint')
        return None, paints
    base = np.asarray(Image.open(base_p).convert('RGB').resize((SKIN_TEX, SKIN_TEX), Image.LANCZOS), dtype=np.float32) / 255
    pal = np.asarray(Image.open(pal_p).convert('RGB').resize((SKIN_TEX, SKIN_TEX), Image.LANCZOS), dtype=np.float32) / 255
    w = np.clip(pal.sum(-1, keepdims=True), 0, 1)
    mix = (pal[..., :1] * paints[0] + pal[..., 1:2] * paints[1] + pal[..., 2:3] * paints[2]) / np.maximum(pal.sum(-1, keepdims=True), 1e-4)
    out = base * (1 - w) + mix * w
    buf = io.BytesIO()
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(buf, 'JPEG', quality=90)
    print(f'skin {skin}: {os.path.basename(base_p)} + palette, {len(buf.getvalue()) // 1024} KB')
    return buf.getvalue(), paints


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root'); ap.add_argument('pc'); ap.add_argument('out')
    ap.add_argument('--error', type=float, default=0.01, help='meshoptimizer relative error cap')
    a = ap.parse_args()
    root, out = a.root, a.out
    global ROOT
    ROOT = root
    work = os.path.join(os.path.dirname(os.path.abspath(out)), '_work')
    os.makedirs(work, exist_ok=True)
    pc = json.load(open(a.pc, encoding='utf-8'))
    parts = jbeam.load_parts(root)
    sel = jbeam.resolve(parts, pc['mainPartName'], pc['parts'])
    s = dts.read(glob.glob(os.path.join(root, '*.cached.dts'))[0])
    mnames = mats.material_names(s['tail'])
    defs = mats.load_material_defs(root)
    byname = {s['names'][o[0]]: o for o in s['objs']}
    skin_jpg, paints = bake_skin(root, defs, pc, parts)
    paint_hex = [to_hex(p) for p in paints]
    # hub centres (BeamNG frame: x = left, y = rear, z = up)
    fw, rw = find_node(parts, sel, 'fw1l'), find_node(parts, sel, 'rw1l')
    oy, oz = (fw[1] + rw[1]) / 2, (fw[2] + rw[2]) / 2
    want = []
    for p in sel:
        for _, m in jbeam.meshes_of(parts[p]):
            if m in byname and m not in want and not EXCLUDE.search(m):
                want.append(m)
    groups = collections.defaultdict(lambda: {'pos': [], 'nor': [], 'uv': [], 'idx': [], 'n': 0})
    for name in want:
        o = byname[name]
        m = s['meshes'][o[2]] if o[1] else None
        if m is None or m['v'] is None:
            continue
        v = np.asarray(m['v']).view('<f4').reshape(-1, 3).astype(np.float64)
        n = np.asarray(m['n']).view('<f4').reshape(-1, 3).astype(np.float64)
        # BeamNG paint designs (skins + colour palette) are laid out on the second UV set; fall back to UV0
        uvsrc = ('t2', 'nt2') if m.get('nt2') == m['nv'] else ('t', 'nt')
        uv = np.asarray(m[uvsrc[0]]).view('<f4').reshape(-1, 2) if m[uvsrc[1]] == m['nv'] else np.zeros((len(v), 2), np.float32)
        M = node_matrix(s, o[3])
        if not np.allclose(M, np.eye(4), atol=1e-5):
            v = (np.c_[v, np.ones(len(v))] @ M.T)[:, :3]
            n = n @ M[:3, :3].T
        # BeamNG -> game axes: x = -b.x, y = b.z, z = b.y
        g = np.c_[-v[:, 0], v[:, 2] - oz, v[:, 1] - oy]
        gn = np.c_[-n[:, 0], n[:, 2], n[:, 1]]
        gn /= np.maximum(np.linalg.norm(gn, axis=1, keepdims=True), 1e-9)
        inner = bool(INTERIOR.search(name))
        for mi, tris in tri_indices(m).items():
            mat = mnames[mi] if mi >= 0 else 'NONE'
            if mat in DROP_MATS:
                continue
            kind, col = KIND.get(mat, (None, None))
            if kind is None:
                kind = 'glass' if 'glass' in mat.lower() else ('interior' if inner else 'trim')
            tex = bool(skin_jpg) and mat in SKINNED
            if kind == 'paint':
                col = paint_hex[0]
            elif kind == 'paint3':
                col = paint_hex[2]
            else:
                fixed = kind in ('glass', 'lens')  # BeamNG glass factors are white (tint comes from its shader)
                col = col or (None if fixed else factor_color(defs.get(mat))) or KIND_COLOR.get(kind, '#808080')
            G = groups[(kind, col, inner, tex)]
            used = np.unique(tris)
            remap = -np.ones(len(v), dtype=np.int64); remap[used] = np.arange(len(used))
            G['pos'].append(g[used]); G['nor'].append(gn[used]); G['uv'].append(uv[used]); G['idx'].append(remap[tris][:, ::-1] + G['n'])  # x mirror flips winding: reverse it so front faces stay CCW
            G['n'] += len(used)
    # simplify every group with meshoptimizer (Node)
    man, flat = {'groups': []}, []
    for gi, (key, G) in enumerate(groups.items()):
        pos = np.concatenate(G['pos']).astype('<f4'); nor = np.concatenate(G['nor']).astype('<f4'); uv = np.concatenate(G['uv']).astype('<f4')
        idx = np.concatenate(G['idx']).astype('<u4').ravel()
        kind, _, inner, _ = key
        ratio = RATIO.get(kind, DEFAULT_RATIO) * (0.6 if inner and kind not in RATIO else 1.0)
        base = os.path.join(work, f'g{gi}')
        pos.tofile(base + '.pos'); idx.tofile(base + '.idx')
        man['groups'].append({'pos': base + '.pos', 'idx': base + '.idx', 'out': base + '.out', 'ratio': ratio, 'error': a.error})
        flat.append((key, pos, nor, uv))
    mpath = os.path.join(work, 'manifest.json')
    json.dump(man, open(mpath, 'w'))
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run(['node', os.path.join(here, 'simplify.mjs'), mpath], check=True, cwd=here)
    man = json.load(open(mpath))
    # GLB
    bin_ = bytearray(); views, accs, meshes, nodes, materials = [], [], [], [], []

    def view(data, target=None):
        while len(bin_) % 4:
            bin_.append(0)
        v = {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v); bin_.extend(data)
        return len(views) - 1

    images, textures = [], []
    if skin_jpg:
        images.append({'bufferView': view(skin_jpg), 'mimeType': 'image/jpeg'})
        textures.append({'source': 0, 'sampler': 0})
    tot_before = tot_after = 0
    for (key, pos, nor, uv), g in zip(flat, man['groups']):
        kind, col, inner, tex = key
        idx = np.fromfile(g['out'], dtype='<u4')
        tot_before += g['before']; tot_after += g['after']
        used = np.unique(idx)
        remap = np.zeros(len(pos), dtype='<u4'); remap[used] = np.arange(len(used), dtype='<u4')
        p, n, t, ii = pos[used], nor[used], uv[used], remap[idx]
        attrs = {}
        accs.append({'bufferView': view(p.tobytes(), 34962), 'componentType': 5126, 'count': len(p), 'type': 'VEC3', 'min': p.min(0).tolist(), 'max': p.max(0).tolist()})
        attrs['POSITION'] = len(accs) - 1
        accs.append({'bufferView': view(n.tobytes(), 34962), 'componentType': 5126, 'count': len(n), 'type': 'VEC3'})
        attrs['NORMAL'] = len(accs) - 1
        if tex:
            accs.append({'bufferView': view(t.tobytes(), 34962), 'componentType': 5126, 'count': len(t), 'type': 'VEC2'})
            attrs['TEXCOORD_0'] = len(accs) - 1
        accs.append({'bufferView': view(ii.tobytes(), 34963), 'componentType': 5125, 'count': len(ii), 'type': 'SCALAR'})
        gloss, emi, op, shadow = KIND_STYLE.get(kind, (0.2, 0, 1, True))
        mat = {'name': f'{kind}_{len(materials)}', 'doubleSided': True,
               'extras': {'kind': kind, 'color': col, 'gloss': gloss, 'emissive': emi, 'opacity': op, 'shadow': shadow and not inner, 'interior': inner}}
        if tex:
            mat['pbrMetallicRoughness'] = {'baseColorTexture': {'index': 0}}
        materials.append(mat)
        meshes.append({'name': kind, 'primitives': [{'attributes': attrs, 'indices': len(accs) - 1, 'material': len(materials) - 1}]})
        nodes.append({'name': f'{kind}{"_int" if inner else ""}_{len(nodes)}', 'mesh': len(meshes) - 1})
    gltf = {'asset': {'version': '2.0', 'generator': 'Tools/Models/convert.py (local only, not for distribution)'},
            'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
            'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(bin_)}],
            'extras': {'source': f"{os.path.basename(os.path.normpath(root))} / {os.path.basename(a.pc)}", 'hubF_z': fw[1] - oy, 'hubR_z': rw[1] - oy,
                       'hubY': [fw[2] - oz, rw[2] - oz], 'paints': paint_hex, 'tris': int(tot_after)}}
    if images:
        gltf.update(images=images, textures=textures, samplers=[{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}])
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    while len(bin_) % 4:
        bin_.append(0)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942)); f.write(bin_)
    shutil.rmtree(work, ignore_errors=True)
    print(f'meshes {len(want)}  groups {len(nodes)}  tris {tot_before:.0f} -> {tot_after:.0f}  {os.path.getsize(out) / 1e6:.1f} MB')
    for (key, *_), g in zip(flat, man['groups']):
        print(f'  {key[0]:9s} {key[1]:8s} int={int(key[2])} tex={int(key[3])} {g["before"]:7.0f} -> {g["after"]:7.0f}')


if __name__ == '__main__':
    main()
