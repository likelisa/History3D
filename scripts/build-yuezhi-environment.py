"""Run with Blender --background --python scripts/build-yuezhi-environment.py.
An explicitly illustrative meeting landscape, not a historical reconstruction.
"""
import bpy, math, random, json, hashlib, pathlib, urllib.request
import numpy as np
import bmesh
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'viewer/public/yuezhi'; OUT.mkdir(parents=True,exist_ok=True)
random.seed(42)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system='METRIC'
def mat(name,color,rough=.9):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough
 return m
soil=mat('Dry earth and gravel',(.36,.32,.22)); grass=mat('Muted river valley vegetation',(.25,.31,.16)); rock=mat('Weathered grey stone',(.38,.37,.32)); water=mat('Shallow river',(.12,.29,.32),.3)
texture=pathlib.Path('/tmp/yuezhi-ground.jpg'); url='https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rocks_ground_05/rocks_ground_05_diff_1k.jpg'
if not texture.exists():
 try: urllib.request.urlretrieve(url,texture)
 except Exception: pass
# Rebuild uses official CC0 assets cached outside the source tree.
for asset in ['grass_medium_01','shrub_01']:
 root=pathlib.Path('/tmp/yuezhi-ph')/asset
 if not (root/(asset+'_1k.gltf')).exists():
  data=json.load(urllib.request.urlopen('https://api.polyhaven.com/files/'+asset))['gltf']['1k']['gltf']
  root.mkdir(parents=True,exist_ok=True);urllib.request.urlretrieve(data['url'],root/(asset+'_1k.gltf'))
  for rel,entry in data['include'].items():
   dest=root/rel;dest.parent.mkdir(parents=True,exist_ok=True);urllib.request.urlretrieve(entry['url'],dest)
if not pathlib.Path('/tmp/yuezhi-meadow.jpg').exists():urllib.request.urlretrieve('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/grass_path_2/grass_path_2_diff_1k.jpg','/tmp/yuezhi-meadow.jpg')
# Vertex colors carry the meadow/path mix to glTF without Blender-only shaders.
groundmat=mat('Meadow and earthen path',(.34,.40,.20))
def colors(ob,fn):
 attr=ob.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
 for loop in ob.data.loops:
  v=ob.data.vertices[loop.vertex_index].co;attr.data[loop.index].color=(*fn(v),1)
 m=ob.data.materials[0];n=m.node_tree.nodes.new('ShaderNodeVertexColor');n.layer_name='Color';m.node_tree.links.new(n.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
def riverx(y):return -18+2.2*math.sin(y*.12)+.7*math.sin(y*.25)
def height(x,y):
 # Blender XY maps to browser X,-Z. Central walkable meeting ground stays flat.
 if -11<x<12 and -13<y<12:return 0
 if abs(x-riverx(y))<2.5:return -.28
 edge=max(0,abs(x)-10)/20
 return max(0,edge*(.65+.3*math.sin(y*.24)) + max(0,y-17)*.10)
def mesh(name,verts,faces,material):
 me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update(); ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(material)
 for p in me.polygons:p.use_smooth=True
 return ob
N=100; verts=[];faces=[]
for j in range(N+1):
 for i in range(N+1):
  x=-30+60*i/N;y=-30+60*j/N;verts.append((x,y,height(x,y)))
for j in range(N):
 for i in range(N):
  a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
ground=mesh('Illustrative valley terrain',verts,faces,groundmat)
def groundcolor(v):
 x,y=v.x,v.y;variation=.04*math.sin(x*.75+y*.43)+.025*math.sin(y*1.4-x*.32)
 path=abs(x-(1.4*math.sin(y*.14)))<2.6 or (abs(y-4)<1.8 and -12<x<5)
 beach=abs(x-riverx(y))<3.3
 if beach:return (.46+variation,.40+variation,.27+variation)
 if path:return (.40+variation,.33+variation,.22+variation)
 return (.23+variation,.32+variation,.12+variation)
# Bake a browser-portable diffuse atlas from real ground textures.
base=bpy.data.images.load('/tmp/yuezhi-meadow.jpg');gravel=bpy.data.images.load(str(texture))
bp=np.array(base.pixels[:]).reshape(base.size[1],base.size[0],4);gp=np.array(gravel.pixels[:]).reshape(gravel.size[1],gravel.size[0],4)
pixels=np.zeros((1024,1024,4),dtype=np.float32)
for j in range(1024):
 y=-30+60*j/1023
 for i in range(1024):
  x=-30+60*i/1023;uvx=int((x/4%1)*1023);uvy=int((y/4%1)*1023)
  path=abs(x-1.4*math.sin(y*.14))<2.6 or (abs(y-4)<1.8 and -12<x<5) or abs(x-riverx(y))<3.3
  c=gp[uvy,uvx,:3] if path else bp[uvy,uvx,:3]
  pixels[j,i,:3]=c*np.array([.65,.64,.60] if path else [.57,.62,.58]);pixels[j,i,3]=1
atlas=bpy.data.images.new('Baked earth meadow atlas',1024,1024);atlas.pixels.foreach_set(pixels.ravel());atlas.pack()
n=groundmat.node_tree.nodes.new('ShaderNodeTexImage');n.image=atlas;groundmat.node_tree.links.new(n.outputs['Color'],groundmat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
uv=ground.data.uv_layers.new(name='GroundUV')
for p in ground.data.polygons:
 for li in p.loop_indices:
  v=ground.data.vertices[ground.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+30)/60,(v.y+30)/60)
rv=[]
for j in range(81):
 y=-30+j*.75; bend=riverx(y)
 rv.extend([(bend-2.0,y,-.19),(bend+2.0,y,-.19)])
river=mesh('Illustrative river ribbon',rv,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(80)],water)
water.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.2
colors(river,lambda v:(.055+.025*math.sin(v.y*.4),.20+.045*math.sin(v.y*.2),.19+.04*math.sin(v.y*.2)))
def stone(name,x,y,z,sx,sy,sz,material=rock,sub=2):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=(x,y,z));ob=bpy.context.object;ob.name=name
 for v in ob.data.vertices:
  f=random.uniform(.88,1.12);v.co*=f
 ob.scale=(sx,sy,sz);ob.data.materials.append(material)
 for p in ob.data.polygons:p.use_smooth=True
 return ob
