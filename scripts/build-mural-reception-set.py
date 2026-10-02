"""Author a formal illustrative Yuezhi reception, never a named excavated palace.

Blender --background --python scripts/build-mural-reception-set.py
Evidence and source boundaries: docs/historical/yuezhi-reception-r4.md.
Existing sets and Tripo figures are preserved. New geometry and all rasters are authored.
"""
import ast
import hashlib
import json
import math
import pathlib
import struct
from collections import Counter
import bpy
import numpy as np
from mathutils import Vector

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'viewer/public/mural-assets'
EVIDENCE = ROOT.parent.parent / 'outputs/mural-clarity/reception-court-r4'
SIZE, SEED = 512, 20261001
EVIDENCE.mkdir(parents=True, exist_ok=True)
np.random.seed(SEED)

def load_helpers(path, names):
    nodes = [n for n in ast.parse(path.read_text(encoding='utf-8')).body
             if isinstance(n, ast.FunctionDef) and n.name in names]
    if {n.name for n in nodes} != names:
        raise RuntimeError('Reviewed helper missing')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), globals())

load_helpers(ROOT / 'scripts/refine-yuezhi-environment.py',
             {'image', 'isotropic_noise', 'textures', 'pbr_material', 'metric_uv', 'inspect_glb'})
load_helpers(ROOT / 'scripts/build-mural-detention-set.py',
             {'sha', 'bv', 'material', 'mesh', 'box', 'beam', 'tube', 'vessel'})
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system = 'METRIC'
materials = {
    'earth': material('earth', 'reception earth'),
    'plaster': material('plaster', 'earthen wall', (1.12, 1.10, 1.04)),
    'brick': material('clay', 'exposed mud brick', (.94, .88, .77)),
    'wood': material('wood', 'timber beams'),
    'felt': material('cloth', 'woven canopy', (1.18, 1.16, 1.10)),
    'rug': material('cloth', 'muted red reception rug', (1.05, .53, .43)),
    'border': material('cloth', 'undyed rug edge', (1.04, 1.02, .94)),
    'rope': material('cloth', 'fibre tie', (.66, .60, .52)),
    'clay': material('clay', 'plain serving ware', (1.18, .93, .74)),
}
for key, mat in materials.items():
    mat.name = 'Refined illustrative reception ' + key + ' - embedded PBR'
objects, components = [], Counter()
box('Packed earth forecourt, surface at Y0', (0, -.06, -.3), (19, .12, 21), materials['earth'])

# Side rooms establish a controlled court rather than a hut on a roadside.
# Neither their footprint nor this mixed timber/felt/earthen construction is attested.
for side in [-1, 1]:
    x = side * 6.0
    box('Plastered court side wall', (x, 1.13, -1.7), (.55, 2.26, 12.0), materials['plaster'], .035)
    box('Low worn wall footing', (x, .15, -1.7), (.68, .3, 12.12), materials['brick'], .035)
    for z in [-6.0, -3.5, -.8, 2.0, 4.1]:
        box('Mud brick buttress', (x - side * .35, 1.03, z), (.46, 2.06, .55), materials['plaster'], .025)
        components['buttress'] += 1
    # Visible blockwork at the top of the near wall, modest wear rather than damage.
    for i in range(19):
        z = -7.2 + i * .63
        box('Individual earthen coping block', (x, 2.28 + .014 * math.sin(i), z),
            (.59, .10, .56), materials['brick'], .017)
    box('Low side waiting bench', (side * 4.7, .32, 1.9), (1.2, .16, 3), materials['wood'], .02)
    for z in [.65, 3.15]:
        box('Bench foot', (side * 4.7, .12, z), (.85, .25, .14), materials['wood'], .012)
box('Back court enclosure', (0, 1.35, -7.4), (12.5, 2.7, .6), materials['plaster'], .04)
for x in [-5.9, -3, 0, 3, 5.9]:
    box('Rear plain timber wall stiffener', (x, 1.45, -7.05), (.13, 2.7, .12), materials['wood'], .01)

