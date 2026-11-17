# Builds the ruins on Cloudrest, the island in the sky over /island, and exports them as one .glb:
# a ring temple, the spire on the island's upper tier, a broken arch, a stone lantern and the
# crystals that grow back after they're gathered.
#
#   nix develop .#blender -c blender -b -P tools/island-sky/build.py -- <out.glb> [preview-dir]
#
# Like the garden's models (tools/island-farm), each piece is its own object, named for the page to
# pick out, modelled in three.js coordinates in metres (y up, standing on y = 0) and exported without
# the y-up conversion. Their materials carry the real colours, which the page turns into toon
# materials of the same colour; "Glow" is drawn unlit, so it shines.
#
#   Temple        a stepped round platform and a ring of twelve columns (two of them fallen) under
#                 a broken lintel, round an altar; the page floats a crystal over the altar
#   Spire         a tall, tapering tower with its top broken off, on a plinth; a crystal floats in
#                 the cup at the top
#   Arch          a stone arch with one side of its top fallen in
#   Lantern       a stone lantern; its window is "Glow"
#   CrystalRock   the rock a crystal cluster grows from, which stays when it's gathered
#   Crystal       the cluster itself
#
# The page knows these sizes (to walk round the columns and climb the steps), so if they change here
# change them in src/lib/island/skyisle.ts too.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'sky.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Stone': '#e9e4f5',
    'StoneShade': '#c9c2e2',
    'StoneDark': '#a9a1cc',
    'Gold': '#ffd84d',
    'Tile': '#8fd3f0',
    'TileDeep': '#5fb0e8',
    'Roof': '#7b8fd6',
    'Glow': '#fff1b8',
    'Crystal': '#9fe3ff',
    'CrystalPale': '#d8f6ff',
    'Rock': '#9890bb',
    'Moss': '#9ad67f',
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
    if name in ('Glow', 'Crystal', 'CrystalPale'):
        bsdf.inputs['Emission Color'].default_value = (*linear(hex_color), 1)
        bsdf.inputs['Emission Strength'].default_value = 0.6 if name == 'Glow' else 0.25
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
        # The pieces come out of bmesh facing the right way already. (Recalculating the normals over
        # the whole object, with its pieces running into each other, turns some of them inside out.)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m])
        # Faceted, like everything else on the island.
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
        # A point: its cap collapses to nothing, and left in it turns the tip black.
        bmesh.ops.remove_doubles(part.bm, verts=verts, dist=1e-5)
        verts = [v for v in verts if v.is_valid]
    return part.paint(verts, mat)


def disc(part, y0, y1, r, mat, segments=24, r_top=None):
    """An upright round slab from height y0 to y1."""
    return cylinder(part, (0, y0, 0), (0, y1, 0), r, r if r_top is None else r_top, mat, segments)


