# Builds Pebble, the sea otter who keeps the market stand on /island, and exports her as a .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-otter/build.py -- <out.glb> [preview-dir]
#
# Modelled in three.js coordinates in metres (y up, feet on y = 0, facing +z) and exported without
# the y-up conversion. Her materials carry the real colours, which the page turns into toon
# materials. She's rigged with a handful of bones that all point straight up with no roll, so a
# pose is just rotations about the world's axes: Hips (with her body and apron skinned between it
# and Chest), Chest, Head (head, hat and face), ArmL and ArmR, and Tail. The clips are Idle, Wave,
# Talk and Happy, all looping; the page turns her head towards Nixchan on top of them.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'otter.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Fur': '#9a6a43',
    'FurDark': '#7a5236',
    'Cream': '#ecd5b0',
    'Nose': '#2c2a52',
    'Eye': '#1d1b3a',
    'Shine': '#ffffff',
    'Blush': '#f2a0a8',
    'Whisker': '#fdfbff',
    'GinghamLight': '#ffe4e8',
    'GinghamMid': '#f7a3ad',
    'GinghamDark': '#ee6170',
    'Frill': '#fdfbff',
    'Pocket': '#fdfbff',
    'Carrot': '#f28c3a',
    'Leaf': '#5fae5c',
    'Straw': '#ecc77a',
    'Band': '#5fb0e8',
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


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------- building blocks ----------


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def paint(self, verts, name):
        index = self.mat(name)
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = index
        return verts

    def done(self):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m])
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        obj = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(obj)
        return obj


def ball(part, centre, radius, mat, scale=(1, 1, 1), seg=(20, 12), matrix=Matrix.Identity(4)):
    verts = bmesh.ops.create_uvsphere(part.bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    bmesh.ops.transform(part.bm, matrix=matrix @ Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1)), verts=verts)
    return part.paint(verts, mat)


def rod(part, a, b, r0, r1, mat, segments=10):
    a, b = Vector(a), Vector(b)
    axis = b - a
    verts = bmesh.ops.create_cone(part.bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1, depth=axis.length)['verts']
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(part.bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=verts)
    return part.paint(verts, mat)


def blob_chain(part, points, radius, mat, steps=10):
    """Spheres along a line of points, for a limb or a tail; melted together by a remesh after."""
    for i in range(steps + 1):
        t = i / steps
        k = min(int(t * (len(points) - 1)), len(points) - 2)
        u = t * (len(points) - 1) - k
        p = Vector(points[k]).lerp(Vector(points[k + 1]), u)
        ball(part, p, radius(t), mat, seg=(14, 8))


def melt(obj, voxel=0.014, iterations=5):
    """Voxel-remesh a part built from overlapping blobs into one smooth skin."""
    for kind, settings in (('REMESH', {'mode': 'VOXEL', 'voxel_size': voxel}), ('LAPLACIANSMOOTH', {'iterations': iterations, 'lambda_factor': 0.8, 'use_volume_preserve': True}), ('DECIMATE', {'ratio': 0.35})):
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
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))


# ---------- her shape ----------
# A pear of a body: a round tummy, a narrower chest, and a big round head on top.
HIP = Vector((0, 0.36, 0))
CHEST = Vector((0, 0.62, 0))
NECK = Vector((0, 0.8, 0))
HEAD = Vector((0, 0.98, 0.02))
SHOULDER = {1: Vector((0.2, 0.66, 0.04)), -1: Vector((-0.2, 0.66, 0.04))}
TAIL_ROOT = Vector((0, 0.2, -0.22))


def body_radius(y):
    lower = 0.3 * math.sqrt(max(0.0, 1 - ((y - 0.36) / 0.36) ** 2))
    upper = 0.23 * math.sqrt(max(0.0, 1 - ((y - 0.64) / 0.22) ** 2))
    return max(lower, upper)


p = Part('Body')
ball(p, HIP, 1, 'Fur', scale=(0.3, 0.36, 0.27))
ball(p, CHEST, 1, 'Fur', scale=(0.23, 0.22, 0.21))
for side in (1, -1):
    # Stubby feet, poking out at the front.
    ball(p, (side * 0.13, 0.05, 0.1), 1, 'Fur', scale=(0.08, 0.05, 0.12))
