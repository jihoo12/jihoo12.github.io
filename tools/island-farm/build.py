# Builds the garden on /island (the crops at each stage, seed packets, the market stand, the water
# barrel and the watering can) and exports them as one .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-farm/build.py -- <out.glb> [preview-dir]
#
# Each piece is its own object, named for the page to pick out, modelled in three.js coordinates in
# metres (y up, standing on y = 0, facing +z) and exported without the y-up conversion. Their
# materials carry the real colours: the page turns each into a toon material of the same colour,
# except "Packet", which it tints for each crop's seeds.
#
#   Sprout                                  every crop's first leaves
#   TurnipLeaves, CarrotLeaves,             the crop growing, before it's ripe; a ripe one is the
#   StrawberryBush, PumpkinVine             same leaves with the crop itself showing
#   Turnip, Carrot, Strawberry, Pumpkin     the crops, as they're held up and shown in the bag
#   Packet                                  a packet of seeds
#   Stall, Barrel, Can                      the market stand, the water barrel, the watering can
#   Sprinkler, SprinklerHead                a sprinkler on its stake, and the head that spins on
#                                           top of it (its origin at the hub, SPRINKLER_TOP up)
#   Helper, HelperKey                       Sprocket, the clockwork garden helper, and the key in
#                                           its back that turns as it goes (origin at its axle)
#   HarvestCrate                            the crate Sprocket picks crops into
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'farm.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Leaf': '#6cc26a',
    'LeafDark': '#4a9e50',
    'Stem': '#5f9a45',
    'TurnipWhite': '#fbf7ef',
    'TurnipPurple': '#b06ab8',
    'Carrot': '#f28c3a',
    'Berry': '#ef4a5c',
    'Seed': '#ffe066',
    'Fleck': '#fff1c4',
    'Flower': '#ffffff',
    'Pumpkin': '#f29a3a',
    'PumpkinDeep': '#d97a26',
    'Packet': '#ffffff',
    'Label': '#fdfbff',
    'Wood': '#b07a4f',
    'WoodDark': '#8a5a3c',
    'Awning': '#f25f6b',
    'AwningWhite': '#fdfbff',
    'Metal': '#9aa3c4',
    'Water': '#6fc3e8',
    'Can': '#5fb0e8',
    'Crate': '#c99a64',
    'Brass': '#e8b84a',
    'Copper': '#c97b4a',
    'Teal': '#5fc7c0',
    'Eye': '#2c2a52',
    'Bulb': '#ff7a6b',
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
    MATS[name] = mat

# ---------- geometry helpers: each takes a bmesh and the name of a material, and returns its verts ----------


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

    def done(self, smooth=True):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces[:])
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(MATS[m])
        me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
        obj = bpy.data.objects.new(self.name, me)
        scene.collection.objects.link(obj)
        return obj


def place(bm, verts, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=verts)
    return verts


def ball(part, centre, radius, mat, scale=(1, 1, 1), seg=(16, 10)):
    verts = bmesh.ops.create_uvsphere(part.bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    place(part.bm, verts, Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1)))
    return part.paint(verts, mat)


