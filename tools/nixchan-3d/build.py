# Builds the 3D Nixchan figure for /experimental and exports it as a .glb.
#
#   blender -b -P tools/nixchan-3d/build.py -- <out.glb> [preview-dir]
#
# Everything is modelled straight in three.js coordinates (y up, she faces +z, y = 0 is the seat,
# z = 0 the front edge of whatever she sits on) and exported without the y-up conversion.
# Materials are only placeholders: the page swaps them for toon materials by name, paints the
# face onto the "Face" mesh, and animates the empties "HeadPivot", "LongHair", "KneeL" and "KneeR".
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'nixchan.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

BODY_Z = -0.18
HEAD_R = 0.56
HEAD = Vector((0, 1.26, BODY_Z))
CAP_R = HEAD_R * 1.09
CAP_TALL = 1.18
# Where the hat ends, in radians down from its own crown.
RIM = math.pi * 0.45
# Tipped back so the bangs show, and a little lopsided.
BEANIE_TILT = Matrix.Rotation(-0.22, 4, 'X') @ Matrix.Rotation(-0.08, 4, 'Z')
SEAT = -HEAD.y

COLORS = {
    'Navy': '#2c2a52',
    'NavyDeep': '#22203f',
    'Hair': '#eceafc',
    'Skin': '#fde9df',
    'Ink': '#1d1b3a',
    'Cord': '#f4f3ff',
}


def linear(hex_color):
    c = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


MATS = {}
for name, hex_color in COLORS.items():
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*linear(hex_color), 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    MATS[name] = mat


# ---------- geometry helpers ----------


def on_head(around, down, r=HEAD_R):
    """A point on the head, `around` radians from the front towards +x and `down` from the crown."""
    return Vector((math.sin(down) * math.sin(around), math.cos(down), math.sin(down) * math.cos(around))) * r


def facing(normal, position=Vector()):
    """A transform whose +z points along `normal`, keeping +y as close to up as it can."""
    z = Vector(normal).normalized()
    up = Vector((0, 1, 0)) if abs(z.y) < 0.99 else Vector((0, 0, -1))
    x = up.cross(z).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = position
    return m


def catmull(points, n):
    pts = [points[0]] + points + [points[-1]]
    segs = len(points) - 1
    out = []
    for i in range(n + 1):
        t = i / n * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = pts[k], pts[k + 1], pts[k + 2], pts[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u**3))
    return out


def faces_of(verts):
    return {f for v in verts for f in v.link_faces}


def set_mat(verts, index):
    for f in faces_of(verts):
        f.material_index = index


def sphere(bm, centre, radius, scale=(1, 1, 1), mat=0, seg=(24, 16), matrix=None):
    verts = bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    m = Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1))
    if matrix is not None:
        m = matrix @ m
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    set_mat(verts, mat)
    return verts


def sweep(bm, points, radius, steps=24, mat=0):
    """A chain of spheres along a curve; a voxel remesh later melts it into one smooth limb."""
    curve = catmull(points, steps)
    for i, p in enumerate(curve):
        sphere(bm, p, radius(i / steps), mat=mat, seg=(16, 10))


def lathe(bm, profile, segments=32, zscale=1.0, centre=Vector(), mat=0):
    """A closed surface of revolution around +y. `profile` is [(radius, y), ...] from bottom to top."""
    rings = []
    for r, y in profile:
        ring = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            ring.append(bm.verts.new(centre + Vector((math.sin(a) * r, y, math.cos(a) * r * zscale))))
        rings.append(ring)
    made = []
    for lo, hi in zip(rings, rings[1:]):
        for s in range(segments):
            made.append(bm.faces.new((lo[s], lo[(s + 1) % segments], hi[(s + 1) % segments], hi[s])))
    made.append(bm.faces.new(list(reversed(rings[0]))))
    made.append(bm.faces.new(rings[-1]))
    for f in made:
        f.material_index = mat
    return [v for ring in rings for v in ring]


