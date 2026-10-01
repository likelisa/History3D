"""Blender-only calibration of one verified Tripo output; no provider requests."""
import bpy, math, pathlib, json, hashlib
from mathutils import Vector, Matrix

ROOT = pathlib.Path(__file__).resolve().parents[1]
PRIVATE = ROOT / '.processing-data/xiongnu-tripo'
OUT = ROOT / 'viewer/public/yuezhi/figures'
record = json.loads((PRIVATE / 'generation.json').read_text(encoding='utf-8'))
request = json.loads((PRIVATE / 'request.json').read_text(encoding='utf-8'))
raw = PRIVATE / 'xiongnu-raw.glb'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
if record['status'] != 'success' or sha(raw) != record['rawSha256']:
    raise RuntimeError('Verified downloaded Tripo output required')
if hashlib.sha256(json.dumps(request, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() != record['requestDigest']:
    raise RuntimeError('Actual request digest mismatch')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(raw))
bpy.context.view_layer.update()
objects = list(bpy.context.scene.objects)
meshes = [o for o in objects if o.type == 'MESH']
points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector([min(p[i] for p in points) for i in range(3)])
hi = Vector([max(p[i] for p in points) for i in range(3)])
factor = 1.72 / (hi.z - lo.z)
root = bpy.data.objects.new('Calibrated anonymous Xiongnu figure', None)
bpy.context.collection.objects.link(root)
for obj in objects:
    if obj.parent is None:
        obj.parent = root
yaw = -math.pi / 2  # Tripo's default X-forward becomes glTF Z-forward.
root.scale = (factor,) * 3
root.rotation_euler.z = yaw
root.location = Matrix.Rotation(yaw, 3, 'Z') @ Vector((-(lo.x + hi.x) / 2 * factor, -(lo.y + hi.y) / 2 * factor, -lo.z * factor))
bpy.context.view_layer.update()
# The provider returned extended arms despite the low A-pose request. Rotate the
# shoulder/arm region locally, preserving UVs and the verified raw model.
arm_vertices = 0
for obj in meshes:
    world_matrix = obj.matrix_world.copy()
    positions = [world_matrix @ vertex.co for vertex in obj.data.vertices]
    obj.parent = None
    obj.matrix_world.identity()
    for vertex, point in zip(obj.data.vertices, positions):
        distance = abs(point.x)
        if point.z > 1.18 and distance > .22:
            side = 1 if point.x > 0 else -1
            weight = min(1, max(0, (distance - .22) / .12))
            weight = weight * weight * (3 - 2 * weight)
            pivot = Vector((side * .22, 0, 1.39))
            point = pivot + Matrix.Rotation(side * math.radians(65) * weight, 3, 'Y') @ (point - pivot)
            arm_vertices += 1
        vertex.co = point
    obj.data.update()
    if obj.data.has_custom_normals:
        obj.data.normals_split_custom_set([(0, 0, 0)] * len(obj.data.loops))
for image in bpy.data.images:
    if image.size[0] > 2048 or image.size[1] > 2048:
        ratio = 2048 / max(image.size)
        image.scale(max(1, round(image.size[0] * ratio)), max(1, round(image.size[1] * ratio)))
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT / 'xiongnu.glb'), export_format='GLB', use_selection=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'xiongnu-tripo.blend'))
triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
source_ids = ['xiongnu-belt-met', 'xiongnu-cap-yaloman', 'xiongnu-robe-noinula', 'xiongnu-boots-noinula']
manifest = {
    'id': 'xiongnu', 'file': 'xiongnu.glb', 'sha256': sha(OUT / 'xiongnu.glb'), 'bytes': (OUT / 'xiongnu.glb').stat().st_size,
    'taskId': record['taskId'], 'source': 'Tripo text-to-model v3.1-20260211', 'rawSha256': record['rawSha256'],
    'creditsConsumed': record['creditsConsumed'], 'model': request['model'], 'requestDigest': record['requestDigest'],
    'promptSha256': hashlib.sha256(request['prompt'].encode()).hexdigest(), 'approxHeightMeters': 1.72, 'triangles': triangles,
    'historicalStatus': 'Cross-source interpretive reconstruction; anonymous character, not an attested portrait or uniform',
    'sourceIds': source_ids,
    'conversion': {'blenderVersion': bpy.app.version_string, 'scale': factor, 'yawDegrees': -90, 'rawBoundsBlenderZUp': {'min': list(lo), 'max': list(hi)}, 'texturesMaxPixels': 2048, 'coordinateSystem': 'glTF Y up', 'origin': 'feet on ground', 'frontAxis': 'glTF +Z; visually checked', 'poseCorrection': {'method': 'Blender local arm deformation preserving UVs; static pose, not skeletal animation', 'shoulderAngleDegrees': 65, 'verticesAffected': arm_vertices}},
    'generationRecord': {'request': request, **record},
}
(OUT / 'xiongnu-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
public_record = ROOT / 'records/yuezhi-book/xiongnu-generation.json'
public_record.write_text(json.dumps({'request': request, **record}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
# A local inspection render. The interactive scene remains the acceptance surface.
bpy.ops.mesh.primitive_plane_add(size=20)
floor = bpy.context.object
floor.location.z = -.01
material = bpy.data.materials.new('Studio ground')
material.diffuse_color = (.12, .14, .13, 1)
floor.data.materials.append(material)
for location, energy, size in [((-3, -4, 5), 600, 4), ((3, -2, 3), 250, 3), ((0, 3, 4), 450, 3)]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.rotation_euler = (Vector((0, 0, .9)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    light.data.energy = energy
    light.data.shape = 'DISK'
    light.data.size = size
bpy.ops.object.camera_add(location=(2, -4, 1.7))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, .9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.15
scene = bpy.context.scene
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.world.color = (.15, .15, .15)
scene.render.resolution_x = 600
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.filepath = str(OUT / 'xiongnu-preview.png')
bpy.ops.render.render(write_still=True)
print(json.dumps({'taskId': manifest['taskId'], 'sha256': manifest['sha256'], 'bytes': manifest['bytes'], 'creditsConsumed': manifest['creditsConsumed'], 'triangles': triangles}))
