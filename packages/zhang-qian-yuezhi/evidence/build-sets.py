"""Illustrative dialogue backdrops: courtyard and Bactrian market. No historical reconstruction claim."""
import bpy, math, pathlib, random, json, hashlib
from mathutils import Vector
OUT=pathlib.Path(__file__).resolve().parents[1]/'viewer/public/yuezhi/sets'
OUT.mkdir(parents=True,exist_ok=True)
random.seed(71)
def material(name,color,rough=.85):
 m=bpy.data.materials.new(name);m.use_nodes=True
 p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
 return m
clay=material('Warm earthen plaster',(.47,.35,.23)); wood=material('Dark worn timber',(.19,.12,.075)); floor=material('Compacted courtyard earth',(.39,.32,.23)); cloth=material('Plain woven cloth - fibre unknown',(.48,.42,.30)); jar=material('Unglazed illustrative container',(.38,.23,.13))
def cube(name,location,scale,mat,bevel=.05):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=bpy.context.object;o.name=name;o.dimensions=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 if bevel:
  mod=o.modifiers.new('Soft weathered edge','BEVEL');mod.width=bevel;mod.segments=3
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def pole(name,x,y,z,r,h):
 bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=r,depth=h,location=(x,y,z));bpy.context.object.name=name;bpy.context.object.data.materials.append(wood)
def clear():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def vessel(x,y):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=.28,location=(x,y,.33));o=bpy.context.object;o.scale=(1,1,1.2);o.data.materials.append(jar)
 for p in o.data.polygons:p.use_smooth=True
 pole('Pot neck',x,y,.6,.12,.12)
manifest=[]
def export(name):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(name+'.blend')))
 data=(OUT/(name+'.glb')).read_bytes();manifest.append({'id':name,'file':name+'.glb','sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'tool':bpy.app.version_string,'status':'illustrative architecture and props; unknown historical location and form'})
clear()
cube('Courtyard floor',(0,0,-.09),(20,18,.18),floor)
cube('Reception wall left',(-5,4,1.7),(5,.65,3.4),clay,.11)
cube('Reception wall right',(5,4,1.7),(5,.65,3.4),clay,.11)
cube('Entry lintel',(0,4,3.1),(5.2,.8,.7),wood)
cube('Shadowed inner wall',(0,7,1.6),(7,.5,3.2),clay,.1)
for x in [-3,3]:
 pole('Portico timber',x,2,1.65,.14,3.3)
cube('Timber crossbeam',(0,2,3.32),(8,.35,.25),wood)
for x in [-3.5,-2,-.5,1,2.5,3.5]:cube('Portico roof beam',(x,3.6,3.48),(.12,4,.2),wood,.015)
cube('Light roof covering',(0,3.6,3.62),(8.2,4,.1),clay,.015)
cube('Plain reception bench',(3.3,2.7,.3),(1.8,.7,.6),wood)
vessel(-4,3);vessel(-4.6,3)
export('meeting')
clear()
cube('Market courtyard',(0,0,-.08),(22,20,.16),floor)
for x in [-7.2,7.2]:
 cube('Low market wall',(x,4,1.4),(5.8,.55,2.8),clay,.12)
 cube('Side facade',(x+(-2.4 if x<0 else 2.4),1.3,1.4),(.6,6.1,2.8),clay,.1)
 for y in [2.5,5]:cube('Doorway timber',(x,y,1),(.18,.18,2),wood,.02)
for x in [-4.5,4.5]:
 for dx in [-1.25,1.25]:pole('Stall canopy posts',x+dx,2,1.35,.065,2.7)
 cube('Canopy', (x,2.7,2.68),(3.0,2.7,.055),cloth,.015)
 cube('Trading table',(x,1.7,.7),(2.6,1.05,.13),wood)
 for dx in [-1.05,1.05]:cube('Table legs',(x+dx,1.7,.34),(.12,.12,.68),wood,.015)
 for dx in [-.8,-.1,.65]:vessel(x+dx,3)
# The two historical goods are visually central, but form/fibre/colour remain illustrative.
cloth_vertices=[];cloth_faces=[]
for j in range(19):
 for i in range(25):cloth_vertices.append((.1+(i/24-.5)*1.15,-.52+math.sin(i/24*math.pi*7)*.022,.74-j/18*.63))
for j in range(18):
 for i in range(24):
  k=j*25+i;cloth_faces.append((k,k+1,k+26,k+25))
cloth_mesh=bpy.data.meshes.new('Plain cloth drape');cloth_mesh.from_pydata(cloth_vertices,[],cloth_faces);cloth_mesh.update()
cloth_object=bpy.data.objects.new('Plain Shu cloth - fibre and weave unknown',cloth_mesh);bpy.context.collection.objects.link(cloth_object);cloth_object.data.materials.append(cloth)
for face in cloth_mesh.polygons:face.use_smooth=True
cube('Goods table',(0,0,.62),(2.6,.9,.15),wood)
for x in [-1.1,1.1]:cube('Goods table legs',(x,0,.3),(.12,.12,.6),wood,.01)
bamboo=material('Illustrative Qiong bamboo',(.40,.34,.16))
for x in [-.78,-.63]:
 bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=.035,depth=1.1,location=(x,0,.77));o=bpy.context.object;o.rotation_euler=(0,math.pi/2,0);o.data.materials.append(bamboo)
 for z in [-.45,-.15,.15,.45]:
  bpy.ops.mesh.primitive_torus_add(major_segments=16,minor_segments=6,major_radius=.036,minor_radius=.006,location=(x+z,0,.77));o=bpy.context.object;o.rotation_euler=(0,math.pi/2,0);o.data.materials.append(bamboo)
export('market')
(OUT/'manifest.json').write_text(json.dumps({'license':'project authored Blender geometry','historicalStatus':'illustrative sets inspired by regional spatial references; not an identified palace or city','assets':manifest},ensure_ascii=False,indent=2))