def torus(bm, centre, major, minor, segments=40, sides=12, yscale=1.0, mat=0, matrix=None):
    """A ring lying flat around +y."""
    rings = []
    for s in range(segments):
        a = 2 * math.pi * s / segments
        ring = []
        for k in range(sides):
            b = 2 * math.pi * k / sides
            r = major + math.cos(b) * minor
            p = Vector((math.sin(a) * r, math.sin(b) * minor * yscale, math.cos(a) * r)) + centre
            if matrix is not None:
                p = matrix @ p
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for s in range(segments):
        a, b = rings[s], rings[(s + 1) % segments]
        for k in range(sides):
            f = bm.faces.new((a[k], b[k], b[(k + 1) % sides], a[(k + 1) % sides]))
            f.material_index = mat


def ribbon(bm, points, width, thick, outward, n=28, sides=8, mat=0):
    """A flat lock of hair: a lens-shaped section, wide along the surface and thin away from it."""
    curve = catmull(points, n)
    rings = []
    for i, p in enumerate(curve):
        t = i / n
        tangent = (curve[min(i + 1, n)] - curve[max(i - 1, 0)]).normalized()
        out = outward(p)
        out = (out - tangent * out.dot(tangent)).normalized()
        side = tangent.cross(out).normalized()
        w, h = width(t), thick(t)
        rings.append([bm.verts.new(p + side * math.cos(a) * w / 2 + out * math.sin(a) * h / 2) for a in (2 * math.pi * k / sides for k in range(sides))])
    made = []
    for lo, hi in zip(rings, rings[1:]):
        for k in range(sides):
            made.append(bm.faces.new((lo[k], lo[(k + 1) % sides], hi[(k + 1) % sides], hi[k])))
    made.append(bm.faces.new(list(reversed(rings[0]))))
    made.append(bm.faces.new(rings[-1]))
    for f in made:
        f.material_index = mat


def lock_width(w0, root=0.6):
    """A chunky lock: swells out of its root, holds its width, then comes to a point."""

    def width(t):
        swell = root + (1 - root) * math.sin(min(t / 0.4, 1.0) * math.pi / 2)
        taper = 1 - max(0.0, (t - 0.5) / 0.5) ** 2.2
        return w0 * swell * taper + 0.006

    return width


def lock_thick(h0):
    return lock_width(h0, root=0.75)


def tube(bm, points, radius, n=14, sides=8, mat=0):
    r = radius if callable(radius) else (lambda t: radius)
    ribbon(bm, points, lambda t: 2 * r(t), lambda t: 2 * r(t), outward=lambda p: Vector((0.3, 0.2, 1)), n=n, sides=sides, mat=mat)


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def interpolate(table, x):
    """Piecewise-linear lookup in [(x, value), ...], sorted by x."""
    if x <= table[0][0]:
        return table[0][1]
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    return table[-1][1]


def grid(bm, rings, closed=True, mat=0):
    """Quads between consecutive rings of points; `closed` joins each ring's end to its start."""
    rings = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for lo, hi in zip(rings, rings[1:]):
        for k in range(n if closed else n - 1):
            f = bm.faces.new((lo[k], lo[(k + 1) % n], hi[(k + 1) % n], hi[k]))
            f.material_index = mat
    return rings


def face_outward(bm, centre=Vector()):
    """Point an open sheet's normals away from `centre`, so a solidify knows which way is in."""
    bm.normal_update()
    if sum(f.normal.dot(f.calc_center_median() - centre) for f in bm.faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])


# ---------- object helpers ----------


def empty(name, position=Vector(), parent=None, matrix=None):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.matrix_basis = matrix if matrix is not None else Matrix.Translation(position)
    return obj


def mesh_object(name, bm, materials, parent=None, position=Vector(), closed=True):
    me = bpy.data.meshes.new(name)
    if closed:
        # The page inks each mesh with a back-facing hull, which needs the normals to point out.
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(MATS[m])
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = position
    return obj


def modify(obj, *mods):
    for kind, settings in mods:
        mod = obj.modifiers.new(kind.lower(), kind)
        for key, value in settings.items():
            setattr(mod, key, value)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.clear()
    old = obj.data
    obj.data = me
    me.name = obj.name
    bpy.data.meshes.remove(old)
    smooth(obj)


