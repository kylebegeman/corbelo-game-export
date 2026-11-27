# Does what `res://proof.json` asks in a Godot project, one step after another, and prints what
# it found as JSON. Run after `godot --headless --import`:
#   godot --headless --fixed-fps 60 --path <project> --script res://proof.gd
#
# The steps, each { "do": ... }:
#   scene     what a scene holds: nodes, meshes, materials, detail levels, collision shapes
#   edit      what a game does to a scene: a material override, an added child, then a save
#   material  changes the colour of a material file of the project
#   library   what a MeshLibrary holds
#   paint     paints cells of a GridMap scene and says where the meshes ended up
#   walk      walks a player through a scene, or through painted cells, on its collision
extends SceneTree

const BEGIN := "CORBELO_GAME_EXPORT_JSON_BEGIN"
const END := "CORBELO_GAME_EXPORT_JSON_END"
## Metres a second the player walks at.
const SPEED := 2.0
## Physics steps the player is given to land before it walks.
const SETTLE := 30

var _steps: Array = []
var _report: Array = []
## The walk in progress, or empty.
var _walk := {}


func _initialize() -> void:
	var request: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://proof.json"))
	_steps = request["steps"]


func _physics_process(_delta: float) -> bool:
	if not _walk.is_empty():
		_walk_on()
		return false
	if _steps.is_empty():
		print(BEGIN)
		print(JSON.stringify({"godot": Engine.get_version_info()["string"], "steps": _report}, "", false, true))
		print(END)
		return true
	var step: Dictionary = _steps.pop_front()
	match step["do"]:
		"scene":
			_report.append(_scene(step))
		"edit":
			_report.append(_edit(step))
		"material":
			_report.append(_material(step))
		"library":
			_report.append(_library(step))
		"paint":
			var grid := _paint(step)
			_report.append(_painted(grid))
			grid.free()
		"walk":
			_walk_start(step)
		_:
			_report.append({"error": "no such step: %s" % step["do"]})
	return false


func _scene(step: Dictionary) -> Dictionary:
	var packed := load(step["path"]) as PackedScene
	if packed == null:
		return {"error": "%s is not a scene" % step["path"]}
	var root := packed.instantiate()
	var nodes: Array = []
	_walk_nodes(root, root, nodes)
	var result := {"root": {"name": String(root.name), "class": root.get_class(), "meta": _mark(root)}, "nodes": nodes}
	root.free()
	return result


func _walk_nodes(root: Node, node: Node, out: Array) -> void:
	if node != root:
		var entry := {"name": String(node.name), "class": node.get_class(), "path": String(root.get_path_to(node))}
		if node is Node3D:
			entry["visible"] = (node as Node3D).visible
			entry["position"] = _vector(_from_root(root, node).origin)
		if node is MeshInstance3D:
			var instance := node as MeshInstance3D
			entry["range"] = [instance.visibility_range_begin, instance.visibility_range_end]
			entry["box"] = _box(_from_root(root, node) * instance.mesh.get_aabb())
			# The same number for two nodes that show one mesh.
			entry["mesh"] = instance.mesh.get_instance_id()
			var surfaces: Array = []
			for at in instance.mesh.get_surface_count():
				surfaces.append({"material": _material_of(instance.mesh.surface_get_material(at)), "override": _material_of(instance.get_surface_override_material(at))})
			entry["surfaces"] = surfaces
		if node is CollisionShape3D:
			var shape := (node as CollisionShape3D).shape
			entry["shape"] = shape.get_class() if shape != null else ""
			entry["body"] = node.get_parent().get_class()
		out.append(entry)
	for child in node.get_children():
		_walk_nodes(root, child, out)


func _material_of(material: Material) -> Variant:
	if material == null:
		return null
	var result := {"name": material.resource_name, "path": material.resource_path}
	if material is BaseMaterial3D:
		result["albedo"] = "#" + (material as BaseMaterial3D).albedo_color.to_html(false)
	return result


## Opens a scene as the editor does, changes it as a game would, and saves it.
func _edit(step: Dictionary) -> Dictionary:
	var packed := load(step["path"]) as PackedScene
	var root := packed.instantiate(PackedScene.GEN_EDIT_STATE_MAIN)
	var mesh := root.get_node(step["mesh"]) as MeshInstance3D
	var material := StandardMaterial3D.new()
	material.resource_name = "GameOverride"
	material.albedo_color = Color.html(step["albedo"])
	mesh.set_surface_override_material(int(step["surface"]), material)
	var child := Node3D.new()
	child.name = step["child"]
	child.position = Vector3(1, 2, 3)
	mesh.add_child(child)
	child.owner = root
	var scene := PackedScene.new()
	var saved := scene.pack(root)
	if saved == OK:
		saved = _save(scene, step["path"])
	root.free()
	return {"saved": saved == OK}


func _material(step: Dictionary) -> Dictionary:
	var material := load(step["path"]) as BaseMaterial3D
	material.albedo_color = Color.html(step["albedo"])
	return {"saved": _save(material, step["path"]) == OK}


## Saves over a file as the editor does: the file keeps its identifier. Outside the editor a
## save would give it a new one.
func _save(resource: Resource, path: String) -> Error:
	var id := ResourceLoader.get_resource_uid(path)
	var saved := ResourceSaver.save(resource, path)
	if saved == OK and id != ResourceUID.INVALID_ID:
		saved = ResourceSaver.set_uid(path, id)
	return saved


