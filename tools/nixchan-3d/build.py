# Builds the 3D Nixchan figure for /experimental and exports it as a .glb.
#
#   nix develop .#blender -c blender -b -P tools/nixchan-3d/build.py -- <out.glb> [preview-dir]
#
# Everything is modelled straight in three.js coordinates (y up, she faces +z, y = 0 is the seat,
# z = 0 the front edge of whatever she sits on) and exported without the y-up conversion.
# Materials are only placeholders: the page swaps them for toon materials by name and paints the
# face onto the "Face" mesh. She is rigged, standing in rest, with clips Sit, Idle, Walk, Run, Wave,
# Swim and Tread, the fishing clips Cast, Fish, Reel and Show, and the jumps and landing baked in; the
# page plays those, and turns the "Head" and "Hair" bones itself. The swimming clips put the water
# line at y = 0 rather than her feet. Her fishing rod ("Rod" and "Reel", with a "RodTip" empty for
# the line to hang from) and her watering can ("Can", with a "CanSpout" empty where the water comes
# out) are in her right hand in every clip, and the page shows each only when she's using it. The
# garden clips are Tend (crouched, patting the soil) and Water. Her smithing hammer ("Hammer") is in
# that hand too, for Smith, a loop of strikes on the anvil in front of her.
# For /skills she has a fighting stance (Ready), a held spell (Charge), and four spells that each
# play once from Ready back to Ready: Shot, Slam, Summon and Dash.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

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
    'Rod': '#c58b57',
    'Reel': '#f25f6b',
    'Can': '#5fb0e8',
    'Metal': '#9aa3c4',
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


# ---------- the skeleton's joints ----------
# She is modelled standing, arms a little out from her sides, and the clips pose everything else,
# sitting included. Every limb hangs from a ball at its joint, so turning it never opens a gap.
SIDES = ((1, 'L'), (-1, 'R'))  # her left is +x
HIP_Y = 0.135
ARM_OUT = 0.3
UPPER_ARM = 0.25
FOREARM = 0.27
THIGH = 0.36
ANKLE = 0.44  # from knee to ankle
JOINT = {'Hips': Vector((0, HIP_Y, BODY_Z)), 'Chest': Vector((0, 0.34, BODY_Z)), 'Head': HEAD.copy(), 'Hair': HEAD.copy()}
ARM_DIR = {}
for side, s in SIDES:
    d = Vector((side * math.sin(ARM_OUT), -math.cos(ARM_OUT), 0))
    ARM_DIR[s] = d
    JOINT['UpperArm' + s] = Vector((side * 0.28, 0.62, BODY_Z))
    JOINT['LowerArm' + s] = JOINT['UpperArm' + s] + d * UPPER_ARM
    JOINT['Hand' + s] = JOINT['LowerArm' + s] + d * FOREARM
    JOINT['Thigh' + s] = Vector((side * 0.16, HIP_Y, BODY_Z))
    JOINT['Shin' + s] = Vector((side * 0.165, HIP_Y - THIGH, BODY_Z))
    JOINT['Foot' + s] = JOINT['Shin' + s] + Vector((0, -ANKLE, 0))

# ---------- hoodie: torso and pocket melted into one ----------
bm = bmesh.new()
lathe(
    bm,
    [(0.3, 0.0), (0.41, 0.03), (0.45, 0.15), (0.44, 0.34), (0.39, 0.52), (0.3, 0.66), (0.17, 0.76), (0.08, 0.8)],
    zscale=0.8,
    centre=Vector((0, 0, BODY_Z)),
)
# The kangaroo pocket.
sphere(bm, Vector((0, 0.2, BODY_Z + 0.31)), 1, scale=(0.25, 0.12, 0.065))
body = mesh_object('Body', bm, ['Navy'])
modify(body, *remeshed(), ('DECIMATE', {'ratio': 0.3}))

# Baggy sleeves, apart from the torso so they can swing through it.
bm = bmesh.new()
for side, s in SIDES:
    a, e, w, d = JOINT['UpperArm' + s], JOINT['LowerArm' + s], JOINT['Hand' + s], ARM_DIR[s]
    sweep(bm, [a, a + d * 0.12, e, e + d * 0.13, w], lambda t: 0.105 + 0.04 * math.sin(math.pi * min(1.0, t * 1.1)))
sleeves = mesh_object('Sleeves', bm, ['Navy'])
modify(sleeves, *remeshed(0.014, 5), ('DECIMATE', {'ratio': 0.3}))

# The hood: a thick collar under her chin, dipping at the front, and the rest lying on her back.
bm = bmesh.new()
torus(bm, Vector(), 0.25, 0.08, matrix=Matrix.Translation((0, 0.705, BODY_Z + 0.01)) @ Matrix.Rotation(0.22, 4, 'X'))
sphere(bm, Vector((0, 0.63, BODY_Z - 0.27)), 1, scale=(0.31, 0.22, 0.14))
hood = mesh_object('Hood', bm, ['Navy'])
modify(hood, *remeshed(), ('DECIMATE', {'ratio': 0.3}))

# Ribbed cuffs and paws, one of each per side so they can follow their own bones.
CUFFS, HANDS = {}, {}
for side, s in SIDES:
    w, d = JOINT['Hand' + s], ARM_DIR[s]
    bm = bmesh.new()
    torus(bm, Vector(), 0.066, 0.036, segments=20, sides=10, yscale=0.9, matrix=facing(d, w + d * 0.05) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    CUFFS[s] = mesh_object('Cuff' + s, bm, ['NavyDeep'])
    smooth(CUFFS[s])
    bm = bmesh.new()
    palm = w + d * 0.11
    sphere(bm, palm, 1, scale=(0.066, 0.078, 0.062), seg=(16, 10))
    # The thumb, towards the front and her middle.
    sphere(bm, palm + Vector((-side * 0.03, 0.02, 0.045)), 0.03, seg=(12, 8))
    HANDS[s] = mesh_object('Hand' + s, bm, ['Skin'])
    smooth(HANDS[s])

# Drawstrings either side of the snowflake, each ending in a stubby tip.
bm = bmesh.new()
for side in (-1, 1):
    pts = [Vector((side * 0.085, 0.66, BODY_Z + 0.27)), Vector((side * 0.12, 0.58, BODY_Z + 0.318)), Vector((side * 0.145, 0.47, BODY_Z + 0.352)), Vector((side * 0.15, 0.38, BODY_Z + 0.375))]
    tube(bm, pts, lambda t: 0.013 if t < 0.8 else 0.021, n=20)
cords = mesh_object('Cords', bm, ['Cord'])
smooth(cords)

# Her fishing rod, through her right fist: in rest it points straight forwards (+z) from the palm,
# and the fishing clips turn her hand to aim it. A short grip runs back from her fist, with the reel
# hanging under it.
GRIP = JOINT['HandR'] + ARM_DIR['R'] * 0.11
ROD_LEN = 1.45
bm = bmesh.new()
for r0, r1, z0, z1, mat in ((0.024, 0.021, -0.2, 0.06, 1), (0.014, 0.005, 0.06, ROD_LEN, 0)):
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r0, radius2=r1, depth=z1 - z0)['verts']
    bmesh.ops.translate(bm, vec=GRIP + Vector((0, 0, (z0 + z1) / 2)), verts=verts)
    set_mat(verts, mat)
