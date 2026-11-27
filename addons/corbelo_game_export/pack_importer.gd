@tool
extends RefCounted
## Brings one pack written by corbelo-game-export up to date in a Godot project.
##
## A pack is a folder with a manifest, `<name>.pack.json`, and the GLB files it lists. Godot
## imports the GLB files itself: each becomes a scene, with a static body and a collision
## shape for every mesh the file names as collision. This adds, next to them:
##
## - `materials/<name>.tres` for each material of the pack, made once from what the file
##   holds. Each file's import settings are pointed at it, so the meshes use the project's
##   material from then on and a new revision of the pack does too.
## - `<asset>.tscn` for each file: a scene that inherits the imported one. It is made once and
##   never written again, so what the game changes or adds in it stays, and a new revision of
##   the file shows through it.
## - for a kit, `<name>.meshlib`, a MeshLibrary with an item for each piece (its mesh, its
##   collision shapes and its name), and `<name>_gridmap.tscn`, a GridMap at the kit's cell
##   size that uses it. The library is written again for each new revision and keeps the
##   number of every item, so what is painted stays. The GridMap scene is made once.
##
## Nothing else in the project is read or written.

const MANIFEST_SUFFIX := ".pack.json"
const MATERIALS_FOLDER := "materials"
## The name of the metadata this add-on leaves on what it makes.
const META := "corbelo_game_export"
## The engine profile a pack must be written for.
const PROFILE := "godot4"


## Every manifest under a folder of the project, in the order of their paths.
static func find_manifests(folder: String) -> PackedStringArray:
	var found := PackedStringArray()
	var dir := DirAccess.open(folder)
	if dir == null or dir.file_exists(".gdignore"):
		return found
	var names := dir.get_files()
	names.sort()
	for name in names:
		if name.ends_with(MANIFEST_SUFFIX):
			found.append(folder.path_join(name))
	var folders := dir.get_directories()
	folders.sort()
	for name in folders:
		if name.begins_with(".") or (folder == "res://" and name == "addons"):
			continue
		found.append_array(find_manifests(folder.path_join(name)))
	return found


## Reads a manifest. Empty when the file is not a manifest of a pack.
static func read_manifest(path: String) -> Dictionary:
	var json := JSON.new()
	if json.parse(FileAccess.get_file_as_string(path)) != OK or not json.data is Dictionary:
		return {}
	var manifest: Dictionary = json.data
	if int(manifest.get("schema", 0)) != 1 or not manifest.get("name") is String or not manifest.get("files") is Array:
		return {}
	return manifest


## Every file a manifest lists: the assets, then the scenes of a kit's layouts.
static func entries(manifest: Dictionary) -> Array:
	var all: Array = []
	all.append_array(manifest["files"])
	if manifest.get("scenes") is Array:
		all.append_array(manifest["scenes"])
	return all


## The manifest in `folder` that lists the GLB file named `file` without its ending, and the
## entry it has for it: { "manifest", "entry" }. Empty when no manifest there lists it.
static func listing(folder: String, file: String) -> Dictionary:
	var dir := DirAccess.open(folder)
	if dir == null:
		return {}
	for name in dir.get_files():
		if not name.ends_with(MANIFEST_SUFFIX):
			continue
		var manifest := read_manifest(folder.path_join(name))
		if manifest.is_empty() or manifest.get("profile", "") != PROFILE:
			continue
		for entry: Dictionary in entries(manifest):
			if str(entry.get("name", "")).get_basename() == file:
				return {"manifest": manifest, "entry": entry}
	return {}


## The detail levels a manifest's entry for one file states: for each body that has lower
## levels, its levels from full detail down, each { "node", "deviation" } with the number of
## the node in the file and how far, in metres, the level's outline is from full detail.
static func detail_levels(entry: Dictionary) -> Array:
	var groups: Array = []
	var facts: Dictionary = entry.get("facts", {})
	# An asset states the levels of each body.
	for body: Dictionary in facts.get("bodies", []):
		var levels: Array = body.get("lods", [])
		if levels.size() > 1:
			groups.append(levels.map(func(level: Dictionary) -> Dictionary: return {"node": level["node"], "deviation": level["deviation"]["meters"]}))
	# A scene of a layout states them for each body in each place.
	for group: Dictionary in facts.get("lods", []):
		var levels: Array = group.get("levels", [])
		if levels.size() > 1:
			groups.append(levels.map(func(level: Dictionary) -> Dictionary: return {"node": level["node"], "deviation": level["deviationMeters"]}))
	return groups


