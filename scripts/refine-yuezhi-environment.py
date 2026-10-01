"""Refine the existing illustrative Blender assets without generating new historical objects.

Blender --background --python scripts/refine-yuezhi-environment.py [-- --sets]
All new material images are authored procedural PBR rasters embedded in the GLB,
not photographs, downloaded assets, or Blender-only noise shaders.
"""
import bpy, bmesh, hashlib, json, math, pathlib, struct, sys
import numpy as np
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'viewer/public/yuezhi'
SIZE = 512
SEED = 20261001
np.random.seed(SEED)


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def image(name, values, color=True):
    data = np.clip(values, 0, 1).astype(np.float32)
    if data.ndim == 2:
        data = np.repeat(data[:, :, None], 3, axis=2)
    rgba = np.concatenate((data, np.ones((SIZE, SIZE, 1), dtype=np.float32)), axis=2)
    im = bpy.data.images.new(name, width=SIZE, height=SIZE, alpha=False)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    im.pixels.foreach_set(rgba.ravel())
    # Packing is required: the exporter receives real raster data, not unsupported shader nodes.
    im.pack()
    return im


def isotropic_noise(rng, smoothing_pixels):
    """Periodic, direction-free noise: retain a physical tile without visible stripe axes."""
    samples = rng.normal(size=(SIZE, SIZE))
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.rfftfreq(SIZE)[None, :]
    kernel = np.exp(-2 * math.pi ** 2 * smoothing_pixels ** 2 * (fx * fx + fy * fy))
    smoothed = np.fft.irfft2(np.fft.rfft2(samples) * kernel, s=samples.shape)
    return np.clip(smoothed / max(float(smoothed.std()), 1e-8), -3, 3).astype(np.float32) / 3


def textures(kind):
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / SIZE
    coarse = np.zeros((SIZE, SIZE), np.float32)
    fine = np.zeros_like(coarse)
    rng = np.random.default_rng(SEED + sum(ord(c) for c in kind))
    for frequency, weight in [(2, .36), (5, .25), (11, .16), (23, .08)]:
        for _ in range(3):
            a, b = rng.integers(1, frequency + 2, size=2)
            phase = rng.uniform(0, math.tau)
            coarse += weight / 3 * np.sin(math.tau * (x * a + y * b) + phase)
    for frequency in [37, 61, 93]:
        fine += .035 * np.sin(math.tau * (x * frequency + y * (frequency - 13)) + frequency)
    if kind in ['plaster', 'earth']:
        # Sand and earthen plaster have irregular pores and mottling, not a grain direction.
        # The sine fields used for stone/wood remain untouched for those materials.
        patch = .45 * isotropic_noise(rng, 20) + .35 * isotropic_noise(rng, 8) + .20 * isotropic_noise(rng, 2)
        grain = isotropic_noise(rng, .65)
        speck = rng.normal(0, .28, size=(SIZE, SIZE)).astype(np.float32)
        height = .5 + patch * .035 + grain * .055 + speck * .014
        shade = 1 + patch * .065 + grain * .030 + speck * .008
        base = np.array([.39, .32, .23]) if kind == 'earth' else np.array([.43, .33, .22])
        roughness = np.clip(.95 + grain * .025 + speck * .008, .88, 1)
    elif kind in ['rock', 'ridge']:
        layers = np.sin(math.tau * (y * 8 + .28 * np.sin(x * math.tau * 2)))
        crack = (np.abs(np.sin(math.tau * (x * 5.0 + y * 1.3) + coarse * 1.5)) < .045).astype(np.float32)
        crack *= (.55 + .45 * (np.sin(y * math.tau * 3) > -.2))
        height = .5 + coarse * .32 + fine + layers * .07 - crack * .22
        shade = 1 + coarse * .30 + fine * .7 + layers * .055 - crack * .38
        base = np.array([.34, .29, .22]) if kind == 'rock' else np.array([.39, .30, .22])
        roughness = np.clip(.91 + coarse * .08 + crack * .055, .75, 1)
    elif kind == 'wood':
        grain = np.sin(math.tau * (x * 28 + coarse * .28 + .5 * np.sin(y * math.tau * 2)))
        height = .5 + grain * .055 + coarse * .2 + fine
        shade = 1 + grain * .14 + coarse * .24
        base = np.array([.24, .16, .095]); roughness = np.clip(.86 + grain * .06, .74, .96)
    elif kind == 'cloth':
        warp = np.sin(x * math.tau * 64); weft = np.sin(y * math.tau * 64)
        height = .5 + (warp + weft) * .035 + coarse * .045
        shade = 1 + (warp + weft) * .035 + coarse * .12
        base = np.array([.48, .41, .30]); roughness = np.clip(.94 + warp * .015 + weft * .015, .87, 1)
    else:
        height = .5 + coarse * .22 + fine * .8
        shade = 1 + coarse * .25 + fine
        base = np.array([.43, .33, .22]); roughness = np.clip(.94 + coarse * .055, .82, 1)
    # The normal raster represents small pores and fractures; geometry carries the silhouette.
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 2.3
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 2.3
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-8)
    normal = normal * .5 + .5
    orm = np.stack((np.ones_like(dx), roughness, np.zeros_like(dx)), axis=2)
    return image('Authored ' + kind + ' basecolor 512', shade[:, :, None] * base), image('Authored ' + kind + ' normal 512', normal, False), image('Authored ' + kind + ' roughness metallic 512', orm, False)


