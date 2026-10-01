import bpy, math, os, json, hashlib
from mathutils import Vector
OUT=os.path.abspath('viewer/public/yuezhi/figures'); os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name,c):
 m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Roughness'].default_value=.87; return m
skin=mat('Neutral illustrative skin',(.39,.26,.18)); shoe=mat('Unspecified leather footwear',(.075,.053,.035)); staffmat=mat('Illustrative wood',(.25,.12,.05))
def uv(name,loc,scale,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,location=loc); o=bpy.context.object; o.name=name; o.scale=scale; o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=True
 return o
def tube(name,centers,radii,m,n=32):
 vs=[]; fs=[]
 for j,(c,r) in enumerate(zip(centers,radii)):
  for i in range(n):
   a=i*2*math.pi/n; fold=1+.035*math.sin(a*9+j*.2)+.018*math.sin(a*17); vs.append((c[0]+r[0]*math.cos(a)*fold,c[1]+r[1]*math.sin(a)*fold,c[2]))
 for j in range(len(centers)-1):
  for i in range(n): k=j*n+i; q=j*n+(i+1)%n; fs.append((k,q,q+n,k+n))
 fs.append(tuple(reversed(range(n)))); fs.append(tuple((len(centers)-1)*n+i for i in range(n)))
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(vs,[],fs); mesh.update(); o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); o.data.materials.append(m)
 for p in mesh.polygons:p.use_smooth=True
 mod=o.modifiers.new('Soft cloth subdivision','SUBSURF'); mod.levels=2; return o
records=[]
for label,color in [('envoy',(.27,.16,.085)),('yuezhi',(.25,.32,.24))]:
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 cloth=mat(label+' neutral robe',color); trim=mat(label+' woven edging',tuple(x*.64 for x in color))
 tube('Continuous folded robe',[(0,0,z) for z in [.12,.2,.45,.7,.94,1.12,1.28,1.39,1.43]],[(.24,.14),(.235,.14),(.215,.135),(.185,.12),(.15,.11),(.18,.12),(.225,.12),(.205,.1),(.095,.073)],cloth)
 for side in [-1,1]:
  # slightly forward relaxed sleeves, broad at cuff, not rigid cylindrical arms
  tube('Draped sleeve',[(side*.18,0,1.36),(side*.245,-.005,1.26),(side*.27,-.025,1.12),(side*.285,-.04,1.00)],[(.085,.09),(.092,.085),(.081,.073),(.065,.065)],cloth)
  uv('Relaxed hand',(side*.285,-.045,.955),(.038,.027,.075),skin)
  uv('Foot',(side*.10,-.035,.065),(.064,.12,.063),shoe)
 uv('Neck',(0,0,1.445),(.054,.05,.075),skin)
 uv('Neutral head',(0,-.005,1.575),(.079,.072,.119),skin)
 uv('Minimal nose',(0,-.073,1.578),(.017,.018,.026),skin)
 for s in [-1,1]: uv('Ear',(s*.077,0,1.57),(.012,.018,.032),skin)
 tube('Plain sash',[(0,0,.96),(0,0,.99)],[(.156,.115),(.156,.115)],trim)
 # flat diagonal collar strip on front of robe
 for s in [-1,1]:
  o=tube('Plain collar',[(s*.065,-.083,1.41),(s*.035,-.118,1.32),(0,-.128,1.22)],[(.012,.008)]*3,trim)
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.export_scene.gltf(filepath=OUT+'/'+label+'.glb',export_format='GLB',use_selection=True,export_apply=True)
 bpy.ops.wm.save_as_mainfile(filepath=OUT+'/'+label+'.blend')
 # studio preview
 floor=mat('Studio',(.14,.16,.17)); bpy.ops.mesh.primitive_plane_add(size=200); bpy.context.object.data.materials.append(floor)
 bpy.ops.object.camera_add(location=(2.3,-4,2.0)); camera=bpy.context.object; camera.rotation_euler=(Vector((0,0,.9))-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=2.1; bpy.context.scene.camera=camera
 bpy.ops.object.light_add(type='AREA',location=(1,-3,4)); bpy.context.object.data.energy=450; bpy.context.object.data.shape='DISK'; bpy.context.object.data.size=4
 bpy.context.scene.world.color=(.35,.35,.35); scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.render.resolution_x=480; scene.render.resolution_y=640; scene.render.resolution_percentage=100; scene.render.filepath=OUT+'/'+label+'.png'; bpy.ops.render.render(write_still=True)
 p=OUT+'/'+label+'.glb'; records.append({'id':label,'file':label+'.glb','sha256':hashlib.sha256(open(p,'rb').read()).hexdigest(),'bytes':os.path.getsize(p),'approxHeightMeters':1.694,'origin':'ground at feet','coordinateSystem':'glTF Y up','source':'procedural illustrative Blender mesh','historicalStatus':'No claim of authentic clothing, face, or individual identity'})
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
tube('Han envoy staff illustrative only',[(0,0,0),(0,0,1.55)],[(.012,.012)]*2,staffmat)
# absence of attested external form is explicit; retain a plain pole instead of invented regalia
bpy.ops.object.select_all(action='SELECT'); bpy.ops.export_scene.gltf(filepath=OUT+'/han-staff.glb',export_format='GLB',use_selection=True,export_apply=True); bpy.ops.wm.save_as_mainfile(filepath=OUT+'/han-staff.blend')
p=OUT+'/han-staff.glb'; records.append({'id':'han-staff','file':'han-staff.glb','sha256':hashlib.sha256(open(p,'rb').read()).hexdigest(),'bytes':os.path.getsize(p),'approxHeightMeters':1.55,'source':'procedural illustrative Blender pole','historicalStatus':'Text attests possession of Han staff; external appearance unknown. Plain pole is a placeholder, not reconstruction.'})
json.dump({'status':'illustrative provisional assets','license':'project-authored procedural geometry','assets':records},open(OUT+'/manifest.json','w'),ensure_ascii=False,indent=2)
