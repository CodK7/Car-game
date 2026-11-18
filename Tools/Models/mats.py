# Material list from the DTS tail + BeamNG *.materials.json lookup.
import struct, json, glob, os, re
import jbeam


def material_names(tail):
    nseq = struct.unpack_from('<i', tail, 0)[0]
    assert nseq == 0, 'sequences present'
    off = 4
    ver = tail[off]; off += 1
    n = struct.unpack_from('<i', tail, off)[0]; off += 4
    names = []
    for _ in range(n):
        l = tail[off]; off += 1
        names.append(tail[off:off + l].decode('latin1')); off += l
    return names


def load_material_defs(root):
    defs = {}
    for f in glob.glob(os.path.join(root, '**', '*.materials.json'), recursive=True):
        try:
            d = jbeam.parse(open(f, encoding='utf-8', errors='replace').read())
        except Exception as e:
            print('materials parse failed', f, e)
            continue
        for k, v in d.items():
            if isinstance(v, dict):
                name = v.get('mapTo', v.get('name', k))
                v['_file'] = f
                defs[name] = v
                defs.setdefault(k, v)
    return defs
