# Builds the inside of Nixchan's house, for /home, and exports it as a .glb: one room, open at the
# front like a dollhouse (the page looks in from there), with her bed, a window, a bookshelf, a
# little table and the door back out to the island.
#
#   nix develop .#blender -c blender -b -P tools/home-room/build.py -- <out.glb> [preview-dir]
#
# Like the island's models, it's modelled in three.js coordinates in metres (y up, the floor at
# y = 0, the open front towards +z) and exported without the y-up conversion. The materials carry the
# real colours, which the page turns into toon materials; "Glow" is drawn unlit (the lamp's shade),
# and "Sky" is what's seen through the window, which the page colours for the time of day.
#
# The page knows these sizes (to walk round the room and its furniture, and to lay her on the bed),
# so if they change here change them in src/lib/home/room.ts too.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'room.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Floor': '#c9945f',
    'FloorDark': '#b78452',
    'Wall': '#f7e3e6',
    'WallStripe': '#f2d4da',
    'Panel': '#b07a4f',
    'Timber': '#8a5a3c',
    'TimberLight': '#c49364',
    'Door': '#5f7fc8',
    'Brass': '#e0b04a',
    'Sky': '#9fd0f5',
    'Glass': '#dff3ff',
    'Sheet': '#fdfbff',
    'Pillow': '#fdfbff',
    'Quilt': '#5f68bd',
    'QuiltLight': '#8f97e0',
    'Rug': '#f29db0',
    'RugTrim': '#fdfbff',
    'BookRed': '#e0606f',
    'BookBlue': '#5fa8e8',
    'BookGreen': '#5fbf9f',
    'BookYellow': '#ffd24d',
    'BookPurple': '#8a5fb8',
    'Mug': '#fdfbff',
    'Coffee': '#6b4f3c',
    'Leaf': '#5fae5c',
    'Pot': '#d9734e',
    'Clock': '#f25f6b',
    'ClockFace': '#fdfbff',
    'Ink': '#1d1b3a',
    'Petal': '#ff9ec7',
    'PetalYellow': '#ffd84d',
    'Glow': '#ffd27a',
}

# The sizes the page knows too (src/lib/home/room.ts).
W = 9.0  # the room's width (x), wall to wall inside
D = 6.0  # its depth (z), back wall to the open front
WALL_H = 3.6
WALL_T = 0.25
BACK = -D / 2
BED = {'x0': 1.2, 'x1': 4.3, 'z0': BACK, 'z1': BACK + 1.7, 'top': 0.72}  # the mattress
PILLOW = (1.75, BACK + 0.85)  # where her head goes
TABLE = (-2.2, 1.9)  # towards the front, clear of the way in from the door
SHELF = (-3.75, BACK + 0.35)
DOOR = (-W / 2, 0.6)  # its middle, in the left wall
WINDOW = (-0.6, 2.15)  # its middle, in the back wall (x, height)
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



# ---------- the room ----------


