# Builds the sky gate at the end of the path on /experimental (the walk-along 3D homepage): a
# horseshoe arch of stones on a round plinth that Nixchan walks through to get to /island.
#
#   nix develop .#blender -c blender -b -P tools/experimental-portal/build.py -- <out.glb> [preview-dir]
#
# Like the island's models (tools/island-forge and friends), each piece is its own object, named for
# the page to pick out, modelled in three.js coordinates in metres (y up, standing on y = 0, its
# front towards +z) and exported without the y-up conversion. Materials carry the real colours;
# "Glow" is drawn unlit by the page, so it shines.
#
#   Gate     the plinth, the arch on its two feet, the keystone with its star, moss, and crystals
#   Veil     the opening, a flat face at z = 0 the page draws its swirling sky on
#   Float0…2 little mossy rocks that drift round the arch
#
# The page knows the arch's size (to walk through the opening and round its feet), so if these
# change here change them in src/lib/experimental/portal.ts too.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'portal.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = 2 * math.pi

COLORS = {
    'Stone': '#c9c3e3',
    'StoneDark': '#a59dc8',
    'Plinth': '#d8d1c4',
    'PlinthDark': '#b9b0a3',
    'Moss': '#8fd17a',
    'MossDark': '#6fb562',
    'Rock': '#9a92ad',
    'Star': '#ffd166',
    'Glow': '#9fe3ff',
    'Veil': '#ffffff',
}

# The arch: a ring round (0, CENTRE_Y) from R_IN to R_OUT, open at the bottom below FOOT angle,
# where it stands on two feet down to the plinth's top.
PLINTH_TOP = 0.06
PLINTH_R = 2.9
CENTRE_Y = 2.15
R_IN = 1.5
R_OUT = 2.02
DEPTH = 0.62
FOOT = math.radians(-38)  # where the arc ends on the right; the left mirrors it


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
    if name in ('Glow', 'Veil'):
        bsdf.inputs['Emission Color'].default_value = (*linear(hex_color), 1)
        bsdf.inputs['Emission Strength'].default_value = 1.5
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


def box(part, centre, size, mat, yaw=0.0, roll=0.0):
    verts = bmesh.ops.create_cube(part.bm, size=1)['verts']
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(roll, 4, 'Z')
    place(part.bm, verts, Matrix.Translation(centre) @ turn @ Matrix.Diagonal((*size, 1)))
    return part.paint(verts, mat)


def disc(part, y0, y1, r0, r1, mat, segments=40, lobes=0.0, seed=0.0):
    """A round slab from y0 to y1, its radius r0 at the bottom and r1 at the top, the rim a little
    lumpy with `lobes`, like rough-cut stone."""
    bm = part.bm
    ring0, ring1 = [], []
    for i in range(segments):
        a = TAU * i / segments
        k = 1 + lobes * math.sin(a * 5 + seed) * math.cos(a * 3 - seed)
        ring0.append(bm.verts.new((r0 * k * math.cos(a), y0, -r0 * k * math.sin(a))))
        ring1.append(bm.verts.new((r1 * k * math.cos(a), y1, -r1 * k * math.sin(a))))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    verts = ring0 + ring1
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