rod = mesh_object('Rod', bm, ['Rod', 'NavyDeep'])
bm = bmesh.new()
verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.04, radius2=0.04, depth=0.035)['verts']
bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP + Vector((0, -0.05, -0.1))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), verts=verts)
# The reel's handle, a knob sticking out on her left of it.
verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.01, radius2=0.01, depth=0.05)['verts']
bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP + Vector((0.035, -0.07, -0.1))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), verts=verts)
reel = mesh_object('Reel', bm, ['Reel'])
rod_tip = empty('RodTip', GRIP + Vector((0, 0, ROD_LEN)))

# Her watering can, held by the handle over its top. In rest it hangs from her fist the right way up
# with its spout forwards (+z); the Water clip turns her hand to tip it.
bm = bmesh.new()


def can_part(verts, mat):
    set_mat(verts, mat)


CAN_Y = -0.15
for r0, r1, y0, y1 in ((0.1, 0.09, CAN_Y - 0.08, CAN_Y + 0.08),):
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r0, radius2=r1, depth=y1 - y0)['verts']
    bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP + Vector((0, (y0 + y1) / 2, 0))) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), verts=verts)
    can_part(verts, 0)
handle = [GRIP + Vector((0, CAN_Y + 0.08 + math.sin(t) * 0.1 - 0.02, -math.cos(t) * 0.07)) for t in [i * math.pi / 8 for i in range(9)]]
for a, b in zip(handle, handle[1:]):
    axis = b - a
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.014, radius2=0.014, depth=axis.length)['verts']
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4(), verts=verts)
    can_part(verts, 1)
for a, b, r0, r1, mat in (
    (Vector((0, CAN_Y - 0.03, 0.08)), Vector((0, CAN_Y + 0.1, 0.27)), 0.022, 0.012, 0),
    (Vector((0, CAN_Y + 0.095, 0.26)), Vector((0, CAN_Y + 0.115, 0.29)), 0.028, 0.032, 1),
):
    axis = b - a
    verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r0, radius2=r1, depth=axis.length)['verts']
    bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP + (a + b) / 2) @ Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4(), verts=verts)
    can_part(verts, mat)
# Modelled small, then grown about her fist to a size that reads at a distance.
CAN_SCALE = 1.5
bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP) @ Matrix.Scale(CAN_SCALE, 4) @ Matrix.Translation(-GRIP), verts=bm.verts[:])
watering_can = mesh_object('Can', bm, ['Can', 'Metal'])
can_spout = empty('CanSpout', GRIP + Vector((0, CAN_Y + 0.115, 0.3)) * CAN_SCALE)

# Her smithing hammer, through her right fist like the rod: in rest its handle points forwards (+z)
# from her palm, with the head across the end of it, standing upright (its striking face down, -y).
# The Smith clip turns her hand to swing it.
HAMMER_LEN = 0.3
bm = bmesh.new()
verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.018, radius2=0.015, depth=HAMMER_LEN + 0.1)['verts']
bmesh.ops.translate(bm, vec=GRIP + Vector((0, 0, (HAMMER_LEN - 0.1) / 2)), verts=verts)
set_mat(verts, 0)
verts = bmesh.ops.create_cube(bm, size=1)['verts']
bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP + Vector((0, -0.02, HAMMER_LEN))) @ Matrix.Diagonal((0.075, 0.17, 0.085, 1)), verts=verts)
set_mat(verts, 1)
HAMMER_SCALE = 1.4
bmesh.ops.transform(bm, matrix=Matrix.Translation(GRIP) @ Matrix.Scale(HAMMER_SCALE, 4) @ Matrix.Translation(-GRIP), verts=bm.verts[:])
hammer = mesh_object('Hammer', bm, ['Rod', 'Metal'])
# The middle of the hammer's striking face, where the sparks fly from.
hammer_face = empty('HammerFace', GRIP + Vector((0, -0.105, HAMMER_LEN)) * HAMMER_SCALE)

flake_chest = empty('FlakeChest', matrix=facing((0, 0.2, 1), Vector((0, 0.47, BODY_Z + 0.352))))

# ---------- legs: thighs from the hips, shins and sneakers from the knees ----------
THIGHS = {}
for side, s in SIDES:
    hip = JOINT['Thigh' + s]
    bm = bmesh.new()
    sweep(bm, [hip + Vector((0, 0.05, 0)), JOINT['Shin' + s] + Vector((0, -0.01, 0))], lambda t: 0.14, steps=12)
    THIGHS[s] = mesh_object('Thigh' + s, bm, ['Navy'])
    modify(THIGHS[s], *remeshed(), ('DECIMATE', {'ratio': 0.3}))

SHOE = Vector((0, -0.475, 0.065))
SHOE_SIZE = Vector((0.108, 0.078, 0.172))


def instep(x, z):
    """The height of the shoe's upper at (x, z), for laying the laces on it."""
    d = 1 - (x / SHOE_SIZE.x) ** 2 - ((z - SHOE.z) / SHOE_SIZE.z) ** 2
    return SHOE.y + SHOE_SIZE.y * math.sqrt(max(d, 0.0))


