"""Material-only GLB candidate; preserves the input mesh and placement.

Usage: blender -b -t 2 --python refine_material.py -- INPUT.glb OUTPUT.glb '#RRGGBB'
Animated GLBs are rejected until node/clip preservation is separately verified.
"""

import json
import os
import re
import sys

import bpy


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 3 or not re.fullmatch(r"#[0-9a-fA-F]{6}", args[2]):
        raise SystemExit("expected input.glb output.glb #RRGGBB")
    source, output, hex_color = args
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(source))
    if not any(obj.type == "MESH" for obj in bpy.context.scene.objects):
        raise RuntimeError("GLB has no mesh")
    if len(bpy.data.actions):
        raise RuntimeError("animated GLB material roundtrip is not supported")
    color = tuple(int(hex_color[index : index + 2], 16) / 255 for index in (1, 3, 5)) + (1,)
    edited = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            material = slot.material
            if not material:
                continue
            material.diffuse_color = color
            material.use_nodes = True
            principled = material.node_tree.nodes.get("Principled BSDF")
            if principled:
                principled.inputs["Base Color"].default_value = color
            edited += 1
    if edited == 0:
        raise RuntimeError("GLB has no editable material")
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(output), export_format="GLB", use_selection=True, export_apply=True)
    print(json.dumps({"tool": "Blender", "version": bpy.app.version_string, "materialsEdited": edited, "color": hex_color}))


if __name__ == "__main__":
    main()