def smooth(obj):
    obj.data.polygons.foreach_set('use_smooth', [True] * len(obj.data.polygons))


def remeshed(voxel=0.016, iterations=6):
    return [
        ('REMESH', {'mode': 'VOXEL', 'voxel_size': voxel}),
        ('LAPLACIANSMOOTH', {'iterations': iterations, 'lambda_factor': 0.8, 'use_volume_preserve': True}),
    ]


root = empty('Nixchan')

# ---------- hoodie: torso, sleeves, collar, hood and pocket melted into one ----------
bm = bmesh.new()
lathe(
    bm,
    [(0.3, 0.0), (0.41, 0.03), (0.45, 0.15), (0.44, 0.34), (0.39, 0.52), (0.3, 0.66), (0.17, 0.76), (0.08, 0.8)],
    zscale=0.8,
    centre=Vector((0, 0, BODY_Z)),
)
SLEEVE = {}
for side in (-1, 1):
    # A baggy sleeve from the shoulder, round the elbow, to paws that meet in her lap.
    path = [Vector((side * 0.28, 0.62, BODY_Z)), Vector((side * 0.41, 0.46, BODY_Z + 0.04)), Vector((side * 0.33, 0.33, BODY_Z + 0.25)), Vector((side * 0.125, 0.305, BODY_Z + 0.4))]
    sweep(bm, path, lambda t: 0.105 + 0.04 * math.sin(math.pi * min(1.0, t * 1.1)))
    SLEEVE[side] = (path[-1], (path[-1] - path[-2]).normalized())
# The kangaroo pocket.
sphere(bm, Vector((0, 0.2, BODY_Z + 0.31)), 1, scale=(0.25, 0.12, 0.065))
body = mesh_object('Body', bm, ['Navy'], parent=root)
modify(body, *remeshed(), ('DECIMATE', {'ratio': 0.3}))

# The hood: a thick collar under her chin, dipping at the front, and the rest lying on her back.
bm = bmesh.new()
torus(bm, Vector(), 0.25, 0.08, matrix=Matrix.Translation((0, 0.705, BODY_Z + 0.01)) @ Matrix.Rotation(0.22, 4, 'X'))
sphere(bm, Vector((0, 0.63, BODY_Z - 0.27)), 1, scale=(0.31, 0.22, 0.14))
hood = mesh_object('Hood', bm, ['Navy'], parent=root)
modify(hood, *remeshed(), ('DECIMATE', {'ratio': 0.3}))