KNEES, FEET = {}, {}
for side, s in SIDES:
    # Shins and sneakers are modelled around the knee; the sneakers turn at the ankle.
    name = 'Knee' + s
    knee = KNEES[s] = empty(name, JOINT['Shin' + s])
    ankle = FEET[s] = empty('Ankle' + s, JOINT['Foot' + s])
    to_knee = Vector((0, ANKLE, 0))
    # Joggers: loose down the shin, gathered into a cuff at the ankle.
    bm = bmesh.new()
    sweep(bm, [Vector((0, 0, 0)), Vector((0, -0.18, 0.005)), Vector((0, -0.33, 0))], lambda t: 0.118 + 0.014 * math.sin(math.pi * t), steps=14)
    torus(bm, Vector((0, -0.36, 0)), 0.062, 0.05, segments=20, sides=10)
    shin = mesh_object(name + 'Shin', bm, ['Navy'], parent=knee)
    modify(shin, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.25}))

    bm = bmesh.new()
    sphere(bm, SHOE, 1, scale=SHOE_SIZE)
    sphere(bm, Vector((0, -0.425, -0.005)), 0.098)
    upper = mesh_object(name + 'Shoe', bm, ['NavyDeep'], parent=ankle, position=to_knee)
    modify(upper, *remeshed(0.012, 4), ('DECIMATE', {'ratio': 0.25}))

    # The white rubber: a toe cap and a sole a little wider than the upper.
    bm = bmesh.new()
    sphere(bm, Vector((0, -0.492, 0.172)), 1, scale=(0.1, 0.062, 0.078), seg=(20, 12))
    lathe(bm, [(0.085, -0.572), (0.112, -0.562), (0.118, -0.535), (0.112, -0.512), (0.09, -0.505)], segments=28, zscale=1.62, centre=Vector((0, 0, 0.068)))
    rubber = mesh_object(name + 'Rubber', bm, ['Cord'], parent=ankle, position=to_knee)
    smooth(rubber)

    bm = bmesh.new()
    for z in (0.085, 0.118, 0.151):
        tube(bm, [Vector((x, instep(x, z) + 0.006, z + abs(x) * 0.15)) for x in (-0.062, -0.032, 0, 0.032, 0.062)], 0.0095, n=8, sides=6)
    laces = mesh_object(name + 'Laces', bm, ['Cord'], parent=ankle, position=to_knee)
    smooth(laces)

# Where the sole meets the ground, from the ankle: heel, ball and toe.
SOLE = [Vector((0, -0.572 + ANKLE, z)) for z in (-0.09, 0.07, 0.22)]

# ---------- head ----------
head = empty('HeadPivot', HEAD)
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
long_hair = empty('LongHair', HEAD)
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

# ---------- the rig ----------
# Every bone points straight up with no roll, so in rest each one's axes are the world's: a pose is
# just rotations about x (forwards and back), y (turning) and z (sideways), and locations in metres.
PARENT = {'Hips': None, 'Chest': 'Hips', 'Head': 'Chest', 'Hair': 'Chest'}
for _, s in SIDES:
    PARENT.update({'UpperArm' + s: 'Chest', 'LowerArm' + s: 'UpperArm' + s, 'Hand' + s: 'LowerArm' + s, 'Thigh' + s: 'Hips', 'Shin' + s: 'Thigh' + s, 'Foot' + s: 'Shin' + s})
BONE_LEN = 0.1
rig_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Nixchan', rig_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, parent in PARENT.items():
    eb = rig_data.edit_bones.new(name)
    eb.head = JOINT[name]
    eb.tail = JOINT[name] + Vector((0, BONE_LEN, 0))
    eb.roll = 0
    if parent:
        eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'


def attach(obj, bone):
    """Hang a rigid part off a bone, where it already is. Blender hangs it from the bone's tail."""
    world = obj.matrix_basis.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Translation(-(JOINT[bone] + Vector((0, BONE_LEN, 0)))) @ world


for obj in (hood, cords, flake_chest):
    attach(obj, 'Chest')
for obj in (rod, reel, rod_tip, watering_can, can_spout, hammer, hammer_face):
    attach(obj, 'HandR')
attach(head, 'Head')
attach(long_hair, 'Hair')
for _, s in SIDES:
    attach(CUFFS[s], 'LowerArm' + s)
    attach(HANDS[s], 'Hand' + s)
    attach(THIGHS[s], 'Thigh' + s)
    attach(KNEES[s], 'Shin' + s)
    attach(FEET[s], 'Foot' + s)


def skin(obj, weigh):
    """Bind a soft part to the rig, with `weigh(position)` giving {bone: weight} for each vertex."""
    obj.parent = rig
    groups = {}
    for v in obj.data.vertices:
        for bone, w in weigh(v.co).items():
            if w > 1e-3:
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(name=bone)
                groups[bone].add([v.index], w, 'REPLACE')
    obj.modifiers.new('rig', 'ARMATURE').object = rig


def torso_weights(co):
    c = smoothstep(0.18, 0.46, co.y)
    return {'Chest': c, 'Hips': 1 - c}


def sleeve_weights(co):
    s = 'L' if co.x > 0 else 'R'
    along = (co - JOINT['UpperArm' + s]).dot(ARM_DIR[s])
    lower = smoothstep(UPPER_ARM - 0.06, UPPER_ARM + 0.06, along)
    return {'UpperArm' + s: 1 - lower, 'LowerArm' + s: lower}


skin(body, torso_weights)
skin(sleeves, sleeve_weights)

# ---------- poses ----------


def euler(x=0.0, y=0.0, z=0.0):
    return Euler((x, y, z), 'XYZ').to_quaternion()


def new_pose():
    return {b: [Vector(), Quaternion()] for b in PARENT}


def fk(pose):
    """Each bone's matrix in the rig's space; a rest point p on bone b lands at world[b] @ (p - JOINT[b])."""
    world = {}
    for b, parent in PARENT.items():
        loc, q = pose[b]
        local = Matrix.Translation(JOINT[b] - (JOINT[parent] if parent else Vector()) + loc) @ q.to_matrix().to_4x4()
        world[b] = world[parent] @ local if parent else local
    return world


def ground(pose, lift=0.0):
    """Raise or drop her so the lower sole rests on y = 0 (plus `lift`)."""
    world = fk(pose)
    low = min((world['Foot' + s] @ p).y for _, s in SIDES for p in SOLE)
    pose['Hips'][0].y += lift - low


def frame(a, f):
    return Matrix((a, f, a.cross(f))).transposed()


REST_FRAME = {s: frame(ARM_DIR[s], Vector((0, 0, 1))) for _, s in SIDES}


def reach(pose, s, target, pole, hand=None):
    """Bend an arm so its wrist reaches `target`, given in the chest's rest frame, elbow towards `pole`.
    In rest the forearm would bend forwards (+z); the bend is carried over so the sleeve never twists."""
    shoulder = JOINT['UpperArm' + s]
    to = Vector(target) - shoulder
    dist = min(to.length, (UPPER_ARM + FOREARM) * 0.995)
    a = to.normalized()
    pole = Vector(pole)
    pole = (pole - a * pole.dot(a)).normalized()
    along = (UPPER_ARM**2 + dist**2 - FOREARM**2) / (2 * dist)
    elbow = shoulder + a * along + pole * math.sqrt(max(UPPER_ARM**2 - along**2, 0.0))
    wrist = shoulder + a * dist
    upper, fore = (elbow - shoulder).normalized(), (wrist - elbow).normalized()
    bend = fore - upper * fore.dot(upper)
    f = bend.normalized() if bend.length > 1e-3 else -pole
    r_upper = frame(upper, f) @ REST_FRAME[s].transposed()
    axis = upper.cross(f)
    r_fore = frame(fore, axis.cross(fore)) @ REST_FRAME[s].transposed()
    pose['UpperArm' + s][1] = r_upper.to_quaternion()
    pose['LowerArm' + s][1] = (r_upper.transposed() @ r_fore).to_quaternion()
    pose['Hand' + s][1] = hand or Quaternion()


