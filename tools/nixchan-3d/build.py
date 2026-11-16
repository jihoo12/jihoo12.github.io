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
# Tipped back so the bangs show, and a little lopsided.
BEANIE_TILT = Matrix.Rotation(-0.2, 4, 'X') @ Matrix.Rotation(-0.08, 4, 'Z')

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


def lock_width(w0):
    return lambda t: w0 * (1 - t**1.7) * (0.8 + 0.4 * math.sin(math.pi * t)) + 0.004


def lock_thick(h0):
    return lambda t: h0 * (1 - t**1.5) + 0.004


# ---------- object helpers ----------


def empty(name, position=Vector(), parent=None, matrix=None):
    obj = bpy.data.objects.new(name, None)
    scene.collection.objects.link(obj)
    obj.parent = parent
    obj.matrix_basis = matrix if matrix is not None else Matrix.Translation(position)
    return obj


def mesh_object(name, bm, materials, parent=None, position=Vector()):
    me = bpy.data.meshes.new(name)
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

# ---------- hoodie and legs, melted into one ----------
bm = bmesh.new()
lathe(
    bm,
    [(0.3, 0.0), (0.4, 0.03), (0.44, 0.16), (0.44, 0.34), (0.39, 0.52), (0.3, 0.66), (0.17, 0.76), (0.08, 0.8)],
    zscale=0.8,
    centre=Vector((0, 0, BODY_Z)),
)
for side in (-1, 1):
    # A baggy sleeve from the shoulder, round the elbow, to a hand on the knee.
    sweep(
        bm,
        [Vector((side * 0.28, 0.62, BODY_Z)), Vector((side * 0.4, 0.46, BODY_Z + 0.04)), Vector((side * 0.34, 0.33, BODY_Z + 0.24)), Vector((side * 0.2, 0.3, BODY_Z + 0.4))],
        lambda t: 0.1 + 0.035 * math.sin(math.pi * min(1.0, t * 1.15)),
    )
    # Thighs, reaching just past the front edge.
    sweep(bm, [Vector((side * 0.16, 0.13, BODY_Z - 0.05)), Vector((side * 0.165, 0.13, BODY_Z + 0.37))], lambda t: 0.135, steps=12)
# The hood, lying on her back, and the kangaroo pocket.
sphere(bm, Vector((0, 0.66, BODY_Z - 0.24)), 1, scale=(0.3, 0.2, 0.13))
torus(bm, Vector((0, 0.74, BODY_Z)), 0.22, 0.085)
sphere(bm, Vector((0, 0.2, BODY_Z + 0.31)), 1, scale=(0.24, 0.12, 0.06))
body = mesh_object('Body', bm, ['Navy'], parent=root)
modify(body, *remeshed(), ('DECIMATE', {'ratio': 0.45}))

bm = bmesh.new()
for side in (-1, 1):
    top = Vector((side * 0.065, 0.66, BODY_Z + 0.31))
    sweep(bm, [top, top + Vector((0, -0.2, 0.06))], lambda t: 0.013, steps=8)
    sphere(bm, Vector((side * 0.065, 0.45, BODY_Z + 0.38)), 0.026, seg=(12, 8))
cords = mesh_object('Cords', bm, ['Cord'], parent=root)
modify(cords, ('REMESH', {'mode': 'VOXEL', 'voxel_size': 0.006}), ('DECIMATE', {'ratio': 0.3}))

bm = bmesh.new()
for side in (-1, 1):
    sphere(bm, Vector((side * 0.16, 0.29, BODY_Z + 0.43)), 1, scale=(0.085, 0.06, 0.08))
    sphere(bm, Vector((side * 0.1, 0.3, BODY_Z + 0.43)), 0.032)
hands = mesh_object('Hands', bm, ['Skin'], parent=root)
modify(hands, ('REMESH', {'mode': 'VOXEL', 'voxel_size': 0.008}), ('LAPLACIANSMOOTH', {'iterations': 4, 'lambda_factor': 0.8}), ('DECIMATE', {'ratio': 0.4}))

for side, name in ((-1, 'KneeL'), (1, 'KneeR')):
    knee = empty(name, Vector((side * 0.165, 0.13, BODY_Z + 0.36)), parent=root)
    bm = bmesh.new()
    sweep(bm, [Vector((0, 0, 0)), Vector((0, -0.2, 0)), Vector((0, -0.38, 0))], lambda t: 0.11 - 0.015 * t, steps=14)
    shin = mesh_object(name + 'Shin', bm, ['Navy'], parent=knee)
    modify(shin, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.4}))
    bm = bmesh.new()
    sphere(bm, Vector((0, -0.44, 0.05)), 1, scale=(0.11, 0.085, 0.16))
    sphere(bm, Vector((0, -0.4, 0.0)), 0.1)
    shoe = mesh_object(name + 'Shoe', bm, ['Ink'], parent=knee)
    modify(shoe, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.4}))

