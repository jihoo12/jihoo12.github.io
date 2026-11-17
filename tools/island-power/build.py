# Builds the island's powered machines (a windmill, and a drill to set over an ore vein) and exports
# them as one .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-power/build.py -- <out.glb> [preview-dir]
#
# Like the island's other models (tools/island-forge, tools/island-farm), each piece is its own
# object, named for the page to pick out, modelled in three.js coordinates in metres (y up, standing
# on y = 0, its front towards +z) and exported without the y-up conversion. Their materials carry
# the real colours, which the page turns into toon materials of the same colour; "Lamp" is the one
# the page lights up (or not) to show whether a machine has power.
#
#   Windmill       a timber trestle with a cap on top, and a tail vane behind it
#   WindmillRotor  its four sails round the hub, turning about z, centred on the hub (put it at HUB)
#   Drill          a three-legged frame to stand over an ore rock, a motor at the top with its lamp,
#                  and a little bin on one side for the ore it brings up
#   DrillBit       the bit, hanging from the motor, turning about y, its top at the origin (put it
#                  at BIT_TOP)
#
# The page knows these sizes (to put the rotor and the bit in place, and to walk round the legs),
# so if they change here change them in src/lib/island/power.ts too.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'power.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Timber': '#8a5a3c',
    'TimberLight': '#b07a4f',
    'Sail': '#f4eee0',
    'Roof': '#d9734e',
    'Iron': '#7d86a8',
    'IronDark': '#4f5675',
    'Brass': '#e8b84a',
    'Copper': '#d98a5a',
    'Lamp': '#7dffb0',
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
    bsdf.inputs['Roughness'].default_value = 0.8
    if name == 'Lamp':
        bsdf.inputs['Emission Color'].default_value = (*linear(hex_color), 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    MATS[name] = mat


class Part:
    """One object's mesh, built up from pieces, each with its own material."""

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
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m])
        me.polygons.foreach_set('use_smooth', [False] * len(me.polygons))
        obj = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(obj)
        return obj


def place(bm, verts, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=verts)
    return verts


def cylinder(part, a, b, r0, r1, mat, segments=12):
    """A (tapered) cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    verts = bmesh.ops.create_cone(part.bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1, depth=axis.length)['verts']
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    place(part.bm, verts, Matrix.Translation((a + b) / 2) @ rot)
    if min(r0, r1) == 0:
        bmesh.ops.remove_doubles(part.bm, verts=verts, dist=1e-5)
        verts = [v for v in verts if v.is_valid]
    return part.paint(verts, mat)


def box(part, centre, size, mat, yaw=0.0, tilt=(0.0, 0.0)):
    """A box of `size` at `centre`, turned `yaw` about the vertical and tipped by `tilt` (about x, z)."""
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Z')
    place(part.bm, verts, Matrix.Translation(centre) @ turn @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


def beam(part, a, b, size, mat):
    """A square timber from a to b."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    place(part.bm, verts, Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((size, size, axis.length, 1)))
    return part.paint(verts, mat)


# ---------- the windmill ----------

HUB = (0.0, 3.55, 0.42)  # where the rotor turns, in front of the cap
SAIL = 1.75  # from the hub to a sail's tip
TOWER_TOP = 3.2