def legs(pose, s, thigh, knee, foot, yaw=0.0, roll=0.0):
    pose['Thigh' + s][1] = euler(thigh, yaw, roll)
    pose['Shin' + s][1] = euler(knee)
    pose['Foot' + s][1] = euler(foot)


def hang(pose, s, side, forward=0.0, elbow=-0.25, inward=0.05):
    """An arm hanging loosely from the shoulder."""
    pose['UpperArm' + s][1] = euler(forward, 0, -side * inward)
    pose['LowerArm' + s][1] = euler(elbow)
    pose['Hand' + s][1] = Quaternion()


TAU = 2 * math.pi
# Standing, she steps back from the edge she sits on, so her toes stay on it.
STAND_Z = -0.22
LAP = lambda side: Vector((side * 0.15, 0.33, BODY_Z + 0.36))
LAP_POLE = lambda side: (side, -0.3, -0.5)


def sit(t):
    p = new_pose()
    p['Chest'][1] = euler(0.02 * math.sin(TAU * t))
    for side, s in SIDES:
        # Her legs swing from the knee, out of step with each other.
        ph = TAU * t + (math.pi if side > 0 else 0)
        legs(p, s, -math.pi / 2, math.pi / 2 + math.sin(ph) * 0.28 - 0.08, 0.12 * math.sin(ph - 0.8), yaw=side * 0.05)
        reach(p, s, LAP(side), LAP_POLE(side))
    return p


def idle(t):
    p = new_pose()
    breathe = math.sin(TAU * t)
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(0, 0, 0.015 * breathe)
    p['Chest'][1] = euler(0.025 * breathe, 0, -0.02 * breathe)
    for side, s in SIDES:
        legs(p, s, 0, 0.04, -0.04, roll=side * 0.03)
        hang(p, s, side, forward=-0.06 - 0.03 * breathe)
    ground(p)
    return p


def walk(t):
    p = new_pose()
    ph = TAU * t
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(0, -0.12 * math.sin(ph), 0)
    p['Chest'][1] = euler(0.06, 0.2 * math.sin(ph), 0)
    for side, s in SIDES:
        q = ph + (0 if side > 0 else math.pi)
        thigh = -0.42 * math.sin(q)
        # The knee folds as the leg swings through, and the heel lifts as it pushes off behind.
        knee = 0.08 + 0.8 * max(0.0, math.cos(q)) ** 1.6
        legs(p, s, thigh, knee, -(thigh + knee) + 0.5 * max(0.0, thigh) - 0.1 * max(0.0, math.cos(q)), roll=side * 0.02)
        hang(p, s, side, forward=0.38 * math.sin(q) - 0.05, elbow=-0.3 - 0.25 * max(0.0, -math.sin(q)))
    ground(p)
    return p


def run(t):
    p = new_pose()
    ph = TAU * t
    lean = 0.1
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(lean, -0.15 * math.sin(ph), 0)
    p['Chest'][1] = euler(0.14, 0.28 * math.sin(ph), 0)
    for side, s in SIDES:
        q = ph + (0 if side > 0 else math.pi)
        thigh = -0.35 - 0.8 * math.sin(q)
        knee = 0.25 + 1.45 * (0.5 + 0.5 * math.cos(q - 0.4)) ** 1.5
        legs(p, s, thigh - lean, knee, -(thigh + knee) * 0.6 + 0.2, roll=side * 0.02)
        # Arms pump with the elbows bent, against the legs.
        p['UpperArm' + s][1] = euler(0.7 * math.sin(q) - 0.2, 0, side * 0.1)
        p['LowerArm' + s][1] = euler(-1.45)
        p['Hand' + s][1] = euler(0.2)
    # Both feet leave the ground between strides.
    ground(p, lift=0.06 * max(0.0, math.sin(2 * ph + 0.6)))
    return p


def wave(t):
    p = new_pose()
    ph = TAU * t
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(0, 0, -0.03)
    p['Chest'][1] = euler(0.02, 0.12, -0.05 + 0.015 * math.sin(2 * ph))
    for side, s in SIDES:
        legs(p, s, 0, 0.04, -0.04, roll=side * 0.03)
    hang(p, 'L', 1, forward=-0.05)
    # Her right hand up beside her face, in front of her hair, waving side to side.
    reach(p, 'R', Vector((-0.42 - 0.07 * math.sin(2 * ph), 0.93, BODY_Z + 0.36)), (-1, -1, -0.3), hand=euler(0, 0, 0.3 * math.sin(2 * ph - 0.7)))
    ground(p)
    return p


def afloat(pose, depth=-0.06):
    """Raise or drop her so her shoulders sit `depth` below the water line, which is y = 0."""
    world = fk(pose)
    shoulders = sum(world['UpperArm' + s].translation.y for _, s in SIDES) / 2
    pose['Hips'][0].y += depth - shoulders


# Swimming she tips forwards into a doggy paddle; the page lifts her head back up to look ahead.
SWIM_LEAN = 0.75


def swim(t):
    p = new_pose()
    ph = TAU * t
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(SWIM_LEAN, 0.06 * math.sin(ph), 0.04 * math.sin(ph))
    p['Chest'][1] = euler(-0.2, 0.1 * math.sin(ph), 0)
    for side, s in SIDES:
        q = ph + (0 if side > 0 else math.pi)
        # A quick flutter kick behind her, twice to each paddle, toes pointed.
        k = 2 * ph + (0 if side > 0 else math.pi)
        legs(p, s, 0.2 + 0.3 * math.sin(k), 0.3 + 0.35 * max(0.0, math.cos(k)), 0.75, roll=side * 0.04)
        # Each paw circles under her chin, reaching forwards and pulling back, in turn.
        reach(p, s, Vector((side * 0.19, 0.6 + 0.1 * math.sin(q), BODY_Z + 0.34 + 0.12 * math.cos(q))), (side, -0.5, -0.4), hand=euler(0.5 + 0.3 * math.sin(q)))
    afloat(p, -0.02)
    return p


def tread(t):
    p = new_pose()
    ph = TAU * t
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(0.12, 0, 0.02 * math.sin(ph))
    p['Chest'][1] = euler(0.02 * math.sin(ph))
    for side, s in SIDES:
        q = ph + (0 if side > 0 else math.pi)
        # Slow bicycling legs, and paws sculling out to the sides just under the surface.
        legs(p, s, -0.45 + 0.3 * math.sin(q), 0.85 + 0.35 * math.cos(q), 0.3, yaw=side * 0.1)
        sweep = math.sin(2 * ph)
        reach(p, s, Vector((side * (0.5 + 0.05 * sweep), 0.5, BODY_Z + 0.2 + 0.1 * math.cos(2 * ph))), (side, -1, -0.4), hand=euler(0, 0, side * 0.35 * sweep))
    afloat(p, -0.1 + 0.03 * math.sin(2 * ph))
    return p