func _library(step: Dictionary) -> Dictionary:
	var library := load(step["path"]) as MeshLibrary
	if library == null:
		return {"error": "%s is not a mesh library" % step["path"]}
	var items: Array = []
	for id in library.get_item_list():
		var mesh := library.get_item_mesh(id)
		var shapes := library.get_item_shapes(id)
		var classes: Array = []
		var places: Array = []
		for at in range(0, shapes.size(), 2):
			classes.append((shapes[at] as Shape3D).get_class())
			places.append(_vector((shapes[at + 1] as Transform3D).origin))
		var materials: Array = []
		for at in mesh.get_surface_count():
			materials.append(_material_of(mesh.surface_get_material(at)))
		items.append({"id": id, "name": library.get_item_name(id), "box": _box(library.get_item_mesh_transform(id) * mesh.get_aabb()), "shapes": classes, "shapePlaces": places, "materials": materials})
	return {"items": items, "meta": _mark(library)}


## A GridMap scene with cells painted: each { "item": name, "cell": [x, y, z], "turn": quarter turns about +Y }.
func _paint(step: Dictionary) -> GridMap:
	var grid := (load(step["gridMap"]) as PackedScene).instantiate() as GridMap
	for cell: Dictionary in step["cells"]:
		var at := Vector3i(cell["cell"][0], cell["cell"][1], cell["cell"][2])
		var facing := grid.get_orthogonal_index_from_basis(Basis(Vector3.UP, int(cell["turn"]) * PI / 2.0))
		grid.set_cell_item(at, grid.mesh_library.find_item_by_name(cell["item"]), facing)
	return grid


func _painted(grid: GridMap) -> Dictionary:
	var boxes: Array = []
	var meshes := grid.get_meshes()
	for at in range(0, meshes.size(), 2):
		boxes.append(_box((meshes[at] as Transform3D) * (meshes[at + 1] as Mesh).get_aabb()))
	var cells: Array = []
	for cell in grid.get_used_cells():
		cells.append({"cell": [cell.x, cell.y, cell.z], "item": grid.mesh_library.get_item_name(grid.get_cell_item(cell))})
	return {"class": grid.get_class(), "name": String(grid.name), "cellSize": _vector(grid.cell_size), "cells": cells, "boxes": boxes}


## Puts the world and a player in the tree. The player is a CharacterBody3D with the capsule
## Godot makes by default: 0.5 m in radius and 2 m tall. Nothing else here collides.
func _walk_start(step: Dictionary) -> void:
	var world: Node3D = _paint(step) if step.has("gridMap") else (load(step["path"]) as PackedScene).instantiate() as Node3D
	root.add_child(world)
	var player := CharacterBody3D.new()
	var capsule := CollisionShape3D.new()
	capsule.shape = CapsuleShape3D.new()
	player.add_child(capsule)
	var shape := capsule.shape as CapsuleShape3D
	# `start` is where the feet are. A little above it, to land.
	player.position = Vector3(step["start"][0], step["start"][1], step["start"][2]) + Vector3(0, shape.height / 2.0 + 0.05, 0)
	root.add_child(player)
	_walk = {
		"world": world,
		"player": player,
		"half": shape.height / 2.0,
		"legs": step["legs"],
		"leg": -1,
		"left": SETTLE,
		"lowest": INF,
		"highest": -INF,
		"result": {"player": {"radius": shape.radius, "height": shape.height}, "bodies": world.find_children("*", "StaticBody3D", true, false).size(), "shapes": world.find_children("*", "CollisionShape3D", true, false).size(), "legs": []},
	}


## One physics step of the walk. A leg is { "direction": [x, z], "seconds": n }.
func _walk_on() -> void:
	var player: CharacterBody3D = _walk["player"]
	var leg: int = _walk["leg"]
	var across := Vector2.ZERO
	if leg >= 0:
		var direction: Array = _walk["legs"][leg]["direction"]
		across = Vector2(direction[0], direction[1]).normalized() * SPEED
	var fall := 0.0 if player.is_on_floor() else player.velocity.y - 9.8 * player.get_physics_process_delta_time()
	player.velocity = Vector3(across.x, fall, across.y)
	player.move_and_slide()
	var feet := player.position.y - float(_walk["half"])
	_walk["lowest"] = minf(_walk["lowest"], feet)
	_walk["highest"] = maxf(_walk["highest"], feet)
	_walk["left"] -= 1
	if _walk["left"] > 0:
		return
	if leg >= 0:
		_walk["result"]["legs"].append({"feet": [player.position.x, feet, player.position.z], "onFloor": player.is_on_floor(), "onWall": player.is_on_wall(), "lowest": _walk["lowest"], "highest": _walk["highest"]})
	else:
		_walk["result"]["landed"] = {"feet": [player.position.x, feet, player.position.z], "onFloor": player.is_on_floor()}
	_walk["lowest"] = INF
	_walk["highest"] = -INF
	leg += 1
	_walk["leg"] = leg
	if leg < _walk["legs"].size():
		_walk["left"] = int(round(float(_walk["legs"][leg]["seconds"]) * Engine.physics_ticks_per_second))
		return
	_report.append(_walk["result"])
	(_walk["world"] as Node).free()
	player.free()
	_walk = {}


## The mark the add-on leaves on what it makes, or null.
func _mark(object: Object) -> Variant:
	return object.get_meta("corbelo_game_export") if object.has_meta("corbelo_game_export") else null


## Where a node is, in the axes of the scene's root.
func _from_root(top: Node, node: Node) -> Transform3D:
	var place := Transform3D.IDENTITY
	var at := node
	while at != null and at != top:
		if at is Node3D:
			place = (at as Node3D).transform * place
		at = at.get_parent()
	return place


func _vector(value: Vector3) -> Array:
	return [value.x, value.y, value.z]


func _box(box: AABB) -> Dictionary:
	return {"min": _vector(box.position), "max": _vector(box.end)}
