"""Offline Blender inspection/calibration of verified Tripo story assets.

Use the existing portable Blender; this script has no network/provider access.
  blender --background --python-exit-code 1 --python scripts/normalize-story-tripo-r9.py -- --mode inspect
  blender --background --python-exit-code 1 --python scripts/normalize-story-tripo-r9.py -- --mode normalize --only zhangqian --yaw zhangqian=0 --review-note "raw four-view review: face toward source +Z"
Raw GLBs remain immutable. Yaw is Blender Z-up degrees: source +X to target
glTF +Z uses -90, source -X uses +90, source -Z uses 180. No yaw is guessed.
If raw has extended arms, explicitly request --arm-down id=65 after review.
This is static geometry preparation, never proof of skeletal animation quality.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import struct
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'viewer/public'
OUT = PUBLIC / 'mural-assets/tripo-story-r9'
BASE_URL = '/mural-assets/tripo-story-r9/'
IDS = ('zhangqian', 'ganfu', 'qiong-bamboo')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def parse_map(values, label):
    result = {}
    for value in values:
        key, separator, number = value.partition('=')
        if not separator or key not in IDS or key in result:
            raise RuntimeError('Invalid or repeated ' + label + ': ' + value)
        result[key] = float(number)
        if not math.isfinite(result[key]):
            raise RuntimeError('Non-finite ' + label)
    return result


def glb_info(path):
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b'glTF' or struct.unpack_from('<II', data, 4) != (2, len(data)):
        raise RuntimeError('Invalid GLB: ' + path.name)
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4e4f534a or length > len(data) - 20:
        raise RuntimeError('Invalid GLB JSON')
    doc = json.loads(data[20:20 + length])
    if any('uri' in row for group in ('buffers', 'images') for row in doc.get(group, [])):
        raise RuntimeError('GLB must have embedded buffers/textures')
    materials = doc.get('materials', [])
    triangles = 0
    for mesh in doc.get('meshes', []):
        for primitive in mesh.get('primitives', []):
            if primitive.get('mode', 4) == 4:
                accessor = primitive.get('indices', primitive.get('attributes', {}).get('POSITION'))
                if accessor is not None:
                    triangles += doc['accessors'][accessor]['count'] // 3
    return {
        'triangles': triangles, 'meshes': len(doc.get('meshes', [])),
        'materials': len(materials), 'images': len(doc.get('images', [])),
        'baseColorTexturedMaterials': sum('baseColorTexture' in m.get('pbrMetallicRoughness', {}) for m in materials),
        'normalMappedMaterials': sum('normalTexture' in m for m in materials),
        'metallicRoughnessTexturedMaterials': sum('metallicRoughnessTexture' in m.get('pbrMetallicRoughness', {}) for m in materials),
        'uvPrimitives': sum('TEXCOORD_0' in p.get('attributes', {}) for m in doc.get('meshes', []) for p in m.get('primitives', [])),
    }


def bounds(meshes):
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    if not points:
        raise RuntimeError('No vertices in source asset')
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    return lo, hi


def uv_fingerprint(meshes):
    digest = hashlib.sha256()
    for obj in meshes:
        for layer in obj.data.uv_layers:
            for uv in layer.data:
                digest.update(struct.pack('<ff', *uv.uv))
    return digest.hexdigest()


def load_verified(asset_id, records):
    record = records.get(asset_id)
    if not record or record.get('status') != 'downloaded':
        raise RuntimeError('Verified downloaded record required: ' + asset_id)
    raw = OUT / (asset_id + '-raw.glb')
    if not raw.is_file() or sha(raw) != record.get('sha256') or raw.stat().st_size != record.get('bytes'):
        raise RuntimeError('Raw GLB hash/bytes mismatch: ' + asset_id)
    info = glb_info(raw)
    if not info['images'] or not info['uvPrimitives'] or not info['baseColorTexturedMaterials']:
        raise RuntimeError('Raw asset lacks embedded textured PBR/UV: ' + asset_id)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(raw))
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == 'MESH']
    if not meshes:
        raise RuntimeError('No imported mesh: ' + asset_id)
    return raw, record, info, objects, meshes


def display_transform(objects, meshes, height, yaw):
    lo, hi = bounds(meshes)
    if hi.z - lo.z < 1e-8:
        raise RuntimeError('No usable vertical extent')
    scale = height / (hi.z - lo.z)
    wrapper = bpy.data.objects.new('Story calibration root', None)
    bpy.context.collection.objects.link(wrapper)
    for obj in objects:
        if obj.parent is None:
            world = obj.matrix_world.copy()
            obj.parent = wrapper
            obj.matrix_world = world
    wrapper.scale = (scale,) * 3
    wrapper.rotation_euler.z = math.radians(yaw)
    wrapper.location = Matrix.Rotation(math.radians(yaw), 3, 'Z') @ Vector((-(lo.x + hi.x) / 2 * scale, -(lo.y + hi.y) / 2 * scale, -lo.z * scale))
    bpy.context.view_layer.update()
    return wrapper, lo, hi, scale


def lower_arms(meshes, height, angle):
    if any(obj.type == 'ARMATURE' for obj in bpy.context.scene.objects):
        raise RuntimeError('Local arm deformation is only supported for unrigged static meshes')
    if not 0 < angle <= 80:
        raise RuntimeError('Arm-down angle must be greater than 0 and at most 80 degrees')
    count = 0
    start_x, full_x, shoulder_z = height * .125, height * .205, height * .79
    for obj in meshes:
        world = obj.matrix_world.copy()
        positions = [world @ vertex.co for vertex in obj.data.vertices]
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex, point in zip(obj.data.vertices, positions):
            distance = abs(point.x)
            if point.z > height * .59 and distance > start_x:
                side = 1 if point.x > 0 else -1
                weight = min(1, max(0, (distance - start_x) / (full_x - start_x)))
                weight = weight * weight * (3 - 2 * weight)
                pivot = Vector((side * start_x, 0, shoulder_z))
                point = pivot + Matrix.Rotation(side * math.radians(angle) * weight, 3, 'Y') @ (point - pivot)
                count += 1
            vertex.co = point
        obj.data.update()
        if obj.data.has_custom_normals:
            obj.data.normals_split_custom_set([(0, 0, 0)] * len(obj.data.loops))
    if not count:
        raise RuntimeError('Arm deformation selected no vertices')
    return {'method': 'explicit local shoulder-region static mesh deformation', 'angleDegrees': angle,
            'verticesAffected': count, 'startXRatio': .125, 'fullXRatio': .205,
            'minimumZRatio': .59, 'shoulderZRatio': .79, 'uvPreserved': True,
            'acceptance': 'requires normalized front/side review and runtime motion verification'}


def calibrate_diameter(objects, meshes, diameter, raw_bounds):
    if not 0 < diameter < .15:
        raise RuntimeError('Staff diameter must be greater than 0 and below 0.15 meters')
    lo, hi = bounds(meshes)
    width = max(hi.x - lo.x, hi.y - lo.y)
    if width < 1e-8:
        raise RuntimeError('No usable staff transverse width')
    factor = diameter / width
    wrapper = bpy.data.objects.new('Explicit staff transverse diameter calibration', None)
    bpy.context.collection.objects.link(wrapper)
    for obj in objects:
        if obj.parent is None:
            world = obj.matrix_world.copy()
            obj.parent = wrapper
            obj.matrix_world = world
    wrapper.scale = (factor, factor, 1)
    bpy.context.view_layer.update()
    calibrated_lo, calibrated_hi = bounds(meshes)
    final_width = max(calibrated_hi.x - calibrated_lo.x, calibrated_hi.y - calibrated_lo.y)
    if abs(final_width - diameter) > .00001:
        raise RuntimeError('Staff transverse scale validation failed')
    return {'method': 'explicit local transverse scale preserving height/UV/PBR',
            'rawCoordinateMaxTransverseWidth': max(raw_bounds['max'][i] - raw_bounds['min'][i] for i in (0, 1)),
            'widthMetersAfterUniformHeightScale': width, 'transverseScale': factor,
            'targetMaxDiameterMeters': diameter, 'measuredMaxDiameterMeters': final_width,
            'providerDimensionClaim': 'provider did not meet the prompt diameter; local calibration applied'}


def add_studio(meshes, height):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Neutral review studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.28, .31, .34, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .7
    scene.world = world
    target = Vector((0, 0, height * .5))
    bpy.ops.mesh.primitive_plane_add(size=height * 8, location=(0, 0, -.008))
    floor = bpy.context.object
    floor.name = 'Review ground - excluded from GLB'
    material = bpy.data.materials.new('Review ground')
    material.diffuse_color = (.18, .19, .20, 1)
    floor.data.materials.append(material)
    for location, energy, size in [((-3, -4, 5), 800, 4), ((4, -2, 3), 500, 4), ((0, 4, 4), 700, 3)]:
        bpy.ops.object.light_add(type='AREA', location=location)
        light = bpy.context.object
        light.data.energy = energy
        light.data.shape = 'DISK'
        light.data.size = size
        light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    camera.data.lens = 60
    camera.data.clip_end = 100
    lo, hi = bounds(meshes)
    # ortho_scale is vertical span, with viewport aspect applied to horizontal fit.
    camera.data.ortho_scale = max(height, (hi.x - lo.x) * 900 / 720, (hi.y - lo.y) * 900 / 720) * 1.22
    scene.camera = camera
    return scene, camera, target


def render_views(asset_id, meshes, height, stage):
    directory = OUT / 'review' / stage
    directory.mkdir(parents=True, exist_ok=True)
    scene, camera, target = add_studio(meshes, height)
    # Blender -Y corresponds to glTF +Z. These are coordinate names, not claims
    # that the raw character actually faces that camera.
    views = [('front-plus-z', (0, -4, .5)), ('back-minus-z', (0, 4, .5)),
             ('right-plus-x', (4, 0, .5)), ('left-minus-x', (-4, 0, .5)),
             ('three-quarter', (3, -4, .65))]
    results = []
    for label, location in views:
        camera.location = Vector((location[0] * height, location[1] * height, location[2] * height))
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        path = directory / (asset_id + '-' + label + '.png')
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        results.append({'view': label, 'path': BASE_URL + 'review/' + stage + '/' + path.name,
                        'sha256': sha(path), 'bytes': path.stat().st_size})
        print('STORY_RENDER ' + asset_id + ' ' + stage + ' ' + label, flush=True)
    blend_path = directory / (asset_id + '-' + stage + '.blend')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    return results, blend_path


def validate_export(path, height, source_info, diameter=None):
    info = glb_info(path)
    for key in ('images', 'baseColorTexturedMaterials', 'normalMappedMaterials', 'metallicRoughnessTexturedMaterials'):
        if info[key] < source_info[key]:
            raise RuntimeError('PBR preservation check failed: ' + key)
    if not info['uvPrimitives']:
        raise RuntimeError('Export lost texture coordinates')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    lo, hi = bounds(meshes)
    if abs(lo.z) > .002 or abs((hi.z - lo.z) - height) > .002:
        raise RuntimeError('Exported ground/height validation failed')
    if diameter is not None and abs(max(hi.x - lo.x, hi.y - lo.y) - diameter) > .00001:
        raise RuntimeError('Exported staff diameter validation failed')
    return info, {'min': list(lo), 'max': list(hi)}


parser = argparse.ArgumentParser()
parser.add_argument('--mode', required=True, choices=('inspect', 'normalize'))
parser.add_argument('--only', choices=IDS)
parser.add_argument('--yaw', action='append', default=[], help='Explicit Blender Z yaw, id=degrees')
parser.add_argument('--arm-down', action='append', default=[], help='Reviewed static mesh arm correction, id=degrees')
parser.add_argument('--diameter', action='append', default=[], help='Explicit maximum staff X/Z diameter in meters, id=meters')
parser.add_argument('--review-note', default='', help='Evidence from raw views used to decide orientation/pose')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
yaws = parse_map(args.yaw, 'yaw')
arms = parse_map(args.arm_down, 'arm-down')
diameters = parse_map(args.diameter, 'diameter')
plan = json.loads((OUT / 'plan.json').read_text(encoding='utf-8'))
cases = {item['id']: item for item in plan['cases']}
generation = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
records = {item['id']: item for item in generation['assets']}
selected = [args.only] if args.only else list(IDS)
manifest_path = OUT / 'normalized-manifest.json'
previous = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.is_file() else {'assets': []}
normalized = {item['id']: item for item in previous['assets']}
inspection_path = OUT / 'raw-inspection.json'
previous_inspection = json.loads(inspection_path.read_text(encoding='utf-8')) if inspection_path.is_file() else {'assets': []}
inspections = {item['id']: item for item in previous_inspection['assets']}
for asset_id in selected:
    if args.mode == 'normalize' and (asset_id not in yaws or not args.review_note.strip()):
        raise RuntimeError('Normalization requires explicit yaw and raw-view review note: ' + asset_id)
    if asset_id == 'qiong-bamboo' and asset_id in arms:
        raise RuntimeError('Arm correction is only for characters')
    if asset_id != 'qiong-bamboo' and asset_id in diameters:
        raise RuntimeError('Diameter correction is only for bamboo staff')
    raw, record, source_info, objects, meshes = load_verified(asset_id, records)
    uv_before = uv_fingerprint(meshes)
    height = cases[asset_id]['normalization']['targetHeightMeters']
    yaw = yaws.get(asset_id, 0) if args.mode == 'normalize' else 0
    wrapper, raw_lo, raw_hi, scale = display_transform(objects, meshes, height, yaw)
    raw_bounds = {'min': list(raw_lo), 'max': list(raw_hi)}
    if args.mode == 'inspect':
        views, blend = render_views(asset_id, meshes, height, 'raw')
        inspections[asset_id] = {'id': asset_id, 'rawSha256': record['sha256'], 'rawBoundsBlenderZUp': raw_bounds,
                                'displayScale': scale, 'yawDegrees': 0, 'views': views,
                                'blend': BASE_URL + 'review/raw/' + blend.name,
                                'orientationStatus': 'raw coordinate views only; face direction requires visual review',
                                'animationStatus': 'not evaluated', 'blenderVersion': bpy.app.version_string}
        save_json(inspection_path, {'experimentId': plan['experimentId'], 'assets': list(inspections.values())})
        continue
    pose = lower_arms(meshes, height, arms[asset_id]) if asset_id in arms else {
        'method': 'no mesh pose deformation', 'acceptance': 'requires normalized visual/runtime review'}
    diameter_correction = calibrate_diameter(list(bpy.context.scene.objects), meshes, diameters[asset_id], raw_bounds) if asset_id in diameters else None
    if uv_fingerprint(meshes) != uv_before:
        raise RuntimeError('Calibration changed UV coordinates')
    # Deformation may change feet/height in unexpected ways: recenter and rescale
    # by a second wrapper to enforce the output contract without touching UVs.
    lo, hi = bounds(meshes)
    if abs(lo.z) > .0001 or abs(hi.z - lo.z - height) > .0001:
        all_objects = list(bpy.context.scene.objects)
        _, _, _, _ = display_transform(all_objects, meshes, height, 0)
    derived = OUT / (asset_id + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(derived), export_format='GLB', use_selection=True,
                             export_apply=True, export_image_format='AUTO', export_yup=True)
    editable = OUT / (asset_id + '-normalized.blend')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(editable))
    exported_info, exported_bounds = validate_export(derived, height, source_info, diameters.get(asset_id))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    views, review_blend = render_views(asset_id, meshes, height, 'normalized')
    if sha(raw) != record['sha256']:
        raise RuntimeError('Immutable raw GLB changed')
    normalized[asset_id] = {
        'id': asset_id, 'path': BASE_URL + derived.name, 'bytes': derived.stat().st_size, 'sha256': sha(derived),
        'rawPath': record['path'], 'rawSha256': record['sha256'], 'taskId': record['taskId'],
        'creditsConsumed': record.get('creditsConsumed'), 'requestHash': record.get('requestHash'),
        'heightMeters': height, 'frontAxis': '+Z', 'ground': 'lowest mesh point at Y=0', 'stats': exported_info,
        'historicalBoundary': cases[asset_id]['historicalBoundary'],
        'editableBlend': BASE_URL + editable.name,
        'reviewBlend': BASE_URL + 'review/normalized/' + review_blend.name, 'views': views,
        'conversion': {'blenderVersion': bpy.app.version_string, 'scale': scale, 'yawDegrees': yaw,
                       'rawBoundsBlenderZUp': raw_bounds, 'exportedBoundsBlenderZUp': exported_bounds,
                       'coordinateSystem': 'glTF Y up', 'uvCoordinatesUnchanged': True,
                       'textureResampling': 'none', 'poseCorrection': pose, 'diameterCorrection': diameter_correction},
        'orientationDecision': args.review_note, 'visualReviewStatus': 'normalized views require reviewer acceptance',
        'animationStatus': 'not evaluated; static GLB is not animation acceptance',
    }
    if asset_id in diameters:
        normalized[asset_id]['diameterMeters'] = max(exported_bounds['max'][i] - exported_bounds['min'][i] for i in (0, 1))
    save_json(manifest_path, {'experimentId': plan['experimentId'], 'status': 'normalized_visual_review_pending',
                              'assets': [normalized[key] for key in IDS if key in normalized]})
    print('STORY_NORMALIZED ' + json.dumps({'id': asset_id, 'heightMeters': height, 'yawDegrees': yaw,
                                          'sha256': normalized[asset_id]['sha256'], 'stats': exported_info}), flush=True)
print('STORY_' + args.mode.upper() + '_COMPLETE ' + str(len(selected)), flush=True)