def jump_key(thigh, knee, foot, hips, chest, arms):
    p = new_pose()
    p['Hips'][0] = Vector(hips)
    p['Chest'][1] = euler(chest)
    for side, s in SIDES:
        legs(p, s, thigh, knee, foot, yaw=side * 0.05)
        target, pole = arms(side)
        reach(p, s, target, pole)
    return p


# Arms through a jump: swung back to push off, flung up as she leaves, out for balance, lower to land.
ARMS_BACK = lambda side: (Vector((side * 0.36, 0.4, BODY_Z - 0.16)), (side, 0, 0.6))
ARMS_UP = lambda side: (Vector((side * 0.36, 0.92, BODY_Z + 0.36)), (side, -1, -0.2))
ARMS_OUT = lambda side: (Vector((side * 0.46, 0.72, BODY_Z + 0.36)), (side, -1, -0.3))
ARMS_LOW = lambda side: (Vector((side * 0.42, 0.55, BODY_Z + 0.36)), (side, -1, -0.3))
ARMS_LAP = lambda side: (LAP(side), LAP_POLE(side))


def stand_key(thigh, knee, foot, chest, arms, lift=None):
    """A jump pose from or to her feet: kept on the ground, or with her hips at `lift` in the air."""
    p = jump_key(thigh, knee, foot, (0, 0, STAND_Z), chest, arms)
    if lift is None:
        ground(p)
    else:
        p['Hips'][0].y = lift
    return p


# Off a seat: crouched forwards to push off, stretched out as she leaves, and tucked up in the air.
SIT_CROUCH = jump_key(-1.25, 1.5, 0.1, (0, 0.05, -0.05), 0.25, ARMS_BACK)
SIT_STRETCH = jump_key(-0.15, 0.2, 0.6, (0, 0.4, -0.12), -0.12, ARMS_UP)
SIT_TUCK = jump_key(-1.15, 1.8, 0.3, (0, 0.22, -0.05), 0.05, ARMS_OUT)
# Onto a seat: reaching forwards for it, and landing sat down.
SIT_REACH = jump_key(-1.35, 1.1, -0.1, (0, 0.12, 0), 0.1, ARMS_LOW)
SIT_LAND = jump_key(-math.pi / 2, math.pi / 2, 0, (0, 0, 0), 0.12, ARMS_LAP)
# Off her feet: knees bent and arms back, then up onto her toes; tucked, her hips stay at standing
# height, so the jump lifts her rather than dropping her into a squat.
STAND_CROUCH = stand_key(-0.75, 1.35, -0.6, 0.3, ARMS_BACK)
STAND_STRETCH = stand_key(-0.1, 0.15, 0.55, -0.12, ARMS_UP)
STAND_TUCK = stand_key(-1.0, 1.7, 0.3, 0.05, ARMS_OUT, lift=0.72)
# Onto her feet: legs reaching down, toes first.
STAND_REACH = stand_key(-0.3, 0.4, 0.2, 0.08, ARMS_LOW)
# And the landing that follows: the knees take it, then she straightens up.
STAND_SQUASH = stand_key(-0.8, 1.45, -0.65, 0.3, ARMS_LOW)


def keyed(keys):
    """A clip that eases from each (time, pose) to the next."""

    def clip(t):
        for (t0, a), (t1, b) in zip(keys, keys[1:]):
            if t <= t1:
                u = smoothstep(t0, t1, t)
                return {k: [a[k][0].lerp(b[k][0], u), a[k][1].slerp(b[k][1], u)] for k in a}
        return keys[-1][1]

    return clip


# The page picks one by where she leaps from and to, and scrubs it along her flight.
JUMPS = {
    'Jump': [(0.0, SIT_CROUCH), (0.15, SIT_STRETCH), (0.45, SIT_TUCK), (0.78, SIT_REACH), (1.0, SIT_LAND)],
    'JumpUp': [(0.0, STAND_CROUCH), (0.15, STAND_STRETCH), (0.45, STAND_TUCK), (0.78, SIT_REACH), (1.0, SIT_LAND)],
    'JumpDown': [(0.0, SIT_CROUCH), (0.15, SIT_STRETCH), (0.45, SIT_TUCK), (0.82, STAND_REACH), (1.0, STAND_REACH)],
    'JumpStand': [(0.0, STAND_CROUCH), (0.15, STAND_STRETCH), (0.45, STAND_TUCK), (0.82, STAND_REACH), (1.0, STAND_REACH)],
}
jump = keyed(JUMPS['Jump'])
# Played straight after a jump that ends on her feet.
land = keyed([(0.0, STAND_REACH), (0.3, STAND_SQUASH), (1.0, idle(0))])


# ---------- fishing ----------
# She holds the rod in her right fist with her left hand lower down on the grip, and the clips aim it
# by turning her right hand so the rod (+z in rest) points along `aim`, given in the chest's frame.


def rod_hold(p, aim, wrist, crank=None):
    aim = Vector(aim).normalized()
    reach(p, 'R', wrist, (-1, -1, -0.4))
    world = fk(p)
    chest = world['Chest'].to_3x3()
    fore = world['LowerArmR'].to_3x3()
    local = (fore.inverted() @ chest @ aim).normalized()
    p['HandR'][1] = Vector((0, 0, 1)).rotation_difference(local)
    world = fk(p)
    # Where her right fist ended up, back in the chest's frame, and her left hand lower on the grip
    # (or turning the reel's handle, when she's reeling in).
    to_chest = world['Chest'].inverted()
    fist = to_chest @ world['HandR'] @ (GRIP - JOINT['HandR'])
    side = (to_chest.to_3x3() @ world['HandR'].to_3x3() @ Vector((1, 0, 0))).normalized()
    held = fist - aim * 0.17 + Vector((0.02, -0.04, -0.02))
    if crank is not None:
        held = fist - aim * 0.1 + side * 0.06 + (Vector((0, math.cos(crank), math.sin(crank))) * 0.045)
    # The wrist sits about a palm's length back from what the hand holds.
    reach(p, 'L', held - Vector((0.05, -0.06, 0.05)), (1, -1, -0.3))


def stance(p, wide=0.06, bend=0.08):
    p['Hips'][0].z = STAND_Z
    for side, s in SIDES:
        legs(p, s, -bend, bend * 2, -bend, roll=side * wide)