# Ribbed cuffs, their own mesh so the ink line picks them out.
bm = bmesh.new()
for side in (-1, 1):
    end, along = SLEEVE[side]
    torus(bm, Vector(), 0.066, 0.036, segments=20, sides=10, yscale=0.9, matrix=facing(along, end + along * 0.05) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
cuffs = mesh_object('Cuffs', bm, ['NavyDeep'], parent=root)
smooth(cuffs)

bm = bmesh.new()
for side in (-1, 1):
    end, along = SLEEVE[side]
    palm = end + along * 0.1 + Vector((0, -0.01, 0.035))
    sphere(bm, palm, 1, scale=(0.07, 0.055, 0.075), seg=(16, 10))
    sphere(bm, palm + Vector((-side * 0.03, 0.035, 0.03)), 0.03, seg=(12, 8))
hands = mesh_object('Hands', bm, ['Skin'], parent=root)
smooth(hands)

# Drawstrings either side of the snowflake, each ending in a stubby tip.
bm = bmesh.new()
for side in (-1, 1):
    pts = [Vector((side * 0.085, 0.66, BODY_Z + 0.27)), Vector((side * 0.12, 0.58, BODY_Z + 0.318)), Vector((side * 0.145, 0.47, BODY_Z + 0.352)), Vector((side * 0.15, 0.38, BODY_Z + 0.375))]
    tube(bm, pts, lambda t: 0.013 if t < 0.8 else 0.021, n=20)
cords = mesh_object('Cords', bm, ['Cord'], parent=root)
smooth(cords)

flake_chest = empty('FlakeChest', parent=root, matrix=facing((0, 0.2, 1), Vector((0, 0.47, BODY_Z + 0.352))))

# ---------- legs: thighs on the seat, shins and sneakers swinging from the knees ----------
bm = bmesh.new()
for side in (-1, 1):
    sweep(bm, [Vector((side * 0.16, 0.135, BODY_Z - 0.05)), Vector((side * 0.165, 0.135, BODY_Z + 0.37))], lambda t: 0.14, steps=12)
legs = mesh_object('Legs', bm, ['Navy'], parent=root)
modify(legs, *remeshed(), ('DECIMATE', {'ratio': 0.3}))

SHOE = Vector((0, -0.475, 0.065))
SHOE_SIZE = Vector((0.108, 0.078, 0.172))


def instep(x, z):
    """The height of the shoe's upper at (x, z), for laying the laces on it."""
    d = 1 - (x / SHOE_SIZE.x) ** 2 - ((z - SHOE.z) / SHOE_SIZE.z) ** 2
    return SHOE.y + SHOE_SIZE.y * math.sqrt(max(d, 0.0))


for side, name in ((-1, 'KneeL'), (1, 'KneeR')):
    knee = empty(name, Vector((side * 0.165, 0.135, BODY_Z + 0.36)), parent=root)
    # Joggers: loose down the shin, gathered into a cuff at the ankle.
    bm = bmesh.new()
    sweep(bm, [Vector((0, 0, 0)), Vector((0, -0.18, 0.005)), Vector((0, -0.33, 0))], lambda t: 0.118 + 0.014 * math.sin(math.pi * t), steps=14)
    torus(bm, Vector((0, -0.36, 0)), 0.062, 0.05, segments=20, sides=10)
    shin = mesh_object(name + 'Shin', bm, ['Navy'], parent=knee)
    modify(shin, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.25}))

    bm = bmesh.new()
    sphere(bm, SHOE, 1, scale=SHOE_SIZE)
    sphere(bm, Vector((0, -0.425, -0.005)), 0.098)
    upper = mesh_object(name + 'Shoe', bm, ['NavyDeep'], parent=knee)
    modify(upper, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.25}))

    # The white rubber: a toe cap and a sole a little wider than the upper.
    bm = bmesh.new()
    sphere(bm, Vector((0, -0.492, 0.172)), 1, scale=(0.1, 0.062, 0.078), seg=(20, 12))
    lathe(bm, [(0.085, -0.572), (0.112, -0.562), (0.118, -0.535), (0.112, -0.512), (0.09, -0.505)], segments=28, zscale=1.62, centre=Vector((0, 0, 0.068)))
    rubber = mesh_object(name + 'Rubber', bm, ['Cord'], parent=knee)
    smooth(rubber)

    bm = bmesh.new()
    for z in (0.085, 0.118, 0.151):
        tube(bm, [Vector((x, instep(x, z) + 0.006, z + abs(x) * 0.15)) for x in (-0.062, -0.032, 0, 0.032, 0.062)], 0.0095, n=8, sides=6)
    laces = mesh_object(name + 'Laces', bm, ['Cord'], parent=knee)
    smooth(laces)

# ---------- head ----------
head = empty('HeadPivot', HEAD, parent=root)
bm = bmesh.new()
verts = sphere(bm, Vector(), HEAD_R, scale=(1.04, 0.97, 1), seg=(64, 40))
for v in verts:
    # Fuller cheeks and a softer chin than a plain ball.
    d = v.co.normalized()
    if d.y < 0:
        low = -d.y
        v.co.x *= 1 + 0.05 * math.sin(math.pi * min(1.0, low * 1.6)) * max(0.0, d.z)
        v.co.y *= 1 - 0.05 * low
face = mesh_object('Face', bm, ['Skin'], parent=head)
smooth(face)


def cap_point(around, polar, r=CAP_R):
    """A point on the hat, in the hat's own untilted frame."""
    return Vector((math.sin(polar) * math.sin(around) * r, math.cos(polar) * r * CAP_TALL + 0.02, math.sin(polar) * math.cos(around) * r))


