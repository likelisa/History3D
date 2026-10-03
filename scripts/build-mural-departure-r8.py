"""Build an original illustrative Longxi departure environment, entirely offline.

Run Blender --background --python-exit-code 1 --python this.py [-- options].
Three.js coordinates are used in all authoring helpers: X, vertical Y, ground Z.
The party walks from Z8 to Z3, away from an open gateway at Z10. The Chinese
histories attest departure from Longxi, not this gate, road or equipment layout.
No existing asset or shared scene manifest is overwritten by this generator.
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
SIZE, SEED = 512, 20261003
parser = argparse.ArgumentParser()
parser.add_argument('--out-dir', type=pathlib.Path, default=ROOT / 'viewer/public/mural-assets')
parser.add_argument('--evidence-dir', type=pathlib.Path,
                    default=ROOT.parent.parent / 'outputs/story-r8/departure-outpost-r8')
options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT, EVIDENCE = options.out_dir.resolve(), options.evidence_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
TARGET = OUT / 'departure-outpost-r8.glb'
PREVIEW = EVIDENCE / 'departure-outpost-r8-overview.png'
if TARGET.exists() or PREVIEW.exists() or (OUT / 'departure-outpost-r8-manifest.json').exists():
    raise RuntimeError('Preserve earlier builds; choose new --out-dir and --evidence-dir')

# Only reviewed material/UV helpers are compiled; the upstream build is not run.
UPSTREAM = ROOT / 'scripts/refine-yuezhi-environment.py'
names = {'image', 'isotropic_noise', 'textures', 'pbr_material', 'metric_uv', 'inspect_glb'}
nodes = [n for n in ast.parse(UPSTREAM.read_text(encoding='utf-8')).body
         if isinstance(n, ast.FunctionDef) and n.name in names]
if {n.name for n in nodes} != names:
    raise RuntimeError('Reviewed material helpers unavailable')
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(UPSTREAM), 'exec'), globals())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bv(point):
    return Vector((point[0], -point[2], point[1]))


def material(kind, label, tint=(1, 1, 1), strata=False):
    mat = pbr_material(kind)
    mat.name = 'Refined illustrative departure ' + label + ' - embedded PBR'
    shader = mat.node_tree.nodes.get('Principled BSDF')
    base = shader.inputs['Base Color'].links[0].from_node.image
    pixels = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    base.pixels.foreach_get(pixels)
    pixels = pixels.reshape(SIZE, SIZE, 4)
    pixels[:, :, :3] *= np.array(tint, dtype=np.float32)
    if strata:
        row, col = np.mgrid[0:SIZE, 0:SIZE].astype(np.float32) / SIZE
        band = np.cos(math.tau * (row * 4 + .018 * np.sin(col * math.tau * 2)))
        pixels[:, :, :3] *= (1 + .043 * band[:, :, None])
    base.pixels.foreach_set(np.clip(pixels, 0, 1).ravel())
    base.pack()
    return mat


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
materials = {
    'ground': material('earth', 'dry loess soil', (1.26, 1.17, 1.08)),
    'road': material('earth', 'compacted dusty track', (1.42, 1.29, 1.12)),
    'rut': material('earth', 'shallow worn wheel rut', (1.08, .98, .83)),
    'wall': material('plaster', 'rammed earth horizontal layers', (1.32, 1.23, 1.06), True),
    'wood': material('wood', 'worn dark timber'),
    'cloth': material('cloth', 'muted brown travel cloth', (.71, .66, .53)),
    'leather': material('earth', 'plain brown leather skin', (.62, .50, .40)),
    'rope': material('cloth', 'twisted flax bindings', (1.04, .96, .81)),
    'stone': material('rock', 'small angular earth stones', (1.03, .96, .85)),
    'dry-grass': material('cloth', 'sparse ochre grass', (.86, .84, .51)),
}
objects, categories, components = [], {}, Counter()


def remember(ob, category, mat, tile=.7):
    ob.data.materials.append(mat)
    bpy.context.view_layer.update()
    metric_uv(ob, tile)
    objects.append(ob)
    categories[ob.name] = category
    return ob


def mesh(name, verts, faces, mat, tile=.7, smooth=False, category='prop'):
    data = bpy.data.meshes.new(name)
    data.from_pydata([bv(v) for v in verts], [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    return remember(ob, category, mat, tile)


def box(name, center, size, mat, bevel=0, category='prop'):
    bpy.ops.mesh.primitive_cube_add(size=1, location=bv(center))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = ob.modifiers.new('Rounded wear at exposed edges', 'BEVEL')
        mod.width, mod.segments = bevel, 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return remember(ob, category, mat)


def beam(name, a, b, radius, mat, sides=12, category='prop'):
    a, b = bv(a), bv(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius,
                                       depth=(b-a).length, location=(a+b)*.5)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for polygon in ob.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return remember(ob, category, mat, .45)


def tube(name, points, radius, mat, sides=8, category='prop'):
    points = [Vector(p) for p in points]
    verts, faces = [], []
    for index, point in enumerate(points):
        tangent = (points[min(index+1, len(points)-1)] - points[max(0, index-1)]).normalized()
        axis = tangent.cross(Vector((0, 1, 0)))
        if axis.length < .01:
            axis = tangent.cross(Vector((1, 0, 0)))
        u, v = axis.normalized(), tangent.cross(axis.normalized())
        for s in range(sides):
            verts.append(tuple(point + radius*(u*math.cos(s*math.tau/sides) + v*math.sin(s*math.tau/sides))))
        if index:
            for s in range(sides):
                a = (index-1)*sides+s
                b = (index-1)*sides+(s+1)%sides
                faces.append((a, b, index*sides+(s+1)%sides, index*sides+s))
    return mesh(name, verts, faces, mat, .4, True, category)


def terrain_y(x, z):
    # Exact flat walking surface; dry low slopes form a different horizon to the old green valley.
    road_distance = max(0, abs(x)-3)
    weight = min(1, road_distance/5)
    waves = .08*math.sin(x*.29+z*.24) + .05*math.sin(x*.63-z*.19)
    far_slope = 2.4*math.exp(-((z+29)/7.5)**2) * (.76+.21*math.sin(x*.24+.6))
    far_weight = min(1, max(0, (-z-15)/8))
    return weight*waves + far_weight*far_slope


NX, NZ = 97, 121
verts = [(x, terrain_y(x, z), z)
         for z in np.linspace(-38, 22, NZ) for x in np.linspace(-24, 24, NX)]
faces = []
for j in range(NZ-1):
    for i in range(NX-1):
        a = j*NX+i
        faces.append((a, a+NX, a+NX+1, a+1))
mesh('Wide dry departure ground 48 by 60 metres', verts, faces,
     materials['ground'], 2.4, True, 'surface')
components['wide_dry_terrain'] = 1


def road_x(z):
    return 0 if z >= -2 else .8*math.sin((-z-2)*.08)


def track(name, half_width, x_offset, mat, height):
    verts, faces = [], []
    for j, z in enumerate(np.linspace(-36, 21, 191)):
        center = road_x(float(z)) + x_offset
        width = half_width*(1+.05*math.sin(float(z)*.8))
        for x in [center-width, center+width]:
            verts.append((x, terrain_y(x, float(z))+height, float(z)))
        if j:
            a = (j-1)*2
            faces.append((a, a+2, a+3, a+1))
    mesh(name, verts, faces, mat, .85, True, 'surface')


track('Broad compacted earth road leading west', 3.15, 0, materials['road'], .004)
for offset in [-.93, .93]:
    track('Narrow irregular shallow wheel rut', .047, offset, materials['rut'], .009)
    track('Weathered edge of wheel rut', .016, offset+.058, materials['ground'], .010)
components.update({'compacted_road': 1, 'paired_shallow_wheel_tracks': 2})


def wall(side, start, end, z, height=1.42):
    # Tapered earth with a lightly eroded silhouette, not a stylised crenellated palace.
    xs = np.linspace(start, end, max(4, round(abs(end-start)/.45)+1))
    verts = []
    for index, x in enumerate(xs):
        top = height+.038*math.sin(index*1.4)+.022*math.sin(index*2.8)
        for y, depth in [(0, .42), (top, .29)]:
            verts.extend([(float(x), y, z-depth), (float(x), y, z+depth)])
    faces = []
    for i in range(len(xs)-1):
        a, b = i*4, (i+1)*4
        faces.extend([(a,b,b+2,a+2),(a+1,a+3,b+3,b+1),(a+2,b+2,b+3,a+3),(a,a+1,b+1,b)])
    faces.extend([(0,2,3,1),(len(verts)-4,len(verts)-3,len(verts)-1,len(verts)-2)])
    mesh('Low rammed earth gateway side wall '+str(side), verts, faces, materials['wall'], .9)
    components['low_earthen_wall'] += 1
    for x in np.linspace(start+side*.7, end-side*.6, 4):
        box('Tapered wall earth footing', (float(x), .12, z-.43), (.54,.24,.35), materials['wall'], .035)
    # Horizontal formwork/compaction bands are represented by the embedded colour raster.


wall(-1, -3.65, -14.7, 10)
wall(1, 3.65, 14.7, 10)
for side in [-1, 1]:
    x = side*3.5
    beam('Plain wooden entrance upright', (x, -.08, 10), (x, 4.08, 10), .14, materials['wood'], 16)
    for y in [3.68, 3.92]:
        tube('Entrance timber fibre lashing', [(x-.15,y,9.84),(x+.15,y,9.84),
             (x+.15,y,10.16),(x-.15,y,10.16),(x-.15,y,9.84)], .018, materials['rope'])
    # Unlatched leaves are placed completely to the sides of the travel strip.
    for i in range(7):
        px = side*(3.74+i*.20)
        box('Open entrance leaf individual worn plank', (px,1.02,10.18+.045*math.sin(i)),
            (.185,2.04+.025*math.sin(i),.11), materials['wood'], .012)
    for y in [.32,1.72]:
        beam('Open entrance leaf timber rail',(side*3.65,y,10.31),(side*5.12,y,10.31),.055,materials['wood'])
    beam('Entrance leaf diagonal brace',(side*3.75,.35,10.35),(side*5.0,1.65,10.35),.044,materials['wood'])
beam('Plain wooden entrance lintel above clear walking space',(-3.7,3.95,10),(3.7,3.95,10),
     .13,materials['wood'],16,'overhead')
components.update({'open_wooden_gateway':1,'open_leaf_planks':14})


def rounded(name, center, scale, mat, category='prop'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=16, radius=1, location=bv(center))
    ob = bpy.context.object
    ob.name = name
    ob.scale = (scale[0],scale[2],scale[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for polygon in ob.data.polygons:
        polygon.use_smooth=True
    return remember(ob,category,mat,.38)


# Readable travel supplies at the side, no cloned white tents, labels or invented insignia.
for index, (x,z) in enumerate([(-4.25,8.6),(-4.8,8.2),(-5.0,9.1)]):
    rounded('Soft tied travel bundle', (x,.24,z), (.37,.23,.25), materials['cloth'])
    tube('Bundle encircling fibre tie',[(x-.34,.22,z),(x-.22,.43,z),(x+.22,.43,z),
         (x+.34,.22,z),(x+.2,.07,z),(x-.2,.07,z),(x-.34,.22,z)],.014,materials['rope'])
    tube('Bundle crossed tie',[(x,.11,z-.23),(x,.40,z-.13),(x,.44,z+.13),(x,.11,z+.23)],
         .012,materials['rope'])
    components['tied_cloth_bundle'] += 1
for x,z in [(4.28,8.55),(4.75,8.2)]:
    rounded('Plain soft travel water skin',(x,.32,z),(.21,.29,.15),materials['leather'])
    beam('Closed water skin neck',(x,.53,z),(x+.015,.71,z),.055,materials['leather'])
    beam('Plain water skin timber stopper',(x+.015,.70,z),(x+.015,.76,z),.037,materials['wood'],10)
    tube('Water skin carrying loop',[(x-.17,.38,z),(x-.27,.68,z),(x-.17,.84,z),
         (x+.17,.84,z),(x+.27,.65,z),(x+.17,.4,z)],.015,materials['rope'])
    tube('Water skin edge stitching',[(x-.19,.2,z+.07),(x-.14,.08,z+.1),(x+.14,.08,z+.1),
         (x+.19,.2,z+.07),(x+.15,.53,z+.08)],.006,materials['rope'],6)
    components['water_skin_with_stopper_and_loop'] += 1
for x in [-5.7,-5.58,-5.46]:
    beam('Travel bedroll core',(x,.2,8.2),(x,.2,9.0),.18,materials['cloth'],20)
for z in [8.34,8.87]:
    tube('Rolled cloth binding',[(-5.82,.2,z),(-5.68,.39,z),(-5.40,.39,z),
         (-5.26,.2,z),(-5.4,.04,z),(-5.68,.04,z),(-5.82,.2,z)],.014,materials['rope'])
components['plain_rolled_cloth'] = 1

rng = np.random.default_rng(SEED)
grass_verts, grass_faces = [], []
for index in range(300):
    x,z = float(rng.uniform(-22,22)),float(rng.uniform(-33,19))
    if abs(x-road_x(z)) < 3.3 or (abs(x)<15.2 and 9.2<z<10.8):
        continue
    y=terrain_y(x,z)
    for k in range(3):
        dx,dz = rng.uniform(-.09,.09,2)
        height = float(rng.uniform(.06,.18))
        a=len(grass_verts)
        grass_verts.extend([(x+dx-.009,y,z+dz),(x+dx+.009,y,z+dz),
                            (x+dx+.025,y+height,z+dz+.02)])
        grass_faces.append((a,a+1,a+2))
mesh('Sparse low ochre dry grass away from roadway',grass_verts,grass_faces,
     materials['dry-grass'],.25,False,'surface-detail')
materials['dry-grass'].use_backface_culling=False
components['individual_dry_grass_blades']=len(grass_faces)
for index in range(45):
    x,z=float(rng.uniform(-20,20)),float(rng.uniform(-31,18))
    if abs(x-road_x(z))<3.5 or (abs(x)<15.2 and 9<z<11):
        continue
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,
        location=bv((x,terrain_y(x,z)+.045,z)))
    ob=bpy.context.object
    ob.name='Small angular dusty roadside stone'
    ob.scale=(float(rng.uniform(.08,.21)),float(rng.uniform(.08,.19)),float(rng.uniform(.04,.08)))
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    remember(ob,'prop',materials['stone'],.55)
    components['small_angular_stone']+=1

bpy.context.view_layer.update()
original_count=len(objects)
triangles=sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in objects)
collision_checks=[]
all_points=[]
for ob in objects:
    points=[ob.matrix_world@v.co for v in ob.data.vertices]
    low=[min(p.x for p in points),min(p.z for p in points),-max(p.y for p in points)]
    high=[max(p.x for p in points),max(p.z for p in points),-min(p.y for p in points)]
    all_points.extend(points)
    if categories[ob.name] not in ['surface','surface-detail']:
        overlaps=not(high[0]<=-3 or low[0]>=3 or high[2]<=0 or low[2]>=12 or low[1]>=3.7)
        collision_checks.append({'name':ob.name,'bounds':{'min':low,'max':high},'crossesCharacterCorridor':overlaps})
        if overlaps:
            raise RuntimeError('Character corridor is obstructed: '+ob.name)
bounds={'min':[min(p.x for p in all_points),min(p.z for p in all_points),-max(p.y for p in all_points)],
        'max':[max(p.x for p in all_points),max(p.z for p in all_points),-min(p.y for p in all_points)]}
if triangles>=60000:
    raise RuntimeError('Browser triangle budget exceeded')

# Merge only matching materials, preserving PBR UVs and a modest draw-call count.
groups={key:[ob for ob in objects if ob.data.materials[0]==mat] for key,mat in materials.items()}
joined=[]
for key,selection in groups.items():
    if not selection:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for ob in selection:
        ob.select_set(True)
    bpy.context.view_layer.objects.active=selection[0]
    if len(selection)>1:
        bpy.ops.object.join()
    ob=bpy.context.object
    ob.name='Illustrative Longxi departure '+key
    ob['historical_status']='Original illustrative set; source attests departure from Longxi only'
    joined.append(ob)
bpy.ops.object.select_all(action='DESELECT')
for ob in joined:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(TARGET),export_format='GLB',use_selection=True,
                         export_yup=True,export_extras=True)
inspection=inspect_glb(TARGET)
if len(inspection['refinedMaterials'])!=len(joined) or TARGET.stat().st_size>7*1024*1024:
    raise RuntimeError('Embedded PBR or browser byte budget failed')

scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.cycles.use_denoising=True
scene.render.resolution_x=1600
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.48,.40,.30,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
bpy.ops.object.light_add(type='SUN',location=bv((0,12,0)))
bpy.context.object.rotation_euler=(.58,-.39,-.6)
bpy.context.object.data.energy=2.6
bpy.context.object.data.angle=.075
bpy.ops.object.light_add(type='AREA',location=bv((0,7,6)))
lamp=bpy.context.object
lamp.rotation_euler=(bv((0,0,6))-lamp.location).to_track_quat('-Z','Y').to_euler()
lamp.data.energy=850
lamp.data.shape='DISK'
lamp.data.size=10
bpy.ops.object.camera_add(location=bv((15,8.5,19)))
camera=bpy.context.object
camera.rotation_euler=(bv((0,1,6))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=43
scene.camera=camera
scene.render.filepath=str(PREVIEW)
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE/'departure-outpost-r8.blend'))
bpy.ops.render.render(write_still=True)

# Additional actual shot from the integration camera contract, without invented people.
camera.location=bv((7.4,3.9,6.5))
camera.rotation_euler=(bv((0,1.35,9))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens=35
scene.render.filepath=str(EVIDENCE/'departure-outpost-r8-route-camera.png')
bpy.ops.render.render(write_still=True)
record={
    'schema':'history3d.scene-build.v1','id':'departure-outpost-r8','file':TARGET.name,
    'filePath':str(TARGET),'bytes':TARGET.stat().st_size,'sha256':sha(TARGET),
    'tool':'Blender '+bpy.app.version_string,'unit':'metre','upAxis':'Y','bounds':bounds,
    'triangles':triangles,'originalMeshObjects':original_count,'exportMeshObjects':len(joined),
    'embeddedPBR':inspection,'textureDimensions':[SIZE,SIZE],'seed':SEED,'components':dict(components),
    'builder':{'script':'scripts/build-mural-departure-r8.py','sha256':sha(pathlib.Path(__file__))},
    'materialLineage':{'script':'scripts/refine-yuezhi-environment.py','sha256':sha(UPSTREAM)},
    'characterCorridor':{'x':[-3,3],'z':[0,12],'flatSurfaceY':0,'narrativeDirection':'Z8 to Z3',
                         'obstructionsBelowY3_7':0,'overheadTimberMinimumY':3.82},
    'geometryClearanceChecks':collision_checks,'gatewayZ':10,
    'historicalStatus':'Illustrative Longxi departure; not an identified gate, fort, palace or excavated site.',
    'historicalNoteZh':'《史记》《汉书》记载张骞与甘父从陇西出发，未记具体出入口、道路、夯土边墙、行囊或水囊形制。本资产中的地点、建筑平面、器物和远坡均为原创展示示意，不能称为具名遗址或汉代建筑实测复原。少量既有Tripo人物由集成层代表百余人使团，本GLB不包含人物。',
    'sourceRecords':[
        {'title':'《史记》卷123·大宛列传','url':'https://zh.wikisource.org/wiki/史記/卷123',
         'cachedEvidence':'outputs/mural-clarity/reception-primary-web-r4-followup.json',
         'supports':'出陇西；不支持此具体建筑、道路和设备布局'},
        {'title':'《汉书》·张骞李广利传','url':'https://ctext.org/han-shu/zhang-qian-li-guang-li-zhuan/zh',
         'cachedEvidence':'outputs/mural-clarity/reception-research-r6.json',
         'supports':'从陇西出发；不支持此具体出塞地点和造型'}],
    'preview':{'overview':str(PREVIEW),'overviewSha256':sha(PREVIEW),
               'routeCamera':str(EVIDENCE/'departure-outpost-r8-route-camera.png')},
    'offlineOriginalGeometryAndRasters':True,'newProviderRequests':0,'downloadedModels':0,
    'noExistingAssetOverwrite':True,'classification':['no_persist'],
    'runtimeOrUserVisualAcceptance':False,
}
(EVIDENCE/'departure-outpost-r8-build.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
manifest={'formatVersion':'1.0.0',
          'asset':{'id':'departure-outpost','path':'/mural-assets/'+TARGET.name,
                   'bytes':record['bytes'],'sha256':record['sha256']},
          'authoring':{'builder':record['builder'],'materialLineage':record['materialLineage'],
                       'tool':record['tool'],'offlineOriginalGeometryAndRasters':True,
                       'triangles':triangles,'embeddedImages':inspection['embeddedImages'],
                       'newProviderRequests':0,'downloadedModels':0},
          'historicalStatus':record['historicalStatus'],'boundaryNoteZh':record['historicalNoteZh'],
          'sourceRecords':record['sourceRecords'],'characterCorridor':record['characterCorridor'],
          'bounds':bounds,'noExistingAssetOverwrite':True}
(OUT/'departure-outpost-r8-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('DEPARTURE_R8_SUCCESS '+json.dumps({'file':str(TARGET),'bytes':record['bytes'],
       'sha256':record['sha256'],'triangles':triangles,'images':inspection['embeddedImages']},ensure_ascii=False),flush=True)
