# Builds Parmen, the old tortoise who sits on the Lonely Islet off /island and asks after being and
# not-being, and exports him as a .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-tortoise/build.py -- <out.glb> [preview-dir]
#
# Modelled in three.js coordinates in metres (y up, feet on y = 0, facing +z) and exported without
# the y-up conversion, like Pebble (tools/island-otter). His materials carry the real colours, which
# the page turns into toon materials. Everything on him is rigid, hung off a few bones that point
# straight up with no roll: Body (the shell, legs and tail), Neck, and Head (head, spectacles,
# brows, and the beard, a separate smooth part). The clips are Idle, Talk and Nod, all looping; the page turns his head towards
# Nixchan on top of them.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'tortoise.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Shell': '#8a7a4e',
    'ShellLight': '#a8975f',
    'Seam': '#4f4630',
    'Rim': '#6f6340',
    'Plastron': '#e3cf98',
    'Skin': '#9aa37c',
    'SkinDark': '#7b8460',
    'Nail': '#efe3c4',
    'Eye': '#1d1b3a',
    'Shine': '#ffffff',
    'Beard': '#e2ded3',
    'Wire': '#d6a63c',
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


def ball(part, centre, radius, mat, scale=(1, 1, 1), seg=(20, 12)):
    verts = bmesh.ops.create_uvsphere(part.bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    bmesh.ops.transform(part.bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1)), verts=verts)
    return part.paint(verts, mat)


def rod(part, a, b, r0, r1, mat, segments=10):
    a, b = Vector(a), Vector(b)
    axis = b - a
    verts = bmesh.ops.create_cone(part.bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1, depth=axis.length)['verts']
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(part.bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=verts)
    return part.paint(verts, mat)


def ring(part, centre, radius, thickness, normal, mat, steps=18):
    """A thin wire ring (a spectacle's rim) round `centre`, facing `normal`."""
    n = Vector(normal).normalized()
    u = n.orthogonal().normalized()
    v = n.cross(u)
    pts = [Vector(centre) + (u * math.cos(TAU * k / steps) + v * math.sin(TAU * k / steps)) * radius for k in range(steps)]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        rod(part, a, b, thickness, thickness, mat, 6)


def melt(obj, voxel=0.006, iterations=4):
    """Voxel-remesh a part built from overlapping blobs into one smooth skin (as Pebble's are)."""
    for kind, settings in (('REMESH', {'mode': 'VOXEL', 'voxel_size': voxel}), ('LAPLACIANSMOOTH', {'iterations': iterations, 'lambda_factor': 0.8, 'use_volume_preserve': True}), ('DECIMATE', {'ratio': 0.4})):
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


# ---------- his shell ----------
# A high dome of a shell, older than anything else on the island: big scutes, each a little paler in
# the middle, with dark seams between, and a band of rim scutes round the edge over a cream plastron.
SHELL = Vector((0, 0.3, -0.04))
SHELL_SCALE = Vector((0.56, 0.4, 0.66))
RIM_Y = 0.24

p = Part('Shell')
verts = bmesh.ops.create_uvsphere(p.bm, u_segments=84, v_segments=44, radius=1)['verts']
for v in verts:
    x, y, z = v.co
    # The underside's squashed flat, so he sits low on his plastron.
    if y < 0:
        y *= 0.35
    v.co = SHELL + Vector((x * SHELL_SCALE.x, y * SHELL_SCALE.y, z * SHELL_SCALE.z))
# The scutes: one on top, a ring of five round it, and the rim below. Each face takes the colour of
# the scute it's nearest the middle of, and faces near a boundary between two make the seam.
up = Vector((0, 1, 0))
SCUTES = [Vector((0, 1, 0.05))]
for k in range(5):
    a = TAU * k / 5 + 0.35
    SCUTES.append(Vector((math.sin(a) * 0.8, 0.6, math.cos(a) * 0.8)))