mv=[];mf=[]
for j in range(37):
 y=23+j/3
 for i in range(193):
  x=-32+i/3; rise=3+2*math.sin(x*.16)**2+2*math.sin(x*.31+1)**2
  z=max(0,rise*math.sin(math.pi*j/36))+.35*math.sin(x*.7+j*.9)
  mv.append((x,y,z))
for j in range(36):
 for i in range(192):
  a=j*193+i;mf.append((a,a+1,a+194,a+193))
mountain=mesh('Distant illustrative mountain ridge',mv,mf,rock.copy())
colors(mountain,lambda v:(.31+.045*math.sin(v.x*.16+v.y*.25),.25+.04*math.sin(v.x*.16+v.y*.25),.18+.035*math.sin(v.x*.16+v.y*.25)))
for i in range(60):
 x=random.choice([random.uniform(-29,-22),random.uniform(14,29)]);y=random.uniform(-28,24);z=height(x,y)
 stone('Procedural weathered stone',x,y,z+.12,random.uniform(.25,1.2),random.uniform(.25,.8),random.uniform(.15,.6))
ov=[];of=[]
for j in range(25):
 for i in range(25):
  x=-90+i*7.5;y=-90+j*7.5;ov.append((x,y,-.4+max(0,abs(x)-30)*.015))
for j in range(24):
 for i in range(24):
  x=-90+(i+.5)*7.5;y=-90+(j+.5)*7.5
  if abs(x)<30 and abs(y)<30:continue
  a=j*25+i;of.append((a,a+1,a+26,a+25))