# A broad shaded receiving place with an elevated principal position and clear approach.
box('Low reception platform', (0, .10, -4.25), (6.1, .20, 4.3), materials['plaster'], .026)
box('Approach step, shallow', (0, .045, -1.95), (5.8, .09, .3), materials['brick'], .022)
box('Principal rug', (0, .207, -4.25), (4.9, .014, 3.25), materials['rug'], .009)
for x in [-2.36, 2.36]:
    box('Principal rug woven border', (x, .217, -4.25), (.14, .005, 3.25), materials['border'])
for z in [-5.73, -2.77]:
    box('Principal rug end border', (0, .217, z), (4.9, .005, .13), materials['border'])
for x in [-1.65, 1.65]:
    box('Guest reception mat', (x, .016, .4), (1.68, .032, 2.05), materials['rug'], .009)
    for z in [-.49, 1.29]:
        box('Guest mat border', (x, .035, z), (1.68, .006, .10), materials['border'])

# Six structural columns, exposed rafters, roof seams, draped valance and bound joints.
for x in [-4.4, 4.4]:
    for z in [-6.6, -4.15, -1.6]:
        beam('Canopy structural post', (x, .0, z), (x, 3.32, z), .115, materials['wood'], 16)
        box('Post plain earth socket', (x, .13, z), (.39, .26, .39), materials['brick'], .02)
        for y in [2.99, 3.19]:
            tube('Post fibre lashing', [(x-.125,y,z-.125),(x+.125,y,z-.125),
                 (x+.125,y,z+.125),(x-.125,y,z+.125),(x-.125,y,z-.125)], .018, materials['rope'], 8)
        components['timber_post'] += 1
    beam('Canopy longitudinal support', (x, 3.26, -6.8), (x, 3.26, -1.4), .075, materials['wood'])
for z in [-6.65, -5.45, -4.2, -2.95, -1.6]:
    beam('Plain transverse rafter', (-4.56,3.27,z), (4.56,3.27,z), .069, materials['wood'])
verts, faces = [], []
cols, rows = 41, 25
def canopy_y(x,z):
    return 3.40 - .12 * (1-(x/4.55)**2) + .017*math.sin(x*7+z*1.3)
for j in range(rows):
    z = -6.85 + 5.45*j/(rows-1)
    for i in range(cols):
        x = -4.55+9.1*i/(cols-1)
        verts.append((x,canopy_y(x,z),z))
for j in range(rows-1):
    for i in range(cols-1):
        a=j*cols+i
        faces.append((a,a+cols,a+cols+1,a+1))
roof=mesh('Woven canopy with drape',verts,faces,materials['felt'],.7,True)
roof.data.materials[0].use_backface_culling=False
for x in np.linspace(-4.4,4.4,9):
    tube('Joined canopy cloth seam',[(float(x),canopy_y(x,float(z))+.006,float(z)) for z in np.linspace(-6.84,-1.41,24)],.009,materials['rope'])
for side in [-1,1]:
    x=side*4.55
    mesh('Shallow side canopy valance',[(x,3.37,-6.85),(x,3.37,-1.4),(x,3.04,-1.4),(x,3.04,-6.85)],[(0,1,2,3)],materials['felt'],.7)
    # Side fabric divider lies outside character space; folds show woven material.
    curtain_verts=[]
    for y in [.45,1.1,1.9,2.6,3.25]:
        for j in range(29):
            z=-6.7+3.5*j/28
            curtain_verts.append((side*(4.38+.055*math.sin(j*1.65)),y,z))
    curtain_faces=[]
    for i in range(4):
        for j in range(28):
            a=i*29+j
            curtain_faces.append((a,a+29,a+30,a+1))
    mesh('Hanging woven side screen',curtain_verts,curtain_faces,materials['felt'],.7,True)

# Plain equipment communicates an occupied receiving court, without invented treaties.
box('Plain rear receiving bench', (0,.52,-5.93),(2.0,.17,.64),materials['wood'],.025)
for x in [-.82,.82]:
    box('Rear bench leg',(x,.32,-5.93),(.13,.48,.49),materials['wood'],.016)