## Brings one pack up to date and says what was done:
## { "pack", "materials", "reimported", "scenes", "library", "grid_map", "waiting", "errors" }.
## The first three list paths, `library` and `grid_map` are a path or "", `waiting` lists files
## Godot has not imported yet, and `errors` says what could not be done. With `rebuild` the
## mesh library is written again even when the manifest is the one it was built from.
static func import_pack(manifest_path: String, rebuild: bool = false) -> Dictionary:
	var report := {"pack": manifest_path.get_file().trim_suffix(MANIFEST_SUFFIX), "materials": [], "reimported": [], "scenes": [], "library": "", "grid_map": "", "waiting": [], "errors": []}
	var manifest := read_manifest(manifest_path)
	if manifest.is_empty():
		report["errors"].append("it is not a pack manifest of corbelo-game-export")
		return report
	report["pack"] = manifest["name"]
	if manifest.get("profile", "") != PROFILE:
		report["errors"].append("the pack was written for the profile \"%s\", and only \"%s\" packs are imported" % [manifest.get("profile", ""), PROFILE])
		return report
	var folder := manifest_path.get_base_dir()
	var ready: Array = []
	for entry: Dictionary in entries(manifest):
		var path := folder.path_join(str(entry["name"]))
		if not FileAccess.file_exists(path):
			report["errors"].append("%s is listed and is not in the folder" % entry["name"])
		elif not FileAccess.file_exists(path + ".import") or not ResourceLoader.exists(path):
			report["waiting"].append(path)
		else:
			ready.append(entry)
	if not report["waiting"].is_empty():
		# Godot has not imported every file yet. It says so when it has.
		return report

	var material_paths := _make_materials(folder, manifest, report)
	var again := _point_at_materials(folder, manifest, ready, material_paths, report)
	if not again.is_empty():
		EditorInterface.get_resource_filesystem().reimport_files(again)
		report["reimported"].append_array(again)
	_make_scenes(folder, ready, report)
	if manifest.get("kind", "") == "kit" and manifest.get("kit") is Dictionary:
		_update_library(folder, manifest, FileAccess.get_sha256(manifest_path), rebuild, report)
	return report


## Tells the editor about a file made just now, so that it can be found by its path and by its
## identifier before the editor next looks through the project.
static func _made(path: String) -> void:
	EditorInterface.get_resource_filesystem().update_file(path)
	var id := ResourceLoader.get_resource_uid(path)
	if id != ResourceUID.INVALID_ID and not ResourceUID.has_id(id):
		ResourceUID.add_id(id, path)


## One line about what a report says was done, or "" when nothing was.
static func summary(report: Dictionary) -> String:
	var parts := PackedStringArray()
	for part: Array in [["materials", "material", "made"], ["reimported", "file", "imported again"], ["scenes", "scene", "made"]]:
		var count: int = report[part[0]].size()
		if count > 0:
			parts.append("%d %s%s %s" % [count, part[1], "" if count == 1 else "s", part[2]])
	if report["library"] != "":
		parts.append("mesh library written")
	if report["grid_map"] != "":
		parts.append("grid map scene made")
	return ", ".join(parts)


## The names of the materials one file uses.
static func _materials_of(manifest: Dictionary, entry: Dictionary) -> PackedStringArray:
	var names := PackedStringArray()
	var facts: Dictionary = entry.get("facts", {})
	# An asset states its materials. A scene of a layout uses the materials of its pieces.
	var stated: Array = facts["materials"] if facts.get("materials") is Array else manifest.get("materials", [])
	for material: Dictionary in stated:
		names.append(str(material["name"]))
	return names


