# Torque3D DTS v26 reader (BeamNG cached.dts). Reads nodes, objects, meshes (standard), names, materials.
import struct, sys, numpy as np

class Alloc:
    def __init__(s, buf, start16, start8):
        s.b32 = np.frombuffer(buf, dtype='<i4', count=start16)
        s.b16 = np.frombuffer(buf, dtype='<i2', offset=start16*4, count=(start8-start16)*2)
        s.b8 = np.frombuffer(buf, dtype='<i1', offset=start8*4)
        s.p32 = s.p16 = s.p8 = 0
        s.g = 0
    def i32(s, n=None):
        if n is None:
            v = int(s.b32[s.p32]); s.p32 += 1; return v
        v = s.b32[s.p32:s.p32+n]; s.p32 += n; return v
    def f32(s, n=None):
        if n is None:
            return float(s.i32(1).view('<f4')[0])
        return s.i32(n).view('<f4')
    def i16(s, n):
        v = s.b16[s.p16:s.p16+n]; s.p16 += n; return v
    def i8(s, n):
        v = s.b8[s.p8:s.p8+n]; s.p8 += n; return v
    def guard(s, where=''):
        a = int(s.b32[s.p32]); b = int(s.b16[s.p16]); c = int(s.b8[s.p8])
        s.p32 += 1; s.p16 += 1; s.p8 += 1
        ok = (a == s.g and b == (s.g & 0xffff if s.g < 32768 else s.g - 65536) and (c & 0xff) == (s.g & 0xff))
        if not ok:
            raise RuntimeError(f'guard {s.g} failed at {where}: {a} {b} {c} (p32={s.p32})')
        s.g += 1

def read_mesh(a, mtype, meshes):
    t = mtype & 0xff
    if t == 4:  # null
        return None
    if t not in (0, 1, 3):
        raise RuntimeError(f'mesh type {mtype:#x}')
    a.guard('mesh start')
    numFrames = a.i32(); numMatFrames = a.i32(); parent = a.i32()
    a.f32(6); a.f32(3); a.f32(1)
    def shared32(n, key):
        if parent < 0:
            return a.i32(n)
        return meshes[parent][key] if meshes[parent] else None
    def shared8(n, key):
        if parent < 0:
            return a.i8(n)
        return None
    nv = a.i32(); verts = shared32(3*nv, 'v')
    nt = a.i32(); tv = shared32(2*nt, 't')
    nt2 = a.i32(); tv2 = shared32(2*nt2, 't2')
    nc = a.i32(); cols = shared32(nc, 'c')
    norms = shared32(3*nv, 'n')
    shared8(nv, 'en')
    np_ = a.i32(); prims = a.i32(3*np_)
    ni = a.i32(); inds = a.i32(ni)
    nm = a.i32(); a.i16(nm)
    vpf = a.i32(); flags = a.i32()
    a.guard('mesh end')
    m = dict(type=t, v=verts, t=tv, t2=tv2, c=cols, n=norms, nv=nv, nt=nt, nt2=nt2, prims=prims.copy().reshape(-1, 3), inds=inds.copy(), parent=parent, vpf=vpf, frames=numFrames, flags=flags)
    if t == 1:
        sz = a.i32(); shared32(3*sz, 'iv')
        shared32(3*sz, 'in'); shared8(sz, 'ien')
        sz = a.i32(); shared32(16*sz, 'it')
        sz = a.i32(); shared32(sz, 'vi'); shared32(sz, 'bi'); shared32(sz, 'w')
        sz = a.i32(); shared32(sz, 'ni')
        a.guard('skin end')
    if t == 3:
        raise RuntimeError('sorted mesh not supported')
    return m

def read(path):
    data = open(path, 'rb').read()
    ver, size, s16, s8 = struct.unpack_from('<iiii', data, 0)
    print('version', ver & 0xffff, 'exporter', ver >> 16, 'words', size, s16, s8)
    buf = data[16:16 + size*4]
    a = Alloc(buf, s16, s8)
    nNodes, nObjects, nDecals, nSub, nIfl = a.i32(5)
    nRot, nTrans, nUS, nAS, nArbS = a.i32(5)
    nGround, nObjStates, nDecalStates, nTrig, nDetails, nMeshes, nNames = a.i32(7)
    a.i32(2)
    a.guard('counts')
    print(dict(nodes=nNodes, objects=nObjects, decals=nDecals, sub=nSub, ifl=nIfl, meshes=nMeshes, names=nNames, details=nDetails))
    a.f32(1); a.f32(1); a.f32(3); bounds = a.f32(6)
    a.guard('bounds')
    nodes = a.i32(nNodes*5).reshape(-1, 5); a.guard('nodes')
    objs = a.i32(nObjects*6).reshape(-1, 6); a.guard('objects')
    a.i32(nDecals*5); a.guard('decals')
    a.i32(nIfl*5); a.guard('ifl')
    a.i32(nSub*3); a.guard('sub1')
    a.i32(nSub*3); a.guard('sub2')
    rots = a.i16(nNodes*4).reshape(-1, 4).astype(np.float64) / 32767.0
    trans = a.f32(nNodes*3).reshape(-1, 3).copy()
    a.f32(nTrans*3); a.i16(nRot*4)
    a.guard('default trs')
    a.f32(nUS); a.f32(nAS*3); a.f32(nArbS*3); a.i16(nArbS*4); a.guard('scales')
    a.f32(nGround*3); a.i16(nGround*4); a.guard('ground')
    a.i32(nObjStates*3); a.guard('objstates')
    a.i32(nDecalStates); a.guard('decalstates')
    a.i32(nTrig*2); a.guard('triggers')
    # details: try 13 ints (v26) else 7
    p = (a.p32, a.p16, a.p8)
    try:
        dets = a.i32(nDetails*13).reshape(-1, 13); a.guard('details')
    except RuntimeError:
        a.p32, a.p16, a.p8 = p
        dets = a.i32(nDetails*7).reshape(-1, 7); a.guard('details7')
    meshes = []
    for i in range(nMeshes):
        mt = a.i32()
        try:
            meshes.append(read_mesh(a, mt, meshes))
        except Exception as e:
            print('mesh', i, 'failed', e); raise
    a.guard('meshes')
    names = []
    raw = a.b8[a.p8:].tobytes()
    off = 0
    for i in range(nNames):
        e = raw.index(b'\0', off); names.append(raw[off:e].decode('latin1')); off = e + 1
    a.p8 += off
    # material list after the buffer: find it by scanning the trailing bytes for name strings
    tail = data[16 + size*4:]
    return dict(nodes=nodes, objs=objs, rots=rots, trans=trans, dets=dets, meshes=meshes, names=names, bounds=bounds, tail=tail)

if __name__ == '__main__':
    s = read(sys.argv[1])
    print('details', [(s['names'][d[0]], d[1], d[2], round(float(np.array([d[3]]).view('<f4')[0]),1)) for d in s['dets']])
    print('objects', len(s['objs']), 'tail bytes', len(s['tail']))
    tot = 0
    for o in s['objs'][:20]:
        print(s['names'][o[0]], 'nmesh', o[1], 'start', o[2], 'node', o[3])
    for o in s['objs']:
        m = s['meshes'][o[2]] if o[1] > 0 else None
        if m: tot += len(m['inds'])//3
    print('detail0 tris approx', tot)
