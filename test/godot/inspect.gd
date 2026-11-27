# Loads scenes the editor importer produced and prints what Godot ended up with as JSON.
# Run after `godot --headless --import`:
#   godot --headless --path <project> --script res://inspect.gd -- block.glb cylinder.glb
extends SceneTree


func _init() -> void:
	var report := {"godot": Engine.get_version_info()["string"], "files": {}}
	for file in OS.get_cmdline_user_args():
		report["files"][file] = _inspect_file("res://" + file)
	print("CORBELO_GAME_EXPORT_JSON_BEGIN")
	print(JSON.stringify(report, "", false, true))
	print("CORBELO_GAME_EXPORT_JSON_END")
	quit()


func _inspect_file(path: String) -> Dictionary:
	# A .glb only loads as a PackedScene when the editor importer has imported it.
	var packed := load(path) as PackedScene
	if packed == null:
		return {"error": "not imported as a scene"}
	var root := packed.instantiate()
	var nodes: Array = []
	_walk(root, root, nodes)
	var result := {"root": {"name": String(root.name), "class": root.get_class()}, "nodes": nodes}
	root.free()
	return result


func _walk(root: Node, node: Node, out: Array) -> void:
	if node != root:
		var entry := {"name": String(node.name), "class": node.get_class(), "path": String(root.get_path_to(node))}
		if node.get_parent() != root:
			entry["parent"] = String(root.get_path_to(node.get_parent()))
		if node is Node3D:
			var spatial := node as Node3D
			entry["position"] = _vector(spatial.position)
			# The node's own +Z axis, in its parent's axes.
			entry["zAxis"] = _vector(spatial.basis.z)
			entry["visible"] = spatial.visible
		if node is MeshInstance3D:
			entry["mesh"] = _inspect_mesh((node as MeshInstance3D).mesh)
		if node is CollisionShape3D:
			entry["shape"] = _inspect_shape((node as CollisionShape3D).shape)
		out.append(entry)
	for child in node.get_children():
		_walk(root, child, out)


func _inspect_mesh(mesh: Mesh) -> Dictionary:
	var aabb := mesh.get_aabb()
	var surfaces: Array = []
	for index in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(index)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals = arrays[Mesh.ARRAY_NORMAL]
		var indices = arrays[Mesh.ARRAY_INDEX]
		var surface := {
			"vertexCount": vertices.size(),
			"triangleCount": (indices.size() if indices != null else vertices.size()) / 3,
			"hasNormals": normals != null and normals.size() == vertices.size(),
			"vertices": _vectors(vertices),
			"normals": _vectors(normals) if normals != null else [],
			"indices": Array(indices) if indices != null else [],
		}
		var uvs = arrays[Mesh.ARRAY_TEX_UV]
		if uvs != null:
			var flat: Array = []
			for uv in uvs:
				flat.append_array([uv.x, uv.y])
			surface["uvs"] = flat
		var tangents = arrays[Mesh.ARRAY_TANGENT]
		if tangents != null:
			surface["tangents"] = Array(tangents)
		var material := mesh.surface_get_material(index) as BaseMaterial3D
		if material != null:
			surface["material"] = {
				"name": material.resource_name,
				"albedo": "#" + material.albedo_color.to_html(false),
				"metallic": material.metallic,
				"roughness": material.roughness,
			}
		surfaces.append(surface)
	return {
		"name": mesh.resource_name,
		"aabbPosition": _vector(aabb.position),
		"aabbSize": _vector(aabb.size),
		"surfaces": surfaces,
	}


func _inspect_shape(shape: Shape3D) -> Dictionary:
	if shape == null:
		return {"class": ""}
	var result := {"class": shape.get_class()}
	if shape is ConvexPolygonShape3D:
		result["points"] = _vectors((shape as ConvexPolygonShape3D).points)
	if shape is BoxShape3D:
		result["size"] = _vector((shape as BoxShape3D).size)
	if shape is ConcavePolygonShape3D:
		result["faces"] = _vectors((shape as ConcavePolygonShape3D).get_faces())
	return result


func _vector(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


func _vectors(values: PackedVector3Array) -> Array:
	var out: Array = []
	for value in values:
		out.append_array([value.x, value.y, value.z])
	return out
