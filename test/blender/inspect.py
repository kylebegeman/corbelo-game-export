# Runs inside Blender with no window: imports each GLB named after "--" into an empty scene
# and prints one JSON report of what Blender ended up with, between two marker lines.
#
# Blender's importer turns glTF's +Y up into Blender's +Z up: glTF (x, y, z) arrives as
# (x, -z, y). The numbers below are Blender's own, in world space, with nothing converted back.
import json
import sys

import bpy

BEGIN = "CORBELO_GAME_EXPORT_JSON_BEGIN"
END = "CORBELO_GAME_EXPORT_JSON_END"


def inspect(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    nodes = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        world = obj.matrix_world
        rotation = world.to_3x3()
        points = [world @ vertex.co for vertex in mesh.vertices]
        lows = [min(point[axis] for point in points) for axis in range(3)]
        highs = [max(point[axis] for point in points) for axis in range(3)]
        centre = [(lows[axis] + highs[axis]) / 2 for axis in range(3)]
        triangles = []
        for triangle in mesh.loop_triangles:
            corners = [points[index] for index in triangle.vertices]
            # The facing direction from the winding Blender holds, counter-clockwise from outside.
            facing = (corners[1] - corners[0]).cross(corners[2] - corners[0])
            middle = (corners[0] + corners[1] + corners[2]) / 3
            normals = [list(rotation @ mesh.corner_normals[loop].vector) for loop in triangle.loops]
            triangles.append(
                {
                    "facing": list(facing),
                    "middle": list(middle),
                    "corners": [list(corner) for corner in corners],
                    "normals": normals,
                    # The material slot of the object this triangle is drawn with.
                    "material": triangle.material_index,
                }
            )
        materials = []
        for material in mesh.materials:
            shader = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
            entry = {"name": material.name}
            if shader is not None:
                entry["baseColor"] = list(shader.inputs["Base Color"].default_value)
                entry["metallic"] = shader.inputs["Metallic"].default_value
                entry["roughness"] = shader.inputs["Roughness"].default_value
            materials.append(entry)
        nodes.append(
            {
                "name": obj.name,
                "meshName": mesh.name,
                "location": list(world.translation),
                "vertexCount": len(mesh.vertices),
                "triangleCount": len(mesh.loop_triangles),
                "min": lows,
                "max": highs,
                "centre": centre,
                "triangles": triangles,
                "materials": materials,
            }
        )
    return {"nodes": nodes}


def main():
    paths = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    report = {"blender": bpy.app.version_string, "files": {}}
    for path in paths:
        name = path.replace("\\", "/").split("/")[-1]
        try:
            report["files"][name] = inspect(path)
        except Exception as error:  # reported to the test, which fails on it
            report["files"][name] = {"error": str(error), "nodes": []}
    print(BEGIN + json.dumps(report) + END)


main()