def windmill():
    p = Part('Windmill')
    foot, top = 0.75, 0.32
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for sx, sz in corners:
        beam(p, (sx * foot, 0, sz * foot), (sx * top, TOWER_TOP, sz * top), 0.12, 'Timber')
    # Cross-bracing round the trestle in three tiers, and an iron shoe under each leg.
    for y0, y1 in ((0.15, 1.15), (1.15, 2.2), (2.2, TOWER_TOP)):
        w0 = foot + (top - foot) * y0 / TOWER_TOP
        w1 = foot + (top - foot) * y1 / TOWER_TOP
        for k in range(4):
            (ax, az), (bx, bz) = corners[k], corners[(k + 1) % 4]
            beam(p, (ax * w0, y0, az * w0), (bx * w1, y1, bz * w1), 0.06, 'TimberLight')
        for k in range(4):
            (ax, az), (bx, bz) = corners[k], corners[(k + 1) % 4]
            beam(p, (ax * w1, y1, az * w1), (bx * w1, y1, bz * w1), 0.07, 'Timber')
    for sx, sz in corners:
        box(p, (sx * foot, 0.06, sz * foot), (0.24, 0.12, 0.24), 'IronDark')
    # The cap: a little house on top, its roof, and the shaft out to the hub.
    box(p, (0, TOWER_TOP + 0.05, 0), (0.86, 0.1, 0.86), 'Timber')
    box(p, (0, TOWER_TOP + 0.32, -0.05), (0.56, 0.46, 0.7), 'TimberLight')
    for side in (-1, 1):
        box(p, (side * 0.17, TOWER_TOP + 0.66, -0.05), (0.38, 0.06, 0.8), 'Roof', tilt=(0, side * -0.5))
    cylinder(p, (0, HUB[1], 0.2), (0, HUB[1], HUB[2]), 0.07, 0.07, 'IronDark', 10)
    # The tail vane, behind, that keeps it into the wind.
    beam(p, (0, TOWER_TOP + 0.35, -0.4), (0, TOWER_TOP + 0.45, -1.35), 0.06, 'Timber')
    box(p, (0, TOWER_TOP + 0.55, -1.3), (0.04, 0.55, 0.5), 'Sail')
    # A brass box at the foot, where the power's taken off.
    box(p, (0, 0.3, foot * 0.35), (0.34, 0.46, 0.26), 'Brass')
    box(p, (0, 0.5, foot * 0.35 + 0.135), (0.12, 0.08, 0.02), 'Copper')
    return p.done()


def rotor():
    p = Part('WindmillRotor')
    cylinder(p, (0, 0, -0.06), (0, 0, 0.14), 0.16, 0.12, 'Brass', 12)
    cylinder(p, (0, 0, 0.14), (0, 0, 0.22), 0.1, 0.0, 'Brass', 12)
    for k in range(4):
        a = k * TAU / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        n = Vector((-math.sin(a), math.cos(a), 0))
        beam(p, d * 0.1, d * SAIL, 0.06, 'Timber')
        # The sail on one side of its stock, a little twisted to catch the wind.
        for j in range(3):
            r0 = 0.45 + j * 0.43
            r1 = r0 + 0.4
            mid = d * ((r0 + r1) / 2) + n * 0.19
            verts = bmesh.ops.create_cube(p.bm, size=1)['verts']
            frame = Matrix(((d.x, n.x, 0), (d.y, n.y, 0), (0, 0, 1))).to_4x4()
            place(p.bm, verts, Matrix.Translation(mid) @ frame @ Matrix.Rotation(0.18, 4, 'X') @ Matrix.Diagonal((r1 - r0, 0.34, 0.025, 1)))
            p.paint(verts, 'Sail')
        beam(p, d * 0.45 + n * 0.36, d * SAIL + n * 0.36, 0.035, 'TimberLight')
    return p.done()


# ---------- the drill ----------

LEG_R = 1.55  # how far out from the middle of the rock its legs stand
APEX = 2.55  # where the legs meet
BIT_TOP = 1.95  # the top of the bit, under the motor
BIT_LEN = 0.75
BIN = (0.0, 1.85)  # the bin's middle, in x and z: out in front, between two legs


