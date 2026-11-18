# Tolerant jbeam (relaxed JSON) reader + BeamNG part-config resolver.
import re, os, json, glob

TOK = re.compile(r'\s+|//[^\n]*|/\*.*?\*/|"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+', re.S)


def parse(text):
    toks = [t for t in TOK.findall(text) if t.strip() and not t.startswith('//') and not t.startswith('/*') and t != ',']
    pos = 0

    def val():
        nonlocal pos
        t = toks[pos]
        pos += 1
        if t == '{':
            d = {}
            while toks[pos] != '}':
                k = val()
                if toks[pos] == ':':
                    pos += 1
                d[k] = val()
            pos += 1
            return d
        if t == '[':
            l = []
            while toks[pos] != ']':
                l.append(val())
            pos += 1
            return l
        if t.startswith('"'):
            try:
                return json.loads(t)
            except Exception:
                return t[1:-1]
        if t in ('true', 'false'):
            return t == 'true'
        if t == 'null':
            return None
        try:
            return float(t)
        except ValueError:
            return t

    out = {}
    while pos < len(toks):
        v = val()
        if isinstance(v, dict):
            out.update(v)
    return out


def load_parts(root):
    parts = {}
    for f in glob.glob(os.path.join(root, '**', '*.jbeam'), recursive=True):
        try:
            d = parse(open(f, encoding='utf-8', errors='replace').read())
        except Exception as e:
            print('jbeam parse failed', f, e)
            continue
        for k, v in d.items():
            if isinstance(v, dict):
                parts[k] = v
    return parts


def slots_of(p):
    out = []
    for key in ('slots', 'slots2'):
        rows = p.get(key)
        if not rows:
            continue
        hdr = rows[0]
        h = {n: i for i, n in enumerate(hdr)} if isinstance(hdr, list) else {}
        for r in rows[1:]:
            if isinstance(r, list) and len(r) >= 2:
                if key == 'slots2':
                    out.append((r[h.get('name', 0)], r[h.get('default', 3)] if len(r) > h.get('default', 3) else ''))
                else:
                    out.append((r[0], r[1]))
    return out


def resolve(parts, main, chosen):
    sel = []

    def walk(name):
        p = parts.get(name)
        if p is None or name in sel:
            return
        sel.append(name)
        for slot, default in slots_of(p):
            c = chosen.get(slot, default)
            if c:
                walk(c)

    walk(main)
    return sel


def meshes_of(p):
    out = []
    fb = p.get('flexbodies') or []
    for r in fb[1:]:
        if isinstance(r, list) and r and isinstance(r[0], str):
            out.append(('flex', r[0]))
    pr = p.get('props') or []
    for r in pr[1:]:
        if isinstance(r, list) and len(r) > 1 and isinstance(r[1], str):
            out.append(('prop', r[1]))
    return out
