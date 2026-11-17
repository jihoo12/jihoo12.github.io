# Builds the forge on /island (the smithy, its anvil, iron ingots and the iron ore veins in the hills)
# and exports them as one .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-forge/build.py -- <out.glb> [preview-dir]
#
# Like the island's other models (tools/island-farm, tools/island-sky), each piece is its own
# object, named for the page to pick out, modelled in three.js coordinates in metres (y up, standing
# on y = 0, its front towards +z) and exported without the y-up conversion. Their materials carry
# the real colours, which the page turns into toon materials of the same colour; "Glow" is drawn
# unlit, so it shines (the furnace's mouth and a hot ingot).
#
#   Smithy     an open timber workshop on a stone floor, under a tiled roof: the furnace and its
#              chimney at the back on the left, bellows beside it, a rack of tools on the back wall,
#              a water trough on the right and a heap of coal
#   Anvil      an anvil on a stump, its face at ANVIL_TOP
#   Ingot      an iron ingot; IngotHot, the same glowing from the furnace
#   OreRock    the rock iron ore crops out of, which stays when it's mined; Ore, the ore itself
#
# The page knows these sizes (to walk round the posts and the furnace, and to put the work on the
# anvil), so if they change here change them in src/lib/island/forge.ts too.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'forge.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Stone': '#b9b3d6',
    'StoneDark': '#9890bb',
    'Floor': '#cfc6b8',
    'Timber': '#8a5a3c',
    'TimberLight': '#b07a4f',
    'Roof': '#d9734e',
    'RoofDark': '#b85a3b',
    'Iron': '#7d86a8',
    'IronDark': '#4f5675',
    'Leather': '#a8693f',
    'Coal': '#3a3550',
    'Water': '#6fc3e8',
    'Glow': '#ffb347',
    'Ore': '#c0703f',
    'OreDark': '#8f4f30',
    'Rock': '#8a8399',
    'Moss': '#88cc73',
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
    if name == 'Glow':
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
        # The pieces come out of bmesh facing the right way already (recalculating over the whole
        # object, with its pieces running into each other, would turn some of them inside out).
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


def prism(part, outline, y0, y1, mat):
    """An upright prism: the polygon `outline` (x, z pairs, anticlockwise from above) from y0 to y1."""
    bm = part.bm
    bottom = [bm.verts.new((x, y0, z)) for x, z in outline]
    top = [bm.verts.new((x, y1, z)) for x, z in outline]
    n = len(outline)
    bm.faces.new(list(reversed(bottom)))
    bm.faces.new(top)
    for i in range(n):
        bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
    verts = bottom + top
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


def lump(part, centre, radius, mat, squash=0.6, seed=0, subdivisions=1):
    verts = bmesh.ops.create_icosphere(part.bm, subdivisions=subdivisions, radius=radius)['verts']
    for v in verts:
        k = 0.85 + 0.25 * math.sin(v.co.x * 5.1 + seed) * math.cos(v.co.z * 4.3 - seed * 2)
        v.co = Vector((v.co.x * k, v.co.y * squash * k, v.co.z * k)) + Vector(centre)
    return part.paint(verts, mat)


# ---------- the smithy ----------

FLOOR = (7.0, 5.0)  # width (x) and depth (z) of its stone floor
FLOOR_TOP = 0.2
POST_H = 3.0
FURNACE = (-2.2, -1.4)  # where the furnace stands, its mouth towards +z
TROUGH = (2.45, -1.2)