def rim(around):
    """The hat hangs a little lower over her ears than a flat cut would."""
    return RIM + 0.07 * math.sin(around) ** 2


# The hair over the back and sides of the skull, open where the face is.
bm = bmesh.new()
verts = sphere(bm, Vector(), HEAD_R * 1.03, seg=(48, 30))
doomed = []
# The hat is tipped and lopsided, so its rim has to be found in the hat's own frame.
untilt = BEANIE_TILT.inverted().to_3x3()
for v in verts:
    d = v.co.normalized()
    h = untilt @ d
    under_cap = math.acos(max(-1, min(1, h.y))) < rim(math.atan2(h.x, h.z)) - 0.1
    around = math.atan2(d.x, d.z)
    down = math.acos(max(-1, min(1, d.y)))
    # Anything the hat covers would only poke through it.
    if under_cap or down > 2.25 or (abs(around) < 1.05 and down > 0.85):
        doomed.append(v)
bmesh.ops.delete(bm, geom=doomed, context='VERTS')
face_outward(bm)
shell = mesh_object('HairShell', bm, ['Hair'], parent=head, closed=False)
modify(shell, ('SOLIDIFY', {'thickness': 0.04, 'offset': 1}))

# Bangs: chunky locks following the skull from under the hat to the eyes.
bm = bmesh.new()
bangs = [
    # around, tip (radians below the equator), curl, width
    (-1.02, 0.72, 0.1, 0.27),
    (-0.8, 0.22, 0.06, 0.3),
    (-0.52, -0.1, 0.08, 0.3),
    (-0.25, -0.08, 0.12, 0.29),
    (0.0, 0.2, 0.1, 0.25),
    (0.26, -0.1, -0.06, 0.29),
    (0.52, -0.07, -0.08, 0.3),
    (0.8, 0.22, -0.06, 0.3),
    (1.02, 0.72, -0.1, 0.27),
]
for around, reach, curl, w in bangs:
    pts = []
    start, end = 1.0, math.pi / 2 + reach
    for i in range(7):
        t = i / 6
        # Starts tucked inside the hat, then lifts off the skull.
        lift = 0.95 + 0.09 * min(1.0, t * 2.5) + 0.07 * math.sin(math.pi * t) + (0.05 * t if reach > 0.15 else 0)
        pts.append(on_head(around + curl * t * t, start + (end - start) * t, HEAD_R * lift))
    ribbon(bm, pts, lock_width(w, root=0.85), lock_thick(0.085), outward=lambda p: p.copy(), n=16)
bangs_obj = mesh_object('Bangs', bm, ['Hair'], parent=head)
smooth(bangs_obj)

# ---------- long hair: trails the head a little when she turns ----------
long_hair = empty('LongHair', HEAD, parent=root)
horizontal = lambda p: Vector((p.x, 0, p.z)) if Vector((p.x, 0, p.z)).length > 1e-4 else Vector((0, 0, -1))
# How far the mass of hair stands out from the head's axis on its way down to the seat.
MASS = [(-1.08, 0.6), (-0.98, 0.7), (-0.85, 0.75), (-0.6, 0.71), (-0.3, 0.655), (-0.1, 0.62), (0.05, 0.585), (0.14, 0.542)]


def mass_r(y):
    return interpolate(MASS, y)


# One thick sheet behind her, so no gaps open between the locks.
bm = bmesh.new()
rows = []
for j in range(18):
    y = 0.14 + (-1.08 - 0.14) * j / 17
    gap = 1.12 + 0.2 * smoothstep(-0.4, -0.75, y)
    rows.append([Vector((math.sin(a) * mass_r(y), y, math.cos(a) * mass_r(y))) for a in (gap + (2 * math.pi - 2 * gap) * i / 44 for i in range(45))])
grid(bm, rows, closed=False)
face_outward(bm)
back = mesh_object('HairBack', bm, ['Hair'], parent=long_hair, closed=False)
modify(back, ('SOLIDIFY', {'thickness': 0.07, 'offset': -1}))


