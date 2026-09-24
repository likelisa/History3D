"""Create original low-poly fixture GLBs for dynamic assembly tests.

Usage: blender -b --python processing/tools/make_demo_components.py -- OUTPUT_DIR
The figures are illustrative technical assets, not historical reconstructions.
"""

import os
import sys

import bpy


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    return mat


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def cylinder(name, radius, depth, location, mat, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def export(filepath):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=filepath, export_format="GLB", use_selection=True, export_apply=True)


def traveler(filepath):
    clear()
    robe = material("muted olive robe", (0.19, 0.28, 0.23))
    skin = material("warm face", (0.60, 0.43, 0.31))
    dark = material("boots and cap", (0.20, 0.17, 0.14))
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.25, radius2=0.17, depth=0.92, location=(0, 0, 0.96))
    bpy.context.object.name = "robe"
    bpy.context.object.data.materials.append(robe)
    for side in (-1, 1):
        cylinder("arm", 0.075, 0.58, (side * 0.285, 0, 1.12), robe, 8)
        cylinder("leg", 0.085, 0.60, (side * 0.11, 0, 0.38), dark, 8)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(side * 0.11, -0.065, 0.09))
        bpy.context.object.name = "boot"
        bpy.context.object.dimensions = (0.18, 0.31, 0.18)
        bpy.context.object.data.materials.append(dark)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.16, location=(0, 0, 1.59))
    bpy.context.object.name = "head"
    bpy.context.object.data.materials.append(skin)
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.22, radius2=0.09, depth=0.20, location=(0, 0, 1.79))
    bpy.context.object.name = "cap"
    bpy.context.object.data.materials.append(dark)
    export(filepath)


def walking_staff(filepath):
    clear()
    wood = material("dark wood", (0.36, 0.22, 0.11))
    metal = material("tip", (0.35, 0.37, 0.36))
    cylinder("staff", 0.055, 1.42, (0, 0, 0.76), wood, 8)
    cylinder("metal tip", 0.055, 0.08, (0, 0, 0.04), metal, 8)
    export(filepath)


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 1:
        raise SystemExit("expected output directory")
    directory = args[0]
    os.makedirs(directory, exist_ok=True)
    traveler(os.path.join(directory, "traveler-demo.glb"))
    walking_staff(os.path.join(directory, "staff-demo.glb"))


if __name__ == "__main__":
    main()
