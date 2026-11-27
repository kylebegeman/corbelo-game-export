@tool
extends GLTFDocumentExtension
## Wires the detail levels of a file of a pack to visibility ranges while Godot imports it.
##
## The files hold the lower levels as hidden nodes, since Godot has no rule for reading detail
## levels from a file. This shows each level and gives it the range of distances it is drawn
## at, so that one level is drawn at a time. It acts on a file only when a pack's manifest in
## the same folder lists it, and on nothing in a file but its detail levels.
##
## It takes two steps, since only this one knows which node of the file a level is, and Godot
## makes the nodes that are drawn after it: here each level is shown and its range is noted on
## its node, and `Ranges` below sets the noted range on the node Godot made of it.

const PackImporter := preload("pack_importer.gd")

## Metres of distance for each metre a level's outline is away from full detail. A level is
## drawn from its deviation times this: at 700 that is where the deviation is about one pixel
## on a screen 1080 pixels tall with a camera of 75 degrees.
const SETTING := "corbelo_game_export/detail_levels/distance_per_deviation"
const DEFAULT_DISTANCE := 700.0
## A level starts at least this many metres after the level before it.
const LEAST_STEP := 1.0
## The name of the note a level's node carries from one step to the other: a Vector2 of where
## the level starts and where it ends.
const NOTE := "corbelo_game_export_range"


func _import_post(state: GLTFState, root: Node) -> Error:
	if root == null:
		return OK
	var listing := PackImporter.listing(state.base_path, state.filename)
	if listing.is_empty():
		return OK
	var wired := 0
	for levels: Array in PackImporter.detail_levels(listing["entry"]):
		var begins := range_begins(levels)
		for at in levels.size():
			var node := state.get_scene_node(int(levels[at]["node"]))
			if node == null or not node is Node3D:
				continue
			(node as Node3D).visible = true
			node.set_meta(NOTE, Vector2(begins[at], begins[at + 1] if at + 1 < begins.size() else 0.0))
			wired += 1
	if wired > 0:
		root.set_meta(PackImporter.META, {"pack": listing["manifest"]["name"], "detail_levels": wired})
	return OK


## Where each level of one body starts to be drawn, in metres from the camera. Level 0 starts at 0.
static func range_begins(levels: Array) -> PackedFloat32Array:
	var per_meter := float(ProjectSettings.get_setting(SETTING, DEFAULT_DISTANCE))
	var begins := PackedFloat32Array()
	for at in levels.size():
		if at == 0:
			begins.append(0.0)
		else:
			begins.append(maxf(float(levels[at]["deviation"]) * per_meter, begins[at - 1] + LEAST_STEP))
	return begins


## The second step: sets each noted range on the node that is drawn, and takes the note away.
class Ranges:
	extends EditorScenePostImportPlugin

	func _post_process(scene: Node) -> void:
		_set_ranges(scene)

	func _set_ranges(node: Node) -> void:
		if node.has_meta(NOTE):
			var noted: Variant = node.get_meta(NOTE)
			node.remove_meta(NOTE)
			if noted is Vector2 and node is GeometryInstance3D:
				var drawn := node as GeometryInstance3D
				drawn.visibility_range_begin = noted.x
				drawn.visibility_range_end = noted.y
		for child in node.get_children():
			_set_ranges(child)
