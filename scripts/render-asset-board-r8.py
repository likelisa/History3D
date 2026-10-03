"""Blender thumbnail recipe; preserves all supplied GLB files.

blender --background --python-exit-code 1 --python scripts/render-asset-board-r8.py
Run build-asset-board-r8.py first, and again afterwards to record PNG hashes.
"""
from pathlib import Path
import argparse,hashlib,json,math,sys
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'viewer/public'
OUT=PUBLIC/'asset-board-r8'
jobs=json.loads((OUT/'thumbnail-jobs.json').read_text(encoding='utf-8'))
parser=argparse.ArgumentParser()
parser.add_argument('--only',help='Render one new/changed asset; preserve all other thumbnails and provenance')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
selected=[job for job in jobs if not args.only or job['id']==args.only]
if not selected:raise RuntimeError('No matching asset thumbnail job')
provenance=OUT/'thumbnail-provenance.json'
existing=json.loads(provenance.read_text(encoding='utf-8')) if args.only and provenance.is_file() else []
records={record['id']:record for record in existing}
for job in selected:
    path=PUBLIC/job['path'].lstrip('/')
    output=PUBLIC/job['thumbnail'].lstrip('/')
    if hashlib.sha256(path.read_bytes()).hexdigest()!=job['sha256']:raise RuntimeError('GLB changed '+job['id'])
    output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.render.engine='BLENDER_EEVEE_NEXT'
    scene.render.resolution_x=640;scene.render.resolution_y=420;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=True
    scene.view_settings.view_transform='AgX'
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes=[o for o in scene.objects if o.type=='MESH']
    if not meshes:raise RuntimeError('No mesh '+job['id'])
    points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
    lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center=(lo+hi)/2;size=hi-lo;factor=3.5/max(size)
    wrapper=bpy.data.objects.new('Thumbnail display normalization',None);scene.collection.objects.link(wrapper)
    for o in list(scene.objects):
        if o==wrapper or o.parent:continue
        world=o.matrix_world.copy();o.parent=wrapper;o.matrix_world=world
    wrapper.location=-center*factor;wrapper.scale=(factor,)*3
    bpy.context.view_layer.update()
    bpy.ops.object.camera_add(location=(5.3,-7.8,4.0) if job['id'] not in ('monk','tower','zhangqian-trial') else (6.8,-4.8,3.4))
    camera=bpy.context.object;camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';scene.camera=camera
    # A diagonal narrow staff can have a projected length larger than every
    # individual XYZ extent. Fit the actual projected corners, not max XYZ.
    inverse=camera.rotation_euler.to_quaternion().inverted()
    projected=[inverse@((p-center)*factor-camera.location) for p in points]
    span_x=max(p.x for p in projected)-min(p.x for p in projected)
    span_y=max(p.y for p in projected)-min(p.y for p in projected)
    camera.data.ortho_scale=max(span_x,span_y*640/420)*1.18
    world=bpy.data.worlds.new('Thumbnail soft studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs['Color'].default_value=(.45,.48,.44,1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7;scene.world=world
    for loc,power,span in [((3,-4,6),850,5),((-4,-2,3),600,4),((2,4,4),700,3)]:
        bpy.ops.object.light_add(type='AREA',location=loc)
        light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=span
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(output)
    bpy.ops.render.render(write_still=True)
    records[job['id']]={'id':job['id'],'glbSha256':job['sha256'],'thumbnail':job['thumbnail'],
                    'thumbnailSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
                    'sourceBoundsBlender':{'min':list(lo),'max':list(hi)},
                    'displayScale':factor,'blenderVersion':bpy.app.version_string}
    print('ASSET_BOARD_RENDERED '+job['id'],flush=True)
provenance.write_text(json.dumps([records[job['id']] for job in jobs if job['id'] in records],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('ASSET_BOARD_COMPLETE '+str(len(records)),flush=True)