box('Folded plain seat textile',(0,.64,-5.93),(1.72,.10,.53),materials['rug'],.025)
for side in [-1,1]:
    box('Small side serving board',(side*3.45,.49,-4.9),(.76,.09,.68),materials['wood'],.02)
    for dx in [-.27,.27]:
        box('Serving board leg',(side*3.45+dx,.32,-4.9),(.08,.35,.47),materials['wood'],.01)
    vessel('Plain court water jar',side*5.0,-1.9,.64,.52)
    vessel('Plain small court bowl',side*4.75,-1.05,.18,.40)
components.update({'courtyard':1,'receiving_platform':1,'principal_rug':1,'guest_mats':2,'canopy':1,'plain_receiving_bench':1})

bpy.context.view_layer.update()
triangles=sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in objects)
joined=[]
material_groups={key:[ob for ob in objects if ob.data.materials[0]==mat] for key,mat in materials.items()}
for key,mat in materials.items():
    selection=material_groups[key]
    if not selection: continue
    bpy.ops.object.select_all(action='DESELECT')
    for ob in selection: ob.select_set(True)
    bpy.context.view_layer.objects.active=selection[0]
    if len(selection)>1: bpy.ops.object.join()
    bpy.context.object.name='Reception court '+key
    joined.append(bpy.context.object)
target=OUT/'reception-court.glb'
if target.exists(): raise RuntimeError('Use a new output filename rather than overwrite preserved assets')
bpy.ops.object.select_all(action='DESELECT')
for ob in joined: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(target),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
inspection=inspect_glb(target)
if target.stat().st_size>6*1024*1024 or triangles>60000: raise RuntimeError('Browser asset budget exceeded')
record={'id':'reception-court','file':target.name,'bytes':target.stat().st_size,'sha256':sha(target),
 'tool':'Blender '+bpy.app.version_string,'unit':'metre','upAxis':'Y','triangles':triangles,
 'embeddedPBR':inspection,'components':dict(components),'textureDimensions':[512,512],
 'builder':{'script':'scripts/build-mural-reception-set.py','sha256':sha(pathlib.Path(__file__))},
 'historicalStatus':'Illustrative royal-court reception. Neither a treaty ceremony nor an identified excavated building.',
 'historicalNoteZh':'史书记载月氏王庭在妫水北及张骞求盟未成；未载具体接见建筑和礼仪。院落、毡织顶棚、主客位置、器物均为展示推演，不等同阿伊哈努姆宫殿，不确定统治者肖像或性别。',
 'sourceDocument':'docs/historical/yuezhi-reception-r4.md','noNewProviderGeneration':True,
 'characterPositions':{'host':[0,.225,-3.8],'envoy':[-1.55,.04,.55],'translator':[1.5,.04,.85],
 'attendants':[[-3.1,.20,-4.8],[3.1,.20,-4.6]]}}
(OUT/'reception-court-manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(EVIDENCE/'asset-validation.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
scene=bpy.context.scene
bpy.ops.object.light_add(type='SUN',location=(0,0,12));bpy.context.object.rotation_euler=(.48,-.42,-.4);bpy.context.object.data.energy=2.1
bpy.ops.object.light_add(type='AREA',location=bv((0,6,4)));bpy.context.object.data.energy=1500;bpy.context.object.data.size=8
scene.world.color=(.18,.2,.22)
bpy.ops.object.camera_add(location=bv((9,5.5,11)));cam=bpy.context.object
cam.rotation_euler=(bv((0,1,-2))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=43;scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1280;scene.render.resolution_y=800
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(EVIDENCE/'reception-court-overview.png');scene.view_settings.view_transform='AgX'
bpy.ops.wm.save_as_mainfile(filepath=str(EVIDENCE/'reception-court.blend'))
bpy.ops.render.render(write_still=True)
print('RECEPTION_COURT_SUCCESS '+json.dumps({'bytes':record['bytes'],'sha256':record['sha256'],'triangles':triangles}),flush=True)