def drill():
    p = Part('Drill')
    for k in range(3):
        a = TAU * k / 3 + math.pi / 6
        x, z = math.cos(a) * LEG_R, math.sin(a) * LEG_R
        beam(p, (x, 0, z), (x * 0.18, APEX, z * 0.18), 0.11, 'Iron')
        box(p, (x, 0.05, z), (0.26, 0.1, 0.26), 'IronDark')
        # A rung between each pair of legs, a little way up.
        b = TAU * (k + 1) / 3 + math.pi / 6
        y = 1.2
        f = 1 - (1 - 0.18) * y / APEX
        beam(p, (x * f, y, z * f), (math.cos(b) * LEG_R * f, y, math.sin(b) * LEG_R * f), 0.06, 'IronDark')
    # The motor: a drum with brass bands, its lamp on the front, and a copper coil on the side.
    cylinder(p, (0, BIT_TOP + 0.05, 0), (0, APEX + 0.35, 0), 0.34, 0.3, 'IronDark', 14)
    for y in (BIT_TOP + 0.15, APEX + 0.25):
        cylinder(p, (0, y - 0.03, 0), (0, y + 0.03, 0), 0.36, 0.36, 'Brass', 14)
    cylinder(p, (0, APEX + 0.35, 0), (0, APEX + 0.45, 0), 0.22, 0.12, 'Iron', 12)
    cylinder(p, (0.34, BIT_TOP + 0.32, 0), (0.48, BIT_TOP + 0.32, 0), 0.11, 0.11, 'Copper', 10)
    box(p, (0, BIT_TOP + 0.55, 0.33), (0.14, 0.14, 0.06), 'Lamp')
    box(p, (0, BIT_TOP + 0.55, 0.3), (0.2, 0.2, 0.05), 'Brass')
    # The chute down from the motor, and the bin it fills, out front.
    bx, bz = BIN
    beam(p, (0, BIT_TOP + 0.2, 0.28), (bx, 0.75, bz - 0.15), 0.1, 'Iron')
    box(p, (bx, 0.05, bz), (0.6, 0.1, 0.5), 'Timber')
    for sx in (-1, 1):
        box(p, (bx + sx * 0.28, 0.3, bz), (0.05, 0.4, 0.5), 'TimberLight')
    for sz in (-1, 1):
        box(p, (bx, 0.3, bz + sz * 0.23), (0.6, 0.4, 0.05), 'TimberLight')
    return p.done()


def drill_bit():
    p = Part('DrillBit')
    cylinder(p, (0, 0, 0), (0, -0.2, 0), 0.08, 0.08, 'Iron', 10)
    # A screw: a stack of little blades turned round as it goes down, then the point.
    n = 7
    for j in range(n):
        y = -0.2 - j * (BIT_LEN - 0.35) / n
        r = 0.16 - j * 0.012
        box(p, (0, y, 0), (r * 2, 0.04, 0.07), 'Brass', yaw=j * 0.7)
    cylinder(p, (0, -0.15, 0), (0, -BIT_LEN + 0.15, 0), 0.06, 0.05, 'IronDark', 10)
    cylinder(p, (0, -BIT_LEN + 0.15, 0), (0, -BIT_LEN, 0), 0.07, 0.0, 'Iron', 10)
    return p.done()


OBJECTS = [windmill(), rotor(), drill(), drill_bit()]

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
tris = sum(len(f.vertices) - 2 for o in OBJECTS for f in o.data.polygons)
print(f'power: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    # Blender's own z-up world, for the previews: stand the y-up models upright in it, and put the
    # rotor and the bit where they go.
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 700
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.3, 0.5)
    layout = {'Windmill': (-2.5, 0, 0), 'WindmillRotor': (-2.5 + HUB[0], HUB[2], HUB[1]), 'Drill': (2.5, 0, 0), 'DrillBit': (2.5, 0, BIT_TOP)}
    for o in OBJECTS:
        x, y, z = layout[o.name]
        # Blender's y is the page's -z.
        o.location = (x, -y, z)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 9
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target in (('front', (3, -20, 6), (0, 0, 2)), ('side', (20, -6, 6), (0, 0, 2))):
        target = Vector(target)
        direction = target - Vector(location)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam.location = location
        scene.render.filepath = os.path.join(PREVIEW, f'power-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'power: previews in {PREVIEW}')
