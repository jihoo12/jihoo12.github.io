# Builds Nixchan's house on /island and exports it as a .glb: a little cottage with a covered porch
# out front, where her wardrobe and a standing mirror are.
#
#   nix develop .#blender -c blender -b -P tools/island-house/build.py -- <out.glb> [preview-dir]
#
# Like the island's other models (tools/island-forge and the rest), it's modelled in three.js
# coordinates in metres (y up, standing on y = 0, its front towards +z) and exported without the
# y-up conversion. The materials carry the real colours, which the page turns into toon materials of
# the same colour; "Glow" is drawn unlit (the lantern by the door), and materials named "Roof…" fade
# when she's under them, as the forge's do.
#
#   House        the cottage (closed: its door is shut), its porch, the steps up, and on the porch
#                the wardrobe (on the left as you face the house) and the mirror's frame (on the right)
#   MirrorGlass  an empty at the middle of the mirror, turned the way it faces (MIRROR_YAW); the page
#                puts a real mirror there, MIRROR_W by MIRROR_H, oval
#
# The page knows these sizes (to walk round the walls, onto the porch, and up to the mirror), so if
# they change here change them in src/lib/island/house.ts too.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'house.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Stone': '#b9b3d6',
    'StoneDark': '#9890bb',
    'Plaster': '#f6ecd8',
    'Timber': '#8a5a3c',
    'TimberLight': '#b07a4f',
    'Plank': '#c9945f',
    'PlankDark': '#b78452',
    'Roof': '#5f68bd',
    'RoofDark': '#4c549f',
    'Door': '#5f7fc8',
    'Brass': '#e0b04a',
    'Glass': '#a9d8f0',
    'Wardrobe': '#f2c7d3',
    'WardrobeTrim': '#fdfbff',
    'Frame': '#d6a63c',
    'Backing': '#6b4f3c',
    'Rug': '#f29db0',
    'RugTrim': '#fdfbff',
    'Leaf': '#5fae5c',
    'Petal': '#ff9ec7',
    'PetalYellow': '#ffd84d',
    'Pot': '#d9734e',
    'Glow': '#ffd27a',
}

# The sizes the page knows too (src/lib/island/house.ts).
FLOOR_TOP = 0.3  # the porch floor and the foundation, over the ground
W = 6.4  # the house's width (x)
BACK = -3.0  # the back wall's outside face (z)
FRONT = 0.4  # the front wall's outside face, where the porch starts (z)
PORCH = 2.9  # the porch's front edge (z)
WALL_H = 3.0
WALL_T = 0.24
WARDROBE = (-1.95, 0.72)  # its middle on the floor (x, z)
MIRROR = (1.95, 0.78)  # the glass's middle (x, z)
# The mirror's turned on its stand towards the middle of the porch, so that with Nixchan standing in
# front of it and to one side, the camera (out past the porch's open front) sees her in it.
MIRROR_YAW = -0.45
# Where she stands to see herself, in the mirror's own frame (x across it, z out of it).
STAND = (-0.55, 1.25)
MIRROR_W, MIRROR_H = 1.0, 2.3
MIRROR_Y = 1.6  # the glass's middle over the porch floor


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
    return part.paint(verts, mat)


def box(part, centre, size, mat, yaw=0.0, tilt=(0.0, 0.0)):
    """A box of `size` at `centre`, turned `yaw` about the vertical and tipped by `tilt` (about x, z)."""
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Z')
    place(part.bm, verts, Matrix.Translation(centre) @ turn @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


def ball(part, centre, radius, mat, scale=(1, 1, 1), seg=(10, 6)):
    verts = bmesh.ops.create_uvsphere(part.bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    place(part.bm, verts, Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1)))
    return part.paint(verts, mat)


