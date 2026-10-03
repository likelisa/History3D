"""Render offline world review views from a formal v0.1 scene package.

Usage: blender -b -t 2 --python processing/tools/render_world.py -- PACKAGE_DIR OUTPUT_DIR
These renders are evidence for review, not screenshots from the formal viewer.
"""

import json
import os
import sys

import bpy
from mathutils import Vector


def from_y_up(position):
    return Vector((position[0], -position[2], position[1]))


def look_at(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("expected package directory and output directory")
    package_dir, output_dir = args
    os.makedirs(output_dir, exist_ok=True)
    with open(os.path.join(package_dir, "scene.json"), encoding="utf-8") as stream:
        scene_data = json.load(stream)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    asset_paths = {asset["id"]: os.path.join(package_dir, asset["path"]) for asset in scene_data["assets"]}
    visible = []
    for item in scene_data["objects"]:
        position = from_y_up(item["position"])
        yaw = -item["rotation"][1]
        render = item["render"]
        if render["type"] == "primitive":
            width, height, depth = item["dimensionsM"]
            bpy.ops.mesh.primitive_cube_add(size=1, location=position + Vector((0, 0, height / 2)))
            obj = bpy.context.object
            obj.name = item["id"]
            obj.dimensions = (width, depth, height)
            obj.rotation_euler.z = yaw
            material = bpy.data.materials.new(item["id"] + " material")
            rgb = item["render"]["color"].lstrip("#")
            color = tuple(int(rgb[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (1,)
            material.diffuse_color = color
            material.use_nodes = True
            material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
            obj.data.materials.append(material)
            visible.append(obj)
        elif render["type"] == "asset":
            before = set(bpy.context.scene.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.abspath(asset_paths[render["assetId"]]))
            imported = [obj for obj in bpy.context.scene.objects if obj not in before]
            root = bpy.data.objects.new(item["id"] + " root", None)
            bpy.context.collection.objects.link(root)
            for obj in imported:
                if obj.parent is None:
                    obj.parent = root
            root.location = position
            root.rotation_euler.z = yaw
            visible.extend(obj for obj in imported if obj.type == "MESH")
    for obj in visible:
        if obj.type == "MESH":
            obj.active_material = obj.active_material or bpy.data.materials.new("Review neutral")
    ground_data = bpy.data.meshes.new("Ground mesh")
    ground = bpy.data.objects.new("Ground", ground_data)
    bpy.context.collection.objects.link(ground)
    span_x = scene_data["walkableBounds"]["max"][0] - scene_data["walkableBounds"]["min"][0]
    span_z = scene_data["walkableBounds"]["max"][1] - scene_data["walkableBounds"]["min"][1]
    extent = max(span_x, span_z) + 30
    ground_data.from_pydata([(-extent, -extent, 0), (extent, -extent, 0), (extent, extent, 0), (-extent, extent, 0)], [], [(0, 1, 2, 3)])
    ground_data.update()
    ground_mat = bpy.data.materials.new("Ground gray")
    ground_mat.diffuse_color = (0.28, 0.34, 0.40, 1)
    ground_mat.use_nodes = True
    ground_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = ground_mat.diffuse_color
    ground.data.materials.append(ground_mat)

    world = bpy.data.worlds.new("Review world")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.53, 0.63, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    light_data = bpy.data.lights.new("Key", "AREA")
    light = bpy.data.objects.new("Key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (8, -4, 14)
    light_data.energy = 1800
    light_data.size = 12

    camera_data = bpy.data.cameras.new("Review camera")
    camera = bpy.data.objects.new("Review camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.type = "PERSP"
    camera_data.lens = 30
    scene = bpy.context.scene
    engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"

    overview = scene_data["cameras"]["overview"]
    views = {
        "overview": (from_y_up(overview["position"]), from_y_up(overview["target"])),
        "main": (Vector((4.5, -10, 4.2)), Vector((0, -2, 1.2))),
        "human-scale": (Vector((0, -23, 3.0)), Vector((0, -16, 1.0))),
    }
    for view_id, (position, target) in views.items():
        camera.location = position
        camera_data.lens = 18 if view_id == "overview" else (22 if view_id == "human-scale" else 30)
        look_at(camera, target)
        scene.render.filepath = os.path.join(output_dir, f"{view_id}.png")
        bpy.ops.render.render(write_still=True)
    print(json.dumps({"views": list(views), "objectIds": [item["id"] for item in scene_data["objects"]]}))


if __name__ == "__main__":
    main()