def fish_pose(aim, wrist, lean=0.0, crank=None, bob=0.0):
    p = new_pose()
    stance(p, bend=0.08 + bob)
    p['Hips'][1] = euler(-lean * 0.4, 0.06, 0)
    p['Chest'][1] = euler(-lean, 0.03, 0)
    rod_hold(p, aim, wrist, crank)
    ground(p)
    return p


# Waiting for a bite: rod held out over the water, breathing, the tip nodding a little.
FISH_WRIST = Vector((-0.17, 0.5, BODY_Z + 0.34))
FISH_AIM = Vector((-0.12, 0.5, 1))


def fish(t):
    b = math.sin(TAU * t)
    return fish_pose(FISH_AIM + Vector((0, 0.04 * b, 0)), FISH_WRIST + Vector((0, 0.01 * b, 0)), lean=0.02 * b, bob=0.01 * b)


# The cast: rod swung up and back over her shoulder, then flicked out forwards and lowered to wait.
CAST_KEYS = [
    (0.0, fish_pose(FISH_AIM, FISH_WRIST)),
    (0.38, fish_pose((0, 1, -0.55), FISH_WRIST + Vector((0, 0.22, -0.12)), lean=0.18)),
    (0.6, fish_pose((0.05, 0.25, 1), FISH_WRIST + Vector((0, 0.02, 0.08)), lean=-0.16)),
    (1.0, fish_pose(FISH_AIM, FISH_WRIST)),
]
cast = keyed(CAST_KEYS)


# Reeling in: leaning back with the rod high, cranking the reel.
def reel_in(t):
    ph = TAU * t
    tug = math.sin(ph * 2)
    return fish_pose((-0.1 + 0.03 * tug, 0.9, 1), Vector((-0.16, 0.56 + 0.015 * tug, BODY_Z + 0.3)), lean=0.12 + 0.03 * tug, crank=ph, bob=0.04)


# Showing off a catch, held out in front in both hands, with a little bounce. The page puts the fish
# between her hands.
def show(t):
    ph = TAU * t
    p = new_pose()
    stance(p, bend=0.06 + 0.05 * max(0.0, math.sin(ph)))
    p['Chest'][1] = euler(-0.08, 0, 0.03 * math.sin(ph))
    for side, s in SIDES:
        reach(p, s, Vector((side * 0.19, 0.6 + 0.03 * math.sin(ph), BODY_Z + 0.4)), (side, -1, -0.2))
    ground(p, lift=0.03 * max(0.0, math.sin(ph)))
    return p


# ---------- the garden ----------


def hand_frame(p, s, forward, up):
    """Turn a hand so what it holds (modelled facing +z, the right way up, in rest) faces `forward`
    with its top towards `up`, both in the chest's frame."""
    world = fk(p)
    z = Vector(forward).normalized()
    x = Vector(up).cross(z).normalized()
    want = Matrix((x, z.cross(x), z)).transposed()
    have = world['Chest'].to_3x3().inverted() @ world['LowerArm' + s].to_3x3()
    p['Hand' + s][1] = (have.inverted() @ want).to_quaternion()


# Watering, played once: she lifts the can out in front, tips it right over and sweeps the water
# from one side of the plot to the other and back, her left hand steadying it underneath, then
# brings it level again. `lift` raises the can, `tip` pours, `sweep` turns her (+1 to her left).
def water_pose(lift, tip, sweep):
    p = new_pose()
    stance(p, bend=0.06 + 0.05 * tip)
    p['Hips'][1] = euler(0.04 * tip, 0.14 * sweep, 0)
    p['Chest'][1] = euler(0.08 + 0.14 * tip, 0.16 * sweep, 0)
    reach(p, 'R', Vector((-0.19, 0.4 + 0.12 * lift, BODY_Z + 0.38 + 0.06 * lift)), (-1, -1, -0.4))
    hand_frame(p, 'R', (0.05, -0.1 - 0.8 * tip, 1), (0, 1, 0.15 + 0.85 * tip))
    # Her left hand under the can's body, in the chest's frame.
    world = fk(p)
    to_chest = world['Chest'].inverted()
    body = to_chest @ world['HandR'] @ (GRIP + Vector((0, CAN_Y * CAN_SCALE - 0.12, 0.03)) - JOINT['HandR'])
    if lift > 0.3:
        reach(p, 'L', body + Vector((0.04, -0.02, -0.08)), (1, -1, -0.3))
    else:
        hang(p, 'L', 1, forward=0.1)
    ground(p)
    return p


WATER_KEYS = [
    (0.0, water_pose(0, 0, 0)),
    (0.16, water_pose(1, 0.1, 0)),
    (0.3, water_pose(1, 1, -1)),
    (0.55, water_pose(1, 1, 1)),
    (0.74, water_pose(1, 1, -0.5)),
    (0.86, water_pose(1, 0.1, 0)),
    (1.0, water_pose(0, 0, 0)),
]
water = keyed(WATER_KEYS)


# Smithing, a loop: she stands square to the anvil in front of her, raises the hammer back over her
# shoulder, brings it down on the anvil (her left hand steadying the work there with tongs she
# doesn't have), lets it bounce up, and raises it again. The strike lands at t = 0.62; the page
# throws the sparks then, from "HammerFace".
SMITH_STRIKE = 0.62


def smith_pose(lift, lean=0.0):
    """`lift` is how far the hammer's raised: 1 back over her shoulder, 0 down on the anvil."""
    p = new_pose()
    stance(p, wide=0.1, bend=0.1 + 0.05 * (1 - lift))
    p['Chest'][1] = euler(0.12 + 0.18 * (1 - lift) + lean, -0.12 * lift, 0)
    wrist = Vector((-0.16 - 0.1 * lift, 0.36 + 0.4 * lift, BODY_Z + 0.42 - 0.1 * lift))
    reach(p, 'R', wrist, (-1, -0.6 + 0.8 * lift, -0.4))
    # The handle swings from pointing up (raised) to forwards (striking), its face turning from
    # forwards to down with it. These are in the chest's frame, which leans forwards as she strikes,
    # so the handle's tipped up a little there to come out level.
    aim = Vector((0.04 + 0.06 * lift, 0.3 + 0.7 * lift, 1 - 1.3 * lift))
    up = Vector((0, 1 - lift, -lift))
    hand_frame(p, 'R', aim, up)
    reach(p, 'L', Vector((0.12, 0.3, BODY_Z + 0.46)), (1, -1, -0.3))
    ground(p)
    return p


smith = keyed([
    (0.0, smith_pose(0.85)),
    (0.4, smith_pose(1.0)),
    (SMITH_STRIKE, smith_pose(0.0, lean=0.04)),
    (0.72, smith_pose(0.18)),
    (1.0, smith_pose(0.85)),
])