def box(part, centre, size, mat, yaw=0.0, tilt=(0.0, 0.0)):
    """A box of `size` at `centre`, turned `yaw` about the vertical and tipped by `tilt` (about x, z)."""
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Z')
    place(part.bm, verts, Matrix.Translation(centre) @ turn @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


def wedge(part, centre, r0, r1, a0, a1, depth, mat):
    """One block of an arch: the ring between radii r0 and r1 from angle a0 to a1 (0 is +x, going
    up over the top), `depth` thick, round `centre` in the xy plane."""
    bm = part.bm
    cx, cy = centre
    corners = []
    for r, a in ((r0, a0), (r0, a1), (r1, a1), (r1, a0)):
        corners.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    front = [bm.verts.new((x, y, depth / 2)) for x, y in corners]
    back = [bm.verts.new((x, y, -depth / 2)) for x, y in corners]
    faces = [front, list(reversed(back))] + [[front[i], back[i], back[(i + 1) % 4], front[(i + 1) % 4]] for i in range(4)]
    for f in faces:
        bm.faces.new(f)
    verts = front + back
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


def gem(part, base, direction, length, radius, mat, sides=6):
    """A crystal: a prism from `base` along `direction`, with a pointed tip."""
    d = Vector(direction).normalized()
    shaft = base + d * (length * 0.72)
    cylinder(part, base, shaft, radius, radius * 0.92, mat, sides)
    return cylinder(part, shaft, base + d * length, radius * 0.92, 0.0, mat, sides)


def rock(part, centre, radius, mat, squash=0.6, seed=0):
    verts = bmesh.ops.create_icosphere(part.bm, subdivisions=1, radius=radius)['verts']
    for v in verts:
        k = 0.85 + 0.25 * math.sin(v.co.x * 5.1 + seed) * math.cos(v.co.z * 4.3 - seed * 2)
        v.co = Vector((v.co.x * k, v.co.y * squash * k, v.co.z * k)) + Vector(centre)
    return part.paint(verts, mat)


# ---------- the temple ----------

TEMPLE_STEPS = [(10.0, 0.4), (9.2, 0.8), (8.4, 1.2)]  # (radius, height of its top)
COLUMN_RING = 7.4
COLUMN_HEIGHT = 7.0
COLUMNS = 12
FALLEN = (4, 9)  # the columns broken off short


def temple():
    p = Part('Temple')
    # The steps, down past the ground so they sit on a slope.
    y0 = -2.0
    for i, (r, top) in enumerate(TEMPLE_STEPS):
        disc(p, y0, top, r, 'Stone' if i % 2 == 0 else 'StoneShade', 40)
        y0 = top - 0.4
    floor = TEMPLE_STEPS[-1][1]
    # Tiles: a blue ring and a gold one let into the floor, and a star of gold out from the altar.
    disc(p, floor - 0.05, floor + 0.02, 6.2, 'Tile', 40)
    disc(p, floor - 0.04, floor + 0.03, 5.4, 'Stone', 40)
    disc(p, floor - 0.03, floor + 0.04, 3.2, 'Gold', 32)
    disc(p, floor - 0.02, floor + 0.05, 2.9, 'TileDeep', 32)
    for k in range(8):
        a = k * TAU / 8
        box(p, (math.sin(a) * 4.3, floor + 0.04, math.cos(a) * 4.3), (0.3, 0.06, 2.1), 'Gold', yaw=a)
    # The altar: an eight-sided pedestal with a gold band and a bowl on top.
    disc(p, floor, floor + 0.35, 1.5, 'StoneShade', 8)
    disc(p, floor + 0.35, floor + 1.15, 1.05, 'Stone', 8, r_top=0.9)
    disc(p, floor + 0.8, floor + 0.92, 1.0, 'Gold', 8)
    disc(p, floor + 1.15, floor + 1.4, 0.9, 'StoneShade', 8, r_top=1.25)
    # The columns: a plinth, a fluted-looking shaft (twelve facets), a capital, and every other one
    # topped with a gold finial. Two are broken off, their tops lying on the floor beside them.
    for i in range(COLUMNS):
        a = i * TAU / COLUMNS
        x, z = math.sin(a) * COLUMN_RING, math.cos(a) * COLUMN_RING
        box(p, (x, floor + 0.2, z), (1.3, 0.4, 1.3), 'StoneShade', yaw=a)
        if i in FALLEN:
            h = 1.6 + (i % 3) * 0.5
            cylinder(p, (x, floor + 0.4, z), (x, floor + 0.4 + h, z), 0.5, 0.46, 'Stone', 12)
            # The rest of it, fallen inwards and broken in two.
            inward = Vector((-math.sin(a), 0, -math.cos(a)))
            side = Vector((math.cos(a), 0, -math.sin(a)))
            start = Vector((x, floor + 0.5, z)) + inward * 1.2 + side * 0.8
            cylinder(p, start, start + inward * 2.6 + side * 0.9, 0.46, 0.44, 'Stone', 12)
            second = start + inward * 3.0 + side * 1.6
            cylinder(p, second, second + side * 2.0 + inward * 0.4, 0.44, 0.42, 'StoneShade', 12)
            continue
        cylinder(p, (x, floor + 0.4, z), (x, floor + 0.4 + COLUMN_HEIGHT, z), 0.5, 0.42, 'Stone', 12)
        for band in (0.9, COLUMN_HEIGHT - 0.5):
            disc_y = floor + 0.4 + band
            cylinder(p, (x, disc_y, z), (x, disc_y + 0.14, z), 0.52, 0.52, 'Gold', 12)
        top = floor + 0.4 + COLUMN_HEIGHT
        box(p, (x, top + 0.18, z), (1.35, 0.36, 1.35), 'StoneShade', yaw=a)
        # Every other column carries a gold finial up on the lintel (where there's lintel either side).
        if i % 2 == 0 and (i - 1) % COLUMNS not in FALLEN and (i + 1) % COLUMNS not in FALLEN:
            lintel_top = top + 0.36 + 0.74
            cylinder(p, (x, lintel_top, z), (x, lintel_top + 0.7, z), 0.24, 0.0, 'Gold', 8)
    # The lintel: a beam from each column to the next, except where a fallen one leaves a gap.
    top = floor + 0.4 + COLUMN_HEIGHT + 0.36
    for i in range(COLUMNS):
        j = (i + 1) % COLUMNS
        if i in FALLEN or j in FALLEN:
            continue
        am = (i + 0.5) * TAU / COLUMNS
        chord = 2 * COLUMN_RING * math.sin(TAU / COLUMNS / 2)
        r = COLUMN_RING * math.cos(TAU / COLUMNS / 2)
        box(p, (math.sin(am) * r, top + 0.35, math.cos(am) * r), (chord, 0.7, 1.1), 'Stone', yaw=am)
        box(p, (math.sin(am) * (r + 0.56), top + 0.35, math.cos(am) * (r + 0.56)), (chord - 1.2, 0.18, 0.04), 'Gold', yaw=am)
    # A block over each column where the beams meet, a little proud of them, hiding the joint.
    for i in range(COLUMNS):
        if i in FALLEN or ((i - 1) % COLUMNS in FALLEN and (i + 1) % COLUMNS in FALLEN):
            continue
        a = i * TAU / COLUMNS
        box(p, (math.sin(a) * COLUMN_RING, top + 0.36, math.cos(a) * COLUMN_RING), (1.45, 0.76, 1.25), 'StoneShade', yaw=a)
    return p.done()


# ---------- the spire ----------

SPIRE_HEIGHT = 17.0


def spire():
    p = Part('Spire')
    box(p, (0, -0.6, 0), (6.0, 2.4, 6.0), 'StoneShade')
    box(p, (0, 0.75, 0), (5.2, 0.3, 5.2), 'Stone')
    # Four short stairs up onto the plinth, one on each side.
    for k in range(4):
        a = k * math.pi / 2
        for s in range(2):
            d = 3.25 + s * 0.45
            box(p, (math.sin(a) * d, 0.15 + (1 - s) * 0.25 - 0.25, math.cos(a) * d), (2.2, 0.5 + (1 - s) * 0.5, 0.5), 'Stone', yaw=a)
    # The tower: eight-sided, tapering, in courses with gold bands between them.
    courses = 5
    r0, r1 = 2.0, 1.35
    h = SPIRE_HEIGHT / courses
    for c in range(courses):
        ya, yb = 0.9 + c * h, 0.9 + (c + 1) * h
        ra = r0 + (r1 - r0) * c / courses
        rb = r0 + (r1 - r0) * (c + 1) / courses
        cylinder(p, (0, ya, 0), (0, yb, 0), ra, rb, 'Stone' if c % 2 == 0 else 'StoneShade', 8)
        cylinder(p, (0, yb - 0.12, 0), (0, yb + 0.12, 0), rb + 0.08, rb + 0.08, 'Gold', 8)
        # A tall arched window on alternate faces, a different face each course.
        for k in range(2):
            a = (c * 2 + k * 4) * TAU / 8 + TAU / 16
            rm = (ra + rb) / 2 - 0.05
            box(p, (math.sin(a) * rm, (ya + yb) / 2, math.cos(a) * rm), (0.55, h * 0.5, 0.2), 'Roof', yaw=a)
    # Broken off at the top: a ragged ring of blocks round a cup, where the crystal floats.
    top = 0.9 + SPIRE_HEIGHT
    for k in range(8):
        a = k * TAU / 8
        hh = 0.5 + ((k * 37) % 5) * 0.25
        box(p, (math.sin(a) * (r1 - 0.2), top + hh / 2, math.cos(a) * (r1 - 0.2)), (0.95, hh, 0.45), 'Stone', yaw=a)
    disc(p, top, top + 0.2, 1.0, 'Gold', 8)
    return p.done()


# ---------- the arch, the lantern, the crystals ----------

ARCH_SPAN = 4.4
ARCH_HEIGHT = 5.0


def arch():
    p = Part('Arch')
    half = ARCH_SPAN / 2
    for side in (-1, 1):
        box(p, (side * half, 0.25, 0), (1.0, 0.5, 1.0), 'StoneShade')
        box(p, (side * half, 0.5 + ARCH_HEIGHT / 2, 0), (0.7, ARCH_HEIGHT, 0.7), 'Stone')
    # Its top, a ring of wedge-shaped blocks; the last few on one side have fallen in.
    blocks = 9
    centre_y = 0.5 + ARCH_HEIGHT
    for k in range(blocks - 2):
        a0 = math.pi * (1 - k / blocks)
        a1 = math.pi * (1 - (k + 1) / blocks)
        wedge(p, (0, centre_y), half - 0.35, half + 0.55, a0, a1, 0.72, 'Stone' if k % 2 == 0 else 'StoneShade')
    # One of the fallen blocks, lying at its foot.
    box(p, (half + 0.9, 0.3, 0.6), (0.62, 0.6, 0.72), 'StoneShade', yaw=0.6, tilt=(0.2, 0.3))
    return p.done()


def lantern():
    p = Part('Lantern')
    box(p, (0, 0.12, 0), (0.75, 0.24, 0.75), 'StoneShade')
    cylinder(p, (0, 0.24, 0), (0, 1.05, 0), 0.16, 0.14, 'Stone', 8)
    box(p, (0, 1.1, 0), (0.62, 0.12, 0.62), 'StoneShade')
    box(p, (0, 1.38, 0), (0.42, 0.44, 0.42), 'Glow')
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        box(p, (math.sin(a) * 0.25, 1.38, math.cos(a) * 0.25), (0.08, 0.46, 0.08), 'Stone')
    cylinder(p, (0, 1.6, 0), (0, 1.95, 0), 0.52, 0.06, 'Roof', 4)
    return p.done()


def crystal_rock():
    p = Part('CrystalRock')
    rock(p, (0, 0.15, 0), 0.85, 'Rock', squash=0.55, seed=1)
    rock(p, (0.55, 0.05, -0.25), 0.45, 'Rock', squash=0.6, seed=3)
    rock(p, (0, 0.42, 0), 0.5, 'Moss', squash=0.25, seed=5)
    return p.done()


def crystal():
    p = Part('Crystal')
    base = Vector((0, 0.3, 0))
    for direction, length, radius, mat in (
        ((0, 1, 0), 1.7, 0.26, 'Crystal'),
        ((0.45, 1, 0.1), 1.2, 0.2, 'CrystalPale'),
        ((-0.5, 1, 0.25), 1.05, 0.18, 'Crystal'),
        ((0.1, 1, -0.55), 0.95, 0.17, 'CrystalPale'),
        ((-0.2, 1, 0.6), 0.75, 0.14, 'Crystal'),
    ):
        gem(p, base, direction, length, radius, mat)
    return p.done()


OBJECTS = [temple(), spire(), arch(), lantern(), crystal_rock(), crystal()]

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
print(f'sky: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    # Blender's own z-up world, for the previews: stand the y-up models upright in it.
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 600
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.3, 0.5)
    layout = {'Temple': (0, 0), 'Spire': (16, 0), 'Arch': (-15, 2), 'Lantern': (-11, 6), 'CrystalRock': (-9, 6), 'Crystal': (-9, 6)}
    for o in OBJECTS:
        x, y = layout[o.name]
        o.location = (x, y, 0)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target in (('front', (0, -60, 22), (0, 0, 7)), ('above', (0, -30, 50), (0, 0, 2))):
        target = Vector(target)
        direction = target - Vector(location)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam.location = location
        scene.render.filepath = os.path.join(PREVIEW, f'sky-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'sky: previews in {PREVIEW}')