def smithy():
    p = Part('Smithy')
    w, d = FLOOR
    box(p, (0, FLOOR_TOP - 0.5, 0), (w, 1.0, d), 'Floor')
    # A kerb of darker stone round its edge, and a step up at the front.
    # (The back one a touch taller, so it doesn't meet the sides flush at the corners.)
    for x, z, sx, sz, h in ((0, -d / 2, w, 0.3, 0.12), (-w / 2, 0, 0.3, d, 0.1), (w / 2, 0, 0.3, d, 0.1)):
        box(p, (x, FLOOR_TOP - 0.02 + h / 2, z), (sx + 0.02, h, sz + 0.02), 'StoneDark')
    box(p, (0, FLOOR_TOP - 0.35, d / 2 + 0.35), (2.4, 0.5, 0.7), 'Stone')
    # The posts, with braces up to the beams.
    for x in (-w / 2 + 0.25, w / 2 - 0.25):
        for z in (-d / 2 + 0.25, d / 2 - 0.25):
            box(p, (x, FLOOR_TOP + POST_H / 2, z), (0.28, POST_H, 0.28), 'Timber')
            inward = -1 if x > 0 else 1
            box(p, (x + inward * 0.35, FLOOR_TOP + POST_H - 0.4, z), (0.12, 0.9, 0.12), 'Timber', tilt=(0, inward * 0.75))
    top = FLOOR_TOP + POST_H
    for z in (-d / 2 + 0.25, d / 2 - 0.25):
        box(p, (0, top + 0.12, z), (w + 0.2, 0.24, 0.3), 'TimberLight')
    for x in (-w / 2 + 0.25, w / 2 - 0.25):
        # A shade lower than the beams across, so their tops don't meet flush where they cross.
        box(p, (x, top + 0.11, 0), (0.29, 0.22, d - 0.02), 'TimberLight')
    # The roof: a gable running side to side, in rows of tiles, overhanging all round.
    ridge = top + 1.5
    half = d / 2 + 0.7
    slope = math.atan2(ridge - top, half)
    length = math.hypot(ridge - top, half) + 0.1
    # Clay tiles, row on row up each side, each row overlapping the one below like real tiles and
    # sitting a little proud of it, and staggered by half a tile. No two tiles' faces ever lie in the
    # same plane (where they'd fight over the same pixels and flicker): rows are lifted apart, and
    # tiles in a row stand apart by a hair, each a slightly different thickness.
    rows = 6
    span = w + 1.2
    tile_w = 0.72
    across = int(span / tile_w)
    tile_w = span / across
    row_len = length / rows
    for side in (-1, 1):
        normal = Vector((0, math.cos(slope), side * math.sin(slope)))
        for r in range(rows):
            t = (r + 0.5) / rows
            zc = side * half * (1 - t)
            yc = top + 0.25 + (ridge - top) * t
            stagger = (r % 2) * 0.5
            for k in range(across + (r % 2)):
                x0 = -span / 2 + (k - stagger) * tile_w
                x1 = min(x0 + tile_w, span / 2)
                x0 = max(x0, -span / 2)
                if x1 - x0 < 0.1:
                    continue
                seed = (k * 7 + r * 3 + (side > 0) * 5) % 9
                thick = 0.1 + 0.004 * seed
                centre = Vector(((x0 + x1) / 2, yc, zc)) + normal * (0.05 * r + thick / 2)
                mat = 'Roof' if (k + r + seed // 4) % 3 else 'RoofDark'
                box(p, centre, (x1 - x0 - 0.025, thick, row_len + 0.16), mat, tilt=(side * slope, 0))
    # Round caps along the ridge, and boards along the gable edges and under the eaves.
    for k in range(across + 1):
        x = -span / 2 + (k + 0.5) * span / (across + 1)
        cylinder(p, (x - span / (across + 1) / 2 + 0.01, ridge + 0.42, 0), (x + span / (across + 1) / 2 - 0.01, ridge + 0.42, 0), 0.24, 0.24, 'RoofDark' if k % 2 else 'Roof', 8)
    for side in (-1, 1):
        for x in (-span / 2 - 0.06, span / 2 + 0.06):
            mid = Vector((x, (top + 0.25 + ridge) / 2 + 0.12, side * half / 2))
            box(p, mid, (0.1, 0.3, length + 0.1), 'Timber', tilt=(side * slope, 0))
        box(p, (0, top + 0.1, side * (half + 0.02)), (span + 0.1, 0.22, 0.08), 'Timber')
    # The gable ends, filled in with timber.
    for x in (-w / 2 + 0.2, w / 2 - 0.2):
        outline = [(-d / 2 + 0.25, top + 0.24), (d / 2 - 0.25, top + 0.24), (0, ridge)]
        bm = p.bm
        front = [bm.verts.new((x - 0.06, y, z)) for z, y in outline]
        back = [bm.verts.new((x + 0.06, y, z)) for z, y in outline]
        bm.faces.new(front)
        bm.faces.new(list(reversed(back)))
        for i in range(3):
            bm.faces.new((front[i], back[i], back[(i + 1) % 3], front[(i + 1) % 3]))
        vs = front + back
        bmesh.ops.recalc_face_normals(bm, faces=list({f for v in vs for f in v.link_faces}))
        p.paint(vs, 'TimberLight')
    # A low stone wall along the back, with a rack of tools hung over it.
    box(p, (0.6, FLOOR_TOP + 0.6, -d / 2 + 0.25), (4.6, 1.2, 0.35), 'Stone')
    box(p, (0.9, FLOOR_TOP + 1.9, -d / 2 + 0.3), (3.0, 0.12, 0.08), 'Timber')
    for k, (kind, x) in enumerate((('tongs', -0.2), ('hammer', 0.45), ('tongs', 1.1), ('hammer', 1.75), ('file', 2.2))):
        y = FLOOR_TOP + 1.9
        z = -d / 2 + 0.36
        if kind == 'hammer':
            box(p, (x, y - 0.35, z), (0.05, 0.6, 0.05), 'TimberLight')
            box(p, (x, y - 0.7, z), (0.22, 0.1, 0.1), 'Iron')
        elif kind == 'tongs':
            for s in (-1, 1):
                box(p, (x + s * 0.04, y - 0.4, z), (0.03, 0.75, 0.03), 'IronDark', tilt=(0, s * 0.08))
        else:
            box(p, (x, y - 0.3, z), (0.06, 0.5, 0.02), 'Iron')
    # The furnace: a squat stone block with an arched mouth glowing at the front, and its chimney.
    fx, fz = FURNACE
    box(p, (fx, FLOOR_TOP + 0.75, fz), (1.8, 1.5, 1.6), 'StoneDark')
    box(p, (fx, FLOOR_TOP + 1.55, fz), (2.0, 0.15, 1.8), 'Stone')
    box(p, (fx, FLOOR_TOP + 0.55, fz + 0.79), (0.8, 0.6, 0.04), 'Glow')
    cylinder(p, (fx, FLOOR_TOP + 0.85, fz + 0.81), (fx, FLOOR_TOP + 0.85, fz + 0.79), 0.4, 0.4, 'Glow', 16)
    for k in range(7):
        a = math.pi * k / 6
        box(p, (fx + math.cos(a) * 0.52, FLOOR_TOP + 0.85 + math.sin(a) * 0.4, fz + 0.8), (0.2, 0.16, 0.12), 'Stone', tilt=(0, a))
    box(p, (fx, FLOOR_TOP + 0.2, fz + 0.85), (1.0, 0.12, 0.2), 'Stone')
    chimney_top = ridge + 1.2
    box(p, (fx, (FLOOR_TOP + 1.6 + chimney_top) / 2, fz - 0.2), (0.8, chimney_top - FLOOR_TOP - 1.6, 0.8), 'StoneDark')
    box(p, (fx, chimney_top + 0.1, fz - 0.2), (1.0, 0.2, 1.0), 'Stone')
    # The bellows, beside it on a frame.
    bx = fx + 1.35
    box(p, (bx, FLOOR_TOP + 0.35, fz + 0.1), (0.5, 0.7, 0.9), 'Timber')
    prism(p, [(bx - 0.28, fz - 0.4), (bx + 0.28, fz - 0.4), (bx + 0.2, fz + 0.5), (bx - 0.2, fz + 0.5)], FLOOR_TOP + 0.7, FLOOR_TOP + 0.95, 'Leather')
    box(p, (bx, FLOOR_TOP + 1.0, fz + 0.05), (0.5, 0.06, 1.0), 'TimberLight', tilt=(0.12, 0))
    cylinder(p, (bx - 0.25, FLOOR_TOP + 0.8, fz - 0.2), (fx + 0.9, FLOOR_TOP + 0.8, fz - 0.2), 0.06, 0.05, 'IronDark', 8)
    # The trough of water, and a heap of coal beside the furnace.
    tx, tz = TROUGH
    box(p, (tx, FLOOR_TOP + 0.3, tz), (0.9, 0.6, 1.6), 'Timber')
    box(p, (tx, FLOOR_TOP + 0.56, tz), (0.7, 0.04, 1.4), 'Water')
    for k in range(9):
        a = k * 2.4
        r = 0.15 + 0.06 * k
        lump(p, (fx - 0.2 + math.cos(a) * r * 0.6, FLOOR_TOP + 0.1, fz + 1.4 + math.sin(a) * r * 0.5), 0.16, 'Coal', squash=0.7, seed=k)
    return p.done()


# ---------- the anvil and what's made on it ----------

ANVIL_TOP = 0.62
STUMP_H = 0.32


def anvil():
    p = Part('Anvil')
    cylinder(p, (0, 0, 0), (0, STUMP_H, 0), 0.34, 0.3, 'Timber', 10)
    cylinder(p, (0, STUMP_H - 0.01, 0), (0, STUMP_H + 0.005, 0), 0.29, 0.29, 'TimberLight', 10)
    # Its body, from a broad foot up a waist to the face, with the horn out to one side (+x).
    y = STUMP_H
    box(p, (0, y + 0.05, 0), (0.42, 0.1, 0.3), 'IronDark')
    prism(p, [(-0.2, -0.13), (0.2, -0.13), (0.12, 0.13), (-0.12, 0.13)], y + 0.1, y + 0.16, 'IronDark')
    box(p, (0, y + 0.2, 0), (0.18, 0.1, 0.14), 'Iron')
    face_y = ANVIL_TOP - 0.06
    box(p, (-0.02, face_y, 0), (0.46, 0.12, 0.17), 'Iron')
    box(p, (-0.02, ANVIL_TOP - 0.003, 0), (0.44, 0.006, 0.15), 'IronDark')
    cylinder(p, (0.21, face_y + 0.01, 0), (0.42, face_y + 0.03, 0), 0.07, 0.0, 'Iron', 10)
    box(p, (-0.27, face_y, 0), (0.08, 0.08, 0.12), 'Iron')
    return p.done()


def ingot(name, mat):
    p = Part(name)
    prism(p, [(-0.14, -0.06), (0.14, -0.06), (0.14, 0.06), (-0.14, 0.06)], 0, 0.02, mat)
    prism(p, [(-0.14, -0.06), (0.14, -0.06), (0.11, 0.04), (-0.11, 0.04)], 0.02, 0.07, mat)
    return p.done()


def ore_rock():
    p = Part('OreRock')
    lump(p, (0, 0.2, 0), 0.9, 'Rock', squash=0.65, seed=2)
    lump(p, (0.65, 0.05, 0.3), 0.5, 'Rock', squash=0.7, seed=5)
    lump(p, (-0.5, 0.0, 0.45), 0.4, 'Rock', squash=0.7, seed=7)
    lump(p, (0, 0.62, 0), 0.45, 'Moss', squash=0.25, seed=9)
    return p.done()


def ore():
    p = Part('Ore')
    for k, (x, y, z, r) in enumerate(((0.35, 0.55, 0.5, 0.22), (-0.3, 0.6, 0.55, 0.18), (0.6, 0.35, 0.65, 0.16), (0.05, 0.75, 0.42, 0.2), (-0.62, 0.3, 0.6, 0.15))):
        lump(p, (x, y, z), r, 'Ore' if k % 2 == 0 else 'OreDark', squash=0.8, seed=k * 3, subdivisions=0)
    return p.done()


OBJECTS = [smithy(), anvil(), ingot('Ingot', 'Iron'), ingot('IngotHot', 'Glow'), ore_rock(), ore()]

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
print(f'forge: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    # Blender's own z-up world, for the previews: stand the y-up models upright in it.
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 700
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.3, 0.5)
    layout = {'Smithy': (0, 0), 'Anvil': (0.6, -0.8), 'Ingot': (5.0, -2.5), 'IngotHot': (5.0, -2.0), 'OreRock': (6.0, 0.5), 'Ore': (6.0, 0.5)}
    for o in OBJECTS:
        x, y = layout[o.name]
        # Blender's y is the page's -z.
        o.location = (x, -y, 0)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 14
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target in (('front', (4, -20, 7), (1.2, 0, 1.8)), ('above', (6, -12, 14), (1.2, 0, 1))):
        target = Vector(target)
        direction = target - Vector(location)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        cam.location = location
        scene.render.filepath = os.path.join(PREVIEW, f'forge-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'forge: previews in {PREVIEW}')