flake_chest = empty('FlakeChest', parent=root, matrix=facing((0, 0.2, 1), Vector((0, 0.42, BODY_Z + 0.355))))

# ---------- head ----------
head = empty('HeadPivot', HEAD, parent=root)
bm = bmesh.new()
sphere(bm, Vector(), HEAD_R, scale=(1.03, 0.98, 1), seg=(64, 40))
face = mesh_object('Face', bm, ['Skin'], parent=head)
smooth(face)

# The hair over the back and sides of the head, open where the face is.
bm = bmesh.new()
verts = sphere(bm, Vector(), HEAD_R * 1.03, seg=(56, 36))
doomed = []
# The beanie is tipped and lopsided, so its rim has to be found in the beanie's own frame.
untilt = BEANIE_TILT.inverted().to_3x3()
for v in verts:
    d = v.co.normalized()
    under_cap = math.acos(max(-1, min(1, (untilt @ d).y))) < math.pi * 0.43 - 0.08
    around = math.atan2(d.x, d.z)
    down = math.acos(max(-1, min(1, d.y)))
    # Anything the beanie covers would only poke through it.
    if under_cap or down > 2.25 or (abs(around) < 1.05 and down > 0.85):
        doomed.append(v)
bmesh.ops.delete(bm, geom=doomed, context='VERTS')
shell = mesh_object('HairShell', bm, ['Hair'], parent=head)
modify(shell, ('SOLIDIFY', {'thickness': 0.04, 'offset': 1}), ('SUBSURF', {'levels': 1}))

# Bangs: flat locks following the skull from under the beanie to just above the eyes.
bm = bmesh.new()
bangs = [
    # around, tip (radians below the equator), curl, width
    (-1.05, 0.66, 0.14, 0.26),
    (-0.86, 0.34, 0.1, 0.27),
    (-0.68, 0.12, 0.12, 0.28),
    (-0.5, 0.02, 0.06, 0.27),
    (-0.32, 0.08, 0.1, 0.27),
    (-0.15, -0.03, -0.05, 0.26),
    (0.02, 0.06, 0.07, 0.27),
    (0.19, -0.02, -0.08, 0.26),
    (0.36, 0.09, -0.06, 0.27),
    (0.54, 0.03, -0.1, 0.28),
    (0.72, 0.16, -0.1, 0.28),
    (0.89, 0.36, -0.12, 0.27),
    (1.06, 0.64, -0.14, 0.26),
]
for around, reach, curl, w in bangs:
    pts = []
    start, end = 1.0, math.pi / 2 + reach
    for i in range(7):
        t = i / 6
        # Starts tucked inside the beanie, then lifts off the skull.
        lift = 0.95 + 0.09 * min(1.0, t * 2.5) + 0.07 * math.sin(math.pi * t) + (0.05 * t if reach > 0.3 else 0)
        pts.append(on_head(around + curl * t * t, start + (end - start) * t, HEAD_R * lift))
    ribbon(bm, pts, lock_width(w), lock_thick(0.075), outward=lambda p: p.copy())
bangs_obj = mesh_object('Bangs', bm, ['Hair'], parent=head)
modify(bangs_obj, ('SUBSURF', {'levels': 1}), ('DECIMATE', {'ratio': 0.6}))

# ---------- long hair: trails the head a little when she turns ----------
long_hair = empty('LongHair', HEAD, parent=root)
bm = bmesh.new()
seat = -HEAD.y
horizontal = lambda p: Vector((p.x, 0, p.z)) if Vector((p.x, 0, p.z)).length > 1e-4 else Vector((0, 0, -1))
for layer, (radius, angles) in enumerate(((0.8, [1.15, 1.4, 1.65, 1.9, 2.15, 2.4, 2.65, 2.9]), (0.9, [1.28, 1.52, 1.78, 2.02, 2.28, 2.52, 2.8, 3.05]))):
    for side in (-1, 1):
        for i, a in enumerate(angles):
            around = side * a
            end = seat + 0.08 + ((i + layer) % 3) * 0.1
            pts = [on_head(around, 1.05, HEAD_R * 0.93), on_head(around, math.pi / 2, HEAD_R * 1.06)]
            top = -HEAD_R * 0.5
            for k in range(1, 7):
                t = k / 6
                y = top + (end - top) * t
                r = HEAD_R * (1.06 + 0.12 * math.sin(math.pi * min(1.0, t * 1.4))) + (radius - HEAD_R) * t * t + layer * 0.05
                wave = math.sin(t * math.pi * 2.6 + around * 3 + layer) * 0.13 * t
                r += math.sin(t * math.pi * 3 + around * 5) * 0.04 * t
                b = around + wave
                pts.append(Vector((math.sin(b) * r, y, math.cos(b) * r)))
            ribbon(bm, pts, lock_width(0.26 - layer * 0.03), lock_thick(0.07), outward=horizontal)