body = p.done()
melt(body)
# A cream belly and chest over the front, under the apron's bib.
p = Part('Belly')
ball(p, (0, 0.5, 0.15), 1, 'Cream', scale=(0.2, 0.28, 0.13))
belly = p.done()
melt(belly, voxel=0.012)

# The apron: pink gingham, cut like a real one (a bib over her chest narrowing into the waist, and a
# skirt over her tummy with a gently curved hem), laid onto her body by casting in from outside onto
# her fur and belly, so it hugs her shape. A white frill along the hem, white trim along the top of
# the bib, a pocket with a little carrot stitched on, a strap round her neck, and a tie round her
# waist ending in a bow at the back.
depsgraph = bpy.context.evaluated_depsgraph_get()
SURFACES = [BVHTree.FromObject(o, depsgraph) for o in (body, belly)]
AXIS_Z = 0.0


def onto(a, y, lift):
    """The point on her front at `a` radians round from straight ahead and height `y`, lifted off
    her surface by `lift`, with the surface's normal there."""
    d = Vector((math.sin(a), 0, math.cos(a)))
    origin = Vector((0, y, AXIS_Z)) + d * 1.0
    best = None
    for tree in SURFACES:
        hit, normal, _, _ = tree.ray_cast(origin, -d)
        if hit is not None and (best is None or (hit - origin).length < (best[0] - origin).length):
            best = (hit, normal)
    if best is None:
        return Vector((0, y, AXIS_Z)) + d * (body_radius(y) + lift), d
    hit, normal = best
    n = normal.normalized()
    if n.dot(d) < 0:
        n = -n
    return hit + n * lift, n


WAIST = 0.45
HEM = 0.13
TOP = 0.71


def half_width(y):
    """How far round her the apron reaches either side, at each height: wide over the tummy, in at
    the waist, a narrower bib above."""
    skirt = 1.2 - 0.12 * smoothstep(HEM, WAIST, y)
    bib = 0.62 - 0.08 * smoothstep(WAIST + 0.05, TOP, y)
    return lerp(skirt, bib, smoothstep(WAIST - 0.03, WAIST + 0.06, y))


def lerp(a, b, t):
    return a + (b - a) * t


def edge(s):
    """Bottom and top of the apron for a column at s (-1 at her right edge, +1 at her left): the hem
    dips a little in the middle, and the bib's top corners are rounded off."""
    return HEM - 0.03 * (1 - s * s), TOP - 0.05 * abs(s) ** 6


ROWS, COLS = 22, 18
GINGHAM = ('GinghamLight', 'GinghamMid', 'GinghamDark')
p = Part('Apron')
bm = p.bm
front, back = [], []
for i in range(ROWS + 1):
    t = i / ROWS
    rf, rb = [], []
    for j in range(COLS + 1):
        s = -1 + 2 * j / COLS
        lo, hi = edge(s)
        y = lo + (hi - lo) * t
        a = s * half_width(y)
        out, n = onto(a, y, 0.022)
        rf.append(bm.verts.new(out))
        rb.append(bm.verts.new(out - n * 0.01))
    front.append(rf)
    back.append(rb)