def voussoir(part, a0, a1, r0, r1, depth, mat, steps=3):
    """One stone of the arch: the ring between angles a0 and a1, radii r0 to r1, `depth` deep,
    centred on z = 0. Its faces are bevelled in a touch, so each stone reads on its own."""
    bm = part.bm
    bev = 0.05
    loops = []
    for z, inset in ((-depth / 2, bev), (-depth / 2 + bev, 0), (depth / 2 - bev, 0), (depth / 2, bev)):
        loop = []
        # Inner edge from a0 to a1, then the outer edge back.
        for k in range(steps + 1):
            a = a0 + (a1 - a0) * k / steps
            loop.append((a, r0 + inset))
        for k in range(steps, -1, -1):
            a = a0 + (a1 - a0) * k / steps
            loop.append((a, r1 - inset))
        loops.append([bm.verts.new(((r) * math.cos(a), CENTRE_Y + r * math.sin(a), z)) for a, r in loop])
    n = len(loops[0])
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    for la, lb in zip(loops, loops[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((la[i], la[j], lb[j], lb[i]))
    verts = [v for loop in loops for v in loop]
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


def lump(part, centre, radius, mat, squash=0.6, seed=0, subdivisions=1):
    verts = bmesh.ops.create_icosphere(part.bm, subdivisions=subdivisions, radius=radius)['verts']
    for v in verts:
        k = 0.85 + 0.25 * math.sin(v.co.x * 5.1 + seed) * math.cos(v.co.z * 4.3 - seed * 2)
        v.co = Vector((v.co.x * k, v.co.y * squash * k, v.co.z * k)) + Vector(centre)
    return part.paint(verts, mat)


def crystal(part, base, height, radius, lean, yaw):
    """A six-sided crystal point standing at `base`, leaning `lean` radians towards `yaw`."""
    bm = part.bm
    sides = 6
    bottom = [bm.verts.new((radius * math.cos(TAU * i / sides), 0, radius * math.sin(TAU * i / sides))) for i in range(sides)]
    shoulder = [bm.verts.new((radius * 1.05 * math.cos(TAU * i / sides), height * 0.7, radius * 1.05 * math.sin(TAU * i / sides))) for i in range(sides)]
    tip = bm.verts.new((0, height, 0))
    bm.faces.new(list(reversed(bottom)))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bottom[i], bottom[j], shoulder[j], shoulder[i]))
        bm.faces.new((shoulder[i], shoulder[j], tip))
    verts = bottom + shoulder + [tip]
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    turn = Matrix.Rotation(yaw, 4, 'Y') @ Matrix.Rotation(lean, 4, 'Z')
    place(bm, verts, Matrix.Translation(base) @ turn)
    return part.paint(verts, 'Glow')


def star(part, centre, radius, depth, mat):
    """A plump four-pointed star facing +z, like the ones on the site."""
    bm = part.bm
    points = []
    for i in range(16):
        a = TAU * i / 16 + math.pi / 2
        r = radius if i % 4 == 0 else radius * (0.42 if i % 2 else 0.3)
        points.append((r * math.cos(a), r * math.sin(a)))
    back = [bm.verts.new((centre[0] + x, centre[1] + y, centre[2])) for x, y in points]
    front = [bm.verts.new((centre[0] + x, centre[1] + y, centre[2] + depth)) for x, y in points]
    bm.faces.new(list(reversed(back)))
    bm.faces.new(front)
    for i in range(16):
        j = (i + 1) % 16
        bm.faces.new((back[i], back[j], front[j], front[i]))
    verts = back + front
    bmesh.ops.recalc_face_normals(bm, faces=list({f for v in verts for f in v.link_faces}))
    return part.paint(verts, mat)


# ---------- the gate ----------