outermat=mat('Muted distant continuation',(.15,.18,.12));mesh('Non walkable landscape continuation',ov,of,outermat)
# Import CC0 photographed natural plant models; shared meshes keep the export small.
def plants(asset,count,targetfaces):
 before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath='/tmp/yuezhi-ph/'+asset+'/'+asset+'_1k.gltf');bpy.context.view_layer.update()
 imported=[o for o in bpy.context.scene.objects if o not in before and o.type=='MESH']
 # Preserve every source primitive and material. Bake world transforms before join.
 bpy.ops.object.select_all(action='DESELECT')
 for part in imported:
  world=part.matrix_world.copy();part.parent=None
  for v in part.data.vertices:v.co=world@v.co
  part.matrix_world.identity();part.select_set(True)
 bpy.context.view_layer.objects.active=imported[0];bpy.ops.object.join();keep=bpy.context.object
 xs=[v.co.x for v in keep.data.vertices];ys=[v.co.y for v in keep.data.vertices];zs=[v.co.z for v in keep.data.vertices]
 center=Vector(((min(xs)+max(xs))/2,(min(ys)+max(ys))/2,min(zs)))
 targetHeight=.55 if 'grass' in asset else .8
 factor=targetHeight/max(.001,max(zs)-min(zs))
 for v in keep.data.vertices:v.co=(v.co-center)*factor
 keep.matrix_world.identity();imported=[keep]
 for ob in imported:
  bpy.context.view_layer.objects.active=ob;ob.select_set(True)
  triangles=sum(len(p.vertices)-2 for p in ob.data.polygons)
  if triangles>targetfaces:
   mod=ob.modifiers.new('Browser density budget','DECIMATE');mod.ratio=targetfaces/triangles;bpy.ops.object.modifier_apply(modifier=mod.name)
  ob.parent=None
  for index in range(count):
   item=ob if index==0 else ob.copy()
   if index:item.data=ob.data;bpy.context.collection.objects.link(item)
   if index<7:
    x=random.uniform(-6,-3);y=random.uniform(-10,-3)
   elif index<13:
    x=random.uniform(6,9);y=random.uniform(-3,6)
   else:
    y=random.uniform(-24,20);x=random.choice([riverx(y)+random.uniform(3.5,7),random.uniform(14,27)])
   item.location=(x,y,height(x,y));item.rotation_euler=(0,0,random.uniform(0,math.tau))
   scale=random.uniform(.75,1.3);item.scale=(scale,scale,scale)
plants('grass_medium_01',28,1400)
plants('shrub_01',8,3500)
# Export mesh only; cameras and lights remain preview-only.
bpy.ops.object.select_all(action='DESELECT')
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'environment.glb'),export_format='GLB',use_selection=True,export_yup=True)
points=[o.matrix_world@Vector(c) for o in objects for c in o.bound_box]
manifest={'historicalStatus':'illustrative landscape; geography and meeting layout not asserted as historical facts','blenderVersion':bpy.app.version_string,'unit':'meter','upAxis':'Y','centralWalkableHeight':0,'meetingPoints':[[-4,0,4],[5,0,-4]],'sources':[{'asset':'Rocks Ground 05 diffuse 1K','url':'https://polyhaven.com/a/rocks_ground_05','downloadUrl':url,'license':'CC0','used':True}],'additionalSources':[{'asset':a,'url':'https://polyhaven.com/a/'+a,'license':'CC0'} for a in ['grass_path_2','grass_medium_01','shrub_01']], 'visualNote':'Baked real meadow/earth atlas and decimated photographed plant meshes; illustrative geography', 'geometrySource':'Procedural Blender terrain, river, ridges and stones; Poly Haven natural grass and shrub meshes','sha256':hashlib.sha256((OUT/'environment.glb').read_bytes()).hexdigest(),'bytes':(OUT/'environment.glb').stat().st_size,'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objects),'bounds':{'min':[min(p.x for p in points),min(p.z for p in points),-max(p.y for p in points)],'max':[max(p.x for p in points),max(p.z for p in points),-min(p.y for p in points)]}}
manifest['sourceFileHashes']={str(p.relative_to('/tmp/yuezhi-ph')):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/tmp/yuezhi-ph').rglob('*') if p.is_file()}
(OUT/'environment-manifest.json').write_text(json.dumps(manifest,indent=2))
bpy.ops.object.light_add(type='SUN',location=(0,0,20));bpy.context.object.rotation_euler=(.5,-.4,-.5);bpy.context.object.data.energy=3
bpy.ops.object.camera_add(location=(38,-45,30));cam=bpy.context.object;cam.rotation_euler=(Vector((0,4,0))-cam.location).to_track_quat('-Z','Y').to_euler();bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25);scene.render.filepath='/tmp/yuezhi-environment-preview.png';bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'environment.blend'))
print(json.dumps(manifest))