def cylinder(part, a, b, r0, r1, mat, segments=12):
    """A (tapered) cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    verts = bmesh.ops.create_cone(part.bm, cap_ends=True, segments=segments, radius1=r0, radius2=r1, depth=axis.length)['verts']
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    place(part.bm, verts, Matrix.Translation((a + b) / 2) @ rot)
    return part.paint(verts, mat)


def box(part, centre, size, mat, matrix=Matrix.Identity(4)):
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    place(part.bm, verts, matrix @ Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


def leaf(part, base, direction, length, width, mat, lift=0.5, curl=0.3, thick=0.012):
    """A leaf from `base` reaching out along `direction` (in the xz plane) and up by `lift`,
    a pointed oval that droops towards its tip."""
    d = Vector((direction[0], 0, direction[1])).normalized()
    side = Vector((0, 1, 0)).cross(d).normalized()
    n = 8
    top, bottom = [], []
    rows = []
    for i in range(n + 1):
        t = i / n
        w = width * math.sin(math.pi * t) ** 0.8 * (1 - 0.3 * t)
        centre = Vector(base) + d * (length * t) + Vector((0, length * (lift * t - curl * t * t), 0))
        row = [centre - side * w, centre, centre + side * w]
        rows.append(row)
    bm = part.bm
    grid_top = [[bm.verts.new(p + Vector((0, thick, 0))) for p in row] for row in rows]
    grid_bot = [[bm.verts.new(p - Vector((0, thick, 0))) for p in row] for row in rows]
    verts = []
    for g, flip in ((grid_top, False), (grid_bot, True)):
        for r0, r1 in zip(g, g[1:]):
            for k in range(2):
                quad = [r0[k], r0[k + 1], r1[k + 1], r1[k]]
                try:
                    bm.faces.new(list(reversed(quad)) if flip else quad)
                except ValueError:
                    pass
        verts += [v for row in g for v in row]
    # Close the edges, so the ink line has a hull to follow.
    for g0, g1 in ((grid_top, grid_bot),):
        for i in range(n):
            for k in (0, 2):
                try:
                    bm.faces.new((g0[i][k], g0[i + 1][k], g1[i + 1][k], g1[i][k]))
                except ValueError:
                    pass
    bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-5)
    return part.paint([v for v in verts if v.is_valid], mat)


def lobed(part, centre, radius, lobes, depth, mat, squash=0.75, seg=(32, 16)):
    """A sphere with grooves running down it, like a pumpkin."""
    verts = bmesh.ops.create_uvsphere(part.bm, u_segments=seg[0], v_segments=seg[1], radius=1)['verts']
    for v in verts:
        a = math.atan2(v.co.x, v.co.z)
        r = radius * (1 - depth * (0.5 - 0.5 * math.cos(lobes * a)) ** 2 * (1 - abs(v.co.y)))
        v.co = Vector((v.co.x * r, v.co.y * radius * squash, v.co.z * r)) + Vector(centre)
    return part.paint(verts, mat)


# ---------- the crops ----------


def sprout():
    p = Part('Sprout')
    cylinder(p, (0, 0, 0), (0, 0.1, 0), 0.012, 0.01, 'Stem', 6)
    for a in (0.4, 0.4 + math.pi):
        leaf(p, (0, 0.1, 0), (math.cos(a), math.sin(a)), 0.09, 0.04, 'Leaf', lift=0.6, curl=0.4)
    return p.done()


def rosette(name, count, length, width, mat, lift, curl, twist=0.0, inner=None):
    p = Part(name)
    for i in range(count):
        a = i * TAU / count + twist
        leaf(p, (0, 0.02, 0), (math.cos(a), math.sin(a)), length * (0.85 + 0.15 * (i % 2)), width, mat if i % 2 else 'LeafDark', lift=lift, curl=curl)
    if inner:
        for i in range(inner):
            a = i * TAU / inner + 0.5
            leaf(p, (0, 0.03, 0), (math.cos(a), math.sin(a)), length * 0.6, width * 0.8, 'Leaf', lift=lift * 1.6, curl=curl)
    return p


def turnip_leaves():
    return rosette('TurnipLeaves', 6, 0.3, 0.09, 'Leaf', lift=0.9, curl=0.6, inner=3).done()


def carrot_leaves():
    p = Part('CarrotLeaves')
    # Feathery fronds: thin stalks fanning up, each with little leaflets.
    for i in range(7):
        a = i * TAU / 7
        d = Vector((math.cos(a) * 0.12, 0.32 + 0.05 * (i % 3), math.sin(a) * 0.12))
        cylinder(p, (0, 0, 0), d, 0.008, 0.005, 'Stem', 5)
        for k in range(3):
            t = 0.45 + k * 0.22
            leaf(p, d * t, (math.cos(a + 0.8), math.sin(a + 0.8)), 0.07, 0.025, 'Leaf' if k % 2 else 'LeafDark', lift=0.6, curl=0.3)
            leaf(p, d * t, (math.cos(a - 0.8), math.sin(a - 0.8)), 0.07, 0.025, 'LeafDark' if k % 2 else 'Leaf', lift=0.6, curl=0.3)
    return p.done()


def strawberry_bush():
    p = rosette('StrawberryBush', 8, 0.24, 0.1, 'Leaf', lift=0.55, curl=0.5, twist=0.2, inner=4)
    for i in range(3):
        a = i * TAU / 3 + 1
        c = Vector((math.cos(a) * 0.12, 0.12, math.sin(a) * 0.12))
        for k in range(5):
            b = k * TAU / 5
            ball(p, c + Vector((math.cos(b) * 0.022, 0, math.sin(b) * 0.022)), 0.018, 'Flower', scale=(1, 0.5, 1), seg=(8, 5))
        ball(p, c + Vector((0, 0.008, 0)), 0.012, 'Seed', seg=(8, 5))
    return p.done()


def pumpkin_vine():
    p = Part('PumpkinVine')
    # A curling vine along the ground with three big leaves.
    pts = [Vector((math.cos(t) * (0.15 + t * 0.05), 0.03, math.sin(t) * (0.15 + t * 0.05))) for t in [i * 0.4 for i in range(12)]]
    for a, b in zip(pts, pts[1:]):
        cylinder(p, a, b, 0.016, 0.016, 'Stem', 6)
    for i, t in enumerate((2, 6, 10)):
        base = pts[t]
        a = i * 2.1 + 0.4
        leaf(p, base, (math.cos(a), math.sin(a)), 0.34, 0.17, 'LeafDark' if i % 2 else 'Leaf', lift=0.7, curl=0.7)
    return p.done()


def turnip():
    p = Part('Turnip')
    bulb = ball(p, (0, 0.12, 0), 0.12, 'TurnipWhite', scale=(1, 0.95, 1), seg=(20, 12))
    # Purple across the top half.
    top = [v for v in bulb if v.co.y > 0.15]
    p.paint(top, 'TurnipPurple')
    cylinder(p, (0, 0.02, 0), (0, -0.07, 0), 0.02, 0.002, 'TurnipWhite', 8)
    for a in (0, 2.1, 4.2):
        cylinder(p, (0, 0.22, 0), (math.cos(a) * 0.05, 0.34, math.sin(a) * 0.05), 0.012, 0.008, 'Stem', 6)
    return p.done()


def carrot():
    p = Part('Carrot')
    cylinder(p, (0, -0.2, 0), (0, 0.08, 0), 0.008, 0.06, 'Carrot', 14)
    ball(p, (0, 0.08, 0), 0.06, 'Carrot', scale=(1, 0.35, 1), seg=(14, 8))
    for a in (0, 2.1, 4.2):
        cylinder(p, (0, 0.09, 0), (math.cos(a) * 0.04, 0.2, math.sin(a) * 0.04), 0.01, 0.006, 'Stem', 6)
    return p.done()


def strawberry():
    p = Part('Strawberry')
    # A plump heart-shaped berry, point down, with a leafy cap. The seeds are a sparse scatter of
    # little flat flecks set into the skin, not beads standing proud of it: round bumps packed close
    # together read as unsettling rather than juicy, all the more so blown up in her hand.
    berry = ball(p, (0, 0, 0), 1, 'Berry', seg=(18, 12))

    def width(y):
        # y runs from -1 (the tip) to 1 (the shoulders): narrow at the tip, fullest just above middle.
        t = (y + 1) / 2
        return 0.22 + 0.78 * math.sin(min(t * 1.25, 1) * math.pi / 2) ** 1.4

    for v in berry:
        y = v.co.y
        w = width(y)
        v.co = Vector((v.co.x * w * 0.05, y * 0.055 - 0.005, v.co.z * w * 0.05))
    # Flatten the top a little, so the cap sits on it.
    for v in berry:
        if v.co.y > 0.035:
            v.co.y = 0.035 + (v.co.y - 0.035) * 0.4

    golden = math.pi * (3 - math.sqrt(5))
    for k in range(11):
        y = -0.7 + 1.25 * (k + 0.5) / 11  # in the sphere's -1..1, kept off the tip and the shoulders
        a = k * golden
        r = math.sqrt(max(0.0, 1 - y * y)) * width(y)
        normal = Vector((math.cos(a) * r, y * 0.6, math.sin(a) * r)).normalized()
        centre = Vector((math.cos(a) * r * 0.05, y * 0.055 - 0.005, math.sin(a) * r * 0.05))
        fleck = bmesh.ops.create_uvsphere(p.bm, u_segments=6, v_segments=4, radius=0.0042)['verts']
        # Squash it flat along the skin's normal and sink it halfway in.
        rot = normal.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        place(p.bm, fleck, Matrix.Translation(centre - normal * 0.0008) @ rot @ Matrix.Diagonal((1, 1.35, 0.3, 1)))
        p.paint(fleck, 'Fleck')
    for k in range(5):
        a = k * TAU / 5
        leaf(p, (0, 0.04, 0), (math.cos(a), math.sin(a)), 0.045, 0.018, 'Leaf', lift=0.15, curl=0.3, thick=0.005)
    cylinder(p, (0, 0.04, 0), (0, 0.08, 0), 0.006, 0.005, 'Stem', 6)
    return p.done()


def pumpkin():
    p = Part('Pumpkin')
    lobed(p, (0, 0.2, 0), 0.3, 8, 0.12, 'Pumpkin')
    cylinder(p, (0, 0.4, 0), (0.02, 0.5, 0.01), 0.035, 0.025, 'Stem', 8)
    return p.done()


# ---------- the rest of the garden ----------


def packet():
    p = Part('Packet')
    box(p, (0, 0.11, 0), (0.15, 0.22, 0.02), 'Packet')
    box(p, (0, 0.08, 0.011), (0.12, 0.08, 0.004), 'Label')
    # A crimped top edge.
    box(p, (0, 0.225, 0), (0.15, 0.015, 0.025), 'Packet')
    return p.done(smooth=False)


def stall():
    p = Part('Stall')
    W, D, H = 2.4, 1.1, 0.95
    # The counter: a box on legs, with a crate of produce on it.
    box(p, (0, H - 0.05, 0), (W, 0.1, D), 'Wood')
    box(p, (0, H / 2 - 0.05, D / 2 - 0.04), (W - 0.1, H - 0.2, 0.06), 'WoodDark')
    for x in (-W / 2 + 0.08, W / 2 - 0.08):
        for z in (-D / 2 + 0.08, D / 2 - 0.08):
            box(p, (x, H / 2, z), (0.1, H, 0.1), 'WoodDark')
    # Posts holding up a striped awning.
    for x in (-W / 2 + 0.06, W / 2 - 0.06):
        box(p, (x, H + 0.75, -D / 2 + 0.06), (0.08, 1.5, 0.08), 'WoodDark')
        box(p, (x, H + 0.6, D / 2 - 0.06), (0.08, 1.2, 0.08), 'WoodDark')
    stripes = 8
    for i in range(stripes):
        x = -W / 2 - 0.1 + (W + 0.2) * (i + 0.5) / stripes
        tilt = Matrix.Translation((0, H + 1.45, 0)) @ Matrix.Rotation(0.28, 4, 'X') @ Matrix.Translation((0, -(H + 1.45), 0))
        box(p, (x, H + 1.45, 0.05), ((W + 0.2) / stripes, 0.05, D + 0.5), 'Awning' if i % 2 == 0 else 'AwningWhite', matrix=tilt)
        # A scalloped edge hanging off the front.
        ball(p, tilt @ Vector((x, H + 1.42, D / 2 + 0.3)), (W + 0.2) / stripes / 2, 'Awning' if i % 2 == 0 else 'AwningWhite', scale=(1, 0.7, 0.3), seg=(10, 6))
    for x, color in ((-0.7, 'Carrot'), (-0.25, 'TurnipPurple'), (0.25, 'Berry'), (0.7, 'Pumpkin')):
        box(p, (x, H + 0.1, 0.05), (0.38, 0.14, 0.42), 'Crate')
        for k in range(4):
            ball(p, (x - 0.08 + (k % 2) * 0.16, H + 0.2, -0.05 + (k // 2) * 0.18), 0.075, color, seg=(10, 6))
    return p.done(smooth=False)


def barrel():
    p = Part('Barrel')
    rings = [(0.36, 0), (0.42, 0.25), (0.44, 0.45), (0.42, 0.65), (0.36, 0.9)]
    bm = p.bm
    segs = 16
    grid = []
    for r, y in rings:
        grid.append([bm.verts.new((math.sin(k * TAU / segs) * r, y, math.cos(k * TAU / segs) * r)) for k in range(segs)])
    wood = p.mat('Wood')
    for lo, hi in zip(grid, grid[1:]):
        for k in range(segs):
            f = bm.faces.new((lo[k], lo[(k + 1) % segs], hi[(k + 1) % segs], hi[k]))
            f.material_index = wood
    f = bm.faces.new(list(reversed(grid[0])))
    f.material_index = wood
    # The water inside, a little below the rim.
    f = bm.faces.new(grid[-1])
    f.material_index = p.mat('Water')
    for y, r in ((0.12, 0.395), (0.78, 0.395)):
        cylinder(p, (0, y - 0.03, 0), (0, y + 0.03, 0), r + 0.012, r + 0.012, 'Metal', segs)
    return p.done(smooth=False)


def can(name='Can'):
    """A watering can, its handle at the origin (where it's held), its spout towards +z."""
    p = Part(name)
    body_y = -0.15
    cylinder(p, (0, body_y - 0.08, 0), (0, body_y + 0.08, 0), 0.1, 0.09, 'Can', 16)
    ball(p, (0, body_y + 0.08, 0), 0.09, 'Can', scale=(1, 0.3, 1), seg=(16, 6))
    # The handle arching over the top, from back to front.
    pts = [Vector((0, body_y + 0.08 + math.sin(t) * 0.1, -math.cos(t) * 0.07)) for t in [i * math.pi / 8 for i in range(9)]]
    for a, b in zip(pts, pts[1:]):
        cylinder(p, a, b, 0.014, 0.014, 'Metal', 6)
    cylinder(p, (0, body_y - 0.03, 0.08), (0, body_y + 0.1, 0.27), 0.022, 0.012, 'Can', 8)
    cylinder(p, (0, body_y + 0.095, 0.26), (0, body_y + 0.115, 0.29), 0.028, 0.032, 'Metal', 10)
    return p.done()


# ---------- the garden's machines, made at the forge ----------

SPRINKLER_TOP = 0.62


def sprinkler():
    p = Part('Sprinkler')
    cylinder(p, (0, -0.15, 0), (0, 0.02, 0), 0.02, 0.06, 'WoodDark', 8)
    cylinder(p, (0, 0.0, 0), (0, 0.05, 0), 0.09, 0.08, 'Copper', 12)
    cylinder(p, (0, 0.05, 0), (0, SPRINKLER_TOP - 0.04, 0), 0.025, 0.022, 'Copper', 10)
    # A tap half way up, and the pipe coming in from the side.
    ball(p, (0.0, 0.25, 0.03), 0.04, 'Brass', seg=(10, 6))
    box(p, (0.0, 0.25, 0.08), (0.12, 0.025, 0.02), 'Awning')
    cylinder(p, (0, 0.03, 0), (0.3, 0.02, 0), 0.018, 0.018, 'Metal', 8)
    return p.done(smooth=False)


def sprinkler_head():
    p = Part('SprinklerHead')
    ball(p, (0, 0.0, 0), 0.06, 'Brass', seg=(12, 8))
    for k in range(3):
        a = k * TAU / 3
        tip = Vector((math.sin(a) * 0.2, 0.03, math.cos(a) * 0.2))
        cylinder(p, (0, 0, 0), tip, 0.016, 0.014, 'Copper', 8)
        # The nozzle, bent round so the water flings out as it spins.
        side = Vector((math.cos(a), 0, -math.sin(a)))
        cylinder(p, tip, tip + side * 0.06 + Vector((0, 0.02, 0)), 0.02, 0.012, 'Brass', 8)
    return p.done(smooth=False)


HELPER_KEY = (0, 0.4, -0.21)


def helper():
    """Sprocket: a round clockwork helper about knee high to her, facing +z, with a basket in its arms."""
    p = Part('Helper')
    # Stubby legs and round feet.
    for side in (-1, 1):
        cylinder(p, (side * 0.08, 0.06, 0), (side * 0.08, 0.2, 0), 0.035, 0.035, 'Metal', 8)
        ball(p, (side * 0.08, 0.04, 0.03), 0.06, 'Copper', scale=(1, 0.6, 1.3), seg=(12, 8))
    # The body, a brass ball with a copper band round its middle and rivets on the band.
    ball(p, (0, 0.38, 0), 0.21, 'Brass', scale=(1, 0.92, 0.95), seg=(20, 14))
    cylinder(p, (0, 0.35, 0), (0, 0.41, 0), 0.215, 0.215, 'Copper', 20)
    for k in range(10):
        a = k * TAU / 10
        ball(p, (math.sin(a) * 0.218, 0.38, math.cos(a) * 0.205), 0.014, 'Metal', seg=(6, 4))
    # Its head: a dome with a round window face, two big eyes and a little antenna with a bulb.
    ball(p, (0, 0.64, 0), 0.15, 'Brass', scale=(1, 0.85, 1), seg=(18, 12))
    ball(p, (0, 0.63, 0.1), 0.11, 'Teal', scale=(1, 0.85, 0.55), seg=(16, 10))
    for side in (-1, 1):
        ball(p, (side * 0.045, 0.645, 0.158), 0.026, 'Eye', scale=(1, 1.25, 0.5), seg=(10, 8))
        ball(p, (side * 0.045 + 0.008, 0.66, 0.17), 0.008, 'Flower', seg=(6, 4))
    cylinder(p, (0, 0.76, 0), (0.03, 0.88, -0.02), 0.008, 0.006, 'Metal', 6)
    ball(p, (0.03, 0.9, -0.02), 0.03, 'Bulb', seg=(10, 6))
    # Arms reaching forwards round a little basket.
    for side in (-1, 1):
        cylinder(p, (side * 0.19, 0.42, 0.02), (side * 0.14, 0.3, 0.2), 0.022, 0.02, 'Copper', 8)
        ball(p, (side * 0.14, 0.3, 0.2), 0.03, 'Metal', seg=(8, 6))
    cylinder(p, (0, 0.2, 0.24), (0, 0.32, 0.24), 0.11, 0.13, 'Crate', 12)
    cylinder(p, (0, 0.31, 0.24), (0, 0.33, 0.24), 0.135, 0.135, 'WoodDark', 12)
    return p.done(smooth=False)


def helper_key():
    p = Part('HelperKey')
    cylinder(p, (0, 0, 0), (0, 0, -0.08), 0.015, 0.015, 'Metal', 8)
    for side in (-1, 1):
        ball(p, (side * 0.055, 0, -0.09), 0.045, 'Brass', scale=(1, 0.75, 0.3), seg=(12, 8))
    return p.done(smooth=False)


def harvest_crate():
    p = Part('HarvestCrate')
    W, D, H = 0.9, 0.6, 0.45
    box(p, (0, 0.03, 0), (W, 0.06, D), 'WoodDark')
    # The slats stop just inside the corner posts, so no two faces lie flush.
    for z in (-D / 2 + 0.03, D / 2 - 0.03):
        for y in (0.13, 0.3):
            box(p, (0, y, z), (W - 0.04, 0.12, 0.04), 'Crate')
    for x in (-W / 2 + 0.03, W / 2 - 0.03):
        for y in (0.13, 0.3):
            box(p, (x, y, 0), (0.04, 0.12, D - 0.08), 'Crate')
    for x in (-W / 2 + 0.03, W / 2 - 0.03):
        for z in (-D / 2 + 0.03, D / 2 - 0.03):
            box(p, (x, H / 2, z), (0.07, H, 0.07), 'WoodDark')
    return p.done(smooth=False)


OBJECTS = [
    sprout(),
    turnip_leaves(),
    carrot_leaves(),
    strawberry_bush(),
    pumpkin_vine(),
    turnip(),
    carrot(),
    strawberry(),
    pumpkin(),
    packet(),
    stall(),
    barrel(),
    can(),
    sprinkler(),
    sprinkler_head(),
    helper(),
    helper_key(),
    harvest_crate(),
]

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
print(f'farm: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 500
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.56, 0.7, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.6, 0.4, 0)
    # Small things in a row along the front, the big ones behind.
    small = OBJECTS[:10] + [OBJECTS[12]]
    for i, o in enumerate(small):
        o.location = ((i - (len(small) - 1) / 2) * 0.55, 0, 1.2)
        o.scale = (1.4, 1.4, 1.4)
    OBJECTS[10].location = (-1.6, 0, -1)
    OBJECTS[11].location = (1.6, 0, -1)
    # The machines, in a row of their own nearer the camera: the head and the key put in place.
    sprinkler_obj, head_obj, helper_obj, key_obj, crate_obj = OBJECTS[13:18]
    sprinkler_obj.location = (-0.9, 0, 3)
    head_obj.location = (-0.9, SPRINKLER_TOP, 3)
    helper_obj.location = (0, 0, 3)
    key_obj.location = Vector((0, 0, 3)) + Vector(HELPER_KEY)
    key_obj.rotation_euler = (0, 0, 0.5)
    crate_obj.location = (1.1, 0, 3)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 6.6
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target, scale in (('front', (0, 1.6, 8), (0, 0.6, 0), 6.6), ('above', (0, 6, 6), (0, 0.6, 0), 6.6), ('stall', (1.2, 3.4, 4), (-1.6, 1.5, -1), 6), ('machines', (1.5, 1.4, 6), (0, 0.4, 3), 2.6), ('machines-back', (-1.2, 1.2, 0.5), (0, 0.4, 3), 2.6)):
        target = Vector(target)
        cam.data.ortho_scale = scale
        back = (Vector(location) - target).normalized()
        x = Vector((0, 1, 0)).cross(back).normalized()
        cam.matrix_world = Matrix((x, back.cross(x), back)).transposed().to_4x4()
        cam.matrix_world.translation = location
        scene.render.filepath = os.path.join(PREVIEW, f'farm-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'farm: previews in {PREVIEW}')