def pbr_material(kind):
    base, normal, orm = textures(kind)
    mat = bpy.data.materials.new('Refined illustrative ' + kind + ' - embedded PBR')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    for im, input_name in [(base, 'Base Color')]:
        tex = nodes.new('ShaderNodeTexImage'); tex.image = im; links.new(tex.outputs['Color'], shader.inputs[input_name])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = normal
    normal_node = nodes.new('ShaderNodeNormalMap'); normal_node.inputs['Strength'].default_value = .65
    links.new(tex.outputs['Color'], normal_node.inputs['Color']); links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = orm
    separate = nodes.new('ShaderNodeSeparateRGB')
    links.new(tex.outputs['Color'], separate.inputs['Image'])
    links.new(separate.outputs['G'], shader.inputs['Roughness']); links.new(separate.outputs['B'], shader.inputs['Metallic'])
    return mat


def fingerprint(ob, include_materials=True):
    h = hashlib.sha256()
    for v in ob.data.vertices:
        h.update(struct.pack('<3d', *v.co))
    for p in ob.data.polygons:
        h.update(struct.pack('<' + 'I' * len(p.vertices), *p.vertices))
    for row in ob.matrix_world:
        h.update(struct.pack('<4d', *row))
    if include_materials: h.update('|'.join(m.name for m in ob.data.materials if m).encode())
    return h.hexdigest()


def remove_colors(ob):
    for color in list(ob.data.color_attributes):
        ob.data.color_attributes.remove(color)


def world_mesh(ob):
    world = ob.matrix_world.copy(); ob.parent = None
    for v in ob.data.vertices:
        v.co = world @ v.co
    ob.matrix_world.identity()


def smart_uv(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(64), island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')


def metric_uv(ob, tile_m):
    """Box projection in world metres; large floors/walls never share one packed tile."""
    uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name='Authored metric surface UV')
    normal_matrix = ob.matrix_world.to_3x3().inverted().transposed()
    for polygon in ob.data.polygons:
        normal = normal_matrix @ polygon.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for index in polygon.loop_indices:
            world = ob.matrix_world @ ob.data.vertices[ob.data.loops[index].vertex_index].co
            coordinates = (world.x, world.y) if axis == 2 else (world.x, world.z) if axis == 1 else (world.y, world.z)
            uv.data[index].uv = (coordinates[0] / tile_m, coordinates[1] / tile_m)