mats = [p.mat(m) for m in GINGHAM]
for i in range(ROWS):
    for j in range(COLS):
        # Gingham: light where neither stripe crosses, mid where one does, dark where both do.
        tone = mats[(i // 1) % 2 + (j // 1) % 2]
        f = bm.faces.new((front[i][j], front[i][j + 1], front[i + 1][j + 1], front[i + 1][j]))
        f.material_index = tone
        b = bm.faces.new((back[i + 1][j], back[i + 1][j + 1], back[i][j + 1], back[i][j]))
        b.material_index = mats[1]
edge_mat = mats[2]
for i in range(ROWS):
    for j in (0, COLS):
        f = bm.faces.new((front[i][j], front[i + 1][j], back[i + 1][j], back[i][j]))
        f.material_index = edge_mat
for j in range(COLS):
    for i in (0, ROWS):
        f = bm.faces.new((front[i][j], back[i][j], back[i][j + 1], front[i][j + 1]))
        f.material_index = edge_mat

# A frill of little white scallops along the hem, and white trim along the top of the bib.
for k in range(25):
    s = -1 + 2 * k / 24
    lo, _ = edge(s)
    a = s * half_width(lo)
    at, n = onto(a, lo + 0.005, 0.026)
    ball(p, at, 1, 'Frill', scale=(0.03, 0.022, 0.012), seg=(10, 6), matrix=Matrix.Translation(at) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4() @ Matrix.Translation(-at))
for k in range(11):
    s = -1 + 2 * k / 10
    _, hi = edge(s)
    a = s * half_width(hi)
    at, n = onto(a, hi - 0.004, 0.026)
    ball(p, at, 1, 'Frill', scale=(0.024, 0.012, 0.01), seg=(10, 6), matrix=Matrix.Translation(at) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4() @ Matrix.Translation(-at))

# The pocket, a rounded white patch low on the skirt, with a carrot stitched on it.
pocket, pn = onto(0, 0.28, 0.034)
tilt = Vector((0, 0, 1)).rotation_difference(pn).to_matrix().to_4x4()
on_pocket = lambda x, y, z=0.0: pocket + (tilt @ Vector((x, y, z)).to_4d()).to_3d()
ball(p, pocket, 1, 'Pocket', scale=(0.1, 0.07, 0.01), seg=(20, 8), matrix=Matrix.Translation(pocket) @ tilt @ Matrix.Translation(-pocket))
rod(p, on_pocket(0.018, 0.03, 0.008), on_pocket(-0.016, -0.03, 0.008), 0.011, 0.003, 'Carrot', 8)
for dx in (-0.008, 0.006):
    rod(p, on_pocket(0.018, 0.03, 0.008), on_pocket(0.03 + dx, 0.055, 0.008), 0.004, 0.003, 'Leaf', 5)
apron = p.done()

# The strap from the bib's top corners up round the back of her neck, and the tie round her waist
# with its bow at the back. They're just a tube along points that hug her.
p = Part('Ties')


def tube_along(points, r, mat):
    for a, b in zip(points, points[1:]):
        rod(p, a, b, r, r, mat, 8)
        ball(p, b, r, mat, seg=(8, 6))


for side in (1, -1):
    _, hi = edge(side * 0.9)
    corner, _ = onto(side * 0.9 * half_width(hi), hi - 0.01, 0.024)
    tube_along([corner, Vector((side * 0.13, 0.79, 0.1)), Vector((side * 0.15, 0.82, -0.02)), Vector((side * 0.08, 0.81, -0.12)), Vector((0, 0.8, -0.14))], 0.011, 'GinghamDark')
waist = []
for k in range(33):
    a = -math.pi + 2 * math.pi * k / 32
    at, _ = onto(a, WAIST, 0.03)
    waist.append(at)
tube_along(waist, 0.014, 'GinghamDark')
knot, kn = onto(math.pi, WAIST, 0.045)
ball(p, knot, 0.022, 'GinghamDark', seg=(10, 8))
for side in (1, -1):
    # Two loops either side of the knot, and two tails hanging below.
    loop = [knot + Vector((side * x, y, -0.015 - 0.02 * x)) for x, y in ((0.02, 0.01), (0.06, 0.04), (0.1, 0.03), (0.09, -0.01), (0.05, -0.02), (0.02, -0.005))]
    tube_along(loop, 0.012, 'GinghamDark')
    tube_along([knot, knot + Vector((side * 0.03, -0.06, -0.02)), knot + Vector((side * 0.05, -0.12, -0.03))], 0.012, 'GinghamDark')
ties = p.done()

# Her head: round, a cream muzzle with a dark nose, dot eyes, small round ears, pink cheeks and
# white whiskers; and a little straw hat with a blue band.
p = Part('Head')
ball(p, HEAD, 1, 'Fur', scale=(0.25, 0.22, 0.23))
ball(p, HEAD + Vector((0, -0.07, 0.15)), 1, 'Cream', scale=(0.13, 0.085, 0.09))
ball(p, HEAD + Vector((0, -0.03, 0.235)), 1, 'Nose', scale=(0.045, 0.03, 0.03), seg=(14, 8))
for side in (1, -1):
    ball(p, HEAD + Vector((side * 0.095, 0.035, 0.195)), 0.032, 'Eye', seg=(14, 8))
    ball(p, HEAD + Vector((side * 0.095 + 0.012, 0.05, 0.222)), 0.01, 'Shine', seg=(8, 6))
    ball(p, HEAD + Vector((side * 0.2, 0.13, -0.03)), 1, 'FurDark', scale=(0.055, 0.055, 0.035), seg=(14, 8))
    ball(p, HEAD + Vector((side * 0.16, -0.05, 0.16)), 1, 'Blush', scale=(0.04, 0.022, 0.015), seg=(12, 6))
    for k, tilt in enumerate((-0.15, 0, 0.15)):
        root = HEAD + Vector((side * 0.12, -0.07 + k * 0.02, 0.19))
        tip = root + Vector((side * 0.12, tilt * 0.35, -0.03))
        rod(p, root, tip, 0.004, 0.003, 'Whisker', 5)
ball(p, HEAD + Vector((0, 0.19, -0.01)), 1, 'Straw', scale=(0.3, 0.018, 0.29), seg=(24, 6))
rod(p, HEAD + Vector((0, 0.19, -0.01)), HEAD + Vector((0, 0.32, -0.01)), 0.15, 0.13, 'Straw', 20)
rod(p, HEAD + Vector((0, 0.2, -0.01)), HEAD + Vector((0, 0.245, -0.01)), 0.153, 0.151, 'Band', 20)
ball(p, HEAD + Vector((0, 0.32, -0.01)), 1, 'Straw', scale=(0.13, 0.02, 0.13), seg=(20, 6))
head = p.done()

# Arms hang from the shoulders down to round paws in front of her tummy; the tail's thick at the
# root and tapers back along the ground.
ARMS = {}
for side, name in ((1, 'ArmL'), (-1, 'ArmR')):
    p = Part(name)
    s = SHOULDER[side]
    paw = s + Vector((side * 0.06, -0.2, 0.12))
    blob_chain(p, [s, s + Vector((side * 0.05, -0.1, 0.05)), paw], lambda t: 0.065 - 0.012 * t, 'Fur', steps=8)
    ball(p, paw + Vector((0, -0.02, 0.01)), 0.062, 'FurDark')
    ARMS[side] = p.done()
    melt(ARMS[side], voxel=0.012, iterations=4)
p = Part('Tail')
blob_chain(p, [TAIL_ROOT, TAIL_ROOT + Vector((0, -0.1, -0.15)), TAIL_ROOT + Vector((0, -0.15, -0.35))], lambda t: 0.1 - 0.06 * t, 'Fur', steps=12)
tail = p.done()
melt(tail)

# ---------- the rig ----------

JOINT = {'Hips': HIP, 'Chest': CHEST, 'Head': NECK, 'ArmL': SHOULDER[1], 'ArmR': SHOULDER[-1], 'Tail': TAIL_ROOT}
PARENT = {'Hips': None, 'Chest': 'Hips', 'Head': 'Chest', 'ArmL': 'Chest', 'ArmR': 'Chest', 'Tail': 'Hips'}
BONE_LEN = 0.08
rig_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Pebble', rig_data)
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
    """Hang a rigid part off a bone, where it already is (Blender hangs it from the bone's tail)."""
    world = obj.matrix_basis.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Translation(-(JOINT[bone] + Vector((0, BONE_LEN, 0)))) @ world


def skin(obj):
    """Her body and apron bend between her hips and her chest."""
    obj.parent = rig
    hips = obj.vertex_groups.new(name='Hips')
    chest = obj.vertex_groups.new(name='Chest')
    for v in obj.data.vertices:
        c = smoothstep(0.42, 0.62, v.co.y)
        hips.add([v.index], 1 - c, 'REPLACE')
        chest.add([v.index], c, 'REPLACE')
    obj.modifiers.new('rig', 'ARMATURE').object = rig


for obj in (body, belly, apron, ties):
    skin(obj)
attach(head, 'Head')
attach(ARMS[1], 'ArmL')
attach(ARMS[-1], 'ArmR')
attach(tail, 'Tail')

# ---------- the clips ----------


def euler(x=0.0, y=0.0, z=0.0):
    return Euler((x, y, z), 'XYZ').to_quaternion()


def pose(hips=(0, 0, 0), lift=0.0, chest=(0, 0, 0), head=(0, 0, 0), arm_l=(0, 0, 0), arm_r=(0, 0, 0), tail=(0, 0, 0)):
    return {
        'Hips': (Vector((0, lift, 0)), euler(*hips)),
        'Chest': (Vector(), euler(*chest)),
        'Head': (Vector(), euler(*head)),
        'ArmL': (Vector(), euler(*arm_l)),
        'ArmR': (Vector(), euler(*arm_r)),
        'Tail': (Vector(), euler(*tail)),
    }


# Paws together in front, resting on her apron.
REST_L = (-0.25, 0, -0.2)
REST_R = (-0.25, 0, 0.2)


def idle(t):
    ph = TAU * t
    b = math.sin(ph)
    return pose(hips=(0, 0, 0.02 * math.sin(ph * 0.5 * 2)), chest=(0.03 * b, 0, 0), head=(0.02 * b, 0, 0.05 * math.sin(ph + 1)), arm_l=REST_L, arm_r=REST_R, tail=(0, 0.35 * math.sin(ph), 0))


def wave(t):
    ph = TAU * t
    # Her right paw up beside her head, waving side to side.
    return pose(chest=(0, -0.1, 0.04), head=(0, -0.08, -0.12), arm_l=REST_L, arm_r=(-0.2, 0, -2.5 + 0.35 * math.sin(2 * ph)), tail=(0, 0.5 * math.sin(2 * ph), 0))


def talk(t):
    ph = TAU * t
    return pose(
        chest=(0.04 * math.sin(2 * ph), 0.08 * math.sin(ph), 0),
        head=(0.1 * math.sin(2 * ph), 0.06 * math.sin(ph), 0.06 * math.sin(ph + 0.5)),
        arm_l=(-0.7 + 0.25 * math.sin(ph), 0, -0.35),
        arm_r=(-0.5 + 0.25 * math.sin(ph + 2), 0, 0.3),
        tail=(0, 0.3 * math.sin(ph), 0),
    )


def happy(t):
    ph = TAU * t
    hop = abs(math.sin(2 * ph))
    return pose(
        lift=0.05 * hop,
        chest=(-0.05, 0, 0.05 * math.sin(2 * ph)),
        head=(-0.1, 0, 0.12 * math.sin(2 * ph)),
        arm_l=(-0.3, 0, 2.3 + 0.2 * math.sin(4 * ph)),
        arm_r=(-0.3, 0, -2.3 - 0.2 * math.sin(4 * ph)),
        tail=(0, 0.6 * math.sin(4 * ph), 0),
    )


FPS = 30
CLIPS = {'Idle': (90, idle), 'Wave': (40, wave), 'Talk': (40, talk), 'Happy': (36, happy)}
# The page turns her head itself, on top of the clips.
scene.render.fps = FPS
rig.animation_data_create()
for name, (frames, fn) in CLIPS.items():
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    last = {}
    for f in range(frames + 1):
        for b, (loc, q) in fn(f / frames).items():
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


def apply_pose(p):
    for b, (loc, q) in p.items():
        rig.pose.bones[b].location = loc
        rig.pose.bones[b].rotation_quaternion = q
    bpy.context.view_layer.update()


apply_pose(idle(0))

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
print(f'otter: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 360
    scene.render.resolution_y = 420
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.56, 0.7, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.6, 0.4, 0)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.7
    scene.collection.objects.link(cam)
    scene.camera = cam
    rig.animation_data.use_nla = False
    target = Vector((0, 0.68, 0))
    for clip, t in (('Idle', 0), ('Wave', 0.25), ('Talk', 0.25), ('Happy', 0.25)):
        apply_pose(CLIPS[clip][1](t))
        for view, location in (('front', (0, 0.9, 4)), ('side', (3.4, 1.2, 2))):
            back = (Vector(location) - target).normalized()
            x = Vector((0, 1, 0)).cross(back).normalized()
            cam.matrix_world = Matrix((x, back.cross(x), back)).transposed().to_4x4()
            cam.matrix_world.translation = target + back * 4
            scene.render.filepath = os.path.join(PREVIEW, f'{clip.lower()}-{view}.png')
            bpy.ops.render.render(write_still=True)
    print(f'otter: previews in {PREVIEW}')
