"""Build an illustrative detention camp, with real embedded browser PBR rasters.

Run: blender --background --python scripts/build-mural-detention-set.py
This script creates only the new detention asset. No historical camp plan is asserted.
The same reviewed 512px authored material functions as the Yuezhi refinement are reused
through AST-selected function definitions; the original script's asset entry point is
never imported or run. Blender Z up is converted to glTF Y up on export.
"""
import argparse
import ast
import hashlib
import json
import math
import pathlib
import struct
import sys
from collections import Counter

import bpy
import numpy as np
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[1]
SIZE = 512
SEED = 20261001
np.random.seed(SEED)
args = argparse.ArgumentParser()
args.add_argument('--out-dir', type=pathlib.Path, default=ROOT / 'viewer/public/mural-assets')
args.add_argument('--evidence-dir', type=pathlib.Path,
                  default=ROOT.parent.parent / 'outputs/mural-clarity/detention-camp-r4')
options = args.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = options.out_dir.resolve()
EVIDENCE = options.evidence_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
UPSTREAM = ROOT / 'scripts/refine-yuezhi-environment.py'
HELPERS = {'image', 'isotropic_noise', 'textures', 'pbr_material', 'metric_uv', 'inspect_glb'}
functions = [node for node in ast.parse(UPSTREAM.read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and node.name in HELPERS]
if {node.name for node in functions} != HELPERS:
    raise RuntimeError('Reviewed upstream material helpers are missing')
exec(compile(ast.Module(body=functions, type_ignores=[]), str(UPSTREAM), 'exec'), globals())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def bv(point):
    """glTF (X,Y,Z) to Blender (X,-Z,Y)."""
    return Vector((point[0], -point[2], point[1]))

def material(kind, label, tint=(1, 1, 1)):
    mat = pbr_material(kind)
    mat.name = 'Refined illustrative detention ' + label + ' - embedded PBR'
    shader = mat.node_tree.nodes.get('Principled BSDF')
    base = shader.inputs['Base Color'].links[0].from_node.image
    pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    base.pixels.foreach_get(pixels)
    pixels = pixels.reshape(SIZE, SIZE, 4)
    pixels[:, :, :3] = np.clip(pixels[:, :, :3] * np.array(tint), 0, 1)
    base.pixels.foreach_set(pixels.ravel())
    base.pack()
    return mat

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
materials = {
    'earth': material('earth', 'earth soil'),
    'felt': material('cloth', 'weathered felt', (1.05, 1.04, .98)),
    'felt_dark': material('cloth', 'dark woven cloth', (.62, .60, .56)),
    'wood': material('wood', 'rough timber'),
    'rope': material('cloth', 'plant fibre rope', (.83, .81, .70)),
    'stone': material('rock', 'rough hearth stone', (.83, .85, .86)),
    'clay': material('clay', 'plain earthenware', (1.12, .94, .76)),
    'grass': material('earth', 'dry grass', (.79, .92, .55)),
}
components = Counter()
objects = []

def mesh(name, verts, faces, mat, tile=.55, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([bv(v) for v in verts], [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for face in data.polygons:
        face.use_smooth = smooth
    metric_uv(ob, tile)
    objects.append(ob)
    return ob

def box(name, center, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=bv(center))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    if bevel:
        modifier = ob.modifiers.new('Worn edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 2
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    metric_uv(ob, .5)
    objects.append(ob)
    return ob

def beam(name, a, b, radius, mat, segments=12):
    a, b = bv(a), bv(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=radius,
                                       depth=(b - a).length, location=(a + b) * .5)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.data.materials.append(mat)
    for face in ob.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    metric_uv(ob, .38)
    objects.append(ob)
    return ob

def tube(name, points, radius, mat, segments=6):
    points = [Vector(p) for p in points]
    vertices, faces = [], []
    for i, p in enumerate(points):
        axis = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        cross = axis.cross(Vector((0, 1, 0)))
        if cross.length < .01:
            cross = axis.cross(Vector((1, 0, 0)))
        u = cross.normalized()
        v = axis.cross(u).normalized()
        for s in range(segments):
            vertices.append(tuple(p + radius * (u * math.cos(s * math.tau / segments)
                                               + v * math.sin(s * math.tau / segments))))
        if i:
            for s in range(segments):
                a = (i - 1) * segments + s
                b = (i - 1) * segments + (s + 1) % segments
                faces.append((a, b, i * segments + (s + 1) % segments, i * segments + s))
    return mesh(name, vertices, faces, mat, tile=.3, smooth=True)

def terrain_height(x, z):
    distance = max(abs(x), abs(z))
    weight = min(1, max(0, (distance - 4.15) / 2.5))
    return weight * (.042 * math.sin(x * .83 + z * .47) + .025 * math.sin(z * 1.61 - x * .39))

N = 81
vertices = []
for j in range(N):
    z = -13 + 26 * j / (N - 1)
    for i in range(N):
        x = -13 + 26 * i / (N - 1)
        vertices.append((x, terrain_height(x, z), z))
faces = []
for j in range(N - 1):
    for i in range(N - 1):
        a = j * N + i
        faces.append((a, a + N, a + N + 1, a + 1))
mesh('Camp earth terrain - central 8m square at Y0', vertices, faces, materials['earth'], tile=1.45, smooth=True)
components['terrain'] += 1

def tent(label, cx, cz, width, length, height, eave):
    """Low timber-supported felt shelter: deliberately an illustrative structure."""
    half = width * .5
    front, back = cz + length * .5, cz - length * .5
    def roof_point(sign, across, z):
        sag = .035 * math.sin(math.pi * across) * math.sin(math.pi * (z - back) / length)
        fold = .016 * math.sin((z - back) * math.tau / .44) * math.sin(math.pi * across)
        return (cx + sign * half * across, height + (eave - height) * across - sag + fold, z)
    for sign in [-1, 1]:
        verts, faces = [], []
        cols, rows = 13, 39
        for j in range(rows):
            z = back + length * j / (rows - 1)
            for i in range(cols):
                verts.append(roof_point(sign, i / (cols - 1), z))
        for j in range(rows - 1):
            for i in range(cols - 1):
                a = j * cols + i
                face = (a, a + 1, a + cols + 1, a + cols)
                faces.append(face if sign < 0 else tuple(reversed(face)))
        roof = mesh(label + ' draped felt roof ' + str(sign), verts, faces, materials['felt'], tile=.7, smooth=True)
        roof.data.materials[0].use_backface_culling = False
        # Actual edge binding and panel joins remain visible in side views.
        for z in np.linspace(back, front, max(3, round(length / .9) + 1)):
            tube(label + ' roof panel stitched seam', [roof_point(sign, t, float(z)) for t in np.linspace(0, 1, 15)],
                 .009, materials['felt_dark'])
            components['felt_panel_seam'] += 1
        for y in [.19, eave]:
            tube(label + ' bound cloth hem', [(cx + sign * half, y, back), (cx + sign * half, y, front)], .015, materials['felt_dark'])
        # Side fabric has shallow vertical folds, and is distinct from the roof silhouette.
        verts = []
        for y in [.18, .45 * eave, eave]:
            for j in range(rows):
                z = back + length * j / (rows - 1)
                x = cx + sign * (half + .018 * math.sin(j * 1.4) * (1 - y / (eave + .01)))
                verts.append((x, y, z))
        faces = []
        for i in range(2):
            for j in range(rows - 1):
                a = i * rows + j
                face = (a, a + rows, a + rows + 1, a + 1)
                faces.append(face if sign < 0 else tuple(reversed(face)))
        mesh(label + ' hanging felt sidewall', verts, faces, materials['felt'], tile=.7, smooth=True)
        for z in [back + .2, front - .2]:
            beam(label + ' side support post', (cx + sign * (half - .06), 0, z),
                 (cx + sign * (half - .06), eave + .04, z), .045, materials['wood'])
        for z in np.linspace(back + .28, front - .28, 3):
            start = (cx + sign * half, eave * .94, float(z))
            end = (cx + sign * (half + .9), .10, float(z - .1))
            mid = tuple((Vector(start) + Vector(end)) * .5 + Vector((0, -.06, 0)))
            tube(label + ' tensioned guy rope', [start, mid, end], .017, materials['rope'], 8)
            beam(label + ' timber peg', (end[0], -.04, end[2]), (end[0] - sign * .08, .26, end[2]),
                 .029, materials['wood'], 8)
            components['guy_rope_and_peg'] += 1
    for z in [back + .11, front - .11]:
        beam(label + ' ridge upright', (cx, 0, z), (cx, height - .04, z), .064, materials['wood'])
        for sign in [-1, 1]:
            beam(label + ' timber roof frame', (cx, height - .07, z), (cx + sign * (half - .04), eave - .06, z),
                 .041, materials['wood'])
    beam(label + ' ridge pole', (cx, height - .03, back + .02), (cx, height - .03, front - .02), .058, materials['wood'])
    # Back is closed; front has a rectangular opening and two folded curtains.
    for z, is_front in [(back, False), (front, True)]:
        if not is_front:
            mesh(label + ' closed rear felt panel', [(cx - half, .18, z), (cx + half, .18, z),
                 (cx + half, eave, z), (cx, height, z), (cx - half, eave, z)], [(0, 1, 2, 3, 4)], materials['felt'], tile=.7)
        else:
            door = min(.65, width * .20)
            for sign in [-1, 1]:
                inside, outside = cx + sign * door, cx + sign * half
                mesh(label + ' front felt panel', [(inside, .18, z), (outside, .18, z),
                     (outside, eave, z), (inside, height - (height - eave) * door / half, z)],
                     [(0, 1, 2, 3)], materials['felt'], tile=.7)
                beam(label + ' doorway timber', (inside, 0, z - .045), (inside, height * .69, z - .045), .041, materials['wood'])
                tube(label + ' rolled entrance curtain', [(inside + sign * .06, .28, z + .045),
                     (inside + sign * .10, height * .67, z + .045)], .064, materials['felt_dark'], 12)
            lintel = height * .69
            beam(label + ' doorway lintel', (cx - door, lintel, z - .045), (cx + door, lintel, z - .045), .045, materials['wood'])
            mesh(label + ' upper entrance cloth', [(cx - door, lintel + .02, z), (cx + door, lintel + .02, z),
                 (cx + door, height - (height - eave) * door / half, z), (cx, height, z),
                 (cx - door, height - (height - eave) * door / half, z)], [(0, 1, 2, 3, 4)], materials['felt'], tile=.7)
    box(label + ' simple bedding mat', (cx, .028, cz + .65), (width * .62, .04, length * .52), materials['felt_dark'], .012)
    components['felt_shelter'] += 1

tent('Background main shelter', 0, -6.75, 5.1, 5.0, 2.85, 1.05)
tent('Left small shelter', -6.85, -4.2, 3.1, 3.3, 2.22, .83)
tent('Right small shelter', 6.85, -5.1, 3.0, 3.3, 2.1, .8)

# Low camp boundary: plain split timber and fibre bindings, never prison bars.
for side in [-1, 1]:
    x = side * 4.85
    zs = [-2.45, -.8, .85, 2.5]
    for index, z in enumerate(zs):
        beam('Low boundary post', (x, -.06, z), (x + .024 * math.sin(index), .75, z), .061, materials['wood'])
        components['low_boundary_post'] += 1
        for y in [.3, .61]:
            if index < len(zs) - 1:
                beam('Low boundary rough rail', (x, y, z), (x, y - .016, zs[index + 1]), .036, materials['wood'])
            tube('Boundary fibre binding', [(x - .07, y - .05, z - .06), (x + .07, y + .04, z - .06),
                 (x + .07, y + .04, z + .06), (x - .07, y - .05, z + .06), (x - .07, y - .05, z - .06)],
                 .012, materials['rope'])

def vessel(name, x, z, height, width):
    # Closed outer wall, inner lip and visible hollow interior; no flat cylinder prop.
    profile = [(0, .08 * width), (.07 * height, .32 * width), (.30 * height, .48 * width),
               (.57 * height, .50 * width), (.80 * height, .30 * width),
               (.95 * height, .23 * width), (height, .26 * width),
               (height, .21 * width), (.92 * height, .18 * width), (.72 * height, .18 * width),
               (.30 * height, .37 * width), (.10 * height, .21 * width)]
    vertices, faces = [], []
    segments = 40
    for y, r in profile:
        for i in range(segments):
            angle = i * math.tau / segments
            vertices.append((x + r * math.cos(angle), y, z + r * math.sin(angle)))
    for j in range(len(profile) - 1):
        for i in range(segments):
            a = j * segments + i
            faces.append((a, j * segments + (i + 1) % segments,
                          (j + 1) * segments + (i + 1) % segments, a + segments))
    mesh(name, vertices, faces, materials['clay'], tile=.5, smooth=True)
    components['plain_hollow_vessel'] += 1

vessel('Plain water jar by left shelter', -5.9, -1.5, .61, .53)
vessel('Small storage jar', -6.48, -1.0, .35, .34)
vessel('Plain jar by main shelter', 1.8, -4.78, .48, .43)
vessel('Cooking bowl at camp edge', 6.0, .25, .20, .57)
for i in range(7):
    x, z = 6.15 + .52 * math.cos(i * math.tau / 7), 1.55 + .42 * math.sin(i * math.tau / 7)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=bv((x, .12, z)))
    ob = bpy.context.object
    ob.name = 'Rough stone around unlit hearth'
    ob.scale = (.17, .14, .13)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(materials['stone'])
    metric_uv(ob, .5)
    objects.append(ob)
    components['hearth_stone'] += 1
for i in range(9):
    x, z = -6.1 + (i % 3) * .09, 1.05 + (i // 3) * .09
    beam('Stacked firewood', (x - .48, .09 + (i // 3) * .065, z),
         (x + .48, .09 + (i // 3) * .065, z + .035), .036, materials['wood'])
    components['firewood_piece'] += 1
box('Low simple timber bench at camp edge', (-6.2, .35, .12), (1.4, .12, .48), materials['wood'], .024)
for x in [-6.73, -5.67]:
    box('Bench trestle', (x, .16, .12), (.10, .30, .37), materials['wood'], .01)
box('Folded plain wool cloth', (5.84, .05, -1.25), (1.05, .08, .65), materials['felt_dark'], .025)

# Edge stones and individual grass blades: modest details, open centre untouched.
rng = np.random.default_rng(20261002)
grass_vertices, grass_faces = [], []
for i in range(165):
    x, z = float(rng.uniform(-11.8, 11.8)), float(rng.uniform(-11.8, 10.0))
    if max(abs(x), abs(z)) < 5 or (-3.7 < x < 3.7 and z < -4):
        continue
    y = terrain_height(x, z)
    for j in range(5):
        dx, dz = rng.uniform(-.10, .10, 2)
        h = float(rng.uniform(.09, .25))
        w = .012
        base = len(grass_vertices)
        grass_vertices.extend([(x + dx - w, y, z + dz), (x + dx + w, y, z + dz),
                               (x + dx + .035, y + h, z + dz + .045)])
        grass_faces.append((base, base + 1, base + 2))
mesh('Sparse dry grass outside character space', grass_vertices, grass_faces, materials['grass'], tile=.35)
components['dry_grass_blade'] = len(grass_faces)
for i in range(18):
    x, z = float(rng.uniform(-11.5, 11.5)), float(rng.uniform(-11.5, 9.5))
    if max(abs(x), abs(z)) < 5:
        continue
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=bv((x, terrain_height(x, z) + .018, z)))
    ob = bpy.context.object
    ob.name = 'Small irregular ground stone'
    ob.scale = (float(rng.uniform(.08, .18)), float(rng.uniform(.08, .17)), float(rng.uniform(.025, .055)))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(materials['stone'])
    metric_uv(ob, .45)
    objects.append(ob)
    components['ground_stone'] += 1

bpy.context.view_layer.update()
original_mesh_count = len(objects)
triangle_count = sum(sum(len(poly.vertices) - 2 for poly in ob.data.polygons) for ob in objects)
if triangle_count >= 100000:
    raise RuntimeError('Triangle budget exceeded')
points = [ob.matrix_world @ v.co for ob in objects for v in ob.data.vertices]
bounds = {'min': [min(p.x for p in points), min(p.z for p in points), -max(p.y for p in points)],
          'max': [max(p.x for p in points), max(p.z for p in points), -min(p.y for p in points)]}
# Combine by material for a small browser draw-call budget while retaining UVs.
joined = []
material_groups = {key: [ob for ob in objects if ob.data.materials[0] == mat]
                   for key, mat in materials.items()}
for key, mat in materials.items():
    selected = material_groups[key]
    if not selected:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for ob in selected:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    if len(selected) > 1:
        bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = 'Detention camp ' + key
    joined.append(ob)

target = OUT / 'detention-camp.glb'
if target.exists():
    raise RuntimeError('Refusing to overwrite an existing detention asset; choose a new --out-dir')
bpy.ops.object.select_all(action='DESELECT')
for ob in joined:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True,
                         export_yup=True, export_extras=True)
inspection = inspect_glb(target)
if len(inspection['refinedMaterials']) != len(materials):
    raise RuntimeError('A material lost embedded base/normal/roughness bindings')
if target.stat().st_size > 6 * 1024 * 1024:
    raise RuntimeError('GLB byte budget exceeded')
record = {
    'id': 'detention-camp', 'file': target.name, 'bytes': target.stat().st_size, 'sha256': sha(target),
    'tool': 'Blender ' + bpy.app.version_string, 'unit': 'metre', 'upAxis': 'Y', 'bounds': bounds,
    'triangles': triangle_count, 'originalMeshObjects': original_mesh_count, 'exportMeshObjects': len(joined),
    'embeddedPBR': inspection, 'textureDimensions': [SIZE, SIZE], 'seed': 20261002,
    'centralCharacterSpace': {'x': [-4, 4], 'z': [-4, 4], 'surfaceY': 0, 'propsInside': False},
    'shelterEntrance': [0, 0, -4.25], 'components': dict(components),
    'geometrySource': 'Original procedural Blender mesh authored for this project',
    'materialSource': 'Original authored procedural PBR rasters; reused reviewed Yuezhi material functions',
    'materialLineage': {'script': str(UPSTREAM.relative_to(ROOT)).replace('\\', '/'), 'sha256': sha(UPSTREAM),
                        'selectedFunctions': sorted(HELPERS), 'runsUpstreamAssetEntryPoint': False},
    'builder': {'script': str(pathlib.Path(__file__).resolve().relative_to(ROOT)).replace('\\', '/'),
                'sha256': sha(pathlib.Path(__file__).resolve())},
    'historicalStatus': 'Illustrative reconstruction: camp layout, felt shelter form and detention arrangements are not attested for this episode',
    'historicalNoteZh': '营地形制、毡幕样式、生活器物摆放和拘留安排缺乏本段史料的确证，均为便于理解的制作示意，不据此编造具体事件；张骞曾被匈奴扣留的主线由原故事史料另行标注。',
    'charactersIncluded': False, 'runtimeFigures': 'Integration reuses the existing Tripo xiongnu/envoy/staff figures',
    'noNewProviderGeneration': True,
}
(OUT / 'detention-camp-manifest.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(EVIDENCE / 'asset-validation.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# A saved editable Blender scene and studio overview help the final visual review.
scene = bpy.context.scene
bpy.ops.object.light_add(type='SUN', location=(0, 0, 10))
sun = bpy.context.object
sun.rotation_euler = (math.radians(29), math.radians(-24), math.radians(-27))
sun.data.energy = 2.1
sun.data.angle = math.radians(11)
bpy.ops.object.light_add(type='AREA', location=bv((-6, 8, 5)))
bpy.context.object.data.energy = 1400
bpy.context.object.data.size = 9
scene.world.color = (.18, .20, .22)
bpy.ops.object.camera_add(location=bv((11.0, 7.0, 13.0)))
cam = bpy.context.object
cam.rotation_euler = (bv((0, 1, -3.0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 44
scene.camera = cam
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(EVIDENCE / 'detention-camp-overview.png')
scene.view_settings.view_transform = 'AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE / 'detention-camp.blend'))
bpy.ops.render.render(write_still=True)
print('DETENTION_CAMP_SUCCESS ' + json.dumps({'file': str(target), 'bytes': record['bytes'],
                                             'sha256': record['sha256'], 'triangles': triangle_count,
                                             'embeddedImages': inspection['embeddedImages']}), flush=True)