def inspect_glb(file):
    data = file.read_bytes(); size = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + size])
    bound = []
    for mat in gltf.get('materials', []):
        if mat.get('name', '').startswith('Refined illustrative') and 'water' not in mat.get('name', ''):
            pbr = mat.get('pbrMetallicRoughness', {})
            if not pbr.get('baseColorTexture') or not mat.get('normalTexture') or not pbr.get('metallicRoughnessTexture'):
                raise RuntimeError('PBR_TEXTURE_NOT_EXPORTED: ' + mat['name'])
            bound.append({'name': mat['name'], 'baseColorTexture': pbr['baseColorTexture'], 'normalTexture': mat['normalTexture'], 'metallicRoughnessTexture': pbr['metallicRoughnessTexture']})
    if any(im.get('uri') for im in gltf.get('images', [])):
        raise RuntimeError('EXTERNAL_TEXTURE_NOT_ALLOWED')
    return {'nodes': len(gltf.get('nodes', [])), 'meshes': len(gltf.get('meshes', [])), 'embeddedImages': len(gltf.get('images', [])), 'refinedMaterials': bound}


def import_source(file, manifest):
    if sha(file) != manifest['sha256'] or file.stat().st_size != manifest['bytes']:
        raise RuntimeError('UPSTREAM_HASH_MISMATCH: ' + str(file))
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(file)); bpy.context.view_layer.update()
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def export(file):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in bpy.context.scene.objects:
        if ob.type == 'MESH': ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(file), export_format='GLB', use_selection=True, export_yup=True)