def slab(part, outline, z0, z1, mat):
    """A flat piece in the x-y plane: the polygon `outline` ((x, y) pairs, anticlockwise seen from +z),
    from z0 to z1 (a gable end, a triangle of wall)."""
    bm = part.bm
    back = [bm.verts.new((x, y, z0)) for x, y in outline]
    front = [bm.verts.new((x, y, z1)) for x, y in outline]
    n = len(outline)
    bm.faces.new(list(reversed(back)))
    bm.faces.new(front)
    for i in range(n):
        bm.faces.new((back[i], back[(i + 1) % n], front[(i + 1) % n], front[i]))
    verts = back + front
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


def ellipse_ring(part, centre, a, b, r, mat, steps=40):
    """A rim round an upright ellipse facing +z (the mirror's frame)."""
    pts = [Vector(centre) + Vector((math.cos(TAU * k / steps) * a, math.sin(TAU * k / steps) * b, 0)) for k in range(steps)]
    for p0, p1 in zip(pts, pts[1:] + pts[:1]):
        cylinder(part, p0, p1, r, r, mat, 8)
        ball(part, p1, r, mat, seg=(8, 6))


def ellipse_disc(part, centre, a, b, depth, mat, steps=40):
    outline = [(centre[0] + math.cos(TAU * k / steps) * a, centre[1] + math.sin(TAU * k / steps) * b) for k in range(steps)]
    return slab(part, outline, centre[2] - depth / 2, centre[2] + depth / 2, mat)


def flowers(part, centre, spread, count, seed):
    """A little clump of flowers: leaves, and heads of two colours on top."""
    for k in range(count):
        a = TAU * k / count + seed
        at = Vector(centre) + Vector((math.cos(a) * spread, 0, math.sin(a) * spread))
        ball(part, at, 0.12, 'Leaf', scale=(1, 0.7, 1))
        ball(part, at + Vector((0, 0.13, 0)), 0.07, 'Petal' if (k + seed) % 2 else 'PetalYellow')


def stand():
    """Where she stands at the mirror, in the house's frame."""
    c, s_ = math.cos(MIRROR_YAW), math.sin(MIRROR_YAW)
    x, z = STAND
    return MIRROR[0] + x * c + z * s_, MIRROR[1] - x * s_ + z * c


# ---------- the house ----------


