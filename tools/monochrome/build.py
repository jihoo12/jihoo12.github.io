# Builds the pieces of /monochrome, the grey place through the rift at the standing stones, and
# exports them as one .glb: the walls the cells are walled with, the posts at their corners, and the
# things that stand about in them.
#
#   nix develop .#blender -c blender -b -P tools/monochrome/build.py -- <out.glb> [preview-dir]
#
# Like the island's models, each piece is its own object, named for the page to pick out, modelled
# in three.js coordinates in metres (y up, standing on y = 0) and exported without the y-up
# conversion. There is no colour here: the materials are shades of grey, named for what they are
# ("Stone", "Dark", "Pale", "Black", "Glow"), and the page makes its own toon materials of them,
# which take on a little colour as Nixchan brings it back.
#
#   Wall       one side of a cell: 12 long (along x), 0.5 thick, 5 high, centred on x = z = 0
#   DoorWall   the same, with a doorway 3.2 wide and 3.6 high through its middle
#   TallWall   a side of the tower: 0.5 thick and 32 high, banded, with slit windows
#   Post       the post at a cell's corner, 0.9 square and 5.6 high
#   TallPost   the tower's corners, 1.2 square and 32 high
#   Column     a round column, 0.45 across the shaft and 4.6 high
#   Obelisk    the obelisk in the court: 2.6 square at the foot, 9.4 high
#   Arch       a stone arch standing on its own, 4.4 between its legs
#   Stairs     a flight of eight steps up to nowhere, 2.4 wide, running towards -z
#   Cube       a black cube, 1.2 on a side, centred on the origin (the page floats it)
#   Plinth     the stand a colour shard sits over, 1.1 high
#   Tablet     an upright stone with something carved on it, its face towards +z
#   RiftFrame  two jagged stones either side of a gap 2.4 wide, where the page hangs the rift
#   Lamp       a post with a lantern on top; the lantern is "Glow"
#
# The page knows these sizes (to walk round them and keep the camera out of them), so if they
# change here change them in src/lib/monochrome/blocks.ts too.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'monochrome.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

CELL = 12.0
WALL_T = 0.5
WALL_H = 5.0
DOOR_W = 3.2
DOOR_H = 3.6
POST = 0.9
POST_H = 5.6
TALL_H = 32.0
TALL_POST = 1.2

