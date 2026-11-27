@tool
extends EditorPlugin
## Imports packs written by corbelo-game-export, and does nothing else.
##
## A pack is a folder that holds a manifest, `<name>.pack.json`, and the GLB files it lists.
## Whenever the project's files change, every pack is brought up to date: see pack_importer.gd
## for what that means. A pack that is already up to date costs a few file checks.

const PackImporter := preload("pack_importer.gd")
const DetailLevels := preload("detail_levels.gd")
const MENU_ITEM := "Import Corbelo Packs Again"

var _detail_levels: GLTFDocumentExtension
var _ranges: EditorScenePostImportPlugin
## Manifest path to the SHA-256 it had when its pack was last brought up to date.
var _done := {}
## Manifest paths of packs whose files Godot imported again since.
var _stale := {}
var _busy := false


func _enter_tree() -> void:
	if not ProjectSettings.has_setting(DetailLevels.SETTING):
		ProjectSettings.set_setting(DetailLevels.SETTING, DetailLevels.DEFAULT_DISTANCE)
	ProjectSettings.set_initial_value(DetailLevels.SETTING, DetailLevels.DEFAULT_DISTANCE)
	ProjectSettings.add_property_info({"name": DetailLevels.SETTING, "type": TYPE_FLOAT, "hint": PROPERTY_HINT_RANGE, "hint_string": "1,100000,1,or_greater"})
	# Registered before Godot imports anything, so the first import of a file is already wired.
	_detail_levels = DetailLevels.new()
	GLTFDocument.register_gltf_document_extension(_detail_levels)
	_ranges = DetailLevels.Ranges.new()
	add_scene_post_import_plugin(_ranges)
	var files := EditorInterface.get_resource_filesystem()
	files.resources_reimported.connect(_on_resources_reimported)
	files.filesystem_changed.connect(_on_filesystem_changed)
	add_tool_menu_item(MENU_ITEM, _import_again)
	# Turned on in an editor that is already open, nothing else says when to look.
	_import_packs.call_deferred(false)


func _exit_tree() -> void:
	remove_tool_menu_item(MENU_ITEM)
	var files := EditorInterface.get_resource_filesystem()
	files.resources_reimported.disconnect(_on_resources_reimported)
	files.filesystem_changed.disconnect(_on_filesystem_changed)
	remove_scene_post_import_plugin(_ranges)
	_ranges = null
	GLTFDocument.unregister_gltf_document_extension(_detail_levels)
	_detail_levels = null


func _on_resources_reimported(paths: PackedStringArray) -> void:
	if _busy:
		return
	for manifest: String in _done:
		var folder := manifest.get_base_dir() + "/"
		for path in paths:
			if path.begins_with(folder):
				_stale[manifest] = true
				break


func _on_filesystem_changed() -> void:
	_import_packs(false)


func _import_again() -> void:
	_import_packs(true)


## Brings every pack of the project up to date. With `again`, also the ones already done.
func _import_packs(again: bool) -> void:
	# While the editor looks through the project, wait: it says when it is done.
	if _busy or EditorInterface.get_resource_filesystem().is_scanning():
		return
	_busy = true
	for manifest in PackImporter.find_manifests("res://"):
		var digest := FileAccess.get_sha256(manifest)
		if not again and _done.get(manifest, "") == digest and not _stale.has(manifest):
			continue
		var report := PackImporter.import_pack(manifest, again or _stale.has(manifest))
		_stale.erase(manifest)
		for problem: String in report["errors"]:
			push_warning("Corbelo Game Export: %s: %s" % [manifest, problem])
		if report["waiting"].is_empty():
			_done[manifest] = digest
		var did := PackImporter.summary(report)
		if did != "":
			print("Corbelo Game Export: %s: %s" % [report["pack"], did])
	_busy = false
