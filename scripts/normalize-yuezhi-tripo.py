import bpy,math,os,json,hashlib,shutil
from mathutils import Vector
ROOT=os.path.abspath('.processing-data/yuezhi-tripo');OUT=os.path.abspath('viewer/public/yuezhi/figures');old=json.load(open(OUT+'/manifest.json'));records=[]
for label in ['envoy','yuezhi']:
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 raw=ROOT+'/'+label+'-raw.glb';bpy.ops.import_scene.gltf(filepath=raw)
 objs=list(bpy.context.scene.objects);meshes=[o for o in objs if o.type=='MESH'];pts=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box];lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)]);scale=1.7/(hi.z-lo.z)
 # parent collection under root, keep model front until render review determines it
 root=bpy.data.objects.new('Calibrated neutral character',None);bpy.context.collection.objects.link(root)
 for o in objs:
  if o.parent is None:o.parent=root
 root.scale=(scale,)*3;root.location=(-((lo.x+hi.x)/2)*scale,-((lo.y+hi.y)/2)*scale,-lo.z*scale)
 if label=='envoy':
  root.rotation_euler.z=-math.pi/2
  root.location=(root.location.y,-root.location.x,root.location.z)
 for im in bpy.data.images:
  if im.size[0]>1024 or im.size[1]>1024:im.scale(min(im.size[0],1024),min(im.size[1],1024))
 bpy.ops.object.select_all(action='SELECT');
 backup=OUT+'/'+label+'-procedural.glb'
 if not os.path.exists(backup):shutil.copy(OUT+'/'+label+'.glb',backup)
 bpy.ops.export_scene.gltf(filepath=OUT+'/'+label+'.glb',export_format='GLB',use_selection=True,export_apply=True);bpy.ops.wm.save_as_mainfile(filepath=OUT+'/'+label+'-tripo.blend')
 task=json.load(open(ROOT+'/'+label+'-task.json'))['data'];path=OUT+'/'+label+'.glb';record={'id':label,'file':label+'.glb','sha256':hashlib.sha256(open(path,'rb').read()).hexdigest(),'rawSha256':hashlib.sha256(open(raw,'rb').read()).hexdigest(),'bytes':os.path.getsize(path),'taskId':task['task_id'],'source':'Tripo text-to-model v3.1-20260211','creditsConsumed':task.get('credits_consumed'),'approxHeightMeters':1.7,'historicalStatus':'AI-generated illustrative visitor; no claim of authentic face or clothing','conversion':{'blenderVersion':bpy.app.version_string,'scale':scale,'rawBoundsBlenderZUp':{'min':list(lo),'max':list(hi)},'texturesMaxPixels':1024,'coordinateSystem':'glTF Y up','origin':'feet on ground','frontAxis':'glTF +Z','yawDegrees':-90 if label=='envoy' else 0}};records.append(record)
 bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;m=bpy.data.materials.new('studio');m.diffuse_color=(.13,.15,.16,1);floor.data.materials.append(m)
 bpy.ops.object.camera_add(location=(2.0,-4,1.8));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.15;bpy.context.scene.camera=cam
 bpy.ops.object.light_add(type='AREA',location=(1,-3,4));bpy.context.object.data.energy=400;bpy.context.object.data.size=4;scene=bpy.context.scene;scene.world.color=(.3,.3,.3);scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=480;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.filepath=OUT+'/'+label+'-tripo.png';bpy.ops.render.render(write_still=True)
records.append(next(a for a in old['assets'] if a['id']=='han-staff'));json.dump({'status':'Tripo generated provisional illustrative assets','license':'Tripo generated outputs under account terms; project authorship does not apply to Tripo assets','assets':records},open(OUT+'/manifest.json','w'),ensure_ascii=False,indent=2)