## Makes `materials/<name>.tres` for each material of the pack that has none: the material a
## file of the pack holds, as Godot imported it. Returns the path for each material name.
static func _make_materials(folder: String, manifest: Dictionary, report: Dictionary) -> Dictionary:
	var paths := {}
	for listed: Dictionary in manifest.get("materials", []):
		var name := str(listed["name"])
		var path := folder.path_join(MATERIALS_FOLDER).path_join(name.validate_filename() + ".tres")
		paths[name] = path
		if FileAccess.file_exists(path):
			continue
		var material := _imported_material(folder, listed)
		if material == null:
			# No file shows it: the colour the manifest states, as Godot's importer would set it.
			var factor: Array = listed.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0])
			var standard := StandardMaterial3D.new()
			standard.albedo_color = Color(factor[0], factor[1], factor[2], factor[3]).linear_to_srgb()
			if float(factor[3]) < 1.0:
				standard.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			material = standard
		material.resource_name = name
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		var saved := ResourceSaver.save(material, path)
		if saved == OK:
			_made(path)
			report["materials"].append(path)
		else:
			report["errors"].append("%s could not be written (%s)" % [path, error_string(saved)])
	return paths


## A copy of a material as a file of the pack holds it, or null when no imported file shows it.
static func _imported_material(folder: String, listed: Dictionary) -> Material:
	for file: String in listed.get("files", []):
		var packed := ResourceLoader.load(folder.path_join(file), "PackedScene") as PackedScene
		if packed == null:
			continue
		var root := packed.instantiate()
		var found: Material = null
		for node in root.find_children("*", "MeshInstance3D", true, false):
			var mesh := (node as MeshInstance3D).mesh
			for surface in (mesh.get_surface_count() if mesh != null else 0):
				var material := mesh.surface_get_material(surface)
				if material != null and material.resource_name == listed["name"]:
					found = material.duplicate()
					break
			if found != null:
				break
		root.free()
		if found != null:
			return found
	return null


## Points the import settings of each file at the project's materials, where a material has no
## setting of its own yet or its file was made just now. Returns the files Godot has to import
## again: the ones whose settings changed, and the ones with detail levels that were imported
## while this add-on was off.
static func _point_at_materials(folder: String, manifest: Dictionary, ready: Array, material_paths: Dictionary, report: Dictionary) -> PackedStringArray:
	var again := PackedStringArray()
	for entry: Dictionary in ready:
		var path := folder.path_join(str(entry["name"]))
		var config := ConfigFile.new()
		if config.load(path + ".import") != OK:
			report["errors"].append("%s.import could not be read" % path)
			continue
		var subresources: Dictionary = (config.get_value("params", "_subresources", {}) as Dictionary).duplicate(true)
		var materials: Dictionary = subresources.get("materials", {})
		var changed := false
		for name in _materials_of(manifest, entry):
			var material_path := str(material_paths.get(name, ""))
			if material_path == "" or not FileAccess.file_exists(material_path):
				continue
			var settings: Dictionary = materials.get(name, {})
			var made_now: bool = report["materials"].has(material_path)
			if settings.get("use_external/enabled", false):
				var used := _setting_path(settings)
				if used != "" and not (used == material_path and made_now):
					if str(settings.get("use_external/path", "")) == used or _id_is_known(str(settings.get("use_external/path", ""))):
						# The project's own choice, or ours from before.
						continue
					# The file is there under another identifier than the setting has: point at it again.
					material_path = used
			settings["use_external/enabled"] = true
			settings["use_external/path"] = material_path
			settings.erase("use_external/fallback_path")
			materials[name] = settings
			changed = true
		if changed:
			subresources["materials"] = materials
			config.set_value("params", "_subresources", subresources)
			var saved := config.save(path + ".import")
			if saved != OK:
				report["errors"].append("%s.import could not be written (%s)" % [path, error_string(saved)])
				continue
		if changed or (not detail_levels(entry).is_empty() and not _is_wired(path)):
			again.append(path)
	return again


## The file an import setting for a material points at, or "" when it points at nothing that
## is there. Godot keeps the setting as an identifier, with the path beside it.
static func _setting_path(settings: Dictionary) -> String:
	var path := str(settings.get("use_external/path", ""))
	if path.begins_with("uid://"):
		path = ResourceUID.get_id_path(ResourceUID.text_to_id(path)) if _id_is_known(path) else str(settings.get("use_external/fallback_path", ""))
	return path if path != "" and FileAccess.file_exists(path) else ""


