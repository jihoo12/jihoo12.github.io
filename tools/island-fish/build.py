# Builds the fish Nixchan can catch on /island and exports them as one .glb.
#
#   nix develop .#blender -c blender -b -P tools/island-fish/build.py -- <out.glb> [preview-dir]
#
# Four body shapes, each its own object: Sardine (slim, forked tail), Bream (tall, with a big dorsal
# fin), Puffer (round and spiky) and Moonfish (a tall disc with long sweeping fins). Each is modelled
# in three.js coordinates, a unit long from tail to nose, nose towards +z, and exported without the
# y-up conversion. Materials are placeholders named Body, Belly, Fin, Eye and Shine: the page swaps
# them for toon materials in each species' colours, so one shape serves several kinds of fish.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'fish.glb')
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Preview colours only; the page brings its own.
COLORS = {'Body': '#5f9be8', 'Belly': '#eef3ff', 'Fin': '#3f6fb8', 'Eye': '#1d1b3a', 'Shine': '#ffffff'}
ORDER = list(COLORS)


def linear(hex_color):
    c = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


MATS = {}
for name, hex_color in COLORS.items():
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*linear(hex_color), 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    MATS[name] = mat
M = {name: i for i, name in enumerate(ORDER)}


def body(bm, height, width, rings=28, sides=20, belly=-0.25, fat=0.75, nose=0.55):
    """A body lofted from oval rings along z, from the tail (-0.5) to the nose (+0.5).
    `height(s)` and `width(s)` give the ring's half-sizes, s running 0 (tail) to 1 (nose)."""
    grid = []
    for i in range(rings + 1):
        s = i / rings
        # Rings bunch up towards the nose, which is where the shape turns fastest.
        z = -0.5 + s
        h, w = height(s), width(s)
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            ring.append(bm.verts.new((math.sin(a) * w, math.cos(a) * h, z)))
        grid.append(ring)
    for lo, hi in zip(grid, grid[1:]):
        for k in range(sides):
            f = bm.faces.new((lo[k], lo[(k + 1) % sides], hi[(k + 1) % sides], hi[k]))
            y = sum(v.co.y for v in f.verts) / 4
            top = max(v.co.y for v in hi)
            f.material_index = M['Belly'] if y < belly * top else M['Body']
    for ring, flip in ((grid[0], True), (grid[-1], False)):
        centre = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
        for k in range(sides):
            a, b = ring[k], ring[(k + 1) % sides]
            f = bm.faces.new((a, centre, b) if flip else (b, centre, a))
            f.material_index = M['Body']


def fin(bm, outline, thick=0.012, x=0.0, mat='Fin', matrix=None):
    """A thin flat fin from a closed outline of (z, y) points, in the plane x = `x`."""
    front = [bm.verts.new((x + thick, y, z)) for z, y in outline]
    back = [bm.verts.new((x - thick, y, z)) for z, y in outline]
    faces = [bm.faces.new(front), bm.faces.new(list(reversed(back)))]
    n = len(outline)
    for k in range(n):
        faces.append(bm.faces.new((front[k], back[k], back[(k + 1) % n], front[(k + 1) % n])))
    for f in faces:
        f.material_index = M[mat]
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=front + back)


def ball(bm, centre, radius, mat, seg=(12, 8), scale=(1, 1, 1)):
    verts = bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=radius)['verts']
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*scale, 1)), verts=verts)
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = M[mat]


def eyes(bm, z, y, x, r):
    for side in (-1, 1):
        ball(bm, Vector((side * x, y, z)), r, 'Eye')
        ball(bm, Vector((side * (x + r * 0.55), y + r * 0.35, z + r * 0.35)), r * 0.35, 'Shine', seg=(8, 6))


def side_fins(bm, z, y, x, size):
    for side in (-1, 1):
        outline = [(0, 0), (-size * 0.9, size * 0.35), (-size, -size * 0.25)]
        fin(bm, outline, thick=0.008, matrix=Matrix.Translation((side * x, y, z)) @ Matrix.Rotation(side * 0.5, 4, 'Y'))


def envelope(s, peak=0.55, tail=0.07, nose=0.08, power=0.8):
    """0 → 1 → 0 along the body: thin at the tail, fullest at `peak`, rounded off at the nose."""
    if s < peak:
        u = s / peak
        return tail + (1 - tail) * math.sin(u * math.pi / 2) ** power
    u = (s - peak) / (1 - peak)
    return nose + (1 - nose) * math.cos(u * math.pi / 2) ** 0.55