SCUTES = [s.normalized() for s in SCUTES]
idx = {name: p.mat(name) for name in ('Shell', 'ShellLight', 'Seam', 'Rim', 'Plastron')}
for f in p.bm.faces:
    c = f.calc_center_median()
    local = Vector(((c.x - SHELL.x) / SHELL_SCALE.x, (c.y - SHELL.y) / SHELL_SCALE.y, (c.z - SHELL.z) / SHELL_SCALE.z))
    if c.y < SHELL.y - 0.04:
        f.material_index = idx['Plastron']
        continue
    if c.y < RIM_Y + 0.07:
        # Rim scutes: a band round the edge, notched into short blocks by seams.
        a = math.atan2(local.x, local.z)
        f.material_index = idx['Seam'] if (a / TAU * 22) % 1 < 0.12 or c.y > RIM_Y + 0.055 else idx['Rim']
        continue
    d = local.normalized()
    near = sorted((1 - d.dot(s), i) for i, s in enumerate(SCUTES))
    gap = near[1][0] - near[0][0]
    if gap < 0.035:
        f.material_index = idx['Seam']
    else:
        # Paler towards the middle of each scute (its growth rings).
        f.material_index = idx['ShellLight'] if near[0][0] < 0.04 else idx['Shell']
shell = p.done()

# Four thick, elephant-like legs with cream toenails, and a short tail.
p = Part('Legs')
for sx in (1, -1):
    for sz, lean in ((1, 0.08), (-1, -0.06)):
        hip = Vector((sx * 0.4, 0.22, sz * 0.36))
        foot = Vector((sx * 0.48, 0.06, sz * 0.4 + lean))
        rod(p, hip, foot, 0.13, 0.12, 'Skin', 14)
        ball(p, foot, 1, 'Skin', scale=(0.13, 0.07, 0.14), seg=(16, 8))
        ball(p, hip, 0.13, 'Skin', seg=(14, 8))
        for k in (-1, 0, 1):
            ball(p, foot + Vector((sx * 0.02 + k * 0.05, -0.02, sz * 0.12)), 0.028, 'Nail', seg=(8, 6))
rod(p, (0, 0.2, -0.62), (0, 0.13, -0.78), 0.06, 0.015, 'Skin', 10)
legs = p.done()

# ---------- his neck and head ----------
NECK = Vector((0, 0.28, 0.5))
HEAD = Vector((0, 0.54, 0.98))

p = Part('Neck')
rod(p, NECK + Vector((0, -0.02, -0.08)), HEAD + Vector((0, -0.06, -0.1)), 0.13, 0.1, 'Skin', 16)
# Folds of old skin round his neck.
for k in range(3):
    at = NECK.lerp(HEAD + Vector((0, -0.06, -0.1)), 0.2 + k * 0.25)
    ball(p, at, 1, 'SkinDark', scale=(0.13 - k * 0.01, 0.03, 0.12 - k * 0.01), seg=(16, 6))
neck = p.done()

p = Part('Head')
ball(p, HEAD, 1, 'Skin', scale=(0.16, 0.14, 0.2))
# A blunt, beaky snout, and a mouth line that's nearly a smile.
ball(p, HEAD + Vector((0, -0.03, 0.14)), 1, 'Skin', scale=(0.11, 0.09, 0.09))
rod(p, HEAD + Vector((-0.08, -0.06, 0.15)), HEAD + Vector((0, -0.075, 0.215)), 0.008, 0.008, 'SkinDark', 6)
rod(p, HEAD + Vector((0, -0.075, 0.215)), HEAD + Vector((0.08, -0.06, 0.15)), 0.008, 0.008, 'SkinDark', 6)
for side in (1, -1):
    eye = HEAD + Vector((side * 0.095, 0.035, 0.12))
    ball(p, eye, 0.034, 'Eye', seg=(14, 8))
    ball(p, eye + Vector((side * 0.01, 0.014, 0.026)), 0.009, 'Shine', seg=(8, 6))
    # Heavy lids, half down: he's thinking.
    ball(p, eye + Vector((0, 0.03, 0.002)), 1, 'SkinDark', scale=(0.04, 0.016, 0.036), seg=(14, 8))
    # Bushy white brows over them, and the spectacles.
    ball(p, eye + Vector((side * 0.012, 0.06, 0.0)), 1, 'Beard', scale=(0.05, 0.016, 0.024), seg=(12, 6))
    # The spectacles rest on his snout, the bridge across the top of it, clear of his head; and
    # their arms run back over his cheeks.
    rim = Vector((side * 0.1, 0.05, 0.21))
    ring(p, HEAD + rim, 0.038, 0.005, (side * 0.15, 0, 1), 'Wire')
    rod(p, HEAD + rim + Vector((side * 0.038, 0, -0.004)), HEAD + Vector((side * 0.155, 0.05, 0.0)), 0.005, 0.005, 'Wire', 5)