def long_lock(bm, around, y_end, lift, flick, wave, width, phase=0.0):
    """A lock from under the hat down over the mass, kicking out and up at its tip."""
    # It stays inside the mass until it is clear of the hat, so the band meets one smooth surface.
    pts = [on_head(around, 1.1, HEAD_R * 0.94), on_head(around, 1.45, HEAD_R * 0.97)]
    y0 = pts[-1].y
    for k in range(1, 8):
        t = k / 7
        kick = smoothstep(0.55, 1.0, t) ** 2
        y = y0 + (y_end - y0) * t + flick * 0.45 * smoothstep(0.8, 1.0, t)
        r = mass_r(y) - 0.05 + (lift + 0.05) * smoothstep(0.08, 0.32, t) + flick * kick
        b = around + wave * math.sin(t * math.pi * 1.6 + phase) * t
        pts.append(Vector((math.sin(b) * r, y, math.cos(b) * r)))
    ribbon(bm, pts, lock_width(width), lock_thick(0.115), outward=horizontal, n=18)


bm = bmesh.new()
# The long layer reaches the seat; a shorter layer over it flares out around her shoulders.
long_layer = [(1.45, 0.1, 0.16, 0.5), (1.9, 0.02, 0.13, 2.0), (2.35, 0.08, 0.17, 3.4), (2.8, 0.0, 0.12, 5.0)]
short_layer = [(1.26, 0.52, 0.2, 1.0), (1.68, 0.38, 0.22, 2.6), (2.12, 0.46, 0.19, 4.1), (2.58, 0.34, 0.23, 0.2), (3.0, 0.42, 0.2, 1.7)]
for side in (-1, 1):
    for a, up, flick, phase in long_layer:
        long_lock(bm, side * a, SEAT + 0.05 + up, 0.03, flick, side * 0.1, 0.4, phase)
    for a, up, flick, phase in short_layer:
        long_lock(bm, side * a, SEAT + up, 0.085, flick, -side * 0.12, 0.34, phase)
long_lock(bm, math.pi, SEAT + 0.07, 0.03, 0.14, 0.08, 0.42)
# Locks framing the face and falling in front of her shoulders.
for side in (-1, 1):
    pts = [
        on_head(side * 0.98, 1.2, HEAD_R * 0.97),
        on_head(side * 1.05, 1.62, HEAD_R * 1.09),
        on_head(side * 1.1, 2.0, HEAD_R * 1.1),
        Vector((side * 0.57, -0.55, 0.27)),
        Vector((side * 0.6, -0.8, 0.28)),
        Vector((side * 0.63, -0.98, 0.31)),
        Vector((side * 0.72, -1.05, 0.37)),
    ]
    ribbon(bm, pts, lock_width(0.25), lock_thick(0.1), outward=lambda p: horizontal(p).normalized() + Vector((0, 0, 0.4)), n=18)
    pts = [
        on_head(side * 1.14, 1.25, HEAD_R * 0.97),
        on_head(side * 1.2, 1.7, HEAD_R * 1.12),
        Vector((side * 0.64, -0.3, 0.2)),
        Vector((side * 0.7, -0.52, 0.2)),
        Vector((side * 0.84, -0.6, 0.22)),
    ]
    ribbon(bm, pts, lock_width(0.22), lock_thick(0.09), outward=lambda p: horizontal(p).normalized() + Vector((0, 0, 0.3)), n=16)
locks = mesh_object('Locks', bm, ['Hair'], parent=long_hair)
smooth(locks)

# ---------- cat-ear hat ----------
bm = bmesh.new()
rows = [[cap_point(2 * math.pi * s / 48, rim(2 * math.pi * s / 48) * j / 12) for s in range(48)] for j in range(1, 13)]
rings = grid(bm, rows)
crown = bm.verts.new(cap_point(0, 0))
for s in range(48):
    bm.faces.new((crown, rings[0][s], rings[0][(s + 1) % 48]))