def refine_environment():
    upstream = json.loads((PUBLIC / 'environment-manifest.json').read_text())
    original = PUBLIC / 'environment.glb'
    objects = import_source(original, upstream)
    targets = [o for o in objects if o.name.startswith('Procedural weathered stone') or o.name.startswith('Distant illustrative mountain ridge') or o.name.startswith('Illustrative river ribbon') or o.name.startswith('Illustrative valley terrain')]
    preserved = {o.name: fingerprint(o) for o in objects if o not in targets}
    ground_geometry = {o.name: fingerprint(o, False) for o in targets if o.name.startswith('Illustrative valley terrain')}
    rock = pbr_material('rock'); ridge = pbr_material('ridge')
    edited = []; stone_count = 0
    for ob in targets:
        if not ob.name.startswith('Illustrative valley terrain'): remove_colors(ob)
        if ob.name.startswith('Procedural weathered stone'):
            stone_count += 1; world_mesh(ob)
            points = [v.co.copy() for v in ob.data.vertices]
            low = Vector([min(v[i] for v in points) for i in range(3)])
            high = Vector([max(v[i] for v in points) for i in range(3)])
            center = (low + high) / 2; extent = high - low
            bm = bmesh.new(); bm.from_mesh(ob.data)
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
            bmesh.ops.triangulate(bm, faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
            for vertex in ob.data.vertices:
                p = vertex.co - center
                x, y, z = [p[i] / max(extent[i], .001) for i in range(3)]
                # Angular erosion and tilted fracture planes replace the smooth round dome.
                displacement = .045 * math.sin(x * 17 + y * 11 + stone_count) + .022 * math.sin(z * 25 - y * 9)
                direction = p.normalized()
                vertex.co += direction * displacement * min(extent.x, extent.y)
                vertex.co.x += extent.x * .10 * y * z
                vertex.co.y += extent.y * .12 * x * z
                upper = center.z + extent.z * (.28 + .12 * x - .06 * y)
                vertex.co.z = min(vertex.co.z, upper)
            ob.data.materials.clear(); ob.data.materials.append(rock)
            for polygon in ob.data.polygons: polygon.use_smooth = False
            smart_uv(ob)
        elif ob.name.startswith('Distant illustrative mountain ridge'):
            world_mesh(ob); ob.data.materials.clear(); ob.data.materials.append(ridge)
            uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name='Authored ridge stratum UV')
            for polygon in ob.data.polygons:
                for index in polygon.loop_indices:
                    v = ob.data.vertices[ob.data.loops[index].vertex_index].co
                    uv.data[index].uv = ((v.x + 32) / 16, v.z / 5 + v.y * .035)
        elif ob.name.startswith('Illustrative valley terrain'):
            # Retain the source earth/meadow atlas and base UV. Only detail normals and
            # roughness use a second UV at a 2m repeat, rather than a 60m stretched tile.
            mat = ob.data.materials[0].copy(); mat.name = 'Refined illustrative ground - original atlas with 2m detail PBR'
            ob.data.materials[0] = mat
            _, normal, orm = textures('plaster')
            uv = ob.data.uv_layers.new(name='Authored 2m ground detail UV')
            for polygon in ob.data.polygons:
                for index in polygon.loop_indices:
                    world = ob.matrix_world @ ob.data.vertices[ob.data.loops[index].vertex_index].co
                    uv.data[index].uv = (world.x / 2, world.y / 2)
            nodes = mat.node_tree.nodes; links = mat.node_tree.links; shader = nodes.get('Principled BSDF')
            uv_node = nodes.new('ShaderNodeUVMap'); uv_node.uv_map = uv.name
            texture = nodes.new('ShaderNodeTexImage'); texture.image = normal
            links.new(uv_node.outputs['UV'], texture.inputs['Vector'])
            normal_node = nodes.new('ShaderNodeNormalMap'); normal_node.uv_map = uv.name; normal_node.inputs['Strength'].default_value = .7
            links.new(texture.outputs['Color'], normal_node.inputs['Color']); links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
            texture = nodes.new('ShaderNodeTexImage'); texture.image = orm; links.new(uv_node.outputs['UV'], texture.inputs['Vector'])
            separate = nodes.new('ShaderNodeSeparateRGB'); links.new(texture.outputs['Color'], separate.inputs['Image'])
            links.new(separate.outputs['G'], shader.inputs['Roughness']); links.new(separate.outputs['B'], shader.inputs['Metallic'])
        else:
            water = bpy.data.materials.new('Refined illustrative dark shallow water'); water.use_nodes = True
            shader = water.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = (.025, .067, .055, 1)
            shader.inputs['Roughness'].default_value = .72
            shader.inputs['Metallic'].default_value = 0
            shader.inputs['Specular IOR Level'].default_value = .25
            ob.data.materials.clear(); ob.data.materials.append(water)
        edited.append(ob.name)
    if stone_count != 60: raise RuntimeError('EXPECTED_60_ORIGINAL_STONES: ' + str(stone_count))
    for ob in objects:
        if ob.name in preserved and fingerprint(ob) != preserved[ob.name]: raise RuntimeError('PRESERVED_OBJECT_CHANGED: ' + ob.name)
        if ob.name in ground_geometry and fingerprint(ob, False) != ground_geometry[ob.name]: raise RuntimeError('PRESERVED_GROUND_GEOMETRY_CHANGED: ' + ob.name)
    output = PUBLIC / 'environment-refined.glb'; export(output)
    checks = inspect_glb(output)
    result = dict(upstream)
    result.update({'sha256': sha(output), 'bytes': output.stat().st_size, 'blenderVersion': bpy.app.version_string, 'file': output.name,
                   'geometrySource': upstream['geometrySource'] + '; original rocks refined with authored fracture geometry',
                   'refinement': {'upstreamFile': original.name, 'upstreamSha256': sha(original), 'upstreamBytes': original.stat().st_size,
                     'upstreamManifest': 'environment-manifest.json', 'upstreamTool': upstream.get('blenderVersion'), 'tool': 'Blender ' + bpy.app.version_string,
                     'script': 'scripts/refine-yuezhi-environment.py', 'scriptSha256': sha(pathlib.Path(__file__)), 'seed': SEED, 'editedObjects': edited,
                     'changes': ['60 existing rocks: triangulated fracture surfaces and asymmetrical flattened shapes', 'Original mountain ridge: authored layered rock texture/normal/roughness', 'Original river: dark desaturated matte water; no bright cyan sheen', 'Original ground atlas retained; added 2m repeat detail normal/roughness through a separate UV, ground geometry unchanged'],
                     'textureOrigin': 'Project-authored 512px procedural PBR image rasters; not photos or newly downloaded assets',
                     'preservedMeshAndMaterialSignatures': preserved, 'preservedGroundGeometrySignatures': ground_geometry, 'preservationScope': 'Before/after Blender processing; re-export can re-encode original texture files', 'exportChecks': checks}})
    result['triangles'] = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in objects)
    points = [ob.matrix_world @ vertex.co for ob in objects for vertex in ob.data.vertices]
    result['bounds'] = {'min': [min(p.x for p in points), min(p.z for p in points), -max(p.y for p in points)], 'max': [max(p.x for p in points), max(p.z for p in points), -min(p.y for p in points)]}
    (PUBLIC / 'environment-refined-manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('ENVIRONMENT_REFINED ' + json.dumps({'file': str(output), 'sha256': sha(output), 'bytes': output.stat().st_size, 'checks': checks}))


def refine_sets():
    folder = PUBLIC / 'sets'; manifest = json.loads((folder / 'manifest.json').read_text())
    refined = []
    for record in manifest['assets']:
        source = folder / record['file']; objects = import_source(source, record)
        preserved_geometry = {ob.name: fingerprint(ob, False) for ob in objects}
        material_cache = {}; edits = []
        for ob in objects:
            for index, old in enumerate(list(ob.data.materials)):
                name = old.name if old else ''
                kind = 'wood' if 'timber' in name else 'cloth' if 'cloth' in name else 'earth' if 'courtyard' in name else 'plaster' if 'plaster' in name else None
                if not kind: continue
                if kind not in material_cache: material_cache[kind] = pbr_material(kind)
                ob.data.materials[index] = material_cache[kind]; edits.append({'object': ob.name, 'material': kind})
            if any(e['object'] == ob.name for e in edits):
                remove_colors(ob)
                kinds = {e['material'] for e in edits if e['object'] == ob.name}
                if kinds <= {'earth', 'plaster'}:
                    metric_uv(ob, 1.5 if 'earth' in kinds else 1.0)
                else:
                    smart_uv(ob)
        for ob in objects:
            if fingerprint(ob, False) != preserved_geometry[ob.name]:
                raise RuntimeError('PRESERVED_SET_GEOMETRY_CHANGED: ' + ob.name)
        output = folder / (record['id'] + '-refined.glb'); export(output); checks = inspect_glb(output)
        refined.append({**record, 'file': output.name, 'sha256': sha(output), 'bytes': output.stat().st_size, 'tool': bpy.app.version_string,
                        'refinement': {'upstreamFile': record['file'], 'upstreamSha256': sha(source), 'upstreamBytes': source.stat().st_size,
                         'upstreamTool': record['tool'], 'script': 'scripts/refine-yuezhi-environment.py --sets', 'scriptSha256': sha(pathlib.Path(__file__)), 'seed': SEED,
                          'editedMaterials': edits, 'geometryModified': False, 'preservedGeometrySignatures': preserved_geometry,
                          'surfaceUv': {'earthTileM': 1.5, 'plasterTileM': 1.0, 'projection': 'World-metre dominant-face box projection; timber and cloth keep smart UV'},
                          'textureOrigin': 'Project-authored procedural PBR rasters; earth/plaster use isotropic multiscale noise; not photographic or downloaded textures', 'exportChecks': checks}})
    (folder / 'refined-manifest.json').write_text(json.dumps({**manifest, 'assets': refined}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('SETS_REFINED ' + json.dumps(refined, ensure_ascii=False))


if '--sets' in sys.argv:
    refine_sets()
else:
    refine_environment()