# Tending: crouched down low, patting the soil in front of her with both hands, out of step.
def tend(t):
    ph = TAU * t
    p = new_pose()
    p['Hips'][0].z = STAND_Z
    p['Chest'][1] = euler(0.45, 0, 0.03 * math.sin(ph))
    for side, s in SIDES:
        legs(p, s, -1.05, 1.75, -0.7, yaw=side * 0.12, roll=side * 0.08)
        pat = max(0.0, math.sin(ph + (0 if side > 0 else math.pi)))
        reach(p, s, Vector((side * 0.14, 0.24 + 0.07 * pat, BODY_Z + 0.42)), (side, -1, -0.2))
    ground(p)
    return p


# Planting, played once: she crouches at the edge of the plot, scoops out a little hole with her
# right hand (twice), drops a seed in, pats the soil down with both hands, and stands back up.
# The page throws the dirt, drops the seed and raises the mound in time with it.
def crouch_pose(right, left, chest=0.45):
    p = new_pose()
    p['Hips'][0].z = STAND_Z
    p['Chest'][1] = euler(chest, 0, 0)
    for side, s in SIDES:
        legs(p, s, -1.05, 1.75, -0.7, yaw=side * 0.12, roll=side * 0.08)
    reach(p, 'R', Vector(right), (-1, -1, -0.2))
    reach(p, 'L', Vector(left), (1, -1, -0.2))
    ground(p)
    return p


KNEE_L = (0.2, 0.3, BODY_Z + 0.3)
DIG_IN = (-0.1, 0.19, BODY_Z + 0.47)
DIG_OUT = (-0.24, 0.36, BODY_Z + 0.34)
PLANT_KEYS = [
    (0.0, idle(0)),
    (0.14, crouch_pose((-0.2, 0.3, BODY_Z + 0.32), KNEE_L, chest=0.35)),
    (0.22, crouch_pose(DIG_IN, KNEE_L)),
    (0.3, crouch_pose(DIG_OUT, KNEE_L)),
    (0.38, crouch_pose(DIG_IN, KNEE_L)),
    (0.46, crouch_pose(DIG_OUT, KNEE_L)),
    # Over the hole, and the seed's let go.
    (0.54, crouch_pose((-0.06, 0.32, BODY_Z + 0.46), KNEE_L, chest=0.5)),
    (0.6, crouch_pose((-0.06, 0.27, BODY_Z + 0.46), KNEE_L, chest=0.5)),
    # Both hands patting it down.
    (0.68, crouch_pose((-0.1, 0.31, BODY_Z + 0.44), (0.1, 0.31, BODY_Z + 0.44))),
    (0.74, crouch_pose((-0.1, 0.2, BODY_Z + 0.46), (0.1, 0.2, BODY_Z + 0.46))),
    (0.8, crouch_pose((-0.1, 0.3, BODY_Z + 0.44), (0.1, 0.3, BODY_Z + 0.44))),
    (0.86, crouch_pose((-0.1, 0.2, BODY_Z + 0.46), (0.1, 0.2, BODY_Z + 0.46))),
    (1.0, idle(0)),
]
plant = keyed(PLANT_KEYS)


# ---------- snow magic, for /skills ----------
# Ready is a loop: a light, wide stance with both paws up in front, bouncing on her toes. The spells
# play once each, from Ready back to Ready; the page throws the effects at the moments noted.


def battle_pose(arms, wide=0.11, bend=0.14, chest=0.06, twist=0.0, hips=0.0, lift=0.0):
    """`arms(side)` gives each wrist's (target, pole), in the chest's rest frame."""
    p = new_pose()
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(hips, twist * 0.5, 0)
    p['Chest'][1] = euler(chest, twist, 0)
    for side, s in SIDES:
        legs(p, s, -bend, bend * 2, -bend, yaw=side * 0.12, roll=side * wide)
        target, pole = arms(side)
        reach(p, s, Vector(target), pole)
    ground(p, lift=lift)
    return p


GUARD = lambda side, dy=0.0: ((side * 0.21, 0.5 + dy, BODY_Z + 0.33), (side, -1, -0.3))


def ready(t):
    b = math.sin(TAU * t)
    return battle_pose(lambda side: GUARD(side, 0.02 * b), bend=0.15 + 0.04 * b, chest=0.06 + 0.02 * b)


# Cupped together in front of her chest, where the page grows the snowball between her paws.
CUP = lambda side, z=0.4: ((side * 0.07, 0.5, BODY_Z + z), (side, -1, -0.5))
# Both paws pushed straight out in front at shoulder height.
PUSH = lambda side: ((side * 0.11, 0.62, BODY_Z + 0.56), (side, -0.6, -0.4))


def charge(t):
    """A loop, held while she gathers a spell: a little tremble, leaning in."""
    k = math.sin(TAU * t * 2)
    return battle_pose(lambda side: CUP(side, 0.4 + 0.01 * k), bend=0.2, chest=0.14 + 0.01 * k, twist=0.02 * k)


# Frost Shot: she pulls her paws back to her chest and shoves them forwards. The bolt leaves at 0.3.
SHOT_FIRE = 0.3
shot = keyed([
    (0.0, ready(0)),
    (0.15, battle_pose(lambda side: CUP(side, 0.3), bend=0.22, chest=0.0, twist=0.1)),
    (SHOT_FIRE, battle_pose(PUSH, bend=0.18, chest=0.22, hips=0.06)),
    (0.6, battle_pose(PUSH, bend=0.17, chest=0.18, hips=0.05)),
    (1.0, ready(0)),
])

# Glacier Slam: both paws flung up and out (her head's too big to reach over), a little hop, and down onto the ground in a crouch.
# Her paws hit the ground at 0.55, where the page bursts ice out of it.
SLAM_HIT = 0.55
UP_HIGH = lambda side: ((side * 0.58, 0.9, BODY_Z + 0.3), (side, -0.3, -1))


def slam_low():
    p = new_pose()
    p['Hips'][0].z = STAND_Z
    p['Chest'][1] = euler(0.6, 0, 0)
    for side, s in SIDES:
        legs(p, s, -1.05, 1.75, -0.7, yaw=side * 0.18, roll=side * 0.12)
        reach(p, s, Vector((side * 0.1, 0.28, BODY_Z + 0.46)), (side, -1, -0.2))
    ground(p)
    return p


slam = keyed([
    (0.0, ready(0)),
    (0.12, battle_pose(GUARD, bend=0.3, chest=0.2)),
    (0.32, battle_pose(UP_HIGH, bend=0.0, chest=-0.18, lift=0.22)),
    (0.42, battle_pose(UP_HIGH, bend=0.05, chest=-0.2, lift=0.18)),
    (SLAM_HIT, slam_low()),
    (0.75, slam_low()),
    (1.0, ready(0)),
])