## Whether an identifier, as text, is one of a file of the project.
static func _id_is_known(text: String) -> bool:
	return text.begins_with("uid://") and ResourceUID.has_id(ResourceUID.text_to_id(text))


## Whether an imported scene carries the mark detail_levels.gd leaves when it wires levels.
static func _is_wired(path: String) -> bool:
	var packed := ResourceLoader.load(path, "PackedScene") as PackedScene
	if packed == null:
		return false
	var state := packed.get_state()
	for at in state.get_node_property_count(0):
		if state.get_node_property_name(0, at) == "metadata/" + META:
			return true
	return false


## Makes `<file>.tscn` for each file that has none: a scene that inherits the imported one,
## and states nothing of its own yet.
static func _make_scenes(folder: String, ready: Array, report: Dictionary) -> void:
	for entry: Dictionary in ready:
		var path := folder.path_join(str(entry["name"]))
		var scene_path := path.get_basename() + ".tscn"
		if FileAccess.file_exists(scene_path):
			continue
		var packed := ResourceLoader.load(path, "PackedScene") as PackedScene
		if packed == null or packed.get_state().get_node_count() == 0:
			report["errors"].append("%s did not import as a scene" % path)
			continue
		var base := "path=\"%s\"" % path
		var base_id := ResourceLoader.get_resource_uid(path)
		if base_id != ResourceUID.INVALID_ID:
			base = "uid=\"%s\" %s" % [ResourceUID.id_to_text(base_id), base]
		# The text Godot itself saves for a new inherited scene. It keeps the root's name.
		var text := "[gd_scene format=3 uid=\"%s\"]\n\n[ext_resource type=\"PackedScene\" %s id=\"1_pack\"]\n\n[node name=\"%s\" instance=ExtResource(\"1_pack\")]\n" % [ResourceUID.id_to_text(ResourceUID.create_id()), base, str(packed.get_state().get_node_name(0)).c_escape()]
		var file := FileAccess.open(scene_path, FileAccess.WRITE)
		if file == null:
			report["errors"].append("%s could not be written (%s)" % [scene_path, error_string(FileAccess.get_open_error())])
			continue
		file.store_string(text)
		file.close()
		_made(scene_path)
		report["scenes"].append(scene_path)