COLORS = {
    'Stone': '#a9a9a9',
    'Dark': '#5b5b5b',
    'Pale': '#ececec',
    'Black': '#232323',
    'Glow': '#ffffff',
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
    if name == 'Glow':
        bsdf.inputs['Emission Color'].default_value = (*linear(hex_color), 1)
        bsdf.inputs['Emission Strength'].default_value = 0.8
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


def box(part, centre, size, mat, yaw=0.0, tilt=(0.0, 0.0)):
    """A box of `size` at `centre`, turned `yaw` about the vertical and tipped by `tilt` (about x, z)."""
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Z')
    place(part.bm, verts, Matrix.Translation(centre) @ turn @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


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


def frustum(part, y0, y1, w0, w1, mat):
    """A square block tapering from `w0` across at y0 to `w1` across at y1 (a point, if w1 is 0)."""
    return cylinder(part, (0, y0, 0), (0, y1, 0), w0 / math.sqrt(2), w1 / math.sqrt(2), mat, 4)


def turned(part, verts, yaw):
    place(part.bm, verts, Matrix.Rotation(yaw, 4, 'Y'))
    return verts


# ---------- the walls and posts every cell is made of ----------


def wall_courses(p, x0, x1, top):
    """The plain run of a wall from x0 to x1: its foot, its face and its coping."""
    length = x1 - x0
    mid = (x0 + x1) / 2
    box(p, (mid, 0.15, 0), (length, 0.3, WALL_T + 0.12), 'Dark')
    box(p, (mid, top / 2, 0), (length, top, WALL_T), 'Stone')


def wall():
    p = Part('Wall')
    wall_courses(p, -CELL / 2, CELL / 2, WALL_H)
    box(p, (0, WALL_H + 0.1, 0), (CELL, 0.2, WALL_T + 0.2), 'Dark')
    # A line of shallow panels down both faces, so a long wall reads as a wall, not a sheet.
    for k in range(-2, 3):
        for side in (-1, 1):
            box(p, (k * 2.4, 2.6, side * (WALL_T / 2 + 0.02)), (1.6, 3.2, 0.04), 'Pale' if k == 0 else 'Stone')
    return p.done()


def door_wall():
    p = Part('DoorWall')
    half = DOOR_W / 2
    for side in (-1, 1):
        x0, x1 = sorted((side * half, side * CELL / 2))
        wall_courses(p, x0, x1, WALL_H)
    # Over the doorway, and its frame.
    box(p, (0, (DOOR_H + WALL_H) / 2, 0), (DOOR_W, WALL_H - DOOR_H, WALL_T), 'Stone')
    box(p, (0, WALL_H + 0.1, 0), (CELL, 0.2, WALL_T + 0.2), 'Dark')
    for side in (-1, 1):
        box(p, (side * (half + 0.15), DOOR_H / 2, 0), (0.3, DOOR_H, WALL_T + 0.16), 'Pale')
    box(p, (0, DOOR_H + 0.15, 0), (DOOR_W + 0.6, 0.3, WALL_T + 0.16), 'Pale')
    return p.done()


def tall_wall():
    p = Part('TallWall')
    wall_courses(p, -CELL / 2, CELL / 2, TALL_H)
    # Bands round the tower every few metres, and slit windows between them, black and empty.
    for k in range(1, 8):
        box(p, (0, k * 4.0, 0), (CELL, 0.25, WALL_T + 0.14), 'Dark')
    for k in range(1, 7):
        for x in (-3.6, 0.0, 3.6):
            for side in (-1, 1):
                box(p, (x, k * 4.0 + 2.0, side * (WALL_T / 2 + 0.01)), (0.36, 1.8, 0.04), 'Black')
    return p.done()


def post():
    p = Part('Post')
    box(p, (0, POST_H / 2, 0), (POST, POST_H, POST), 'Dark')
    box(p, (0, 0.2, 0), (POST + 0.2, 0.4, POST + 0.2), 'Dark')
    frustum(p, POST_H, POST_H + 0.5, POST + 0.15, 0.0, 'Pale')
    return p.done()


def tall_post():
    p = Part('TallPost')
    box(p, (0, TALL_H / 2, 0), (TALL_POST, TALL_H, TALL_POST), 'Dark')
    return p.done()


# ---------- what stands about in them ----------


def column():
    p = Part('Column')
    box(p, (0, 0.18, 0), (1.15, 0.36, 1.15), 'Dark')
    cylinder(p, (0, 0.36, 0), (0, 4.1, 0), 0.47, 0.4, 'Pale', 12)
    # Fluting: a ring of thin ribs up the shaft.
    for k in range(8):
        a = k * math.pi / 4
        cylinder(p, (math.cos(a) * 0.44, 0.45, math.sin(a) * 0.44), (math.cos(a) * 0.38, 4.0, math.sin(a) * 0.38), 0.07, 0.06, 'Pale', 4)
    box(p, (0, 4.25, 0), (0.95, 0.3, 0.95), 'Dark')
    box(p, (0, 4.5, 0), (1.25, 0.2, 1.25), 'Pale')
    return p.done()


def obelisk():
    p = Part('Obelisk')
    box(p, (0, 0.25, 0), (3.4, 0.5, 3.4), 'Dark')
    box(p, (0, 0.65, 0), (2.9, 0.3, 2.9), 'Stone')
    frustum(p, 0.8, 8.4, 2.1, 1.25, 'Black')
    frustum(p, 8.4, 9.4, 1.25, 0.0, 'Pale')
    return p.done()


def arch():
    p = Part('Arch')
    half = 2.2
    for side in (-1, 1):
        box(p, (side * (half + 0.4), 0.2, 0), (1.1, 0.4, 1.1), 'Dark')
        box(p, (side * (half + 0.4), 2.2, 0), (0.8, 3.6, 0.8), 'Stone')
    # A square-cut top: a lintel, and a step of stone over it.
    box(p, (0, 4.25, 0), (2 * half + 2.0, 0.5, 1.0), 'Stone')
    box(p, (0, 4.7, 0), (2 * half + 0.8, 0.4, 0.8), 'Dark')
    box(p, (0, 5.1, 0), (1.2, 0.4, 0.8), 'Pale')
    return p.done()


def stairs():
    p = Part('Stairs')
    steps = 8
    rise = 0.4
    tread = 0.55
    for k in range(steps):
        # Each step is a block from the ground up, so the flight is solid underneath.
        top = (k + 1) * rise
        box(p, (0, top / 2, -k * tread - tread / 2), (2.4, top, tread), 'Pale' if k % 2 == 0 else 'Stone')
    # A landing at the top, and nothing beyond it.
    box(p, (0, steps * rise / 2, -steps * tread - 0.6), (2.4, steps * rise, 1.2), 'Stone')
    box(p, (0, steps * rise + 0.08, -steps * tread - 0.6), (2.6, 0.16, 1.4), 'Dark')
    return p.done()


def cube():
    p = Part('Cube')
    box(p, (0, 0, 0), (1.2, 1.2, 1.2), 'Black')
    return p.done()


def plinth():
    p = Part('Plinth')
    box(p, (0, 0.15, 0), (1.4, 0.3, 1.4), 'Dark')
    box(p, (0, 0.65, 0), (0.85, 0.7, 0.85), 'Stone')
    box(p, (0, 1.05, 0), (1.15, 0.12, 1.15), 'Pale')
    return p.done()


def tablet():
    p = Part('Tablet')
    box(p, (0, 0.15, 0), (1.6, 0.3, 0.7), 'Dark')
    box(p, (0, 1.15, 0), (1.25, 1.7, 0.28), 'Dark')
    box(p, (0, 2.06, 0), (1.4, 0.14, 0.4), 'Stone')
    # The carving: lines of pale marks on its face.
    for k in range(4):
        width = 0.9 if k % 2 == 0 else 0.7
        box(p, (0, 1.65 - k * 0.28, 0.15), (width, 0.08, 0.03), 'Pale')
    return p.done()


def rift_frame():
    p = Part('RiftFrame')
    gap = 2.4
    for side in (-1, 1):
        x = side * (gap / 2 + 0.45)
        box(p, (x, 0.2, 0), (1.3, 0.4, 1.1), 'Dark')
        # Each stone is a stack of blocks, a little out of true, as if they'd grown there.
        y = 0.4
        for k, (h, w, lean) in enumerate(((1.4, 0.95, 0.04), (1.2, 0.8, -0.06), (1.0, 0.7, 0.08))):
            box(p, (x + side * 0.05 * k, y + h / 2, 0.02 * k), (w, h, 0.8), 'Stone' if k % 2 == 0 else 'Dark', yaw=0.1 * side * k, tilt=(0.0, lean * side))
            y += h
    # A stone fallen across the top, resting on both.
    box(p, (0.1, 4.2, 0), (gap + 2.2, 0.4, 0.75), 'Dark', tilt=(0.0, 0.05))
    box(p, (-0.3, 4.55, 0), (1.0, 0.3, 0.5), 'Pale', yaw=0.2)
    return p.done()


def lamp():
    p = Part('Lamp')
    box(p, (0, 0.15, 0), (0.7, 0.3, 0.7), 'Dark')
    box(p, (0, 1.6, 0), (0.18, 2.6, 0.18), 'Dark')
    box(p, (0, 2.95, 0), (0.6, 0.1, 0.6), 'Dark')
    box(p, (0, 3.3, 0), (0.4, 0.6, 0.4), 'Glow')
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        box(p, (math.sin(a) * 0.24, 3.3, math.cos(a) * 0.24), (0.07, 0.62, 0.07), 'Dark')
    frustum(p, 3.6, 4.0, 0.75, 0.0, 'Dark')
    return p.done()


OBJECTS = [wall(), door_wall(), tall_wall(), post(), tall_post(), column(), obelisk(), arch(), stairs(), cube(), plinth(), tablet(), rift_frame(), lamp()]

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
print(f'monochrome: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    # Blender's own z-up world, for the previews: stand the y-up models upright in it.
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 700
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.3, 0.5)
    layout = {
        'Wall': (-20, 8),
        'DoorWall': (-6, 8),
        'TallWall': (8, 14),
        'Post': (-13, 4),
        'TallPost': (15, 14),
        'Column': (-18, 0),
        'Obelisk': (-12, -2),
        'Arch': (-5, 0),
        'Stairs': (1, 2),
        'Cube': (5, -3),
        'Plinth': (5, 0),
        'Tablet': (8, 0),
        'RiftFrame': (13, 0),
        'Lamp': (18, 0),
    }
    for o in OBJECTS:
        x, y = layout[o.name]
        o.location = (x, y, 1.5 if o.name == 'Cube' else 0)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 46
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target in (('front', (0, -60, 20), (0, 4, 5)), ('above', (0, -30, 50), (0, 4, 2))):
        target = Vector(target)
        direction = target - Vector(location)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam.location = location
        scene.render.filepath = os.path.join(PREVIEW, f'monochrome-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'monochrome: previews in {PREVIEW}')