def obj(name, bm):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in ORDER:
        me.materials.append(MATS[m])
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def sardine():
    bm = bmesh.new()
    body(bm, lambda s: 0.13 * envelope(s, 0.6), lambda s: 0.08 * envelope(s, 0.6))
    fin(bm, [(-0.47, 0), (-0.66, 0.16), (-0.6, 0.01), (-0.66, -0.16)])
    fin(bm, [(0.05, 0.11), (-0.12, 0.2), (-0.16, 0.09)])
    side_fins(bm, 0.2, -0.04, 0.06, 0.09)
    eyes(bm, 0.36, 0.03, 0.055, 0.03)
    return obj('Sardine', bm)


def bream():
    bm = bmesh.new()
    body(bm, lambda s: 0.27 * envelope(s, 0.52, tail=0.12, power=0.6), lambda s: 0.1 * envelope(s, 0.52))
    fin(bm, [(-0.45, 0), (-0.64, 0.2), (-0.6, 0), (-0.64, -0.2)])
    fin(bm, [(0.2, 0.24), (0.0, 0.36), (-0.3, 0.27), (-0.35, 0.12)])
    fin(bm, [(-0.1, -0.2), (-0.3, -0.27), (-0.35, -0.12)])
    side_fins(bm, 0.15, -0.05, 0.08, 0.12)
    eyes(bm, 0.3, 0.07, 0.07, 0.04)
    return obj('Bream', bm)


def puffer():
    bm = bmesh.new()
    body(bm, lambda s: 0.3 * envelope(s, 0.5, tail=0.15, nose=0.2, power=0.45), lambda s: 0.28 * envelope(s, 0.5, tail=0.15, nose=0.2, power=0.45), belly=-0.1)
    fin(bm, [(-0.44, 0), (-0.58, 0.1), (-0.58, -0.1)])
    side_fins(bm, 0.12, 0.0, 0.25, 0.1)
    eyes(bm, 0.32, 0.12, 0.17, 0.045)
    # Little spikes all over, as cones standing out from the body.
    for i in range(7):
        s = 0.18 + i * 0.1
        for k in range(10):
            a = 2 * math.pi * (k + (i % 2) * 0.5) / 10
            e = envelope(s, 0.5, tail=0.15, nose=0.2, power=0.45)
            n = Vector((math.sin(a) * 0.28 * e, math.cos(a) * 0.3 * e, -0.5 + s))
            normal = Vector((n.x / 0.28, n.y / 0.3, 0)).normalized()
            verts = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.022, radius2=0.0, depth=0.06)['verts']
            up = Vector((0, 0, 1))
            rot = up.rotation_difference(normal).to_matrix().to_4x4()
            bmesh.ops.transform(bm, matrix=Matrix.Translation(n + normal * 0.02) @ rot, verts=verts)
            for f in {f for v in verts for f in v.link_faces}:
                f.material_index = M['Fin']
    return obj('Puffer', bm)


def moonfish():
    bm = bmesh.new()
    body(bm, lambda s: 0.36 * envelope(s, 0.5, tail=0.1, nose=0.12, power=0.5), lambda s: 0.08 * envelope(s, 0.5))
    fin(bm, [(-0.44, 0), (-0.62, 0.26), (-0.56, 0), (-0.62, -0.26)])
    # Long fins sweeping back from the top and bottom of the disc.
    fin(bm, [(0.15, 0.32), (-0.1, 0.62), (-0.2, 0.55), (-0.38, 0.14)])
    fin(bm, [(0.05, -0.32), (-0.15, -0.58), (-0.25, -0.5), (-0.38, -0.14)])
    side_fins(bm, 0.12, -0.05, 0.07, 0.14)
    eyes(bm, 0.3, 0.08, 0.06, 0.045)
    return obj('Moonfish', bm)


SHAPES = [sardine(), bream(), puffer(), moonfish()]

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
tris = sum(len(f.vertices) - 2 for o in SHAPES for f in o.data.polygons)
print(f'fish: wrote {OUT} ({tris} triangles, {os.path.getsize(OUT) // 1024} KiB)')

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 300
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.56, 0.7, 1)
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.6, 0.4, 0)
    for i, o in enumerate(SHAPES):
        o.location = (0, 0, (i - 1.5) * 1.6)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 6.6
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, location in (('side', (6, 0, 0)), ('above', (3, 4, 0))):
        # The camera looks down its own -z, with +y (up, in these y-up models) kept up.
        back = Vector(location).normalized()
        x = Vector((0, 1, 0)).cross(back).normalized()
        cam.matrix_world = Matrix((x, back.cross(x), back)).transposed().to_4x4()
        cam.matrix_world.translation = location
        scene.render.filepath = os.path.join(PREVIEW, f'fish-{name}.png')
        bpy.ops.render.render(write_still=True)
    print(f'fish: previews in {PREVIEW}')