# Closed underneath, where the head and the band hide it.
bm.faces.new(rings[-1])
cap = mesh_object('BeanieCap', bm, ['Navy'], parent=head)
smooth(cap)
cap.data.transform(BEANIE_TILT)

# The turned-up band round its edge: a flat roll lying on the hat.
bm = bmesh.new()
rows = []
for s in range(56):
    a = 2 * math.pi * s / 56
    polar = rim(a) - 0.09
    centre = cap_point(a, polar, CAP_R + 0.012)
    down = (cap_point(a, polar + 0.01) - cap_point(a, polar - 0.01)).normalized()
    out = (centre - Vector((0, 0.02, 0))).normalized()
    squarish = lambda x: math.copysign(abs(x) ** 0.6, x)
    rows.append([BEANIE_TILT @ (centre + down * squarish(math.cos(b)) * 0.085 + out * squarish(math.sin(b)) * 0.045) for b in (2 * math.pi * k / 12 for k in range(12))])
rows.append(rows[0])
grid(bm, rows)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
rim_obj = mesh_object('BeanieRim', bm, ['NavyDeep'], parent=head)
smooth(rim_obj)


def ear(bm, base, height, flat, matrix):
    rows = []
    for j in range(10):
        t = j / 9
        r = base * (1 - t) ** 0.8 + 0.014
        rows.append([matrix @ Vector((math.sin(a) * r, t * height, math.cos(a) * r * flat)) for a in (2 * math.pi * k / 20 for k in range(20))])
    rings = grid(bm, rows)
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


for name, mat, base, height, forward in (('BeanieEars', 'Navy', 0.36, 0.56, 0.0), ('BeanieEarsInner', 'Navy', 0.245, 0.45, 0.052)):
    bm = bmesh.new()
    for side in (-1, 1):
        ear(bm, base, height, 0.4, BEANIE_TILT @ Matrix.Translation((side * 0.33, 0.36, -0.02 + forward)) @ Matrix.Rotation(-side * 0.42, 4, 'Z'))
    smooth(mesh_object(name, bm, [mat], parent=head))

flake_at = cap_point(0.55, 0.93, CAP_R * 1.02)
empty('FlakeHat', parent=head, matrix=BEANIE_TILT @ facing(flake_at - Vector((0, 0.02, 0)), flake_at))

# The X hairpin on her right, just under the band.
bm = bmesh.new()
# Clear of the bangs, which ride up to about 1.15 head radii here.
pin_at = on_head(0.8, 1.5, HEAD_R * 1.2)
orient = facing(pin_at, pin_at)
for spin in (math.pi / 4, -math.pi / 4):
    verts = bmesh.ops.create_cube(bm, size=1)['verts']
    bmesh.ops.transform(bm, matrix=orient @ Matrix.Rotation(spin, 4, 'Z') @ Matrix.Diagonal((0.27, 0.042, 0.035, 1)), verts=verts)
pin = mesh_object('Pin', bm, ['Ink'], parent=head)

# ---------- export ----------
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_yup=False,
    export_apply=True,
    export_texcoords=False,
    export_normals=True,
    export_materials='EXPORT',
)
tris = sum(len(f.vertices) - 2 for o in scene.objects if o.type == 'MESH' for f in o.data.polygons)
print(f'nixchan: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

# ---------- previews, for checking the shape ----------
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 560
    scene.render.resolution_y = 640
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.56, 0.7, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.matrix_world = facing((-0.5, 1, 0.8))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 85
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0.85, BODY_Z))
    views = (
        ('front', (0, 1.1, 7), target),
        ('three-quarter', (5, 1.8, 5), target),
        ('side', (7, 1.0, BODY_Z), target),
        ('back', (-3.5, 1.4, -6), target),
        ('head-left', (-2.8, 2.6, 3.8), HEAD),
        ('head-right', (2.8, 2.6, 3.8), HEAD),
    )
    for name, at, look in views:
        pos = Vector(at)
        cam.matrix_world = facing(pos - look, pos)
        scene.render.filepath = os.path.join(PREVIEW, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'nixchan: previews in {PREVIEW}')