## Writes the kit's MeshLibrary when the manifest is not the one it was built from, and makes
## the GridMap scene when there is none.
static func _update_library(folder: String, manifest: Dictionary, digest: String, rebuild: bool, report: Dictionary) -> void:
	var listed: Dictionary = manifest["kit"].get("meshLibrary", {})
	var size: Array = listed.get("cellSize", [1.0, 1.0, 1.0])
	var cell_size := Vector3(size[0], size[1], size[2])
	var path := folder.path_join(str(manifest["name"]) + ".meshlib")
	var library: MeshLibrary = null
	if FileAccess.file_exists(path):
		library = ResourceLoader.load(path, "MeshLibrary") as MeshLibrary
	var built: Variant = library.get_meta(META, {}) if library != null else {}
	if library == null or rebuild or not built is Dictionary or built.get("manifest_sha256", "") != digest:
		if library == null:
			library = MeshLibrary.new()
		for item: Dictionary in listed.get("items", []):
			var file := folder.path_join(str(item["file"]))
			var packed := ResourceLoader.load(file, "PackedScene") as PackedScene
			if packed == null:
				report["errors"].append("%s did not import as a scene, so the library has no item for it" % file)
				continue
			var root := packed.instantiate() as Node3D
			var mesh := _item_mesh(root)
			if mesh.is_empty():
				report["errors"].append("%s shows no mesh, so the library has no item for it" % file)
				root.free()
				continue
			# An item's own origin is the middle of its cell. The piece's origin is this far from it.
			var offset := Transform3D(Basis.IDENTITY, Vector3(item["offset"][0], item["offset"][1], item["offset"][2]))
			# An item keeps its number for as long as it keeps its name, so what is painted stays.
			var id := library.find_item_by_name(str(item["name"]))
			if id < 0:
				id = int(item["id"])
				if library.get_item_list().has(id):
					id = library.get_last_unused_item_id()
				library.create_item(id)
				library.set_item_name(id, str(item["name"]))
			library.set_item_mesh(id, mesh["mesh"])
			library.set_item_mesh_transform(id, offset * (mesh["transform"] as Transform3D))
			var shapes: Array = []
			for node in root.find_children("*", "CollisionShape3D", true, false):
				var shape := (node as CollisionShape3D).shape
				if shape != null:
					shapes.append(shape)
					shapes.append(offset * _from_root(root, node))
			library.set_item_shapes(id, shapes)
			root.free()
		library.set_meta(META, {"pack": manifest["name"], "manifest_sha256": digest, "cell_size": cell_size})
		var saved := ResourceSaver.save(library, path)
		if saved == OK:
			_made(path)
			report["library"] = path
		else:
			report["errors"].append("%s could not be written (%s)" % [path, error_string(saved)])
			return

	var grid_path := folder.path_join(str(manifest["name"]) + "_gridmap.tscn")
	if FileAccess.file_exists(grid_path):
		if report["library"] != "":
			var cells := _grid_cell_size(grid_path)
			if cells != Vector3.ZERO and not cells.is_equal_approx(cell_size):
				report["errors"].append("%s has cells of %s and the kit now has cells of %s: set the GridMap's cell size to paint this revision" % [grid_path, cells, cell_size])
		return
	var grid := GridMap.new()
	grid.name = str(manifest["name"]).to_pascal_case() + "GridMap"
	grid.mesh_library = ResourceLoader.load(path, "MeshLibrary") as MeshLibrary
	grid.cell_size = cell_size
	var scene := PackedScene.new()
	var packed_grid := scene.pack(grid)
	grid.free()
	if packed_grid == OK:
		packed_grid = ResourceSaver.save(scene, grid_path)
	if packed_grid == OK:
		_made(grid_path)
		report["grid_map"] = grid_path
	else:
		report["errors"].append("%s could not be written (%s)" % [grid_path, error_string(packed_grid)])


## The cell size the GridMap at the root of a scene has, or zero when it cannot be read.
static func _grid_cell_size(path: String) -> Vector3:
	var packed := ResourceLoader.load(path, "PackedScene") as PackedScene
	if packed == null or packed.get_state().get_node_count() == 0 or packed.get_state().get_node_type(0) != &"GridMap":
		return Vector3.ZERO
	var state := packed.get_state()
	for at in state.get_node_property_count(0):
		if state.get_node_property_name(0, at) == &"cell_size":
			return state.get_node_property_value(0, at)
	# Not stored: Godot's own default.
	return Vector3(2, 2, 2)


## What a piece shows at full detail, as one mesh: { "mesh", "transform" }. Empty when it shows
## nothing. A piece of one body gives its mesh as it is. A piece of several gives one mesh made
## of them all, a surface for each of theirs.
static func _item_mesh(root: Node3D) -> Dictionary:
	var shown: Array[MeshInstance3D] = []
	for node in root.find_children("*", "MeshInstance3D", true, false):
		var instance := node as MeshInstance3D
		# A lower detail level starts to be drawn at a distance. An item is the full detail.
		if instance.mesh != null and instance.visible and instance.visibility_range_begin <= 0.0:
			shown.append(instance)
	if shown.is_empty():
		return {}
	if shown.size() == 1:
		return {"mesh": shown[0].mesh, "transform": _from_root(root, shown[0])}
	var merged := ArrayMesh.new()
	for instance in shown:
		var place := _from_root(root, instance)
		for surface in instance.mesh.get_surface_count():
			var tool := SurfaceTool.new()
			tool.append_from(instance.mesh, surface, place)
			tool.commit(merged)
			merged.surface_set_material(merged.get_surface_count() - 1, instance.mesh.surface_get_material(surface))
	return {"mesh": merged, "transform": Transform3D.IDENTITY}


## Where a node is, in the axes of the scene's root.
static func _from_root(root: Node, node: Node) -> Transform3D:
	var place := Transform3D.IDENTITY
	var at := node
	while at != null and at != root:
		if at is Node3D:
			place = (at as Node3D).transform * place
		at = at.get_parent()
	return place