# One lock down the middle of the back.
pts = [on_head(math.pi, 1.05, HEAD_R * 0.93), on_head(math.pi, math.pi / 2, HEAD_R * 1.06)] + [Vector((0, -HEAD_R * 0.5 + (seat + 0.15 + HEAD_R * 0.5) * k / 6, -0.6 - 0.04 * k / 6)) for k in range(1, 7)]
ribbon(bm, pts, lock_width(0.3), lock_thick(0.07), outward=horizontal)
# Locks framing the face, hanging in front of the shoulders.
for side in (-1, 1):
    for j, (a, drop) in enumerate(((0.98, 0.95), (1.12, 0.82))):
        pts = [
            on_head(side * a, 1.25, HEAD_R * 0.95),
            on_head(side * (a + 0.02), 1.65, HEAD_R * 1.06),
            on_head(side * (a + 0.05), 2.05, HEAD_R * 1.07),
            Vector((side * (0.46 + j * 0.06), -0.62, 0.2 - j * 0.06)),
            Vector((side * (0.44 + j * 0.08), -drop, 0.22 - j * 0.06)),
        ]
        ribbon(bm, pts, lock_width(0.17), lock_thick(0.05), outward=lambda p, s=side: Vector((p.x, 0, p.z)).normalized() + Vector((0, 0, 0.3)))
locks = mesh_object('Locks', bm, ['Hair'], parent=long_hair)
modify(locks, ('SUBSURF', {'levels': 1}), ('DECIMATE', {'ratio': 0.5}))

# ---------- beanie with cat ears ----------
bm = bmesh.new()
verts = sphere(bm, Vector((0, 0.02, 0)), CAP_R, seg=(56, 36))
bmesh.ops.delete(bm, geom=[v for v in verts if (v.co.y - 0.02) / CAP_R < math.cos(math.pi * 0.44)], context='VERTS')
cap = mesh_object('BeanieCap', bm, ['Navy'], parent=head)
modify(cap, ('SOLIDIFY', {'thickness': 0.035, 'offset': -1}))
cap.data.transform(BEANIE_TILT)

bm = bmesh.new()
rim_angle = math.pi * 0.43
torus(bm, Vector((0, 0.02 + CAP_R * math.cos(rim_angle), 0)), CAP_R * math.sin(rim_angle) - 0.01, 0.07, segments=56, yscale=1.35, matrix=BEANIE_TILT)
rim = mesh_object('BeanieRim', bm, ['NavyDeep'], parent=head)
smooth(rim)

bm = bmesh.new()
for side in (-1, 1):
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=24, radius1=0.25, radius2=0.045, depth=0.42)['verts']
    m = BEANIE_TILT @ Matrix.Translation((side * CAP_R * 0.56, CAP_R * 0.8, -0.04)) @ Matrix.Rotation(-side * 0.45, 4, 'Z') @ Matrix.Diagonal((1, 1, 0.42, 1)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    bmesh.ops.transform(bm, matrix=m, verts=verts)
ears = mesh_object('BeanieEars', bm, ['Navy'], parent=head)
modify(ears, ('SUBSURF', {'levels': 2}))

flake_at = on_head(0.5, 0.88, CAP_R * 1.02) + Vector((0, 0.02, 0))
empty('FlakeHat', parent=head, matrix=BEANIE_TILT @ facing(flake_at, flake_at))

# The X hairpin on her right.
bm = bmesh.new()
# Clear of the bangs, which ride up to about 1.15 head radii here.
pin_at = on_head(0.8, 1.56, HEAD_R * 1.22)
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
tris = sum(len(o.data.polygons) for o in scene.objects if o.type == 'MESH')
print(f'nixchan: wrote {OUT} ({tris} faces)')

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