def gate():
    p = Part('Gate')
    # A round plinth, sunk into the meadow so only its top shows, with a rough rim of darker stone.
    disc(p, -0.4, PLINTH_TOP - 0.03, PLINTH_R + 0.15, PLINTH_R + 0.08, 'PlinthDark', lobes=0.03, seed=1.3)
    disc(p, -0.4, PLINTH_TOP, PLINTH_R - 0.2, PLINTH_R - 0.25, 'Plinth', lobes=0.02, seed=0.4)

    # The arch: stones from the right foot round over the top to the left one, the odd ones a shade
    # darker and every stone a little deeper or shallower than the next, so it looks laid by hand.
    a0, a1 = FOOT, math.pi - FOOT
    stones = 13
    gap = math.radians(0.9)
    for i in range(stones):
        s0 = a0 + (a1 - a0) * i / stones + gap / 2
        s1 = a0 + (a1 - a0) * (i + 1) / stones - gap / 2
        key = i == stones // 2
        depth = DEPTH + (0.14 if key else 0.06 * math.sin(i * 2.3))
        r1 = R_OUT + (0.22 if key else 0.03 * math.cos(i * 1.7))
        voussoir(p, s0, s1, R_IN - (0.04 if key else 0), r1, depth, 'StoneDark' if i % 2 else 'Stone')

    # The feet: from the ends of the arc straight down to the plinth, a block each, on a wider sill.
    for side in (-1, 1):
        x_in = R_IN * math.cos(FOOT)
        x_out = R_OUT * math.cos(FOOT) + 0.12
        top = CENTRE_Y + R_IN * math.sin(FOOT) + 0.02
        w = x_out - x_in
        box(p, (side * (x_in + w / 2), PLINTH_TOP + (top - PLINTH_TOP) / 2, 0), (w, top - PLINTH_TOP, DEPTH + 0.02), 'Stone')
        box(p, (side * (x_in + w / 2), PLINTH_TOP + 0.13, 0), (w + 0.24, 0.26, DEPTH + 0.26), 'StoneDark')

    # The star on the keystone, front and back.
    key_y = CENTRE_Y + (R_IN + R_OUT + 0.18) / 2
    for side in (-1, 1):
        z = side * (DEPTH / 2 + 0.07)
        star(p, (0, key_y, z if side > 0 else z - 0.05), 0.3, 0.05, 'Star')

    # Moss along the top of the arch, and at its feet.
    for k, a in enumerate((0.62, 0.95, 1.35, 1.9, 2.3)):
        r = R_OUT + 0.02
        lump(p, (r * math.cos(a) * 0.98, CENTRE_Y + r * math.sin(a) - 0.02, 0.05 * math.sin(k * 3)), 0.24 - 0.03 * (k % 2), 'Moss' if k % 2 else 'MossDark', squash=0.45, seed=k * 2.1)
    for side, z in ((-1, 0.4), (1, -0.35)):
        lump(p, (side * (R_OUT * math.cos(FOOT) + 0.3), PLINTH_TOP + 0.05, z), 0.3, 'Moss', squash=0.5, seed=side * 4)

    # Crystals, like the ones on Cloudrest, growing out of the plinth by either foot.
    for x, z, h, r, lean, yaw in (
        (-2.15, 0.65, 0.95, 0.15, 0.25, 0.3),
        (-2.45, 0.2, 0.6, 0.11, 0.4, 0.9),
        (-1.95, 1.05, 0.42, 0.09, -0.3, 2.0),
        (2.3, 0.5, 0.75, 0.13, -0.3, 1.2),
        (2.05, 0.95, 0.45, 0.09, 0.35, 2.8),
    ):
        crystal(p, (x, PLINTH_TOP - 0.02, z), h, r, lean, yaw)
    return p.done()


def veil():
    """The opening: the arc of the arch above, straight down its feet to the plinth below."""
    p = Part('Veil')
    bm = p.bm
    outline = []
    x_in = R_IN * math.cos(FOOT)
    outline.append((x_in, PLINTH_TOP))
    steps = 40
    for k in range(steps + 1):
        a = FOOT + (math.pi - 2 * FOOT) * k / steps
        outline.append((R_IN * math.cos(a), CENTRE_Y + R_IN * math.sin(a)))
    outline.append((-x_in, PLINTH_TOP))
    verts = [bm.verts.new((x, y, 0)) for x, y in outline]
    bm.faces.new(verts)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY', ngon_method='EAR_CLIP')
    return p.done()


def floater(index, radius, seed):
    p = Part(f'Float{index}')
    lump(p, (0, 0, 0), radius, 'Rock', squash=0.7, seed=seed, subdivisions=1)
    lump(p, (0, radius * 0.45, 0), radius * 0.8, 'Moss', squash=0.3, seed=seed + 1, subdivisions=1)
    return p.done()


OBJECTS = [gate(), veil(), floater(0, 0.26, 1.0), floater(1, 0.2, 2.5), floater(2, 0.16, 4.0)]

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
print(f'portal: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    for o in OBJECTS:
        o.rotation_euler = (math.pi / 2, 0, 0)
    layout = {'Gate': (0, 0, 0), 'Veil': (0, 0, 0), 'Float0': (-2.6, 0.3, 3.2), 'Float1': (2.7, -0.2, 3.9), 'Float2': (0.6, 0.6, 4.6)}
    for o in OBJECTS:
        x, z, y = layout[o.name]
        o.location = (x, -z, y)
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.85, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.7, 0.3, 0.5)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 7.5
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location, target in (('front', (0, -20, 3), (0, 0, 2.2)), ('angle', (9, -14, 7), (0, 0, 1.8))):
        target = Vector(target)
        cam.rotation_euler = (target - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
        cam.location = location
        scene.render.filepath = os.path.join(PREVIEW, f'portal-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'portal: previews in {PREVIEW}')