# Blizzard Crown: arms flung up and out in a V to call the storm down, held, then lowered. The rune
# opens over her at 0.3 and the storm falls while her arms are up, until 0.8.
SUMMON_OPEN = 0.3
# Out in front of her long hair, or it hides them.
V_UP = lambda side, w=0.0: ((side * (0.6 + w), 0.86 + w, BODY_Z + 0.32), (side, -0.3, -1))
summon = keyed([
    (0.0, ready(0)),
    (0.12, battle_pose(lambda side: CUP(side, 0.35), bend=0.24, chest=0.18)),
    (SUMMON_OPEN, battle_pose(lambda side: V_UP(side), bend=0.04, chest=-0.22, lift=0.03)),
    (0.55, battle_pose(lambda side: V_UP(side, 0.04), bend=0.06, chest=-0.26, lift=0.03)),
    (0.8, battle_pose(lambda side: V_UP(side), bend=0.06, chest=-0.22)),
    (1.0, ready(0)),
])

# Snow Dash: a low lunge to one side, her right paw slashing across, then back. The slash is at 0.4.
DASH_SLASH = 0.4


def lunge(sweep, low):
    p = new_pose()
    p['Hips'][0].z = STAND_Z
    p['Hips'][1] = euler(0.12 * low, -0.4 * sweep, 0)
    p['Chest'][1] = euler(0.18 * low, -0.5 * sweep, 0)
    legs(p, 'L', -0.2 - 0.5 * low, 0.3 + 0.9 * low, -0.1 - 0.3 * low, roll=0.14)
    legs(p, 'R', 0.15 + 0.25 * low, 0.15 + 0.3 * low, -0.2, roll=-0.14)
    reach(p, 'R', Vector((-0.45 + 0.75 * sweep, 0.58, BODY_Z + 0.38)), (-1, -1, -0.3))
    reach(p, 'L', Vector((0.3, 0.45, BODY_Z + 0.2)), (1, -1, -0.3))
    ground(p)
    return p


dash = keyed([
    (0.0, ready(0)),
    (0.2, lunge(0.0, 0.6)),
    (DASH_SLASH, lunge(1.0, 1.0)),
    (0.6, lunge(1.0, 0.9)),
    (1.0, ready(0)),
])


# Looping clips end where they start; the jumps and Land play once.
FPS = 30
CLIPS = {'Sit': (72, sit), 'Idle': (72, idle), 'Walk': (30, walk), 'Run': (18, run), 'Wave': (48, wave), 'Land': (13, land), 'Swim': (30, swim), 'Tread': (60, tread)}
CLIPS.update({'Cast': (24, cast), 'Fish': (72, fish), 'Reel': (24, reel_in), 'Show': (40, show), 'Water': (54, water), 'Tend': (30, tend), 'Plant': (72, plant), 'Smith': (36, smith)})
CLIPS.update({'Ready': (40, ready), 'Charge': (24, charge), 'Shot': (27, shot), 'Slam': (42, slam), 'Summon': (90, summon), 'Dash': (27, dash)})
CLIPS.update({name: (30, keyed(keys)) for name, keys in JUMPS.items()})
# The page turns the head and the long hair itself.
UNKEYED = {'Head', 'Hair'}
scene.render.fps = FPS
rig.animation_data_create()
for name, (frames, fn) in CLIPS.items():
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    last = {}
    for f in range(frames + 1):
        for b, (loc, q) in fn(f / frames).items():
            if b in UNKEYED:
                continue
            # Keep each quaternion on the same side as the last, so it never spins the long way round.
            if b in last and last[b].dot(q) < 0:
                q = -q
            last[b] = q
            pb = rig.pose.bones[b]
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if b == 'Hips':
                pb.location = loc
                pb.keyframe_insert('location', frame=f)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    rig.animation_data.action = None


def apply_pose(pose):
    for b, (loc, q) in pose.items():
        rig.pose.bones[b].location = loc
        rig.pose.bones[b].rotation_quaternion = q
    bpy.context.view_layer.update()


apply_pose(new_pose())

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
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
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
    only = os.environ.get('NIX_PREVIEW_VIEWS')
    # The clips' NLA tracks would otherwise pose her over the top of these stills.
    rig.animation_data.use_nla = False
    apply_pose(sit(0))
    for name, at, look in views:
        if only and name not in only.split(','):
            continue
        pos = Vector(at)
        cam.matrix_world = facing(pos - look, pos)
        scene.render.filepath = os.path.join(PREVIEW, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    # One still from each clip, from the front and from her left.
    standing = Vector((0, 1.15, BODY_Z))
    only_clips = os.environ.get('NIX_PREVIEW_CLIPS')
    for clip, t in (('JumpStand', 0), ('JumpStand', 0.15), ('JumpStand', 0.45), ('JumpStand', 1.0), ('Land', 0.3), ('JumpDown', 0.45), ('Swim', 0), ('Swim', 0.25), ('Swim', 0.5), ('Tread', 0), ('Tread', 0.25), ('Fish', 0), ('Cast', 0.38), ('Cast', 0.6), ('Reel', 0), ('Reel', 0.5), ('Show', 0), ('Water', 0.16), ('Water', 0.3), ('Water', 0.55), ('Plant', 0.22), ('Plant', 0.3), ('Plant', 0.56), ('Plant', 0.74), ('Smith', 0.4), ('Smith', 0.62), ('Ready', 0), ('Charge', 0), ('Shot', 0.15), ('Shot', 0.3), ('Slam', 0.32), ('Slam', 0.55), ('Summon', 0.3), ('Summon', 0.55), ('Dash', 0.2), ('Dash', 0.4)):
        if only_clips and clip not in only_clips.split(','):
            continue
        apply_pose(CLIPS[clip][1](t))
        # Only what she's holding for this clip, as on the page.
        rod.hide_render = reel.hide_render = clip not in ('Cast', 'Fish', 'Reel')
        watering_can.hide_render = clip != 'Water'
        hammer.hide_render = clip != 'Smith'
        # The swimming clips float her at the water line, lower down and stretched out.
        afloat_clip = clip in ('Swim', 'Tread')
        look = Vector((0, -0.3, BODY_Z + 0.2)) if afloat_clip else standing
        for view, at in (('front', (0, 1.4, 8)), ('side', (6, 1.6, 5))):
            pos = look + (Vector(at) - standing) * (1.25 if afloat_clip else 1)
            cam.matrix_world = facing(pos - look, pos)
            scene.render.filepath = os.path.join(PREVIEW, f'{clip.lower()}-{t}-{view}.png')
            bpy.ops.render.render(write_still=True)
    print(f'nixchan: previews in {PREVIEW}')
