"""Render six fixed views of a GLB with Blender's bundled Python.

Usage: blender -b -t 2 --python processing/tools/render_asset.py -- INPUT.glb OUTPUT_DIR
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("expected input GLB and output directory")
    source, destination = args
    os.makedirs(destination, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(source))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not objects:
        raise RuntimeError("GLB has no mesh to render")
    bounds = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector([min(point[i] for point in bounds) for i in range(3)])
    high = Vector([max(point[i] for point in bounds) for i in range(3)])
    center = (low + high) / 2
    size = high - low
    radius = max(size.length, 0.5)

    world = bpy.data.worlds.new("Neutral review world")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.68, 0.70, 0.72, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    light_data = bpy.data.lights.new("Review area", "AREA")
    light = bpy.data.objects.new("Review area", light_data)
    bpy.context.collection.objects.link(light)
    light.location = center + Vector((radius, -radius, radius * 1.8))
    light_data.energy = 850
    light_data.shape = "DISK"
    light_data.size = max(radius * 2, 1)

    camera_data = bpy.data.cameras.new("Review camera")
    camera = bpy.data.objects.new("Review camera", camera_data)
    bpy.context.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(size.x, size.y, size.z, 0.5) * 1.65
    scene = bpy.context.scene
    engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    positions = {
        "front": (0, -1, 0.2),
        "back": (0, 1, 0.2),
        "left": (-1, 0, 0.2),
        "right": (1, 0, 0.2),
        "top": (0, -0.01, 1),
        "three-quarter": (1, -1, 0.65),
    }
    for view_id, direction in positions.items():
        camera.location = center + Vector(direction).normalized() * radius * 2.5
        camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(destination, f"{view_id}.png")
        bpy.ops.render.render(write_still=True)
    print(json.dumps({"boundsMin": list(low), "boundsMax": list(high), "views": list(positions)}))


if __name__ == "__main__":
    main()