def house():
    p = Part('House')
    top = FLOOR_TOP + WALL_H
    depth = PORCH - BACK

    # The foundation under it all, a course of stone round its foot, and the porch's planks.
    box(p, (0, FLOOR_TOP / 2 - 0.1, (BACK + PORCH) / 2), (W + 0.3, FLOOR_TOP + 0.2, depth + 0.3), 'Stone')
    planks = 12
    for k in range(planks):
        x0 = -W / 2 + k * W / planks
        box(p, (x0 + W / planks / 2, FLOOR_TOP + 0.02 + 0.003 * (k % 3), (FRONT + PORCH) / 2 + 0.05), (W / planks - 0.03, 0.06, PORCH - FRONT + 0.1), 'Plank' if k % 2 else 'PlankDark')
    # Two steps up, at the front.
    for k, (h, z) in enumerate(((FLOOR_TOP * 0.66, PORCH + 0.3), (FLOOR_TOP * 0.33, PORCH + 0.72))):
        box(p, (0, (h - 0.1) / 2, z), (2.0 - 0.2 * k, h + 0.1, 0.44), 'StoneDark' if k else 'Stone')

    # The walls: plaster between timber posts and beams.
    z_mid = (BACK + FRONT) / 2
    body_d = FRONT - BACK
    box(p, (0, FLOOR_TOP + WALL_H / 2, BACK + WALL_T / 2), (W, WALL_H, WALL_T), 'Plaster')
    for side in (-1, 1):
        box(p, (side * (W / 2 - WALL_T / 2), FLOOR_TOP + WALL_H / 2, z_mid), (WALL_T, WALL_H, body_d), 'Plaster')
    # The front wall, round its door (1.2 wide, 2.4 high, in the middle).
    door_w, door_h = 1.2, 2.4
    for side in (-1, 1):
        w = W / 2 - door_w / 2
        box(p, (side * (door_w / 2 + w / 2), FLOOR_TOP + WALL_H / 2, FRONT - WALL_T / 2), (w, WALL_H, WALL_T), 'Plaster')
    box(p, (0, FLOOR_TOP + door_h + (WALL_H - door_h) / 2, FRONT - WALL_T / 2), (door_w, WALL_H - door_h, WALL_T), 'Plaster')
    # The door, shut, set back in its frame: planks, a round window, and a brass knob.
    box(p, (0, FLOOR_TOP + door_h / 2, FRONT - WALL_T + 0.06), (door_w, door_h, 0.08), 'Door')
    for k in (-1, 0, 1):
        box(p, (k * 0.38, FLOOR_TOP + door_h / 2, FRONT - WALL_T + 0.11), (0.03, door_h - 0.1, 0.02), 'Timber')
    ellipse_disc(p, (0, FLOOR_TOP + 1.85, FRONT - WALL_T + 0.12), 0.2, 0.2, 0.03, 'Glass')
    ellipse_ring(p, (0, FLOOR_TOP + 1.85, FRONT - WALL_T + 0.13), 0.2, 0.2, 0.035, 'Brass', steps=20)
    ball(p, (0.42, FLOOR_TOP + 1.15, FRONT - WALL_T + 0.14), 0.06, 'Brass')
    # The door's frame.
    for side in (-1, 1):
        box(p, (side * (door_w / 2 + 0.08), FLOOR_TOP + door_h / 2 + 0.05, FRONT + 0.02), (0.16, door_h + 0.1, 0.1), 'Timber')
    box(p, (0, FLOOR_TOP + door_h + 0.1, FRONT + 0.02), (door_w + 0.32, 0.18, 0.12), 'Timber')
    # Timber: posts at the corners, and a beam along the top and the foot of every wall.
    for x in (-W / 2, W / 2):
        for z in (BACK, FRONT):
            box(p, (x - math.copysign(0.1, x) * 0, FLOOR_TOP + WALL_H / 2, z - math.copysign(0.0, z)), (0.3, WALL_H, 0.3), 'Timber')
    for y in (FLOOR_TOP + 0.1, top - 0.1):
        for z in (BACK, FRONT):
            box(p, (0, y, z), (W + 0.06, 0.2, 0.3), 'Timber')
        for x in (-W / 2, W / 2):
            box(p, (x, y, z_mid), (0.3, 0.2, body_d), 'Timber')
    # A window in each side wall, with a box of flowers under it.
    for side in (-1, 1):
        x = side * (W / 2 + 0.02)
        for z in (BACK + 1.0, FRONT - 1.2):
            box(p, (x, FLOOR_TOP + 1.75, z), (0.06, 0.9, 0.8), 'Glass')
            box(p, (x + side * 0.03, FLOOR_TOP + 1.75, z), (0.06, 0.08, 0.9), 'TimberLight')
            box(p, (x + side * 0.03, FLOOR_TOP + 1.75, z), (0.06, 1.0, 0.08), 'TimberLight')
            for dz in (-0.45, 0.45):
                box(p, (x + side * 0.03, FLOOR_TOP + 1.75, z + dz), (0.08, 1.04, 0.1), 'Timber')
            for dy in (-0.5, 0.5):
                box(p, (x + side * 0.03, FLOOR_TOP + 1.75 + dy, z), (0.08, 0.1, 1.0), 'Timber')
            box(p, (x + side * 0.2, FLOOR_TOP + 1.12, z), (0.3, 0.26, 0.95), 'TimberLight')
            flowers(p, (x + side * 0.2, FLOOR_TOP + 1.3, z), 0.28, 5, side + z)

    # The porch: posts at its front corners, and a beam across between them.
    for side in (-1, 1):
        x = side * (W / 2 - 0.2)
        box(p, (x, FLOOR_TOP + WALL_H / 2, PORCH - 0.2), (0.26, WALL_H, 0.26), 'Timber')
        box(p, (x, top - 0.1, (FRONT + PORCH) / 2), (0.24, 0.2, PORCH - FRONT), 'Timber')
        # A low rail along each side.
        box(p, (x, FLOOR_TOP + 0.75, (FRONT + PORCH) / 2), (0.12, 0.1, PORCH - FRONT), 'TimberLight')
        for k in range(1, 5):
            box(p, (x, FLOOR_TOP + 0.38, FRONT + (PORCH - FRONT) * k / 5), (0.08, 0.74, 0.08), 'TimberLight')
    box(p, (0, top - 0.1, PORCH - 0.2), (W, 0.22, 0.26), 'Timber')

    # The roof: a gable running front to back, over the house and the porch, in rows of tiles
    # (laid as the forge's are: each row overlapping the one below, staggered, no two faces flush).
    ridge = top + 1.9
    half = W / 2 + 0.6
    slope = math.atan2(ridge - top, half)
    length = math.hypot(ridge - top, half) + 0.1
    z0, z1 = BACK - 0.5, PORCH + 0.4
    span = z1 - z0
    zc_roof = (z0 + z1) / 2
    rows = 7
    tile_w = 0.7
    across = int(span / tile_w)
    tile_w = span / across
    row_len = length / rows
    for side in (-1, 1):
        normal = Vector((side * math.sin(slope), math.cos(slope), 0))
        for r in range(rows):
            t = (r + 0.5) / rows
            xc = side * half * (1 - t)
            yc = top + 0.25 + (ridge - top) * t
            stagger = (r % 2) * 0.5
            for k in range(across + (r % 2)):
                a0 = -span / 2 + (k - stagger) * tile_w
                a1 = min(a0 + tile_w, span / 2)
                a0 = max(a0, -span / 2)
                if a1 - a0 < 0.1:
                    continue
                seed = (k * 7 + r * 3 + (side > 0) * 5) % 9
                thick = 0.1 + 0.004 * seed
                centre = Vector((xc, yc, zc_roof + (a0 + a1) / 2)) + normal * (0.05 * r + thick / 2)
                mat = 'Roof' if (k + r + seed // 4) % 3 else 'RoofDark'
                box(p, centre, (row_len + 0.16, thick, a1 - a0 - 0.025), mat, tilt=(0, -side * slope))
    for k in range(across + 1):
        z = z0 + (k + 0.5) * span / (across + 1)
        cylinder(p, (0, ridge + 0.45, z - span / (across + 1) / 2 + 0.01), (0, ridge + 0.45, z + span / (across + 1) / 2 - 0.01), 0.24, 0.24, 'RoofDark' if k % 2 else 'Roof', 8)
    # Boards along the gable edges, front and back, and under the eaves.
    for side in (-1, 1):
        for z in (z0 - 0.06, z1 + 0.06):
            mid = Vector((side * half / 2, (top + 0.25 + ridge) / 2 + 0.12, z))
            box(p, mid, (length + 0.1, 0.3, 0.1), 'Timber', tilt=(0, -side * slope))
        box(p, (side * (half + 0.02), top + 0.1, zc_roof), (0.08, 0.22, span + 0.1), 'Timber')
    # The gable ends: plaster triangles over the front and back walls, with a round window in the
    # front one; and over the porch's open front, a timber truss.
    tri = [(-W / 2, top), (W / 2, top), (0, ridge + 0.1)]
    slab(p, tri, BACK, BACK + WALL_T, 'Plaster')
    slab(p, tri, FRONT - WALL_T, FRONT, 'Plaster')
    ellipse_disc(p, (0, top + 0.75, FRONT + 0.02), 0.32, 0.32, 0.04, 'Glass')
    ellipse_ring(p, (0, top + 0.75, FRONT + 0.04), 0.32, 0.32, 0.05, 'Timber', steps=24)
    cylinder(p, (0, top + 0.43, FRONT + 0.06), (0, top + 1.07, FRONT + 0.06), 0.03, 0.03, 'Timber', 6)
    cylinder(p, (-0.32, top + 0.75, FRONT + 0.06), (0.32, top + 0.75, FRONT + 0.06), 0.03, 0.03, 'Timber', 6)
    zt = PORCH - 0.2
    cylinder(p, (0, top, zt), (0, ridge, zt), 0.12, 0.12, 'Timber', 8)
    for side in (-1, 1):
        cylinder(p, (0, top + 0.5, zt), (side * (W / 2 - 0.4), top, zt), 0.09, 0.09, 'Timber', 8)
        # Rafters under the porch's roof, to see from below.
        for z in (FRONT + 0.8, FRONT + 1.7):
            cylinder(p, (0, ridge, z), (side * half, top + 0.05, z), 0.08, 0.08, 'TimberLight', 6)
    # A chimney out of the roof at the back.
    box(p, (1.9, (FLOOR_TOP + ridge + 1.0) / 2, BACK + 1.0), (0.8, ridge + 1.0 - FLOOR_TOP, 0.8), 'Stone')
    box(p, (1.9, ridge + 1.05, BACK + 1.0), (0.95, 0.18, 0.95), 'StoneDark')

    # A lantern hanging under the porch roof by the door.
    lantern = Vector((-0.95, top - 0.75, FRONT + 0.25))
    cylinder(p, lantern + Vector((0, 0.25, 0)), lantern + Vector((0, 0.75, 0)), 0.015, 0.015, 'Timber', 6)
    box(p, lantern, (0.2, 0.28, 0.2), 'Glow')
    box(p, lantern + Vector((0, 0.17, 0)), (0.28, 0.06, 0.28), 'Timber')
    box(p, lantern + Vector((0, -0.17, 0)), (0.24, 0.05, 0.24), 'Timber')
    # Pots of flowers in the porch's front corners, by the posts.
    for side in (-1, 1):
        at = Vector((side * (W / 2 - 0.65), FLOOR_TOP, PORCH - 0.35))
        cylinder(p, at, at + Vector((0, 0.42, 0)), 0.2, 0.26, 'Pot', 12)
        flowers(p, at + Vector((0, 0.5, 0)), 0.12, 4, side)

    # ---------- the wardrobe ----------
    wx, wz = WARDROBE
    ww, wh, wd = 1.3, 2.3, 0.6
    y0 = FLOOR_TOP
    box(p, (wx, y0 + 0.12 + wh / 2, wz), (ww, wh, wd), 'Wardrobe')
    box(p, (wx, y0 + 0.12 + wh + 0.08, wz + 0.02), (ww + 0.16, 0.16, wd + 0.1), 'WardrobeTrim')
    box(p, (wx, y0 + 0.12 + wh + 0.22, wz), (ww * 0.6, 0.14, wd * 0.8), 'Wardrobe')
    for side in (-1, 1):
        # Its two doors, each with a panel, and a brass knob by the gap between them.
        box(p, (wx + side * ww / 4, y0 + 0.12 + wh / 2 + 0.1, wz + wd / 2 + 0.015), (ww / 2 - 0.12, wh - 0.5, 0.03), 'WardrobeTrim')
        box(p, (wx + side * ww / 4, y0 + 0.12 + wh / 2 + 0.1, wz + wd / 2 + 0.03), (ww / 2 - 0.26, wh - 0.66, 0.03), 'Wardrobe')
        ball(p, (wx + side * 0.09, y0 + 0.12 + wh / 2, wz + wd / 2 + 0.06), 0.05, 'Brass')
        # Little turned feet.
        for fz in (-1, 1):
            cylinder(p, (wx + side * (ww / 2 - 0.12), y0, wz + fz * (wd / 2 - 0.1)), (wx + side * (ww / 2 - 0.12), y0 + 0.14, wz + fz * (wd / 2 - 0.1)), 0.05, 0.07, 'TimberLight', 8)
    # A drawer along the bottom.
    box(p, (wx, y0 + 0.36, wz + wd / 2 + 0.015), (ww - 0.12, 0.34, 0.03), 'WardrobeTrim')
    ball(p, (wx, y0 + 0.36, wz + wd / 2 + 0.06), 0.045, 'Brass')

    # ---------- the mirror ----------
    # Built facing straight out, then turned on its stand about its middle.
    before = set(p.bm.verts)
    mx, mz = MIRROR
    my = FLOOR_TOP + MIRROR_Y
    a, b = MIRROR_W / 2, MIRROR_H / 2
    # A dark board behind the glass, the frame round it, and the stand: two legs either side, on
    # feet, that it pivots between.
    ellipse_disc(p, (mx, my, mz - 0.04), a + 0.02, b + 0.02, 0.05, 'Backing')
    ellipse_ring(p, (mx, my, mz - 0.005), a + 0.035, b + 0.035, 0.055, 'Frame')
    for side in (-1, 1):
        x = mx + side * (a + 0.16)
        cylinder(p, (x, FLOOR_TOP, mz - 0.02), (x, my + 0.2, mz - 0.02), 0.045, 0.04, 'Frame', 8)
        ball(p, (x, my + 0.22, mz - 0.02), 0.07, 'Frame')
        cylinder(p, (x, my, mz - 0.02), (mx + side * (a + 0.03), my, mz - 0.02), 0.03, 0.03, 'Frame', 6)
        box(p, (x, FLOOR_TOP + 0.04, mz - 0.02), (0.12, 0.08, 0.6), 'Frame')
    turned = [v for v in p.bm.verts if v not in before]
    pivot = Vector((mx, 0, mz))
    place(p.bm, turned, Matrix.Translation(pivot) @ Matrix.Rotation(MIRROR_YAW, 4, 'Y') @ Matrix.Translation(-pivot))
    # A round rug where she stands.
    sx, sz = stand()
    rug = [(sx + math.cos(TAU * k / 32) * 0.75, sz + math.sin(TAU * k / 32) * 0.6) for k in range(32)]
    bm = p.bm
    for r, (mat, lift) in ((1.0, ('RugTrim', 0.012)), (0.85, ('Rug', 0.02))):
        pts = [(sx + (x - sx) * r, sz + (z - sz) * r) for x, z in rug]
        lo = [bm.verts.new((x, FLOOR_TOP + 0.05, z)) for x, z in pts]
        hi = [bm.verts.new((x, FLOOR_TOP + 0.05 + lift, z)) for x, z in pts]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for i in range(len(pts)):
            bm.faces.new((lo[i], lo[(i + 1) % len(pts)], hi[(i + 1) % len(pts)], hi[i]))
        verts = lo + hi
        bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
        p.paint(verts, mat)
    return p.done()


OBJECTS = [house()]
glass = bpy.data.objects.new('MirrorGlass', None)
scene.collection.objects.link(glass)
glass.location = (MIRROR[0], FLOOR_TOP + MIRROR_Y, MIRROR[1])
glass.rotation_euler = (0, MIRROR_YAW, 0)

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
print(f'house: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    # Blender's own z-up world, for the previews: stand the y-up model upright in it.
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.2, 0.5)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 35
    scene.collection.objects.link(cam)
    scene.camera = cam
    # In Blender's frame: three.js (x, y, z) is Blender (x, -z, y).
    for name, at, look in (('front', (5, -14, 5), (0, 0, 2.2)), ('porch', (2.5, -7, 2.2), (0, -1.4, 1.6)), ('back', (-9, 11, 6), (0, 0, 2.2))):
        cam.location = at
        d = Vector(look) - Vector(at)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'house: previews in {PREVIEW}')