def room():
    p = Part('Room')
    x0, x1 = -W / 2, W / 2
    front = D / 2

    # The floor: planks running side to side, with a lip along the open front.
    planks = 14
    for k in range(planks):
        z = BACK + (k + 0.5) * D / planks
        box(p, (0, -0.05 + 0.004 * (k % 3), z), (W + 0.5, 0.1, D / planks - 0.025), 'Floor' if k % 2 else 'FloorDark')
    box(p, (0, -0.25, front + 0.05), (W + 0.6, 0.3, 0.12), 'Timber')
    box(p, (0, -0.2, 0), (W + 0.5, 0.2, D), 'Timber')

    # The walls (back, left and right): wood panelling up to the dado rail, striped paper above, and
    # a moulding along the top.
    def wall(centre, size, along):
        cx, cz = centre
        box(p, (cx, WALL_H / 2, cz), size, 'Wall')
        # Stripes of a deeper pink over the paper.
        n = int((size[0] if along == 'x' else size[2]) / 0.45)
        for k in range(n):
            t = -0.5 + (k + 0.5) / n
            if along == 'x':
                box(p, (cx + t * size[0], 1.1 + (WALL_H - 1.1) / 2, cz + size[2] / 2 + 0.003), (0.14, WALL_H - 1.1, 0.01), 'WallStripe')
            else:
                box(p, (cx + size[0] / 2 * (1 if cx < 0 else -1) + (0.003 if cx < 0 else -0.003), 1.1 + (WALL_H - 1.1) / 2, cz + t * size[2]), (0.01, WALL_H - 1.1, 0.14), 'WallStripe')
    wall((0, BACK - WALL_T / 2), (W + 2 * WALL_T, WALL_H, WALL_T), 'x')
    wall((x0 - WALL_T / 2, 0), (WALL_T, WALL_H, D), 'z')
    wall((x1 + WALL_T / 2, 0), (WALL_T, WALL_H, D), 'z')
    # Panelling, rail and moulding on each.
    box(p, (0, 0.55, BACK + 0.03), (W, 1.1, 0.06), 'Panel')
    box(p, (0, 1.12, BACK + 0.06), (W, 0.08, 0.1), 'TimberLight')
    box(p, (0, WALL_H - 0.08, BACK + 0.06), (W, 0.16, 0.12), 'Timber')
    for x, inward in ((x0, 1), (x1, -1)):
        box(p, (x + inward * 0.03, 0.55, 0), (0.06, 1.1, D), 'Panel')
        box(p, (x + inward * 0.06, 1.12, 0), (0.1, 0.08, D), 'TimberLight')
        box(p, (x + inward * 0.06, WALL_H - 0.08, 0), (0.12, 0.16, D), 'Timber')
        # The walls' cut ends at the open front, trimmed in timber.
        box(p, (x - inward * WALL_T / 2 + inward * 0.0, WALL_H / 2, front - 0.06), (WALL_T + 0.08, WALL_H + 0.05, 0.14), 'Timber')

    # The window in the back wall: round-topped, its frame and a cross of glazing bars, a deep sill,
    # and the sky seen through it (a panel just behind, which the page colours).
    wx, wy = WINDOW
    ww, wh = 1.6, 1.5
    sky = [(wx - ww / 2, wy - wh / 2), (wx + ww / 2, wy - wh / 2)] + [(wx + math.cos(a) * ww / 2, wy + wh / 2 - ww / 2 + math.sin(a) * ww / 2) for a in (math.pi * k / 16 for k in range(17))]
    slab(p, sky, BACK + 0.07, BACK + 0.08, 'Sky')
    for a0 in range(16):
        a, b = math.pi * a0 / 16, math.pi * (a0 + 1) / 16
        r = ww / 2 + 0.05
        cy = wy + wh / 2 - ww / 2
        cylinder(p, (wx + math.cos(a) * r, cy + math.sin(a) * r, BACK + 0.12), (wx + math.cos(b) * r, cy + math.sin(b) * r, BACK + 0.12), 0.06, 0.06, 'Timber', 6)
    for side in (-1, 1):
        box(p, (wx + side * (ww / 2 + 0.05), wy - ww / 4 + 0.0, BACK + 0.12), (0.12, wh - ww / 2 + 0.05, 0.1), 'Timber')
    box(p, (wx, wy - wh / 2 - 0.05, BACK + 0.2), (ww + 0.4, 0.1, 0.32), 'TimberLight')
    box(p, (wx, wy - 0.1, BACK + 0.11), (0.06, wh + 0.1, 0.06), 'TimberLight')
    box(p, (wx, wy - 0.15, BACK + 0.11), (ww, 0.06, 0.06), 'TimberLight')
    # A little potted plant on the sill.
    cylinder(p, (wx + 0.5, wy - wh / 2, BACK + 0.22), (wx + 0.5, wy - wh / 2 + 0.2, BACK + 0.22), 0.1, 0.13, 'Pot', 10)
    flowers(p, (wx + 0.5, wy - wh / 2 + 0.25, BACK + 0.22), 0.06, 3, 1)

    # ---------- the bed ----------
    b = BED
    bx, bz = (b['x0'] + b['x1']) / 2, (b['z0'] + b['z1']) / 2
    bw, bd = b['x1'] - b['x0'], b['z1'] - b['z0']
    # Frame on four turned legs, a tall headboard at the pillow's end and a low footboard.
    box(p, (bx, 0.38, bz), (bw, 0.18, bd), 'TimberLight')
    for x in (b['x0'] + 0.1, b['x1'] - 0.1):
        for z in (b['z0'] + 0.1, b['z1'] - 0.1):
            cylinder(p, (x, 0, z), (x, 0.32, z), 0.07, 0.06, 'Timber', 10)
    box(p, (b['x0'] + 0.05, 0.75, bz), (0.12, 1.5, bd + 0.06), 'Timber')
    for z in (b['z0'] + 0.04, b['z1'] - 0.04):
        ball(p, (b['x0'] + 0.05, 1.55, z), 0.09, 'Brass')
    box(p, (b['x1'] - 0.05, 0.55, bz), (0.12, 0.9, bd + 0.06), 'Timber')
    # The mattress and its sheet, the pillow, and a quilt folded down over the foot.
    box(p, (bx, b['top'] - 0.12, bz), (bw - 0.2, 0.24, bd - 0.06), 'Sheet')
    px, pz = PILLOW
    ball(p, (px - 0.2, b['top'] + 0.08, pz), 1, 'Pillow', scale=(0.42, 0.13, 0.62), seg=(20, 10))
    qx0 = b['x1'] - 1.0
    box(p, (qx0 + 0.45, b['top'] + 0.04, bz), (0.9, 0.1, bd - 0.02), 'Quilt')
    for k in range(4):
        box(p, (qx0 + 0.12 + k * 0.22, b['top'] + 0.095, bz), (0.08, 0.01, bd - 0.04), 'QuiltLight')
    box(p, (qx0 + 0.45, b['top'] - 0.1, b['z1'] + 0.02), (0.9, 0.3, 0.04), 'Quilt')

    # A nightstand by the pillow, with a lamp and an alarm clock on it.
    nx, nz = b['x0'] - 0.55, BACK + 0.45
    box(p, (nx, 0.32, nz), (0.7, 0.64, 0.6), 'TimberLight')
    box(p, (nx, 0.4, nz + 0.305), (0.56, 0.22, 0.02), 'Timber')
    ball(p, (nx, 0.4, nz + 0.33), 0.03, 'Brass')
    cylinder(p, (nx - 0.12, 0.64, nz), (nx - 0.12, 0.94, nz), 0.025, 0.025, 'Brass', 8)
    cylinder(p, (nx - 0.12, 0.64, nz), (nx - 0.12, 0.67, nz), 0.12, 0.12, 'Brass', 12)
    cylinder(p, (nx - 0.12, 0.9, nz), (nx - 0.12, 1.12, nz), 0.2, 0.12, 'Glow', 14)
    ball(p, (nx + 0.16, 0.74, nz + 0.05), 1, 'Clock', scale=(0.1, 0.1, 0.06), seg=(16, 8))
    ellipse_disc(p, (nx + 0.16, 0.74, nz + 0.11), 0.07, 0.07, 0.01, 'ClockFace')
    cylinder(p, (nx + 0.16, 0.74, nz + 0.12), (nx + 0.16, 0.795, nz + 0.12), 0.006, 0.006, 'Ink', 4)
    cylinder(p, (nx + 0.16, 0.74, nz + 0.12), (nx + 0.2, 0.74, nz + 0.12), 0.006, 0.006, 'Ink', 4)
    for side in (-1, 1):
        ball(p, (nx + 0.16 + side * 0.06, 0.85, nz + 0.05), 0.035, 'Brass')

    # ---------- the bookshelf ----------
    sx, sz = SHELF
    sw, sh, sd = 1.3, 2.5, 0.5
    for side in (-1, 1):
        box(p, (sx + side * (sw / 2 - 0.04), sh / 2, sz), (0.08, sh, sd), 'Timber')
    box(p, (sx, sh / 2, sz - sd / 2 + 0.02), (sw, sh, 0.04), 'Timber')
    books = ('BookRed', 'BookBlue', 'BookGreen', 'BookYellow', 'BookPurple')
    for shelf in range(5):
        y = 0.05 + shelf * (sh - 0.1) / 4
        box(p, (sx, y, sz), (sw - 0.08, 0.06, sd), 'TimberLight')
        if shelf == 4:
            continue
        x = sx - sw / 2 + 0.12
        k = shelf * 3
        while x < sx + sw / 2 - 0.2:
            bwid = 0.07 + 0.03 * ((k * 7) % 3)
            bh = 0.34 + 0.06 * ((k * 5) % 3)
            lean = 0.12 if (k % 7) == 3 else 0.0
            box(p, (x + bwid / 2, y + 0.03 + bh / 2, sz + 0.02), (bwid, bh, 0.32), books[k % 5], tilt=(0, lean))
            x += bwid + 0.012 + lean * 0.2
            k += 1

    # ---------- the table, its stools, and her mug ----------
    tx, tz = TABLE
    cylinder(p, (tx, 0, tz), (tx, 0.06, tz), 0.35, 0.35, 'Timber', 16)
    cylinder(p, (tx, 0.06, tz), (tx, 0.72, tz), 0.07, 0.07, 'Timber', 10)
    cylinder(p, (tx, 0.72, tz), (tx, 0.8, tz), 0.62, 0.62, 'TimberLight', 24)
    for side in (-1, 1):
        s = Vector((tx + side * 0.95, 0, tz))
        cylinder(p, s, s + Vector((0, 0.48, 0)), 0.06, 0.06, 'Timber', 8)
        cylinder(p, s + Vector((0, 0.48, 0)), s + Vector((0, 0.56, 0)), 0.28, 0.28, 'Quilt', 16)
    cylinder(p, (tx + 0.15, 0.8, tz + 0.1), (tx + 0.15, 0.98, tz + 0.1), 0.08, 0.08, 'Mug', 12)
    cylinder(p, (tx + 0.15, 0.97, tz + 0.1), (tx + 0.15, 0.985, tz + 0.1), 0.065, 0.065, 'Coffee', 12)
    cylinder(p, (tx + 0.23, 0.88, tz + 0.1), (tx + 0.27, 0.92, tz + 0.1), 0.02, 0.02, 'Mug', 6)

    # ---------- the door back out ----------
    dx, dz = DOOR
    dw, dh = 1.2, 2.4
    box(p, (dx + 0.02, dh / 2, dz), (0.1, dh, dw), 'Door')
    for k in (-1, 0, 1):
        box(p, (dx + 0.08, dh / 2, dz + k * 0.38), (0.02, dh - 0.1, 0.03), 'Timber')
    ball(p, (dx + 0.12, 1.15, dz + 0.42), 0.06, 'Brass')
    for side in (-1, 1):
        box(p, (dx + 0.06, dh / 2 + 0.05, dz + side * (dw / 2 + 0.08)), (0.12, dh + 0.1, 0.16), 'Timber')
    box(p, (dx + 0.06, dh + 0.1, dz), (0.14, 0.18, dw + 0.32), 'Timber')
    # A round window in it, as on the outside.
    port = [(dz + math.cos(TAU * k / 20) * 0.2, 1.85 + math.sin(TAU * k / 20) * 0.2) for k in range(20)]
    bm = p.bm
    lo = [bm.verts.new((dx + 0.075, y, z)) for z, y in port]
    hi = [bm.verts.new((dx + 0.09, y, z)) for z, y in port]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(20):
        bm.faces.new((lo[i], hi[i], hi[(i + 1) % 20], lo[(i + 1) % 20]))
    verts = lo + hi
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    p.paint(verts, 'Sky')
    # A mat in front of it.
    box(p, (dx + 0.55, 0.01, dz), (0.7, 0.02, 1.1), 'Rug')

    # A round rug in the middle of the room, and a big pot plant in the front corner.
    rug = [(-0.3 + math.cos(TAU * k / 40) * 1.5, 0.4 + math.sin(TAU * k / 40) * 1.1) for k in range(40)]
    for r, (mat, lift) in ((1.0, ('RugTrim', 0.012)), (0.88, ('Rug', 0.02))):
        pts = [(-0.3 + (x + 0.3) * r, 0.4 + (z - 0.4) * r) for x, z in rug]
        lo = [bm.verts.new((x, 0.0, z)) for x, z in pts]
        hi = [bm.verts.new((x, lift, z)) for x, z in pts]
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for i in range(len(pts)):
            bm.faces.new((lo[i], lo[(i + 1) % len(pts)], hi[(i + 1) % len(pts)], hi[i]))
        verts = lo + hi
        bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
        p.paint(verts, mat)
    cylinder(p, (3.9, 0, 2.2), (3.9, 0.55, 2.2), 0.28, 0.35, 'Pot', 14)
    for k in range(7):
        a = TAU * k / 7
        ball(p, (3.9 + math.cos(a) * 0.22, 0.75 + 0.15 * (k % 3), 2.2 + math.sin(a) * 0.22), 0.26, 'Leaf', scale=(1, 0.8, 1))
    return p.done()


OBJECTS = [room()]

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
print(f'room: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 640
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.5, 0.2, 0.3)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 30
    scene.collection.objects.link(cam)
    scene.camera = cam
    # In Blender's frame: three.js (x, y, z) is Blender (x, -z, y). The page looks in from the front.
    for name, at, look in (('front', (0, -11.5, 5.2), (0, 0, 1.2)), ('bed', (2.2, -5, 3), (2.6, 2.2, 0.6))):
        cam.location = at
        d = Vector(look) - Vector(at)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'room: previews in {PREVIEW}')