rod(p, HEAD + Vector((-0.062, 0.05, 0.21)), HEAD + Vector((0.062, 0.05, 0.21)), 0.005, 0.005, 'Wire', 5)
head = p.done()

# A wisp of grey-white beard under his chin, set back from his mouth: three strands from under his jaw, splaying a little
# and waving as they hang, melted together at the root into one tuft with three points.
p = Part('Beard')
for dx, length, phase in ((0.0, 0.11, 0.0), (-0.03, 0.085, 1.4), (0.03, 0.09, 2.6)):
    for i in range(11):
        t = i / 10
        at = HEAD + Vector((dx * (1 + t * 0.6) + 0.008 * math.sin(t * 5 + phase), -0.125 - length * t, 0.035 + 0.03 * t + 0.008 * math.sin(t * 4 + phase)))
        r = 0.03 * (1 - t) ** 0.8 + 0.004
        ball(p, at, r, 'Beard', seg=(12, 8))
ball(p, HEAD + Vector((0, -0.125, 0.04)), 1, 'Beard', scale=(0.06, 0.03, 0.05), seg=(14, 8))
beard = p.done()
melt(beard)

# ---------- the rig ----------

JOINT = {'Body': Vector((0, 0.25, 0)), 'Neck': NECK, 'Head': HEAD + Vector((0, -0.04, -0.12))}
PARENT = {'Body': None, 'Neck': 'Body', 'Head': 'Neck'}
BONE_LEN = 0.08
rig_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Parmen', rig_data)
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


attach(shell, 'Body')
attach(legs, 'Body')
attach(neck, 'Neck')
attach(head, 'Head')
attach(beard, 'Head')

# ---------- the clips ----------


def euler(x=0.0, y=0.0, z=0.0):
    return Euler((x, y, z), 'XYZ').to_quaternion()


def pose(lift=0.0, body=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0)):
    return {
        'Body': (Vector((0, lift, 0)), euler(*body)),
        'Neck': (Vector(), euler(*neck)),
        'Head': (Vector(), euler(*head)),
    }


def idle(t):
    # Slow breathing, his neck easing out and back, his head drifting as if he's mulling something.
    ph = TAU * t
    return pose(lift=0.008 * math.sin(ph), neck=(0.06 * math.sin(ph), 0, 0), head=(-0.05 + 0.04 * math.sin(ph + 1), 0, 0.06 * math.sin(ph * 0.5 * 2 + 0.4)))


def talk(t):
    ph = TAU * t
    return pose(lift=0.006 * math.sin(2 * ph), neck=(0.1 + 0.05 * math.sin(2 * ph), 0, 0), head=(-0.08 * math.sin(2 * ph), 0.1 * math.sin(ph), 0.08 * math.sin(ph + 0.6)))


def nod(t):
    # Two slow, deep nods: "just so".
    ph = TAU * t
    return pose(neck=(0.12, 0, 0), head=(0.25 * max(0.0, math.sin(2 * ph)), 0, 0))


FPS = 30
CLIPS = {'Idle': (150, idle), 'Talk': (48, talk), 'Nod': (60, nod)}
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
            if b == 'Body':
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
print(f'tortoise: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 420
    scene.render.resolution_y = 360
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
    cam.data.ortho_scale = 2.0
    scene.collection.objects.link(cam)
    scene.camera = cam
    rig.animation_data.use_nla = False
    target = Vector((0, 0.38, 0.1))
    for clip, t in (('Idle', 0), ('Talk', 0.25), ('Nod', 0.25)):
        apply_pose(CLIPS[clip][1](t))
        for view, location in (('front', (0.6, 0.9, 4)), ('side', (3.4, 1.4, 1.2)), ('face', (0, 0.6, 4)), ('face34', (2.6, 0.9, 3)), ('faceside', (4, 0.55, 0.5))):
            back = (Vector(location) - target).normalized()
            x = Vector((0, 1, 0)).cross(back).normalized()
            cam.matrix_world = Matrix((x, back.cross(x), back)).transposed().to_4x4()
            cam.matrix_world.translation = target + back * 4
            cam.data.ortho_scale = 0.7 if view.startswith('face') else 2.0
            if view.startswith('face'):
                cam.matrix_world.translation = HEAD + Vector((0, 0, 0.1)) + back * 4
            scene.render.filepath = os.path.join(PREVIEW, f'{clip.lower()}-{view}.png')
            bpy.ops.render.render(write_still=True)
    print(f'tortoise: previews in {PREVIEW}')
