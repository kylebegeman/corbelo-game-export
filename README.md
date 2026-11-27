# corbelo-game-export

Turns exact CAD bodies into one game-engine-ready GLB file, plus a set of facts computed from the geometry that was written.

It takes triangles as a CAD kernel tessellates them (often triangle soup, in millimetres, with Z up) and writes a glTF 2.0 binary that a game engine imports cleanly: metres, Y up, welded and indexed, with hard and soft edges in the right places, sensible pivots, one named node per body and one material per colour. A body may have one colour or a colour on each of its faces.

On request it also writes what a game needs around the mesh: a collision shape named the way the engine reads it, lower detail levels, texture coordinates and attach points. It checks the result against a budget and against the engine's own player, and packs one asset or a family of them with a manifest.

It also makes kits: pieces that share a grid and meet at sockets, with seven checks on the kit as a whole, a scene for a layout of the pieces, and what a grid of tiles needs. A small [add-on for Godot](#godot-add-on) imports a pack into a project, and [`install`](#installing-into-a-game-project) puts a pack into any game project and records it in a lock file.

| Function | What it does |
| --- | --- |
| [`exportGameGlb`](#use) | The plain export: one GLB and its facts. |
| [`exportGameAsset`](#game-assets) | The same, with collision, detail levels, texture coordinates and attach points. |
| [`checkGameAsset`](#game-checks) | Twelve checks on a GLB this package wrote: pass, warn, fail or not measured, with the numbers. |
| [`exportGamePack`](#packs) | One asset or a family of them: the GLBs and a JSON manifest, and a ZIP archive of both. |
| [`checkKit`](#kit-checks) | Seven checks on a kit of pieces: on the grid, seams, cells, layouts, corners, walkable, collision. |
| [`exportKitPack`](#kit-packs) | A kit as a pack: a GLB for each piece, a scene for each layout, and the manifest. |
| [`exportBlockout`](#blockouts) | A layout of kit pieces as one scene, each mesh stored once. |
| [`planInstall`](#installing-into-a-game-project) | What installing a pack into a game project writes, takes away and records. |

It is used by Corbelo and Corbelo Studio. It has no runtime dependencies and runs in Node 22 or later and in browsers. A bundler leaves out what you do not import: the plain export alone is about 32 kB minified (about 12 kB gzipped). See [Size in a browser bundle](#size-in-a-browser-bundle).

## Install

The built `dist/` folder is committed, so the package installs straight from a git tag with no build step:

```sh
npm install github:kylebegeman/corbelo-game-export#v0.1.7
```

Where the build machine has no `git` program, install the tag's tarball instead. The lock file then holds a plain HTTPS address and a checksum:

```sh
npm install https://github.com/kylebegeman/corbelo-game-export/archive/refs/tags/v0.1.7.tar.gz
```

## Use

```ts
import { exportGameGlb } from "corbelo-game-export";

const { glb, facts } = exportGameGlb({
  bodies: [
    { name: "Left Wall", positions, color: "#d98a3d" },
    { name: "Lid", positions: lidPositions, indices: lidIndices, color: [0.16, 0.5, 0.73], faceIds },
  ],
  source: { unit: 0.001, up: "Z" },
  profile: "godot4",
  pivot: "base-center",
});
```

`glb` is a `Uint8Array` holding the file. `facts` is plain JSON describing what is in it.

### Bodies

| Field | Meaning |
| --- | --- |
| `name` | Required. Becomes the node and mesh name once made safe and unique. |
| `positions` | Required. `x, y, z` per vertex, as a `Float32Array` or any array of numbers. |
| `indices` | Optional. Three vertex numbers per triangle. Without it, every three vertices make one triangle. |
| `color` | Optional. `"#rrggbb"`, `"#rgb"` or `[r, g, b]` with channels from 0 to 1. Default `#cccccc`. |
| `materialName` | Optional. Names the material of the body's own colour. Without it the name comes from the colour. |
| `faceIds` | Optional. One whole number per triangle saying which exact CAD face it came from. |
| `faceColors` | Optional. One entry per triangle: that triangle's colour, written like `color`, or `null` or `undefined` for the body's own colour. See [Bodies with several colours](#bodies-with-several-colours). |
| `faceMaterialNames` | Optional. Names for the materials of face colours: `{ "#c0392b": "Signal Red" }`. See [Materials](#materials). |
| `refines` | Optional. The meshes the body's triangles were cut from, to take the shading from. See [A body cut from a coarser mesh](#a-body-cut-from-a-coarser-mesh). |

### Source space

`source` says how to read the positions:

- `unit`: metres per source unit. `0.001` for millimetres, `0.0254` for inches, `1` for metres.
- `up`: `"Y"` or `"Z"`.
- `handedness`: `"right"` (default) or `"left"`. A left-handed source is a mirror image of glTF's space. The export mirrors it back and reverses the triangle winding, so faces still point outwards.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `profile` | `"godot4"` | `"godot4"`, `"unity6"`, `"unreal5"` or your own profile object. See [Engine profiles](#engine-profiles). |
| `pivot` | `"base-center"` | Where each body's own origin goes. See [Pivots](#pivots). |
| `placement` | `"origin"` | `"origin"` puts every node at the scene origin. `"designed"` keeps each body where it was modelled. `"assembly"` keeps the bodies together and stands the whole set on the scene origin. |
| `creaseAngle` | `30` | Degrees. Edges sharper than this are hard. |
| `normals` | `"angle-area"` | `"angle-area"` or `"face-weighted"`. See [Normals](#normals). |
| `weldTolerance` | `0.000001` | Metres. Vertices closer than this become one. `0` welds only identical positions. |
| `maxTriangles` | `2000000` | The export is refused when all bodies together hold more triangles than this. The meshes given in `refines` are counted on their own, against the same number. |
| `colorSpace` | `"srgb"` | How `[r, g, b]` colours are read. Set `"linear"` if yours are linear light. Hex colours are always sRGB. |
| `provenance` | none | Any plain JSON. Stored untouched next to the facts inside the file. |

## What is in the GLB

- Valid glTF 2.0: metres, +Y up, right-handed, counter-clockwise front faces. The test suite runs the Khronos glTF validator over the output and expects no errors and no warnings. The validator leaves one note per mesh, that no texture uses the tangents; see [why there are tangents](#why-there-are-tangents).
- One node per body, with one mesh each, all direct children of one scene.
- One primitive per mesh for a body in one colour. A body with several colours has one primitive for each colour, which an engine shows as one mesh with a surface or material slot for each.
- Indexed triangles with `POSITION`, `NORMAL` and `TANGENT`. Indices are 16-bit when a primitive has at most 65,535 vertices, otherwise 32-bit.
- One material per distinct colour, shared between bodies: `baseColorFactor` in linear light, `metallicFactor` 0, `roughnessFactor` 0.8.
- `asset.generator` is `corbelo-game-export <version>`.
- `scenes[0].extras.corbeloGameExport` holds `{ schema, profile, facts, provenance }`.

`exportGameGlb` writes no textures, texture coordinates, vertex colours, collision shapes or detail levels. [`exportGameAsset`](#game-assets) adds collision shapes, detail levels, texture coordinates and attach points to the same file. Nothing here writes textures or vertex colours.

### Welding

Positions are converted to metres first, then vertices within `weldTolerance` of each other are merged. The earliest vertex in the input wins, so the result does not depend on anything but the input order.

### Degenerate triangles

A triangle is dropped when two of its corners weld to the same vertex, or when its area is so small against its longest edge that it has no usable direction (twice the area at most `1e-10` times the longest edge squared). The number dropped is reported in the facts. This is the only repair the package makes. A body whose triangles are all dropped is refused.

### Normals

An edge between two triangles is either soft (shaded smoothly across) or hard (a visible crease). Vertices are split along hard edges, so each side gets its own normal.

- Without `faceIds`: an edge is hard when the two triangles' normals differ by more than `creaseAngle`.
- With `faceIds`: an edge inside one face is always soft. An edge between two different faces is hard when the two triangles' normals differ by more than `creaseAngle`, and soft otherwise. This keeps a cylinder's side smooth however coarsely it is tessellated, while two faces that meet tangentially still blend.

An open edge and an edge shared by more than two triangles are always hard.

Each vertex normal is the weighted sum of the normals of the triangles around it:

- `"angle-area"` weights each triangle by its area times its angle at the vertex.
- `"face-weighted"` weights each triangle by its angle at the vertex times the area of the whole flat face it belongs to. Large flat faces then keep their shading flat and small bevels take up the change. A face is the set of triangles with the same face id, or, without ids, neighbouring triangles within 1 degree of each other.

### A body cut from a coarser mesh

Painting a body, cutting a hole into it or joining it to another cuts its triangles into smaller ones. The surface does not move, but the rules above would shade it differently afterwards, for two reasons. A new point inside a flat triangle of a round wall is surrounded by triangles that all lie in that one flat triangle, so it gets the flat triangle's direction, while the wall's old corners keep the round one. And the weights of a vertex normal depend on the triangles around it, so even the old corners move a little when their triangles change.

`refines` avoids both. The body says which meshes its triangles were cut from, and for each of its triangles which triangle of those meshes it lies in. The shading is then taken from those meshes, and the cut changes nothing about it.

```ts
exportGameGlb({
  bodies: [
    {
      name: "Post",
      positions: paintedPositions, // the mesh after the paint cut it
      faceColors,
      refines: {
        surfaces: [{ positions: uncutPositions, faceIds: uncutFaceIds }], // the mesh before
        triangleOf, // for each triangle of the body, the triangle of the uncut mesh it lies in
      },
    },
  ],
  source: { unit: 0.001, up: "Z" },
});
```

| Field | Meaning |
| --- | --- |
| `surfaces` | Required. One or more meshes, each with `positions` and optionally `indices` and `faceIds`, read like a body's and in the same units and axes. |
| `triangleOf` | Required. One whole number per triangle of the body: a triangle of its surface that it lies in, counted in that surface's own order. |
| `surfaceOf` | One whole number per triangle of the body: which of `surfaces` it lies in. Required with more than one surface. |

A cut does not always leave each new triangle inside one old one. Where the surface is flat across several of its triangles, a cut may divide that flat part afresh, and a triangle of the body then reaches across several triangles of the surface. It names any one of them that it touches, for instance the one under its middle.

A painted body has one surface: its mesh before the paint. A body with a hole cut into it has two: its own mesh before the cut, and the mesh of what cut it with every triangle turned over, so that it faces into the hole. A body joined from several has one for each.

How it is shaded:

- Each surface is welded and given its hard edges, soft edges and normals by itself, exactly as a body is, with the same `creaseAngle`, `normals` and `weldTolerance` and with its own `faceIds`.
- Every corner of every triangle of the body is found on its surface. The search starts in the triangle the body's triangle names and walks from there across the surface's soft edges for as long as that comes nearer to the corner, so a corner of a triangle that reaches across a flat part is found in the triangle it really lies in.
- A corner takes the normal the surface has at that point: the normals of the triangle it lies in, mixed by where in the triangle it is. A corner on a vertex of the surface gets that vertex's normal, number for number.
- A corner counts as on a vertex or on an edge of the surface when it is within `weldTolerance` of it. A cut leaves its points a rounding error off the edges they lie on, and the triangles on both sides of such an edge must still find the same place for them.
- Two corners at one point are written as one vertex where the surface is shaded smoothly there, and as two where it is not. So the surface's hard edges stay hard, an edge of the body that runs through the middle of a triangle of the surface is soft, and an edge between two surfaces is always hard.
- The body's own `faceIds` have no say in the shading when it has `refines`. Give the ids to the surfaces.

Welding, dropped triangles, `openEdges`, `nonManifoldEdges`, the triangle and vertex counts and the colours are still those of the body itself. Only its edges and normals come from the surfaces. The facts report it as `shadedFrom`.

A body that names itself as its only surface, with every triangle lying in itself, is written with the same vertex data as without `refines`.

**What is checked.** Every corner must be found on its surface to within a thousandth of the longest edge of the triangle it is found in, or twice `weldTolerance` where that is more. A body with a corner that is not is refused with `BAD_REFINEMENT`, and the message says which triangle and how far off it is. The search does not cross a hard edge of the surface, so a triangle that names one on the other side of a hard edge is refused too. A triangle that is dropped for having no area is not asked. Only the place is checked, not which way the triangle faces: naming the triangle on the far side of a wall thinner than that distance would turn the shading inside out.

### Pivots

The pivot is the point of the body that ends up at the node's own origin. Vertex data is stored relative to it.

| `pivot` | The point |
| --- | --- |
| `"base-center"` | Centre of the bottom of the body's bounding box. The body stands on its origin. |
| `"center"` | Centre of the bounding box. |
| `"min-corner"` | The bounding box corner with the lowest source coordinates. |
| `"origin"` | The source origin. Vertex data keeps its designed coordinates. |
| `[x, y, z]` | A point in source units and source axes. The same point is used for every body. |

With `placement: "origin"` every node sits at the scene origin, which is what you want for separate reusable parts. With `placement: "designed"` each node's translation is its pivot, so the bodies sit together as they were modelled.

With `placement: "assembly"` the bodies also sit together as modelled, and the whole set is moved so that its own pivot is at the scene origin. That pivot is chosen by the same `pivot` option, from the box around every body: with `"base-center"` a chair made of five bodies stands on the origin as one thing, wherever it was drawn. Each node's translation is its own pivot measured from the set's pivot, and the facts report the set's pivot as `assemblyPivot`. With `pivot: "origin"` this is the same as `"designed"`. With one body it is the same as `"origin"`.

### Names

Node and mesh names keep letters, digits, `_` and `-`. Accents are stripped, everything else becomes `_`, and names are cut to 60 characters. Names are made unique without regard to letter case by adding `_2`, `_3` and so on in input order. The same input always gives the same names.

Game engines read some names as instructions. Godot turns a mesh named `wall-col` into a collision shape, and Unreal reads `UCX_Wall` as a collision hull. A body must never be mistaken for one of these, so a name that starts or ends like one is changed: `wall-col` becomes `wall-col_body`, `UCX_Crate` becomes `body_UCX_Crate` and `part_LOD0` becomes `part_LOD0_body`. The name you gave is kept in the facts as `sourceName`.

### Materials

Colours are rounded to 8 bits per channel in sRGB, so `"#ff0000"`, `"#F00"` and `[1, 0, 0]` are one material. A material is named `color_rrggbb` unless you name it: `materialName` names the material of the body's own colour, and `faceMaterialNames` names the materials of the colours on its faces.

```ts
{ name: "Crate", positions, color: "#2980ba", materialName: "Sky Blue", faceColors, faceMaterialNames: { "#c0392b": "Signal Red" } }
```

`faceMaterialNames` is an object whose keys are colours, written `"#rrggbb"` or `"#rgb"`, and whose values are the names. The rules are those of `materialName`:

- A name is made safe the way a node name is: `Signal Red` becomes `Signal_Red`.
- One name means one colour. Using one material name with two different colours is refused, in one body or across bodies, whichever of the two fields the name came from.
- One colour has one name in a body. Two entries that spell the same colour differently must give it the same name, and an entry for the body's own colour names the body's own material, so it must agree with `materialName` where both are given.
- A face colour that is not listed is named after itself, `color_rrggbb`.
- Every entry is checked, also one for a colour that no triangle has. Such an entry writes no material.

The file holds each material once. Every body and every face of that colour uses the same one, whichever body it belongs to. Materials are listed in the order they are first used: body by body, and inside a body in the order of its primitives.

### Bodies with several colours

`faceColors` gives a body a colour per triangle. It is a list with exactly one entry for each triangle of the input, in the input's order: a colour written like `color`, or `null` or `undefined` for the body's own colour.

```ts
exportGameGlb({
  bodies: [{ name: "Crate", positions, color: "#2980ba", faceColors: ["#c0392b", "#c0392b", null, null /* one per triangle */] }],
  source: { unit: 0.001, up: "Z" },
});
```

The body is still one node and one mesh. Its triangles are divided into one primitive per colour, each with its own material, its own vertices and its own indices. Godot imports that as one mesh with a surface per colour and Blender as one object with a material slot per colour, and the tests check both. This is the usual way a glTF file gives one mesh several materials, so other importers are expected to read it as submeshes or material slots too, but Unity and Unreal have not been tested with the engines themselves.

- Primitives come in the order their first triangle comes in the input. Inside a primitive the triangles keep their input order.
- A colour that is the body's own colour, however it is spelled, is the body's own material. A body never has two materials of one colour, and a body whose face colours all come to one colour is written exactly as a body without `faceColors`.
- `materialName` names the material of the body's own colour. Every other colour is named by `faceMaterialNames` where it is listed there, and after itself, `color_rrggbb`, where it is not.
- A material is in the file only when a written triangle uses it. If every triangle of a colour is dropped as degenerate, or the body's own colour is painted over everywhere, there is no material for that colour.

**At a border between two colours.** Welding, dropped triangles, hard and soft edges and normals are all worked out on the whole body before it is divided, so colours change nothing about its shape or its shading. A vertex on the border is written once for each colour that touches it, with the same position, the same normal and the same tangent in each. A soft edge between two colours therefore still shades smoothly, and a hard edge is still hard. The body's `vertices` in the facts is the number written, so it grows by those extra copies. `openEdges` and `nonManifoldEdges` are counted on the whole body: a closed body is closed however it is coloured.

Each colour of a body is a separate draw call in an engine, so a body with very many colours costs more to draw than its triangles suggest.

## Facts

Facts are measured from the geometry that was written, not from the input. A shortened example for one 1000 x 500 x 250 mm box, modelled Z-up in millimetres and exported with the `unreal5` profile:

```json
{
  "schema": 1,
  "generator": "corbelo-game-export 0.1.7",
  "profile": "unreal5",
  "engine": { "unit": "cm", "unitMeters": 0.01, "up": "Z" },
  "source": { "unit": 0.001, "up": "Z", "handedness": "right" },
  "settings": { "pivot": "base-center", "placement": "origin", "creaseAngle": 30, "normals": "angle-area", "weldTolerance": 0.000001, "faceIds": false },
  "bodies": [
    {
      "name": "Left_Wall",
      "sourceName": "Left Wall",
      "node": 0,
      "mesh": 0,
      "triangles": 12,
      "vertices": 24,
      "materialSlots": 1,
      "materials": ["color_d98a3d"],
      "degenerateTrianglesDropped": 0,
      "openEdges": 0,
      "nonManifoldEdges": 0,
      "bounds": {
        "meters": { "min": [-0.5, 0, -0.25], "max": [0.5, 0.25, 0.25], "size": [1, 0.25, 0.5] },
        "engine": { "min": [-50, -25, 0], "max": [50, 25, 25], "size": [100, 50, 25] }
      },
      "localBounds": { "meters": { "...": "..." }, "engine": { "...": "..." } },
      "pivot": { "mode": "base-center", "meters": [0.5, 0, -0.25], "engine": [50, -25, 0], "source": [500, 250, 0] },
      "translation": [0, 0, 0]
    }
  ],
  "materials": [{ "name": "color_d98a3d", "color": "#d98a3d", "baseColorFactor": [0.693872, 0.254152, 0.046665, 1], "bodies": 1 }],
  "total": { "bodies": 1, "triangles": 12, "vertices": 24, "materialSlots": 1, "degenerateTrianglesDropped": 0, "openEdges": 0, "nonManifoldEdges": 0, "bounds": { "...": "..." } }
}
```

- `vertices` is the count after splitting along hard edges and between colours, which is what an engine reports.
- `materialSlots` is the number of primitives the body's mesh has, one for each colour its written triangles have, and `materials` names them in order. A body with more than one also has `slots`, which gives the triangles and vertices of each: `"slots": [{ "material": "color_2980ba", "triangles": 10, "vertices": 20 }, { "material": "color_c0392b", "triangles": 2, "vertices": 4 }]`. A body in one colour has no `slots`, because its one slot holds everything the body has.
- A body given `refines` also has `shadedFrom`, which says how many surfaces its shading was taken from and how many triangles with an area they hold together: `"shadedFrom": { "surfaces": 1, "triangles": 256 }`.
- `settings.faceIds` says whether face ids had a say in the shading: a body's own, or those of the surfaces a body refines.
- In the `materials` list, `bodies` counts the bodies with at least one triangle in that material. `total.materialSlots` is the number of materials in the file.
- `openEdges` counts edges used by one triangle only. It is 0 for a closed body. `nonManifoldEdges` counts edges used by more than two.
- `bounds` is where the body sits in the scene. `localBounds` is the vertex data as stored, relative to the pivot. They are the same when `placement` is `"origin"`.
- Every box and pivot is given twice. `meters` is glTF space: metres, +Y up. `engine` is the same thing in the profile's unit, with the up value moved to the profile's up axis. For a Z-up profile that means glTF `(x, y, z)` is reported as `(x, z, y)`. It describes sizes and heights. It is not a promise about which way an engine's importer turns the model around the up axis.
- `pivot.source` is the pivot in your own units and axes.

### A schema for the facts

`schema/pack.schema.json` is a JSON Schema (draft 2020-12) for what the scene extras hold: the engine profile, the facts and the provenance. The facts layout is still `"schema": 1`. Version 0.1.2 added `slots`, which appears only on a body with several colours, and version 0.1.3 added `shadedFrom`, which appears only on a body given `refines`. Version 0.1.5 added what `exportGameAsset` reports, and none of it appears in a file from `exportGameGlb`: `collision`, `lods` and `attachPoints` on a body, and `texcoords`, `collision` and `lodLayout` in `settings`. None of these changed the meaning of a field that was there before. The facts on their own, which is also the facts file the command line writes, are its `#/$defs/PackFacts`, and an engine profile is `#/$defs/EngineProfile`. Every object in it refuses keys it does not name, and the test suite checks real output against it, so the schema and the code cannot drift apart unnoticed.

A program that checks facts against its own copy of this schema must take the 0.1.5 copy before it reads a file from `exportGameAsset`, since the older copy refuses the new keys.

Six more schemas sit next to it, all checked against real output in the same way:

| File | What it describes |
| --- | --- |
| `schema/pack.schema.json` | The scene extras of a GLB, and the facts in them. |
| `schema/check-report.schema.json` | What [`checkGameAsset`](#game-checks) returns and the `check` command prints. The player profile is its `#/$defs/PlayerProfile`. |
| `schema/pack-manifest.schema.json` | The `<name>.pack.json` file of a [pack](#packs), a [kit pack](#kit-packs) included. |
| `schema/kit-check-report.schema.json` | What [`checkKit`](#kit-checks) returns, with the values of each of the seven checks. A layout is its `#/$defs/Layout` and a grid its `#/$defs/Grid`. |
| `schema/blockout.schema.json` | The scene extras of a [blockout](#blockouts). The facts on their own are its `#/$defs/BlockoutFacts`. |
| `schema/kit-job.schema.json` | The job of a kit, as the [`pack`](#pack) command reads it. |
| `schema/lock.schema.json` | The [lock file](#the-lock-file) `install` keeps in a game project. |

```js
import facts from "corbelo-game-export/schema/pack.schema.json" with { type: "json" };
import report from "corbelo-game-export/schema/check-report.schema.json" with { type: "json" };
import manifest from "corbelo-game-export/schema/pack-manifest.schema.json" with { type: "json" };
import kitReport from "corbelo-game-export/schema/kit-check-report.schema.json" with { type: "json" };
import blockout from "corbelo-game-export/schema/blockout.schema.json" with { type: "json" };
import kitJob from "corbelo-game-export/schema/kit-job.schema.json" with { type: "json" };
import lock from "corbelo-game-export/schema/lock.schema.json" with { type: "json" };
```

The schemas refer to each other by file name, so keep the files together: the manifest's to the facts, the check report, the kit check report and the blockout, the kit check report's and the kit job's to the facts and the check report, and the blockout's to the facts and the kit check report. The lock file's stands alone. Version 0.1.6 added the last four files, and in the manifest's the kind `"kit"` with `kit` and `scenes`. A manifest of an asset or a family reads as it did.

Version 0.1.7 added `playerName` to the values of the three player checks and of Walkable, next to `player`, which is still the id. Nothing was renamed or removed, and a report from before reads as it did. A program that checks reports against its own copy of these schemas must take the 0.1.7 copy of `check-report.schema.json` and `kit-check-report.schema.json` before it reads a report from 0.1.7, since the older copy refuses the new key.

## Game assets

`exportGameAsset` takes everything `exportGameGlb` takes and returns the same `{ glb, facts }`. It adds what a game needs around the mesh.

```ts
import { exportGameAsset } from "corbelo-game-export";

const { glb, facts } = exportGameAsset({
  bodies: [
    {
      name: "Corner Bench",
      positions,
      color: "#8a6f4d",
      lods: [{ positions: halfDetail }, { positions: quarterDetail }],
      collisionPieces: [{ positions: seatBlock }, { positions: backBlock }],
      attachPoints: [{ name: "Seat", position: [150, 150, 400], direction: [0, 0, 1] }],
    },
  ],
  source: { unit: 0.001, up: "Z" },
  profile: "godot4",
  collision: "auto",
  texcoords: { tileMeters: 0.5 },
});
```

A body may have these fields besides those of a [plain body](#bodies):

| Field | Meaning |
| --- | --- |
| `lods` | Lower detail levels, the nearest to full detail first. Each is `{ positions, indices?, faceIds?, faceColors? }`, read like a body's and in the same units and axes. See [Detail levels](#detail-levels). |
| `collisionPieces` | The pieces the body was made from, each `{ positions }` with at least four points. Only the points are used: each piece becomes their convex hull. See [Collision](#collision). |
| `attachPoints` | Named points, each `{ name, position, direction? }` in the body's units and axes. See [Attach points](#attach-points). |

And these options besides the [plain ones](#options):

| Option | Default | Meaning |
| --- | --- | --- |
| `collision` | `"auto"` | `"none"`, `"auto"`, `"box"`, `"hull"`, `"pieces"` or `"decomposition"`, or `{ shape, tolerance, maxPieces, maxHullVertices }`. |
| `texcoords` | none | `true` or `{ tileMeters }` writes texture coordinates. See [Texture coordinates](#texture-coordinates). |
| `kernel` | none | A solid kernel, needed only for `"decomposition"`. See [A kernel for convex decomposition](#a-kernel-for-convex-decomposition). |

Two things differ from the plain export, both so that a part stays the same thing from one revision to the next:

- Material slots come in the order of the material names, not in the order the colours are first used. Painting a different face first does not move a slot.
- A node named like a collision shape or a detail level is one. The plain export only keeps body names clear of those names.

The same input always gives the same bytes. Nothing is read from the clock or the machine, in this function or in any other of the package.

The file is still valid glTF 2.0, and the test suite holds it to no errors and no warnings from the Khronos validator. The validator leaves notes only: that nothing in the file uses the tangents or the texture coordinates yet, that an attach point is an empty node, and that it does not know `KHR_node_visibility` where lower levels are hidden.

### Collision

A collision shape is made of convex pieces. There are four shapes, cheapest for the engine first:

| Shape | What is written |
| --- | --- |
| `"box"` | One box: the box around the body. |
| `"hull"` | One convex hull around the body. |
| `"pieces"` | One convex hull around each of the body's `collisionPieces`. |
| `"decomposition"` | The body cut into convex parts by a solid kernel, each written as its hull. |

A shape asked for by name is built, or refused with `BAD_COLLISION` when it cannot be: `"pieces"` without `collisionPieces`, `"decomposition"` without a `kernel`, for a body that is not closed or for one the kernel cannot cut up, or any shape for a flat body. The refusal says which.

`"auto"` builds the shapes in that order and takes the first whose volume is within `tolerance` of the visible body's. Volume error is `(collision volume - visible volume) / visible volume`, so 0.39 means the collision holds 39% more than the body does. The default tolerance is 0.05. A shape that cannot be built is passed over and the facts say why in `notes`. That holds for a kernel that was given and made no decomposition: its note starts `No convex decomposition was made.` and goes on with the reason. When no shape is within the tolerance, the nearest one is taken, `withinTolerance` is `false` and the [collision check](#game-checks) fails. A body that is not closed has no volume to compare with and gets its convex hull.

| Setting | Default | Meaning |
| --- | --- | --- |
| `shape` | `"auto"` | As above. |
| `tolerance` | `0.05` | How far the collision volume may be from the visible volume, as a share of it. |
| `maxPieces` | `8` | The most parts a decomposition makes. |
| `maxHullVertices` | `64` | The most corners one convex piece has. A piece stopped there may leave points outside it, and its facts say `capped: true`. |

The hulls are built by this package, with no dependency. `convexHull(points, maxVertices)` is exported for use on its own: it gives `{ positions, indices, volume, capped }`, or `null` for points with no volume between them. With no `maxVertices` it keeps every corner, and the time it takes grows with the points about as fast as their number does: a ring of 256 sides by 64, which is 16,384 points and 8,448 corners, takes about 40 ms where 0.1.7 took about 400 ms, so a caller does not need a limit to keep a view moving. A ball of 256 sides by 128, for which 0.1.7 had no hull, gets one. One shape is still slow: a flat end with very many corners on its rim, where every corner added remakes the triangles of that end. A cylinder of 2,048 sides takes over a second.

Each piece is a node of its own with a mesh that holds positions only, a child of the body's node, named the way the profile's engine reads it:

| Profile | A box | A convex piece | What the engine does with the name |
| --- | --- | --- | --- |
| `godot4` | `Crate_00-convcolonly` | `Crate_00-convcolonly` | Makes a static body with a convex collision shape, and draws nothing. |
| `unreal5` | `UBX_Crate_00` | `UCX_Crate_00` | The names of a box and of a convex hull for the mesh `Crate`. |
| `unity6` | `Crate_collision_00` | `Crate_collision_00` | Nothing. Unity has no such rule. |
| your own | by its `conventions`, else `Crate_collision_00` | the same | Whatever your profile says. |

The counter is two digits from `00`, in the order of the pieces, so the names are the same every time. Unity reads no collision from a name: an import script there takes the nodes from the names or from `facts.bodies[].collision.nodes`, gives each a convex mesh collider and stops drawing it.

What the facts say, for an L-shaped bench with its two blocks given as pieces:

```json
"collision": {
  "requested": "auto",
  "shape": "pieces",
  "pieces": 2,
  "tolerance": 0.05,
  "volume": { "visible": 0.18, "collision": 0.18, "error": 0 },
  "withinTolerance": true,
  "nodes": [
    { "name": "Corner_Bench_00-convcolonly", "node": 1, "mesh": 1, "kind": "convex", "role": "collision-convex-only", "vertices": 8, "triangles": 12, "volume": 0.12, "capped": false, "bounds": { "...": "..." } },
    { "name": "Corner_Bench_01-convcolonly", "node": 2, "mesh": 2, "kind": "convex", "role": "collision-convex-only", "vertices": 8, "triangles": 12, "volume": 0.06, "capped": false, "bounds": { "...": "..." } }
  ],
  "tried": [
    { "shape": "box", "pieces": 1, "volume": 0.32, "error": 0.777778, "withinTolerance": false },
    { "shape": "hull", "pieces": 1, "volume": 0.25, "error": 0.388889, "withinTolerance": false },
    { "shape": "pieces", "pieces": 2, "volume": 0.18, "error": 0, "withinTolerance": true }
  ],
  "notes": []
}
```

The numbers are rounded here for reading. Volumes are cubic metres. `tried` lists every shape that was built on the way, so a caller can see what the cheaper ones would have cost. `volume.visible` and `error` are `null` for a body that is not closed. With `collision: "none"` a body has no `collision` in its facts.

The volume of several pieces is their volumes added up. Pieces that overlap count twice where they do, so give pieces that touch and do not overlap.

### A kernel for convex decomposition

Cutting a body into convex parts needs solid operations, which this package does not carry. Pass a kernel and `"auto"` can reach the last shape, and `"decomposition"` can be asked for by name. A kernel is one function:

```ts
interface CollisionKernel {
  /** positions: x, y, z per vertex, each place in space once. indices: three per triangle, facing outwards. */
  solid(positions: Float32Array, indices: Uint32Array): KernelSolid;
}

interface KernelSolid {
  hull(): KernelSolid;
  /** The solid cut in two by the plane where normal . p = originOffset: the part the normal points to first. */
  splitByPlane(normal: [number, number, number], originOffset: number): KernelSolid[];
  volume(): number;
  getMesh(): { numProp: number; vertProperties: ArrayLike<number>; triVerts: ArrayLike<number> };
  /** Optional. The parts of the solid that do not touch. */
  decompose?(): KernelSolid[];
  /** Optional. What this solid and another both fill. Only the kit checks use it. */
  intersect?(other: KernelSolid): KernelSolid;
  /** Optional. Called on every solid the package asked for, when it is done with it. */
  delete?(): void;
}
```

A `Manifold` of the [`manifold-3d`](https://www.npmjs.com/package/manifold-3d) package is a `KernelSolid` as it is, and `manifoldKernel` wraps the module:

```ts
import Module from "manifold-3d";
import { exportGameAsset, manifoldKernel } from "corbelo-game-export";

const wasm = await Module();
wasm.setup();
const { glb, facts } = exportGameAsset({ bodies, source, collision: "auto", kernel: manifoldKernel(wasm) });
```

`manifold-3d` is not a dependency of this package. Install it yourself where you want a decomposition. The tests run against version 3.5.5.

The decomposition cuts the body by planes along the three axes. It takes the part whose hull adds the most volume, tries up to 12 places along each axis where that part has vertices, and keeps the cut that leaves the least extra volume. A hole through an otherwise convex part is not opened by any one cut, since each half still has a hull that fills its share of the hole. Where no cut helps by itself, the cut along each axis that leaves the most even parts is looked at one cut further, and the one that opens the most is kept. It stops when the hulls together are within the tolerance or there are `maxPieces` parts. A wall with a doorway comes out as three parts with no extra volume. A block 0.6 m square with a round hole 0.24 m across is within 5% in 8 parts or fewer. A round or slanted hollow that takes up most of a body needs more parts: a ring 1.2 m across with a hole 0.8 m across needs 13 parts to come within 5% and is 9% over at the default of 8. Give `collisionPieces` from the construction for such a body, or raise `maxPieces`.

A decomposition is made only for a body the kernel can take as a solid: closed, every face pointing outwards, with no hollow shut inside it and a surface that does not cross itself. Any other body gets no decomposition and a reason in plain words: which edges are open or join faces that point opposite ways, what the kernel said when it did not take the body, or that the parts it made do not add up to the body's volume. A surface that crosses itself is not looked for directly. It is caught when the kernel refuses the body or the volumes do not add up.

### Detail levels

You make the lower levels: this package does not simplify meshes. Each level is welded, shaded and split into material slots exactly as a body is, with the same `creaseAngle`, `normals` and `weldTolerance` and its own `faceIds` and `faceColors`. Nothing is repaired, so a level is as closed as you gave it, and the facts count its open edges. The triangles of every level count against `maxTriangles`.

Where the levels go depends on the engine, and `facts.settings.lodLayout` says which was used:

| Layout | Profiles | Nodes |
| --- | --- | --- |
| `"group"` | `unity6`, `unreal5`, and any profile with a rule for level names | The body's node `Crate` is empty. Its children `Crate_LOD0`, `Crate_LOD1`, `Crate_LOD2` hold the levels, level 0 being the full detail. |
| `"children"` | `godot4`, and any profile without such a rule | The body's node `Crate` holds the full detail. Its children `Crate_LOD1`, `Crate_LOD2` hold the lower levels and are written hidden. |

Godot makes its own detail levels on import and has no rule for reading them from a file. An engine without a rule would draw every level at once, one inside the other, so there the lower levels are hidden with the glTF extension `KHR_node_visibility` (`visible: false`), for the game to show in turn. The extension is listed in `extensionsUsed` and not in `extensionsRequired`. A viewer that does not know the extension draws the hidden levels too, so hide them yourself there: `facts.bodies[].lods[]` gives each level's `node` and whether it is `visible`.

Each level is measured as written. For a ring 1.2 m across with 48 sides, given again with 24 sides and with 12, for Godot:

```json
"lods": [
  { "level": 0, "name": "Ring", "node": 0, "mesh": 0, "visible": true, "triangles": 384, "vertices": 384, "materialSlots": 1, "materials": ["color_cccccc"], "degenerateTrianglesDropped": 0, "openEdges": 0, "nonManifoldEdges": 0, "deviation": { "meters": 0, "engine": 0, "share": 0 } },
  { "level": 1, "name": "Ring_LOD1", "node": 1, "mesh": 1, "visible": false, "triangles": 192, "vertices": 192, "materialSlots": 1, "materials": ["color_cccccc"], "degenerateTrianglesDropped": 0, "openEdges": 0, "nonManifoldEdges": 0, "deviation": { "meters": 0.005133, "engine": 0.005133, "share": 0.002944 } },
  { "level": 2, "name": "Ring_LOD2", "node": 2, "mesh": 2, "visible": false, "triangles": 96, "vertices": 124, "materialSlots": 1, "materials": ["color_cccccc"], "degenerateTrianglesDropped": 0, "openEdges": 0, "nonManifoldEdges": 0, "deviation": { "meters": 0.020445, "engine": 0.020445, "share": 0.011726 } }
]
```

The numbers are rounded here for reading. Level 0 is always in the list, so the counts of every level sit side by side.

`deviation` is how far the outline moved from level 0. The measure is the greatest distance from any vertex, or the middle of any triangle, of either mesh to the nearest point of the other mesh's surface, taken both ways. It is zero for the same surface cut into different triangles, and for a round shape made with fewer sides it is how far the flat sides sit inside the round one. `share` is that distance over the diagonal of the box around level 0. A mesh with more than 20,000 vertices or triangles is measured at every so many of them, the same ones every time. `meshDeviation(positionsA, indicesA, positionsB, indicesB)` is exported for use on its own.

### Texture coordinates

`texcoords: true` writes `TEXCOORD_0` by box projection at the scale of the world, so a tiling texture has the same size on every asset, and runs on across kit pieces that are placed a whole number of tiles apart.

- Each triangle is projected along the axis its own face leans on most, from where it sits in the file's scene. With `placement: "origin"` that is measured from the pivot.
- One whole texture covers `tileMeters` by `tileMeters`. The default is 1 metre.
- On the four upright sides, u runs to the right as the side is seen from outside and v runs down, so a texture stands upright. On the top, u runs along +X and v along +Z, and on the bottom along +X and -Z. No side is a mirror image.
- A vertex used by triangles projected along different axes is written once for each, so `vertices` in the facts grows.
- The tangents follow: each points the way u grows, at a right angle to the normal, with `w` set to 1.
- Every detail level gets coordinates the same way.

`facts.settings.texcoords` is `{ "projection": "box", "tileMeters": 0.5 }` when coordinates were written. Box projection shows a seam where the projection changes axis on a round surface. There is no unwrapping and no texture is written: the coordinates are for a material you assign in the engine.

### Attach points

An attach point is an empty node under its body, where something else goes: a hand, a light, a hinge. It moves with the body. Its name is made safe and unique in the file the way a body's is.

With a `direction`, the node is turned by the shortest way so that its own +Z axis points along it. A direction has no length of its own: only its axes are converted. Without a direction the node has no rotation.

```json
"attachPoints": [
  { "name": "Seat", "sourceName": "Seat", "node": 3, "meters": [-0.35, 0.4, 0.25], "engine": [-0.35, 0.4, 0.25], "source": [150, 150, 400], "direction": [0, 1, 0] }
]
```

`meters` is where the point is in the scene, `engine` is the same in the profile's unit and up axis, `source` is what you gave, and `direction` is the way the node's +Z points, in glTF axes and at length 1.

## Game checks

`checkGameAsset` reads a GLB this package wrote and returns one result for every check. It always returns all twelve, in the same order, so a table of them never has a missing row. It measures from the file: the triangles as written and the facts stored with them. An asset that fails a check is not refused. Only a file that cannot be read, or was not written by this package, is (`BAD_GLB`).

```ts
import { checkGameAsset } from "corbelo-game-export";

const report = checkGameAsset(glb, { assetClass: "kit-piece", expect: { opening: true } });
```

```json
{
  "schema": 1,
  "generator": "corbelo-game-export 0.1.7",
  "profile": "godot4",
  "assetClass": "small-prop",
  "budget": { "maxTriangles": 2000, "maxVertices": 4000, "maxMaterialSlots": 2 },
  "player": { "id": "godot4-character-body", "name": "Godot 4 CharacterBody3D", "origin": "built-in", "engine": "godot", "capsuleRadiusM": 0.5, "capsuleHeightM": 2, "stepHeightM": 0, "walkableSlopeDeg": 45, "jumpHeightM": 1.03, "note": "..." },
  "gridMeters": 1,
  "status": "pass",
  "counts": { "pass": 8, "warn": 0, "fail": 0, "notMeasured": 4 },
  "results": [
    { "id": "size", "status": "pass", "message": "The asset is 1 m on its longest side, a size a small prop has.", "values": { "...": "..." } },
    { "id": "collision", "status": "pass", "message": "Collision in 2 convex pieces, within 5% of the visible volume.", "values": { "tolerance": 0.05, "bodies": [{ "name": "Corner_Bench", "requested": "auto", "shape": "pieces", "pieces": 2, "error": 0, "withinTolerance": true }] } },
    { "id": "detail-levels", "status": "not-measured", "message": "The file has no lower detail levels.", "reason": "No body was given lower detail levels. Engines that make their own levels on import need none.", "values": { "maxDeviationShare": 0.05, "bodies": [] } }
  ]
}
```

Every result has `id`, `status`, a `message` for a person, and `values`, the numbers it was judged by. A message or a reason is written for someone who models parts: it names no function of this package, no option key and no id, and says an asset class, a pivot and a player by name. Read `values` and the report's own fields for the ids. `status` is `"pass"`, `"warn"`, `"fail"` or `"not-measured"`, and a result that was not measured always has a `reason`. The report's own `status` is the worst of the results, and what was not measured does not count against it. `CHECK_IDS` lists the ids in order.

| `id` | Passes when | Warns when | Fails when | Not measured when |
| --- | --- | --- | --- | --- |
| `size` | The longest side is in the range of the asset class. | It is outside. Where a mix-up of units would explain it, `suggestedScale` says which. | Never. | Never. |
| `pivot` | Otherwise. | A pivot is further from its body than the body is long. | A kit piece has a pivot off the grid. | Never. |
| `triangles` | The file's triangles are within the budget. | Never. | They are over it. | Never. |
| `vertices` | The vertices, counted after hard edges and colours split them, are within the budget. | Never. | They are over it. | Never. |
| `shading` | Otherwise. | A vertex normal is more than 60 degrees from a face it shades. | A normal points away from its own triangle, or a body has no normals. | Never. |
| `clean-mesh` | Every body is closed, faces outwards and has no sliver triangles. | There are open edges, edges shared by more than two triangles, sliver triangles, or triangles that were left out for having no area. | Two neighbouring faces point opposite ways, or a closed body is inside out. | Never. |
| `material-slots` | The body with the most slots is within the budget. | Never. | It is over it. | Never. |
| `collision` | Every body's collision volume is within the tolerance. | A shape you named is outside the tolerance, or some body has no shape. | A shape `"auto"` settled for is outside the tolerance. | No body has a shape, or the body is not closed and has no volume to compare. |
| `detail-levels` | Every level has fewer triangles than the one above and stays within the allowed share of the outline. | A level has as many triangles as the one above, or moves the outline further than allowed. | A level has more triangles than the one above, or is open when level 0 is closed. | No body has lower levels. |
| `player-openings` | The player fits an opening and can walk in. | The player fits no opening, or fits one whose sill is higher than a step. | The same, when `expect.opening` is `true`, or no opening when one was expected. | No opening was found. |
| `player-steps` | The tallest rise of the stair is no more than the player's step height. | It is more. | The same, when `expect.stairs` is `true`, or no steps when they were expected. | No stair was found. |
| `player-ramps` | Every slope is no steeper than the player walks up. | A slope is steeper. | The same, when `expect.ramp` is `true`, or no ramp when one was expected. | No slope was found. |

What each one measures:

- **Size.** The box around everything, in metres and in the engine's unit. The mix-ups looked for are millimetres, centimetres and inches read as metres, and the other way round.
- **Pivot.** Where each body's pivot is against its own box. A pivot is on the grid when it is a whole number of grid steps from a face of the box, along every axis the body is at least one grid step long in. The grid is `gridMeters`, 1 metre unless given.
- **Shading.** Hard and soft edges are counted from the file. The message says which normal rule the file was written with, and that weighting by the whole flat face is there to ask for.
- **Clean mesh.** A sliver is a triangle whose doubled area is under 1% of its longest edge squared.
- **Collision.** The volume error the facts state, against `collisionTolerance` or else the tolerance the file was written with. Where a shape `"auto"` settled for is outside it, the message says what would bring it nearer and never asks for what was given: the pieces the part was built from, a kernel when none was given, more pieces when a kernel made the most allowed, or the reason a kernel that was given made no decomposition. A body that is not closed is named with the count of its open edges.
- **Detail levels.** The triangle counts and the `deviation.share` of each level, against `lodDeviationShare`, 0.05 unless given.
- **Player openings.** The asset is drawn as a filled outline on a grid, once looking along X and once along Z, standing on a floor at its lowest point. Each free region the outline shuts in is an opening: a doorway, an arch, a window, a tunnel. A gap that is open to the sky is not one. The player fits when the capsule stands in it, and walks in when the sill is no higher than a step. The grid is 384 cells on its longer side, and sizes are good to about two cells: `cellMeters` says how large a cell was.
- **Player steps.** Flat places large enough to stand on are found from the triangles that face up, as heights above the bottom of the asset. A stair is two or more rises in a row of 0.6 metres or less. One rise alone is a stair only when `expect.stairs` is `true`.
- **Player ramps.** Flat slopes from 2 to 60 degrees that are large enough to stand on. Flatter is a floor and steeper is a wall.

The three player checks read the visible mesh, not the collision shape.

### Check options

| Option | Default | Meaning |
| --- | --- | --- |
| `assetClass` | `"small-prop"` | `"small-prop"`, `"large-prop"` or `"kit-piece"`. Decides the budget and the expected size. |
| `budget` | that of the class | `{ maxTriangles, maxVertices, maxMaterialSlots }`, each optional, replacing the class's limit. |
| `player` | the player of the engine the file was written for | An engine profile id, or a player profile of your own. |
| `gridMeters` | `1` | The grid a pivot is checked against. |
| `collisionTolerance` | the file's own | How far the collision volume may be from the visible volume. |
| `lodDeviationShare` | `0.05` | How far a lower level may move the outline, as a share of the body's diagonal. |
| `expect` | none | `{ opening, stairs, ramp }`. `true` turns "none found" and "found, but the player does not fit" into a failure. |

### Budgets

Budgets are places to start from. No engine sets them: they are this package's own, exported as `ASSET_BUDGETS` and `ASSET_SIZE_RANGES`, and `budget` replaces any of them.

| Asset class | Triangles | Vertices | Material slots | Longest side |
| --- | --- | --- | --- | --- |
| `small-prop` | 2,000 | 4,000 | 2 | 0.05 to 2 m |
| `large-prop` | 10,000 | 20,000 | 4 | 1 to 30 m |
| `kit-piece` | 3,000 | 6,000 | 3 | 0.5 to 12 m |

Triangles and vertices are those of the full detail of every body in the file together. Material slots are those of the body that has the most.

### Player profiles

A player profile is the capsule that moves through a level and what it can climb. Lengths are metres, and `capsuleHeightM` is the whole capsule, end to end.

```ts
interface PlayerProfile {
  id: string;
  name: string;
  origin: string;        // "built-in" for the three below
  engine?: string;       // "godot", "unity" or "unreal" for the three below
  capsuleRadiusM: number;
  capsuleHeightM: number;
  stepHeightM: number;   // 0 when the character climbs no steps by itself
  walkableSlopeDeg: number;
  jumpHeightM: number;
  note?: string;
}
```

Without a `player` option, a file is checked against the character of the engine it was written for. `PLAYER_PROFILES` holds the three, by engine profile id:

| Profile | `id` | Radius | Height | Step | Slope | Jump |
| --- | --- | --- | --- | --- | --- | --- |
| `godot4` | `godot4-character-body` | 0.5 | 2 | 0 | 45 | 1.03 |
| `unity6` | `unity6-character-controller` | 0.5 | 2 | 0.3 | 45 | 1.5 |
| `unreal5` | `unreal5-character` | 0.34 | 1.76 | 0.45 | 44.765 | 0.9 |

A file written with a profile of your own is checked against Godot's unless you pass a player. A player object of your own is checked for sane numbers and written into the report as given, any keys of your own included.

The values of the three player checks, and of Walkable among the [kit checks](#kit-checks), carry the player twice: `player` is the profile's `id`, for a program, and `playerName` is its `name`, for a person. The messages say the name. A profile that was given no name is called by its id in both.

These are meant to be the values a new character starts with in each engine, before anybody tunes it. Where they come from, and how far each engine's own documentation confirms them:

**Godot 4.** Confirmed on the pages named.

- Radius 0.5 and height 2: the defaults of [CapsuleShape3D](https://docs.godotengine.org/en/stable/classes/class_capsuleshape3d.html), whose `height` is the full height with both round ends.
- Slope 45: [CharacterBody3D](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html) lists `floor_max_angle` as 0.7853982 radians, which is 45 degrees.
- Step 0: the same page has no setting for climbing steps. A CharacterBody3D stops at a ledge of any height unless the game adds its own step code.
- Jump 1.03: the editor's own [CharacterBody3D script template](https://github.com/godotengine/godot/blob/master/modules/gdscript/editor/script_templates/CharacterBody3D/basic_movement.gd) sets `JUMP_VELOCITY = 4.5`, and [ProjectSettings](https://docs.godotengine.org/en/stable/classes/class_projectsettings.html) lists `physics/3d/default_gravity` as 9.8. The height is 4.5 squared over twice 9.8.

**Unity 6.** Confirmed on the pages named and in saved scenes; Unity itself was not run.

- The [Character Controller component reference](https://docs.unity3d.com/6000.0/Documentation/Manual/class-CharacterController.html) describes the settings and gives advice, not the starting values. It advises a height of "around 2 meters" for a human and a Step Offset "between 0.1 and 0.4" for a human of that size. The height of 2 and the step of 0.3 are inside that advice.
- Radius 0.5, height 2, Slope Limit 45 and Step Offset 0.3 are what Unity writes for a Character Controller nobody has changed. A scene or prefab saved by Unity holds them in plain text as `m_Radius: 0.5`, `m_Height: 2`, `m_SlopeLimit: 45` and `m_StepOffset: 0.3`, for example in [this public practice scene](https://github.com/Mahigcu/CST-461/blob/main/practice.unity). The reference page advises that a Slope Limit of 90 often works best: pass your own player if your game follows that.
- Jump 1.5: the example script of [`CharacterController.Move`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/CharacterController.Move.html) sets `jumpHeight = 1.5f`. A Character Controller has no jump of its own.

**Unreal Engine 5.** Confirmed in public copies of the engine's own constructors; Unreal itself was not run.

- A new Character starts with a capsule of radius 34 and half height 88, Max Step Height 45, Walkable Floor Angle 44.765 and Jump Z Velocity 420 against gravity of 980, all in Unreal units of one centimetre. The jump is 420 squared over twice 980, which is 90 cm.
- Epic's reference for [UCharacterMovementComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent) describes these settings without printing their starting values. Those are set in the engine's source, which needs an Epic Games account to read. Copies of the two constructors that people have posted show them: the Character's `InitCapsuleSize(34.0f, 88.0f)` in [a thread on Epic's forum](https://forums.unrealengine.com/t/how-to-include-add-a-blueprint-component-to-c-actor/492414), and the movement component's `JumpZVelocity = 420.0f`, `MaxStepHeight = 45.0f` and `SetWalkableFloorZ(0.71f)` in [a posted copy of its code](https://gist.github.com/NoirMorilec/1ebe1a6f742c193101265a928b90c897). A floor Z of 0.71 is the angle 44.765 degrees. The copies of the movement component are from Unreal Engine 4; the editor of your version has the last word.

## Packs

`exportGamePack` makes everything a game project needs for one asset, or for a family of them, in one call: the GLBs and a small JSON manifest with what was measured.

```ts
import { exportGamePack, packToZip } from "corbelo-game-export";

const pack = exportGamePack({
  name: "crate",
  source: { unit: 0.001, up: "Z" },
  profile: "unreal5",
  rows: [
    { name: "small", bodies: [{ name: "Crate", positions: small, color: "#8a6f4d" }], provenance: { side: 400 } },
    { name: "large", bodies: [{ name: "Crate", positions: large, color: "#8a6f4d" }], provenance: { side: 800 } },
  ],
  checks: { assetClass: "small-prop" },
  revision: "r12",
});

pack.name;      // "SM_Crate"
pack.files;     // SM_Crate_Small.glb, SM_Crate_Large.glb, SM_Crate.pack.json
pack.manifest;  // the manifest as an object
const zip = packToZip(pack);
```

The input is that of `exportGameAsset`, with these fields added:

| Field | Meaning |
| --- | --- |
| `name` | Required. The asset's name, or the family's. |
| `bodies` | One asset. Give this or `rows`, not both. |
| `rows` | A family: `[{ name, bodies, provenance? }]`, one asset for each row, all written with the same settings. |
| `naming` | The name pattern. Default: that of the engine. See [Names that stay](#names-that-stay). |
| `checks` | The options of `checkGameAsset`, run on every asset. `false` runs none. Default: checks with their own defaults. |
| `generatedAt` | A time to write into the manifest, as text. Without it none is written: the clock is never read. |
| `revision` | Your own name for this revision of the source. |
| `provenance` | Any plain JSON, stored in the manifest and in each GLB. A row's own `provenance` is stored in its GLB in its place. |

What comes back:

| Field | Meaning |
| --- | --- |
| `name` | The pack's name, safe as a file or folder name. |
| `manifest` | The manifest as an object. |
| `files` | `[{ name, mediaType, bytes }]`: every GLB in the order of the rows (`model/gltf-binary`), then the manifest as `<name>.pack.json` (`application/json`). `bytes` is a `Uint8Array`. |

`packToZip(pack)` returns the same files as one ZIP archive, as a `Uint8Array`. The files are stored, not compressed, with a fixed date, so the same pack always gives the same archive. `writeZip(entries)` is the writer by itself, for `[{ name, bytes }]`: it has no dependencies, refuses unsafe and doubled names, and writes at most 65,535 files and 4 GB.

### Names that stay

An asset is named from a pattern, its family and its row:

| Profile | Pattern | `crate`, `small` | `crate` alone |
| --- | --- | --- | --- |
| `godot4` | `{family}_{row}` | `crate_small` | `crate` |
| `unity6` | `{Family}_{Row}` | `Crate_Small` | `Crate` |
| `unreal5` | `SM_{Family}_{Row}` | `SM_Crate_Small` | `SM_Crate` |

`{family}` and `{row}` are written in small letters with `_` between words, `{Family}` and `{Row}` with a capital at the start of each word and nothing between, and `{FAMILY}` and `{ROW}` in capitals with `_` between. Words are runs of letters and digits, with a new word where a capital follows a small letter: `storage crate`, `storage-crate` and `storageCrate` all give `SM_StorageCrate`. Everything else in the pattern is kept. Without a row, the row and the separator in front of it are left out. `assetName(pattern, family, row?)` does this by itself, and `DEFAULT_NAME_PATTERNS` holds the three patterns. A profile of your own uses Godot's unless `naming` is given.

What stays the same from one revision to the next:

- The file is `<asset>.glb`. An asset with one body gives that body the asset's name, so the node and the mesh are named as the file is. An asset with several bodies keeps their own names.
- Collision pieces, detail levels and attach points are named from the body's name with a counter, as above.
- Material slots are in the order of the material names. In a family a material name means one colour: a name that is two colours in two rows is refused with `MATERIAL_CONFLICT`.
- Two rows whose names come out the same are refused with `BAD_PACK`.
- The pivot is the one the `pivot` option names, for every row.
- The same input gives the same bytes: every GLB, the manifest and the archive.

### The manifest

```json
{
  "schema": 1,
  "kind": "family",
  "name": "SM_Crate",
  "generator": "corbelo-game-export 0.1.7",
  "revision": "r12",
  "profile": "unreal5",
  "engine": { "unit": "cm", "unitMeters": 0.01, "up": "Z" },
  "naming": { "pattern": "SM_{Family}_{Row}" },
  "assetClass": "small-prop",
  "budget": { "maxTriangles": 2000, "maxVertices": 4000, "maxMaterialSlots": 2 },
  "player": { "id": "unreal5-character", "...": "..." },
  "status": "pass",
  "materials": [{ "name": "color_8a6f4d", "color": "#8a6f4d", "baseColorFactor": [0.254152, 0.158961, 0.074214, 1], "files": ["SM_Crate_Small.glb", "SM_Crate_Large.glb"] }],
  "files": [
    {
      "name": "SM_Crate_Small.glb",
      "role": "model",
      "mediaType": "model/gltf-binary",
      "bytes": 6548,
      "sha256": "6a4d1046d183d948ea2cea21cbf940201c5a3cbf7d3869b88ccb1c1649d620f1",
      "asset": "SM_Crate_Small",
      "row": "small",
      "facts": { "...": "the facts the GLB carries" },
      "checks": { "...": "the report of checkGameAsset" },
      "provenance": { "side": 400 }
    }
  ]
}
```

- `kind` is `"asset"` for one GLB and `"family"` for one per row. `row` appears only in a family. A [kit pack](#kit-packs) has `"kit"`, with a file for each piece and two parts more.
- `bytes` and `sha256` are the size and the SHA-256 of the file as written, so a download can be checked. `sha256Hex(bytes)` is the function, with no dependencies.
- `facts` is exactly what the GLB carries in its scene extras, and `checks` is the report of `checkGameAsset` for that file.
- `assetClass`, `budget`, `player`, `status` and each file's `checks` are there only when checks ran. `status` is the worst of any file.
- `materials` lists every material of the pack by name, with the files that use it.
- `generatedAt`, `revision` and `provenance` are there only when given.

The manifest is written with two spaces a level and a short list on one line, so a person can read it and a change shows up clearly in a diff.

## Kits

A kit is a set of pieces that share a grid and meet at sockets: a corridor made of a straight piece, a corner, a tee, a crossing, a doorway, an end cap and stairs. The kit is plain data, so an editor can write it from what a person clicked and an agent can write it as JSON. Three functions take it:

| Function | What it does |
| --- | --- |
| [`checkKit`](#kit-checks) | Seven checks on the kit as a whole: pass, warn, fail or not measured, with the numbers. |
| [`exportKitPack`](#kit-packs) | A GLB for each piece, a scene for each layout, and a manifest with the grid, the sockets, the checks and what a grid of tiles needs. |
| [`exportBlockout`](#blockouts) | One layout as one scene, where a piece placed many times is one mesh shown by many nodes. |

```ts
import { checkKit, exportBlockout, exportKitPack, packToZip } from "corbelo-game-export";

const kit = {
  name: "corridor",
  source: { unit: 0.001, up: "Z" },
  grid: { moduleMeters: 3, storeyMeters: 3 },
  collision: "pieces",
  pieces: [
    {
      name: "straight",
      bodies: [{ name: "straight", positions, color: "#8a8f98", materialName: "Concrete", collisionPieces: [{ positions: floor }, { positions: leftWall }, { positions: rightWall }] }],
      sockets: [
        { type: "corridor", side: "+x", passage: true },
        { type: "corridor", side: "-x", passage: true },
      ],
    },
    {
      name: "stairs",
      bodies: [stairsBody],
      cells: [2, 1, 2],
      sockets: [
        { type: "corridor", side: "-x", cell: [0, 0, 0], passage: true },
        { type: "corridor", side: "+x", cell: [1, 0, 1], passage: true },
      ],
    },
    // corner, tee, cross, doorway, endcap
  ],
};

const report = checkKit(kit);              // seven results
const pack = exportKitPack(kit);           // files and a manifest, as a pack
const room = exportBlockout(kit, "room");  // { glb, facts }
const zip = packToZip(pack);
```

### The kit as data

A kit takes the options of [`exportGameAsset`](#game-assets) (`profile`, `collision`, `texcoords`, `kernel`, `creaseAngle` and the rest) and applies them to every piece. It takes no `pivot` and no `placement`: each piece has its own pivot and sits at the origin of its own file.

| Field | Meaning |
| --- | --- |
| `name` | Required. The kit's name: `"corridor"`. |
| `source` | Required. The space the bodies, origins, pivots, planes and regions are given in, as for any export. |
| `grid` | Required. `{ moduleMeters, storeyMeters, trimMeters? }`: the side of one cell on the ground, the height of one cell, and how far a body declared as trim may reach past its piece's cells (default 0.1). All in metres. |
| `pieces` | Required. A list of pieces, or a function `(grid) => pieces` that makes them for a grid, so that [another module size](#another-module-size) is one call. |
| `mates` | Socket types that meet a type other than their own: `{ "plug": "hole" }`. It reads both ways. Without it a type meets itself. |
| `layouts` | Layouts of your own, `[{ name, placements }]`, checked and exported with the test layouts. |
| `naming` | The [name pattern](#names-that-stay), with the kit as the family and the piece as the row. |

A piece:

| Field | Meaning |
| --- | --- |
| `name` | Required. What tells the piece from the others: `"straight"`. It goes into the file name by the pattern: `corridor_straight.glb`. A piece of one body is that body, which takes the file's name as the one body of an asset does. |
| `bodies` | The piece as bodies, as [`exportGameAsset`](#game-assets) takes them, in the kit's source space. Give this or `glb`. |
| `glb` | The piece as a `Uint8Array` this package already wrote with `exportGameAsset`. Its own origin is the piece's pivot, and its `origin`, planes and regions are then read in glTF space: metres, +Y up. |
| `cells` | How many cells the piece takes: along X, along Y, and storeys. Default `[1, 1, 1]`. |
| `origin` | The corner of the piece's cells that is lowest along every axis of the kit, in the piece's units and axes. Default `[0, 0, 0]`. |
| `pivot` | The piece's own origin in the engine, in the piece's units and axes. Default: `origin`. Not for a `glb` piece. |
| `sockets` | The faces where the piece meets another piece. See below. |
| `trim` | Names of bodies that are trim: declared to reach past the piece's cells and to overlap what is next to it, like a skirting board or a threshold. |
| `provenance` | Any plain JSON about this piece. Stored in its GLB and in the manifest. |

A socket is one face of one cell of the piece. Give it by side, or by plane the way a face a person clicked comes:

| Field | Meaning |
| --- | --- |
| `type` | Required. What meets what: sockets of one type meet each other, or the type `mates` names. |
| `side` | `"+x"`, `"-x"`, `"+y"`, `"-y"`, `"+z"` or `"-z"`. Give this or `plane`, not both. |
| `cell` | Which cell of the piece the socket is a face of, counted from 0 along X, along Y and by storey. Default `[0, 0, 0]`. |
| `plane` | `{ point: [x, y, z], normal: [x, y, z] }` in the piece's units and axes, with the normal pointing out of the piece. The side is the axis the normal is nearest, and the cell is the one the point lies on, unless `cell` is given. A plane turned more than 1 degree from every axis is refused. How far the plane is from the face of its cell is kept as `offsetMeters` and judged by [On the grid](#kit-checks). |
| `region` | The outline of the part of the face that meets, as points on the plane in the piece's units and axes. Default: the whole face of the cell. |
| `passage` | `true` when the player walks through this socket. Default `false`. |
| `name` | Default: the side, with the cell when the piece has more than one cell: `"+x"`, `"+x@1,0,1"`. Unique in its piece. |

Sides are named in the kit's own frame: X to the right, Y away, Z up, right-handed. For a source that is Z up and right-handed these are the source's own axes. In the files, which are glTF, the kit's X is X, its Y is -Z and its Z is Y.

`resolveKit(kit, grid?)` reads a kit without checking it and returns it with every piece written and every socket placed: `{ name, profile, grid, naming, mates, pieces, layouts }`, where each piece has `asset`, `cells`, `pivotMeters`, `sockets`, `trim`, `glb` and `facts`. `checkKit`, `exportBlockout`, `kitLayouts` and `layoutJoints` take a resolved kit as well as one as given, so a kit that is checked and laid out many times is written once. `exportKitPack` takes the kit as given, and a resolved kit cannot be checked for another grid, since its pieces are already written. A kit that cannot be read is refused with `BAD_KIT`, and a layout with `BAD_LAYOUT`.

### Layouts

A layout is pieces in their places:

```json
{ "name": "dead end", "placements": [
  { "piece": "endcap", "cell": [0, 0, 0] },
  { "piece": "straight", "cell": [1, 0, 0] },
  { "piece": "corner", "cell": [2, 0, 0], "turn": 1 }
] }
```

`cell` is the cell the piece's first cell, `[0, 0, 0]`, lands on. `turn` is a whole number of quarter turns about the up axis, anticlockwise seen from above, about the middle of the piece's first cell. Default 0. Cells may be negative.

Six test layouts are built from the sockets alone, so a kit is tested as it will be used without anyone laying it out: `run` (a straight run closed at both ends), `corner`, `tee`, `cross`, `rise` (from one storey to the next) and `room` (a closed ring). A piece is read by its sockets on the four sides: one is an end, two on opposite sides of one storey a through piece, two at a right angle a bend, two on different storeys a rise, three a tee and four a crossing. A layout the kit has no pieces for is left out, and the reason is given: `kitLayouts(kit)` returns `{ layouts, skipped: [{ name, reason }] }`.

`layoutJoints(kit, layout)` says what meets what in a layout from the cells and the sockets alone: `joints` (two sockets face to face whose types meet), `open` (a socket facing an empty cell), `blocked` (a socket facing a side of a piece with no socket there), `mismatched` (face to face, with types that do not meet), `doubled` (cells more than one piece is in) and `cells`. `turnSide(side, turn)`, `turnCell(cell, turn)`, `oppositeSide(side)`, `cellSize(grid)` and `placePoint(point, placement, grid)` are the same arithmetic the package uses, for a caller that draws a layout itself.

### Kit checks

`checkKit(kit, options?)` returns one result for every check. It always returns all seven, in this order, and it throws only for a kit that cannot be read. Everything is measured from the files the pieces are written as.

| Id | Name | Passes when |
| --- | --- | --- |
| `on-grid` | On the grid | Every piece is a whole number of modules and storeys, its pivot is on a corner of the grid, and its sockets lie on the faces of its cells. |
| `seams` | Seams match | Any two sockets that can meet show the same outline: what the two pieces cut of the plane between them differs by no more than the tolerance allows. |
| `in-cells` | Stays in its cells | Nothing of a piece reaches past its cells, and what is declared as trim reaches no further than `trimMeters`. |
| `layouts` | Layouts close | In every layout no cell holds two pieces, no socket faces a side without one, the types at every joint meet, the two pieces of every joint touch with no gap and no overlap, and no trim runs into the bodies of the piece next to it. |
| `corners` | Corners line up | Where two outlines meet, every point of one is a point of the other. A point that lies along an edge of the other outline, where it has no point, is a warning: the outlines agree, and a renderer can still show a crack there. |
| `walkable` | Walkable | The player fits through every socket marked as a passage, the floors on the two sides of a joint are level, no rise is higher than the player steps up and no slope is steeper than the player walks. |
| `collision-tiles` | Collision tiles | The collision shapes of two pieces that meet show the same outline at the joint, so that a moving body does not catch on a lip. |

```json
{
  "schema": 1,
  "generator": "corbelo-game-export 0.1.7",
  "kit": "corridor",
  "profile": "godot4",
  "grid": { "moduleMeters": 3, "storeyMeters": 3, "trimMeters": 0.1 },
  "toleranceMeters": 0.0001,
  "player": { "id": "godot4-character-body", "...": "..." },
  "kernel": false,
  "pieces": 7,
  "status": "pass",
  "counts": { "pass": 7, "warn": 0, "fail": 0, "notMeasured": 0 },
  "results": [
    { "id": "on-grid", "status": "pass", "message": "7 pieces of whole modules of 3 m and storeys of 3 m, each with its pivot on a corner of the grid.", "values": { "...": "..." } },
    { "id": "seams", "status": "pass", "message": "136 pairs of sockets that can meet, each with one outline to within 0.0003 m2.", "values": { "...": "..." } }
  ],
  "layouts": [{ "name": "run", "origin": "generated", "placements": [{ "piece": "straight", "cell": [3, 0, 0], "turn": 0 }] }]
}
```

- Each result is `{ id, status, message, values }`, with `reason` added when the status is `"not-measured"`. `message` is one sentence for a person. `values` holds the numbers the check was judged by, and its shape is fixed for each check: `schema/kit-check-report.schema.json` has all seven.
- `status` at the top is the worst of the results. What was not measured does not count.
- `layouts` lists every layout that was checked: the test layouts, then your own. `origin` is `"generated"` or `"given"`.
- Walkable measures the collision shapes a piece brings, and the visible mesh of a piece that brings none. `values.pieces[].geometry` says which.

The options:

| Option | Meaning |
| --- | --- |
| `grid` | Runs the checks for another grid. See below. |
| `player` | A [player profile](#player-profiles) of your own, or the id of an engine profile. Default: the player of the engine the kit is written for. |
| `toleranceMeters` | How near is near enough. Default 0.0001, a tenth of a millimetre. For outlines the allowance is an area: the tolerance times the side of the face. |
| `kernel` | The same [kernel](#a-kernel-for-convex-decomposition) collision takes. Only one thing needs it. |

No check needs a kernel but one part of Layouts close: whether trim that reaches into the piece next to it runs into that piece's bodies. Where the box around the trim is clear of the other piece's triangles that is proven without one. Where it is not, a kernel measures the volume the two share, and without a kernel the check says `"not-measured"` with the reason. It says the same when a body in question is not closed, since such a body has no inside to measure. Every other part of every check is measured either way. The kernel's solids need `intersect(other)` for this, which a `Manifold` has.

#### Another module size

Give `pieces` as a function of the grid and the same kit is checked for another module in one call. The pieces are built again for that grid:

```ts
const kit = { name: "corridor", source, grid: { moduleMeters: 3, storeyMeters: 3 }, pieces: (grid) => piecesFor(grid) };
checkKit(kit);                                               // the kit's own grid
checkKit(kit, { grid: { moduleMeters: 4, storeyMeters: 3.5 } });
```

With `pieces` as a list, the same call measures the pieces as they are against the other grid, which is how to find out that a kit made for 3 m does not fit 2.5 m.

### Kit packs

`exportKitPack(kit)` returns a [pack](#packs), `{ name, manifest, files }`, so `packToZip`, the manifest's checksums and [install](#installing-into-a-game-project) work as for any pack. The files are a GLB for each piece in the order of the pieces, a scene for each layout, and `<name>.pack.json`.

The input is the kit, with these fields added:

| Field | Meaning |
| --- | --- |
| `checks` | The options of `checkKit` without `grid`, or `false` to run none. Default: the checks with their own defaults, and with the kit's own `kernel` when it has one. |
| `pieceChecks` | The options of [`checkGameAsset`](#game-checks), run on every piece, or `false`. Default: each piece is checked as a `"kit-piece"`, with its pivot against the kit's module and with the player of the kit checks. |
| `scenes` | `false` leaves the scenes of the layouts out. Default: one scene for each layout, named by the pattern with the row `layout <name>`: `corridor_layout_room.glb`. |
| `generatedAt`, `revision`, `provenance` | As for a [pack](#packs). |

What stays the same from one revision to the next is what stays for any pack, and for a kit also this: a piece's file is named from the kit and the piece, material slots are in the order of the material names, and in a kit a material name means one colour (`MATERIAL_CONFLICT` otherwise), so every piece that uses `Concrete` shares one slot name and an engine can give them one material.

The manifest is the manifest of a pack, with `"kind": "kit"`, and two parts more:

```json
{
  "schema": 1,
  "kind": "kit",
  "name": "corridor",
  "status": "pass",
  "files": [{ "name": "corridor_straight.glb", "role": "model", "asset": "corridor_straight", "row": "straight", "...": "..." }],
  "scenes": [
    { "name": "corridor_layout_room.glb", "role": "blockout", "mediaType": "model/gltf-binary", "bytes": 30484, "sha256": "...", "layout": "room", "facts": { "...": "the facts of the blockout" } }
  ],
  "kit": {
    "frame": { "up": "Z", "toFile": "x, y, z in the kit is x, z, -y in the files" },
    "grid": { "moduleMeters": 3, "storeyMeters": 3, "trimMeters": 0.1 },
    "cellSize": [3, 3, 3],
    "mates": {},
    "pieces": [
      {
        "name": "stairs",
        "asset": "corridor_stairs",
        "file": "corridor_stairs.glb",
        "cells": [2, 1, 2],
        "pivotMeters": [0, 0, 0],
        "sockets": [
          { "type": "corridor", "side": "-x", "cell": [0, 0, 0], "passage": true, "offsetMeters": 0, "region": null, "name": "-x@0,0,0" },
          { "type": "corridor", "side": "+x", "cell": [1, 0, 1], "passage": true, "offsetMeters": 0, "region": null, "name": "+x@1,0,1" }
        ],
        "trim": []
      }
    ],
    "layouts": [{ "name": "room", "origin": "generated", "placements": [{ "piece": "corner", "cell": [0, 0, 0], "turn": 0 }], "scene": "corridor_layout_room.glb" }],
    "skippedLayouts": [],
    "checks": { "...": "the report of checkKit" },
    "meshLibrary": {
      "cellSize": [3, 3, 3],
      "items": [{ "id": 0, "name": "corridor_straight", "piece": "straight", "file": "corridor_straight.glb", "offset": [-1.5, -1.5, 1.5] }]
    }
  }
}
```

- `files` lists the pieces. `row` is the piece's name, and `checks` is the report of `checkGameAsset` for that piece.
- `scenes` lists the layouts, each with its size, its SHA-256 and the [facts of the blockout](#blockouts). It is there only when scenes were written.
- `kit.pieces` has every piece with its cells, its pivot from the lowest corner of its cells (in metres, in the kit's frame) and its sockets as placed. A socket's `region` is its outline in metres from the middle of the face, or `null` for the whole face.
- `kit.cellSize` and everything under `meshLibrary` are in the files' axes: along X, up, along Z.
- `kit.checks` is there only when the kit checks ran. `kit.skippedLayouts` names the test layouts the kit has no pieces for.
- `status` is the worst of the kit checks and of each piece's game checks. The three player checks of a piece are stored but do not count towards it: they judge a piece standing alone on a floor, and Walkable judges it in its place.

### Blockouts

`exportBlockout(kit, layout, options?)` writes a layout as one scene. `layout` is the name of a test layout or of one of the kit's own, or a layout as data. It returns `{ glb, facts }`.

- There is one node for each placement, named from the piece's asset name and its cell (`corridor_straight_1_0_0`, with `n1` for -1), with the piece's own nodes under it as its own file has them: collision shapes, detail levels and attach points. Their names carry the cell too, around what the engine reads a collision shape or a detail level from, so every name in the scene is its own and the scene collides exactly as the pieces do one at a time.
- Every mesh is stored once. A piece placed twenty times is one mesh shown by twenty nodes, and the same goes for each of its collision meshes.
- Cell `[0, 0, 0]` has its lowest corner at the scene's origin. The kit's X is the scene's X, its Y is -Z and its Z is Y.
- The same input gives the same bytes.

The facts are in the scene extras under `corbeloGameExport.blockout`, in the manifest of a kit pack, and returned:

```json
{
  "schema": 1,
  "generator": "corbelo-game-export 0.1.7",
  "kind": "blockout",
  "kit": "corridor",
  "layout": "room",
  "origin": "generated",
  "profile": "godot4",
  "grid": { "moduleMeters": 3, "storeyMeters": 3, "trimMeters": 0.1 },
  "cellSize": [3, 3, 3],
  "placements": [
    { "piece": "straight", "asset": "corridor_straight", "cell": [0, 1, 0], "turn": 3, "name": "corridor_straight_0_1_0", "node": 6, "translation": [0, 0, -6], "degrees": 270 }
  ],
  "pieces": 3,
  "meshes": { "total": 17, "visible": 3, "collision": 14 },
  "nodes": { "total": 46, "placements": 8, "visible": 8, "collision": 38 },
  "materials": 1,
  "triangles": { "stored": 168, "drawn": 456 },
  "bounds": { "min": [0, 0, -9], "max": [9, 3, 0], "size": [9, 3, 9] }
}
```

- `meshes` says how many meshes the file stores and `nodes` how many nodes show them: here eight pieces of three kinds are three visible meshes on eight nodes.
- `triangles.stored` is what the file holds and `triangles.drawn` what is drawn when every node shows its mesh.
- `placements[].name` is the name of the node that holds the piece and `node` its place in the file's `nodes`. `translation` is where the piece's own origin is in the scene, and `degrees` its turn about +Y.
- `lods` is there only when a piece has detail levels: for each body with levels, in each place, `{ placement, body, levels: [{ level, name, node, visible, deviationMeters }] }`, so an engine can wire the levels of every copy.

The collision in a blockout is each piece's own, written by the engine's name rule. In Godot the room above imports as one scene with 38 static bodies, and its own player walks it: see [Checked against a real engine](#checked-against-a-real-engine).

### A mesh library for a grid of tiles

`kit.meshLibrary` in the manifest is what an engine's grid of tiles needs to paint with the kit: the cell size and one item for each piece.

- `cellSize` is one cell in the files' axes, in metres: `[module, storey, module]`.
- An item has an `id` (the piece's place in the kit), a `name` (the piece's asset name), the `piece`, its `file`, and an `offset`: where the piece's own origin is from the middle of its first cell, in the files' axes. A tile grid places an item at the middle of a cell, so the mesh is moved by `offset`.
- The kit's cell `[i, j, k]` is the grid's cell `(i, k, -j - 1)`, and a `turn` of the kit is that many quarter turns about +Y. A piece of several cells is painted in its first cell and reaches into the others.

For Godot the [add-on](#godot-add-on) builds the `MeshLibrary` and a `GridMap` from this. For Unity and Unreal the numbers are there and nothing is built or claimed.

## Godot add-on

`addons/corbelo_game_export` is a small editor add-on for Godot 4, in GDScript. It reads the manifest of a pack and makes, next to the pack's files, what a game works with. It does nothing besides import: it adds no node types, no dock and no code that runs in a game.

Install it:

1. Copy the folder `addons/corbelo_game_export` into the `addons` folder of the Godot project. It is in this repository and in the installed package, at `node_modules/corbelo-game-export/addons/corbelo_game_export`.
2. Turn it on under Project > Project Settings > Plugins.

Use it by putting a pack's folder anywhere in the project, with [`install`](#install-status-and-pin) or by hand. A pack is a folder with a `<name>.pack.json` and the GLB files it lists. The add-on acts when the editor has imported the files, and again whenever a manifest changes. With no window, `godot --headless --path <project> --import` does the same.

Godot imports each GLB itself: it becomes a scene, and every mesh the file names as collision becomes a `StaticBody3D` with a `CollisionShape3D`. The add-on adds this:

| What | Where | When it is written |
| --- | --- | --- |
| Detail levels on visibility ranges | In the imported scene of each GLB | On every import of the file. |
| A material file for each material of the pack | `materials/<name>.tres` in the pack's folder | Once. |
| A scene for each asset and each blockout | `<asset>.tscn` next to `<asset>.glb` | Once. |
| For a kit: a `MeshLibrary` | `<kit>.meshlib` | For each new revision of the pack. |
| For a kit: a `GridMap` that uses it | `<kit>_gridmap.tscn` | Once. |

**Detail levels.** The files hold the lower levels as hidden nodes. On import each level is shown and given the range of distances it is drawn at, so one level is drawn at a time. Level n starts at its deviation from full detail times a distance, and at least 1 m after the level before it. It ends where the next level starts, and the last level has no end. The distance is the project setting `corbelo_game_export/detail_levels/distance_per_deviation`, in metres of distance for each metre of deviation. It starts at 700, which is where the deviation is about one pixel on a screen 1080 pixels tall with a camera of 75 degrees. The ranges are worked out when Godot imports a file, so after changing the setting, import the pack's files again from the FileSystem dock. In a blockout the levels of every copy of a piece are wired.

**Materials.** For each material of the pack a `StandardMaterial3D` is saved once, from what the file holds, and each GLB's import settings are pointed at it (`use_external`). From then on the meshes use the project's material: change its colour or swap its shader and every piece that uses it follows, and a new revision of the pack keeps using it. A material the project has already pointed somewhere else is left alone.

**Scenes.** `<asset>.tscn` is a scene that inherits the imported one. It is made once and never written again. A new revision of the GLB shows through it, so the meshes update in place, and whatever the game put in the scene stays: a material override, an added child node, a script, a changed property. Node paths stay as they are as long as the bodies keep their names, which [a pack keeps](#names-that-stay). Use this scene in the game, not the GLB.

**The mesh library.** For a kit, an item is made for each piece with its name, its mesh at full detail placed by the item's `offset`, and its collision shapes. The library is written again for each new revision of the pack, and every item keeps its number, by name, so what is painted in a `GridMap` stays painted with the new meshes. The `GridMap` scene has the kit's cell size and the library set, and is made once. If it is later given another cell size than the kit's, the add-on says so and changes nothing.

What it leaves alone: every file it did not make, the per-asset scenes and the `GridMap` scene after it made them, the material files after it made them, and the import settings of a material the project chose itself. The tool menu has one item, Project > Tools > Import Corbelo Packs Again, which checks every pack and writes the mesh libraries again. Only packs written for the `godot4` profile are imported. A pack for another profile is named in a warning and left as Godot imported it.

A new revision comes in the same way as the first: install it over the old one and let Godot import. The files are replaced under the same names, Godot imports the changed ones again, and the add-on brings the rest up to date.

## Installing into a game project

`install` puts a pack into a game project and records it in a lock file at the project's root, so that an agent, a build script or a person can say what is in the project, where it came from and whether anything was changed since. It is not specific to an engine: a project is a folder.

From the command line it is [`install`, `status` and `pin`](#install-status-and-pin). From code in Node:

```ts
import { installPack, pinProject, projectStatus } from "corbelo-game-export/node";

const result = installPack("out/corridor.zip", "/games/demo", { into: "assets" });
const status = projectStatus("/games/demo");  // { ok, packs: [...] }
pinProject("/games/demo", "corridor");
```

The pack is a ZIP archive, as `packToZip` writes it or as another tool packed it, or a folder. It goes into its own folder, `<project>/<into>/<pack name>/`, with `into` being `"assets"` unless given or already recorded for the pack.

- **Checked first.** The pack is held against its own manifest before anything is written: every listed file must be there with the size and the SHA-256 the manifest states. A pack that does not match is refused with `PACK_MISMATCH` and nothing is written. Files in the folder or the archive that the manifest does not list are left out and named in `ignored`.
- **Never outside the project.** Every path is held against the project's folder, as written and through links. A path with `..`, an absolute path, a folder that is a link to somewhere else, a file of the pack's that is a link, and a lock file that points outside are refused with `OUTSIDE_PROJECT`.
- **In place.** Installing a newer pack replaces the files under the same names, adds new ones, and takes away files only the older revision had. A file of the older revision that was changed in the project since is kept where it is and no longer tracked.
- **Nothing overwritten by surprise.** A file in the way that no install put there, or one of the pack that was changed in the project since, is refused with `FILE_IN_THE_WAY`. `force` replaces it.
- **Whole files.** Each file is written next to its place and then moved onto it, and the lock file is written last.
- Paths with spaces are fine. Only the pack's own files are touched: what an engine or a game adds to the pack's folder stays.

`installPack(pack, project, options?)` takes `into`, `pin`, `force` and `dryRun`, and returns what it did:

| Field | Meaning |
| --- | --- |
| `project`, `lockFile` | Absolute paths, with links resolved. |
| `pack`, `kind`, `into` | The pack's name, `"asset"`, `"family"` or `"kit"`, and its folder from the project's root. |
| `from`, `to` | The revision in the project before, when there was one, and the one after: `{ revision?, digest }`. `digest` is the SHA-256 of the manifest. |
| `inTheBuild`, `pinned` | The revision pinned as in the build, and whether it is the one installed. |
| `changes` | Every file of the pack and of the revision before: `{ path, change, from?, to?, forced? }` with `change` one of `added`, `changed`, `unchanged`, `removed`, `kept`. Paths are from the project's root. |
| `counts` | How many of each. |
| `ignored` | Files given that the manifest does not list. |
| `dryRun` | `true` when nothing was written. |

### In the build

The lock file holds two revisions for each pack: the one whose files are in the project, and the one that is in the build. A first install sets both. Installing a newer pack moves only the first, so a game can try a new revision while the lock file still says which one shipped. `pin`, or `install` with `pin`, moves "in the build" to what is installed. `status` says for each pack whether the two are the same, and `pin` is refused with `PACK_MISMATCH` when the files in the project are not the ones the lock file says.

### The lock file

`corbelo-game-export.lock.json`, at the root of the project:

```json
{
  "schema": 1,
  "packs": [
    {
      "name": "corridor",
      "kind": "kit",
      "into": "assets/corridor",
      "manifest": "corridor.pack.json",
      "generator": "corbelo-game-export 0.1.7",
      "profile": "godot4",
      "revision": "r7",
      "digest": "bc4267ac5434a0c8c3e147d72584bffff5f4b9f32c9eebd7fb332fa09f59e9e7",
      "inTheBuild": { "revision": "r7", "digest": "bc4267ac5434a0c8c3e147d72584bffff5f4b9f32c9eebd7fb332fa09f59e9e7" },
      "provenance": { "document": "corridor", "version": 7 },
      "files": [
        { "path": "corridor.pack.json", "role": "manifest", "bytes": 156085, "sha256": "bc4267ac5434a0c8c3e147d72584bffff5f4b9f32c9eebd7fb332fa09f59e9e7" },
        { "path": "corridor_layout_room.glb", "role": "blockout", "bytes": 30484, "sha256": "562cd6412c612df8f5dca968f3c44aea4b9caf188aa1ddf7a3acd23b8493d91f", "layout": "room" },
        { "path": "corridor_straight.glb", "role": "model", "bytes": 9660, "sha256": "ce8ce96caf778f9c6ab559bbd27f90846b39b85827f542308267beffa611c0ff", "asset": "corridor_straight", "row": "straight" }
      ]
    }
  ]
}
```

- Shown with three of the kit's fourteen files. Packs are in the order of their names and files in the order of their paths, and each file is one line. A new revision changes the lines of the files that changed and three or four lines above them, so a diff is small and reads well.
- `into` is the pack's own folder from the project's root, with `/` between folders. A file's `path` is from that folder.
- `digest` is the SHA-256 of the manifest of the pack whose files are in the project. Two packs with one digest are the same pack. `revision` is your own name for it, there when the pack has one, and so is `generatedAt`.
- `role` is `"model"`, `"blockout"` or `"manifest"`. A model has `asset`, and `row` in a family or a kit. A blockout has `layout`.
- `provenance` is the pack's own, as given when it was made. A file that has provenance of its own in the manifest carries it on its line.
- `schema/lock.schema.json` describes it.

The lock file and the plan are also plain functions in the main entry, with no file system, for a caller that keeps a project somewhere else: a browser, a store of its own, a test.

| Function | What it does |
| --- | --- |
| `readZip(archive, { inflate? })` | The files of a ZIP archive as `[{ name, bytes }]`, each checked against its CRC-32. Stored files need nothing. Deflated ones need `inflate`, a function `(data, bytes)` from the raw deflate stream and the size the archive states to the file, since the package brings no decompressor: in Node, `inflateRawSync` of `node:zlib`. Refused with `BAD_ZIP`: what is not a ZIP, an archive in parts or with the 64-bit extension, an encrypted file, another way of packing, a name that would leave the folder, and two files of one name. |
| `verifyPack(files)` | Checks `[{ name, bytes }]` against the manifest among them and returns `{ name, manifest, manifestName, digest, files, ignored }`. The files may all sit in one folder of the archive. |
| `planInstall(pack, lock, present, options?)` | Plans an install and writes nothing. `lock` is the lock file now, or `undefined`. `present(path)` returns the SHA-256 of what is in the project at a path from its root, or `undefined`. Returns the fields of `installPack` above and `write` (`[{ path, bytes }]`), `remove` (paths) and `lock`, the lock file after. |
| `lockJson(lock)`, `parseLock(text)` | The lock file as text, in the layout above, and back. `parseLock` refuses with `BAD_LOCK` what is not a lock file, and with `OUTSIDE_PROJECT` one whose paths leave the project. |
| `lockStatus(lock, present)` | `{ ok, packs: [{ name, kind, into, installed, inTheBuild, pinned, matches, counts, changed, missing }] }`. `ok` is true when every pack matches the lock file and is the revision in the build. |
| `pinLock(lock, name?)` | A lock file with "in the build" moved to what is installed, for one pack or for all. |

`LOCK_FILE_NAME` and `DEFAULT_INSTALL_FOLDER` are the two names.

## Engine profiles

A profile decides which unit the facts are also reported in, and it is stored in the file's extras. It does not change the geometry: the GLB is always metres and Y up, as glTF requires, and each engine's importer converts from there.

| Profile | Unit | Up |
| --- | --- | --- |
| `godot4` | 1 m | Y |
| `unity6` | 1 m | Y |
| `unreal5` | 1 cm | Z |

Each profile also carries the engine's node-name conventions as data, in `ENGINE_PROFILES[id].conventions`:

- Godot: collision suffixes `-col`, `-convcol`, `-colonly`, `-convcolonly`.
- Unreal: collision prefixes `UCX_`, `UBX_`, `USP_`, `UCP_`, written `UCX_{name}_{nn}`, and detail levels `{name}_LOD{n}`.
- Unity: detail levels `{name}_LOD{n}`.

[`exportGameAsset`](#game-assets) names collision shapes and detail levels by these conventions, and every export keeps body names clear of them. For collision it uses the rule for a convex shape that is not drawn (`-convcolonly` in Godot, `UCX_` in Unreal), and for one box the rule for a box where the engine has one (`UBX_`).

You can pass your own profile object with the same shape instead of an id. Its `conventions` then decide the names: a collision rule with the role `collision-box`, `collision-convex-only` or `collision-convex`, and a level rule with the role `lod`. A pattern may use `{name}`, `{n}` counted from 0 and `{nn}`, the same with two digits.

What has been tried in which engine:

| Engine | What is known |
| --- | --- |
| Godot 4 | Imported with the engine itself, in the tests. See [Checked against a real engine](#checked-against-a-real-engine). |
| Unity 6 | Not tried. The files carry the level names Unity's importer documents and plain names for collision. Nothing is claimed beyond the names. |
| Unreal Engine 5 | Not tried. The files carry the collision and level names Unreal documents for static meshes. Nothing is claimed beyond the names, and whether Unreal's glTF importer acts on them has not been checked. |

## Reading files back

```ts
import { readGlb, readAccessor, readPack, readStl } from "corbelo-game-export";

const { json, bin } = readGlb(glb);         // the glTF JSON and the binary chunk
const positions = readAccessor({ json, bin }, 1);
const pack = readPack(glb);                 // generator, profile, facts, provenance, bodies
const stl = readStl(bytes);                 // { positions, triangles, format, name }
```

`readPack` returns each body's name, translation, positions, normals, indices and material, and `texcoords` (u, v per vertex, empty when the file has none). It returns bodies at full detail only: collision shapes, lower detail levels and attach points are not bodies, and the facts say which nodes and meshes they are. To read one of those, use its `mesh` from the facts with `readGlb` and `readAccessor`. For a body with several colours, `positions`, `normals` and `indices` hold every primitive one after another, `surfaces` says where each primitive's vertices and triangles start and which material it has, and `material` is the first one. The GLB reader is small on purpose. It reads the files this package writes and other plain GLB files, refuses sparse accessors and external buffers, and does not decode compressed meshes.

`readStl` reads binary and ASCII STL. It returns triangle soup, ready to use as a body's `positions`.

## Command line

```sh
corbelo-game-export job.json [--out file.glb] [--facts file.json]
```

The job file is JSON. Bodies are STL files:

```json
{
  "bodies": [
    { "name": "Block", "stl": "block.stl", "color": "#d98a3d" },
    { "name": "Lid", "stl": "lid.stl", "color": "#2980ba", "materialName": "Blue Paint" }
  ],
  "source": { "unit": 0.001, "up": "Z" },
  "profile": "godot4",
  "pivot": "base-center",
  "placement": "designed",
  "creaseAngle": 30,
  "output": { "glb": "block.glb", "facts": "block.facts.json" }
}
```

STL cannot say which CAD face a triangle came from. A body may name a file that does: `"faceIds": "block.faces.json"`, a JSON array with one whole number per triangle in the STL's own order. See "Normals" for what the ids change.

STL cannot say what colour a triangle is either. A body may name a file for that too: `"faceColors": "block.colors.json"`, a JSON array with one entry per triangle in the STL's own order, each a colour (`"#rrggbb"`, `"#rgb"` or `[r, g, b]`) or `null` for the body's own colour. See [Bodies with several colours](#bodies-with-several-colours).

A body may name the materials of its face colours in the job itself: `"faceMaterialNames": { "#c0392b": "Signal Red" }`.

A body may also say what it was cut from, as [`refines`](#a-body-cut-from-a-coarser-mesh) does in code. The surfaces are STL files and the two lists are JSON files, each an array with one whole number per triangle of the body's STL:

```json
{
  "name": "Post",
  "stl": "post.painted.stl",
  "faceColors": "post.colors.json",
  "refines": {
    "surfaces": [{ "stl": "post.stl", "faceIds": "post.faces.json" }],
    "triangleOf": "post.triangle-of.json"
  }
}
```

With more than one surface, add `"surfaceOf"`, a file of the same kind that says which surface each triangle lies in.

Every option from the table above may appear at the top level of the job. Unknown keys are refused. Paths inside the job are relative to the job file. `--out` and `--facts` are relative to the working directory and win over the job. Without a facts path, the facts are written next to the GLB as `<name>.facts.json`.

On success the command prints one line of JSON and exits with 0:

```json
{"glb":"/work/block.glb","facts":"/work/block.facts.json","bytes":5784,"bodies":2,"triangles":24,"vertices":48,"materialSlots":2}
```

On failure it prints `corbelo-game-export: error [CODE]: message` to standard error and exits with 1. A wrong command line exits with 2.

The same holds for every command below. All the exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Done. For `pack` and `check` also when checks fail: read `status`. |
| 1 | Refused. One line `corbelo-game-export: error [CODE]: message` is on standard error, with a code from [Refusals](#refusals), and nothing was written. |
| 2 | A wrong command line: an unknown option, a missing value or a missing path. |
| 3 | Only with `--strict`: `check` found a failing check, or `status` found a project that is not what its lock file says or not the revision in the build. |

The same thing is available from code in Node:

```ts
import { runJob } from "corbelo-game-export/node";

const { glb, facts, report } = runJob("job.json");
```

### pack

```sh
corbelo-game-export pack <job.json | -> [--dir <folder>] [--zip <file.zip>] [--base <folder>]
```

Makes a [pack](#packs): one game asset, or a family of them, with the manifest. The job is JSON, from a file or from standard input with `-`, so a program in any language can run it without writing a job file:

```sh
echo "$JOB" | corbelo-game-export pack - --base /work/in --dir /work/out --zip /work/out/crate.zip
```

```json
{
  "name": "corner bench",
  "source": { "unit": 0.001, "up": "Z" },
  "profile": "godot4",
  "bodies": [
    {
      "name": "Bench",
      "stl": "bench.stl",
      "color": "#8a6f4d",
      "lods": [{ "stl": "bench-lod1.stl" }],
      "collisionPieces": [{ "stl": "bench-seat.stl" }, { "stl": "bench-back.stl" }],
      "attachPoints": [{ "name": "Seat", "position": [150, 150, 400], "direction": [0, 0, 1] }]
    }
  ],
  "collision": "auto",
  "texcoords": { "tileMeters": 0.5 },
  "checks": { "assetClass": "small-prop" },
  "revision": "r12",
  "output": { "dir": "out", "zip": "out/corner_bench.zip" }
}
```

The keys of a pack job:

| Key | Meaning |
| --- | --- |
| `name` | Required. The asset's name, or the family's. |
| `source` | Required. As in code. |
| `bodies` | One asset: a list of bodies. Give this or `rows`. |
| `rows` | A family: `[{ "name": "small", "bodies": [...], "provenance": ... }]`. |
| `profile`, `pivot`, `placement`, `creaseAngle`, `normals`, `weldTolerance`, `maxTriangles`, `colorSpace`, `provenance` | As in the [options](#options). `profile` may be an id or a profile object. |
| `collision` | A shape by name, or `{ "shape", "tolerance", "maxPieces", "maxHullVertices" }`. |
| `texcoords` | `true` or `{ "tileMeters": 0.5 }`. |
| `kernel` | Only `"manifold-3d"`. Loads that package for a general convex decomposition. It must be installed next to this one, and the job is refused with `BAD_JOB` when it is not. |
| `naming` | The [name pattern](#names-that-stay). |
| `checks` | The [options of the checks](#check-options), or `false` for none. |
| `generatedAt`, `revision` | Text, written into the manifest. |
| `output` | `{ "dir": "out", "zip": "out/pack.zip" }`: a folder for the files, an archive, or both. |

A body of a pack job has the keys of a body of a plain job (`name`, `stl`, `color`, `materialName`, `faceIds`, `faceColors`, `faceMaterialNames`, `refines`) and three more:

| Key | Meaning |
| --- | --- |
| `lods` | `[{ "stl": "lod1.stl", "faceIds": "lod1.faces.json", "faceColors": "lod1.colors.json" }]`, the nearest to full detail first. The two JSON files are optional and read like a body's. |
| `collisionPieces` | `[{ "stl": "piece.stl" }]`. Only the points of each file are used. |
| `attachPoints` | `[{ "name": "Seat", "position": [150, 150, 400], "direction": [0, 0, 1] }]`, written in the job itself, in source units and axes. |

Unknown keys are refused, at every level. Paths inside the job are relative to the job file. For a job on standard input they are relative to `--base`, or to the working directory without it. `--dir` and `--zip` are relative to the working directory and win over the job's `output`. A job with nowhere to write is refused.

On success the command prints one line of JSON and exits with 0. `status` is the worst result of the checks, and is left out when the job ran none. The manifest has no `sha256`, since it is the file that lists them:

```json
{"name":"corner_bench","status":"pass","dir":"/work/out","zip":"/work/out/corner_bench.zip","files":[{"name":"corner_bench.glb","mediaType":"model/gltf-binary","bytes":8732,"sha256":"81a50095578924eb8fb34d4e172388b026651b306e912b84b0e3a2c05a97fdf2","path":"/work/out/corner_bench.glb"},{"name":"corner_bench.pack.json","mediaType":"application/json","bytes":15020,"path":"/work/out/corner_bench.pack.json"}]}
```

A pack whose checks fail is still written and still exits with 0: read `status`. A job that is refused prints the error line and exits with 1, and a wrong command line exits with 2, as above.

From code in Node:

```ts
import { runPackJob } from "corbelo-game-export/node";

const { name, status, dir, zip, files, pack } = await runPackJob(job, { base: "/work/in", dir: "/work/out" });
```

`job` is the job as an object. The options are `base` (the folder the job's paths are relative to, default the working directory), `dir` and `zip` (in place of the job's `output`), and `kernel` (a kernel object, in place of the one the job names). With nowhere to write, nothing is written and the pack is only returned.

#### A kit job

A job with `pieces` in place of `bodies` or `rows` makes a [kit pack](#kit-packs):

```json
{
  "name": "corridor",
  "source": { "unit": 0.001, "up": "Z" },
  "grid": { "moduleMeters": 3, "storeyMeters": 3 },
  "collision": "pieces",
  "pieces": [
    {
      "name": "straight",
      "bodies": [{ "name": "straight", "stl": "straight.stl", "color": "#8a8f98", "materialName": "Concrete", "collisionPieces": [{ "stl": "straight-floor.stl" }, { "stl": "straight-left.stl" }, { "stl": "straight-right.stl" }] }],
      "sockets": [
        { "type": "corridor", "side": "+x", "passage": true },
        { "type": "corridor", "side": "-x", "passage": true }
      ]
    },
    {
      "name": "endcap",
      "glb": "endcap.glb",
      "sockets": [{ "type": "corridor", "plane": { "point": [3, 1.5, -1.5], "normal": [1, 0, 0] }, "passage": true }]
    }
  ],
  "layouts": [{ "name": "hall", "placements": [{ "piece": "endcap", "cell": [0, 0, 0] }, { "piece": "straight", "cell": [1, 0, 0] }, { "piece": "endcap", "cell": [2, 0, 0], "turn": 2 }] }],
  "revision": "r7",
  "output": { "dir": "out", "zip": "out/corridor.zip" }
}
```

It takes the keys of a pack job but `bodies`, `rows`, `pivot` and `placement`, and these:

| Key | Meaning |
| --- | --- |
| `grid` | Required. `{ "moduleMeters": 3, "storeyMeters": 3, "trimMeters": 0.1 }`. |
| `pieces` | Required. A list of pieces, each with `name` and with `bodies` (as in a pack job) or `glb` (the path of a GLB this package wrote), and optionally `cells`, `origin`, `pivot`, `sockets`, `trim` and `provenance`, as [in code](#the-kit-as-data). |
| `mates`, `layouts` | As in code. |
| `checks` | The options of the kit checks, `{ "player", "toleranceMeters" }`, or `false` for none. |
| `pieceChecks` | The [options of the game checks](#check-options) run on each piece, or `false` for none. |
| `scenes` | `false` leaves the scenes of the layouts out. |
| `kernel` | `"manifold-3d"`, as in a pack job. The kit checks then also measure where a piece's trim runs into the piece next to it. |

Sockets, cells, origins and layouts are written in the job itself. `schema/kit-job.schema.json` describes the whole job. The line printed lists the scenes with the pieces, each with its SHA-256, and `status` is the pack's.

### check

```sh
corbelo-game-export check <file.glb> [--class <class>] [--options <file.json>] [--strict]
```

Runs the [game checks](#game-checks) on a GLB this package wrote and prints the report as one line of JSON. `--class` is `small-prop`, `large-prop` or `kit-piece`. `--options` names a JSON file with the options of `checkGameAsset`, and `--class` wins over the class in it. The command exits with 0 whatever the checks say, unless `--strict` is given: then a report whose `status` is `"fail"` exits with 3.

From code in Node: `checkFile(path, options)` in `corbelo-game-export/node`.

### install, status and pin

```sh
corbelo-game-export install <pack.zip | folder> --project <dir> [--into <folder>] [--pin] [--force] [--dry-run] [--text]
corbelo-game-export status [--project <dir>] [--strict] [--text]
corbelo-game-export pin [<pack name>] --project <dir> [--text]
```

`install` puts a pack into a game project and writes the [lock file](#the-lock-file) at the project's root, as [Installing into a game project](#installing-into-a-game-project) describes. The pack's files go into `<project>/<into>/<pack name>/`.

| Option | Meaning |
| --- | --- |
| `--project` | Required for `install` and `pin`. The game project's folder, which must exist. For `status` it is the working directory unless given. |
| `--into` | The folder of the project the pack's own folder goes into, from the project's root. Default: where the lock file says the pack is, else `assets`. |
| `--pin` | Also moves "in the build" to the revision being installed. A first install always sets it. |
| `--force` | Replaces a file in the way that no install put there, or that was changed in the project since. |
| `--dry-run` | Checks everything and prints what would be done. Writes nothing. |
| `--text` | Prints for a person in place of the line of JSON. |
| `--strict` | For `status`: exits with 3 unless every pack matches the lock file and is the revision in the build. |

Each prints one line of JSON and exits with 0. For `install` it is the result of `installPack`:

```json
{"project":"/games/demo","lockFile":"/games/demo/corbelo-game-export.lock.json","pack":"crate","kind":"asset","into":"assets/crate","to":{"revision":"r1","digest":"ea3af086ad4f2fab2ae6ccb049af4ad0e8559ae954fc8f2de0ac2a4f6cd74d57"},"inTheBuild":{"revision":"r1","digest":"ea3af086ad4f2fab2ae6ccb049af4ad0e8559ae954fc8f2de0ac2a4f6cd74d57"},"pinned":true,"changes":[{"path":"assets/crate/crate.glb","change":"added","to":"2435cc0a1667779a491f01f252552e032cadda512846183167dc282785876654"},{"path":"assets/crate/crate.pack.json","change":"added","to":"ea3af086ad4f2fab2ae6ccb049af4ad0e8559ae954fc8f2de0ac2a4f6cd74d57"}],"counts":{"added":2,"changed":0,"unchanged":0,"removed":0,"kept":0},"ignored":[]}
```

With `--text`, here for a newer revision of the same pack:

```
Installed crate (asset) into assets/crate: r1 (ea3af086ad4f) -> r2 (4f61d4f4977b)
  changed   assets/crate/crate.glb
  changed   assets/crate/crate.pack.json
In the build: r1 (ea3af086ad4f). Installed is r2 (4f61d4f4977b): run pin to put it in the build.
```

`status` compares the project with its lock file and writes nothing. It prints `{ project, lockFile, ok, packs }`, with for each pack what `lockStatus` returns:

```json
{"project":"/games/demo","lockFile":"/games/demo/corbelo-game-export.lock.json","ok":false,"packs":[{"name":"crate","kind":"asset","into":"assets/crate","installed":{"revision":"r2","digest":"4f61d4f4977b8d583f6e9adad62e281981838c574b283562498f6a5646538b42"},"inTheBuild":{"revision":"r1","digest":"ea3af086ad4f2fab2ae6ccb049af4ad0e8559ae954fc8f2de0ac2a4f6cd74d57"},"pinned":false,"matches":true,"counts":{"same":2,"changed":0,"missing":0},"changed":[],"missing":[]}]}
```

```
crate (asset) in assets/crate: r2 (4f61d4f4977b), 2 files as installed
  in the build: r1 (ea3af086ad4f), not the revision installed
```

`ok` is true when every file of every pack is in the project with the bytes the lock file says, and every pack is the revision in the build. The command exits with 0 whatever it finds, unless `--strict` is given: then it exits with 3 when `ok` is false, which is how a build script stops on a changed or unpinned pack.

`pin` moves "in the build" to the installed revision, for the pack named or for every pack, writes the lock file and prints the status after. It is refused when a file of a pack to pin is not the one the lock file says.

A refusal prints the error line and exits with 1, with nothing written:

```
corbelo-game-export: error [FILE_IN_THE_WAY]: Nothing was installed: assets/crate/crate.glb was changed in the project since it was installed. Move what is in the way, or install with force to replace it.
```

From code in Node: `installPack`, `projectStatus` and `pinProject` in `corbelo-game-export/node`, and `runCommand(argv, io)` for the whole command line, which returns the exit code and never throws.

## Refusals

Bad input is refused with a `GameExportError`. Its `code` is stable and its `message` says what is wrong and where. Nothing is fixed silently. A refusal found while one body was checked or built also has `body`, that body's place in the input counted from 0, so a caller can act on that body: for instance export it again without `refines` after a `BAD_REFINEMENT`. A refusal about names or colours, which are read across all bodies, has none.

| Code | When |
| --- | --- |
| `NO_BODIES` | There are no bodies. |
| `EMPTY_BODY` | A body has no vertices or no triangles. |
| `ALL_DEGENERATE` | Every triangle of a body has no area. |
| `BAD_POSITIONS` | Positions are not whole vertices, or not whole triangles when there are no indices. |
| `NON_FINITE_POSITION` | A coordinate is NaN, infinite or not a number. The message names the vertex. |
| `BAD_INDICES` | Indices are not whole triangles of whole numbers. |
| `INDEX_OUT_OF_RANGE` | An index points past the vertices, or is negative. |
| `BAD_FACE_IDS` | `faceIds` is not exactly one whole number per triangle. |
| `BAD_FACE_COLORS` | `faceColors` is not a list with exactly one entry per triangle. |
| `BAD_REFINEMENT` | `refines` is not surfaces and one whole number per triangle, a number points past the surfaces or their triangles, or a triangle does not lie where it says it does. |
| `TOO_MANY_TRIANGLES` | The bodies together hold more than `maxTriangles` triangles (2,000,000 unless changed), or the meshes they refine do. |
| `BAD_NAME` | A body has no name or an empty material name, or `faceMaterialNames` is not an object of names. Also a name pattern with an unknown part or without the family, and a family or row name with no letter or digit. |
| `BAD_COLOR` | A colour cannot be read. Transparency is not supported. For a face colour the message names the triangle. |
| `MATERIAL_CONFLICT` | One material name is used with two colours, or one colour of a body is given two names. In a family, also one name with two colours in two rows, and in a kit in two pieces. |
| `BAD_SOURCE_SPACE` | `source` is missing or has a bad unit, up axis or handedness. |
| `BAD_OPTION` | An option is outside its range, or the profile is unknown. This covers the collision settings, `texcoords`, `kernel` and the options of the checks. |
| `BAD_PROVENANCE` | `provenance` is not plain JSON. |
| `BAD_STL` | An STL file cannot be read. |
| `BAD_GLB` | A GLB file cannot be read, or one given to the checks was not written by this package. |
| `BAD_JOB` | A job file is missing, is not valid JSON or has a wrong or unknown key. Also a pack job with nowhere to write, or one that names a kernel that is not installed. |
| `BAD_LOD` | `lods` is not a list of meshes. A level's own positions, indices, face ids and face colours are refused under the codes above, and the message names the level. |
| `BAD_COLLISION` | `collisionPieces` is not a list of at least four finite points each, a collision shape asked for by name cannot be built, or the kernel failed when `"decomposition"` was asked for by name. Under `"auto"` a kernel that fails is passed over with a note. |
| `BAD_ATTACH_POINT` | An attach point has no name, no position of three finite numbers, or a direction of no length. |
| `BAD_PACK` | A pack has both `bodies` and `rows` or neither, an empty or badly formed row, two rows that come out with one name, or `checks`, `generatedAt` or `revision` of the wrong kind. Also a pack to install that has no manifest, more than one, or one that is not a manifest of this package or lists a file name that would leave the pack's folder. |
| `BAD_KIT` | A kit cannot be read: no name, grid or pieces, a grid that is not positive numbers, two pieces of one name, a piece with both `bodies` and `glb` or neither, cells that are not whole numbers, a socket with no type, with both `side` and `plane` or neither, on a cell the piece does not have, on a face between two cells of its own piece, with a plane turned more than 1 degree from every axis, or two sockets of one name in a piece. Also `mates` that give one type two types to meet, two pieces that come out with one file name, `pivot` or `placement` given for the whole kit, and a layout's scene that comes out with the name of another file. |
| `BAD_LAYOUT` | A layout has no name or no placements, shares its name with another, names a piece the kit does not have, has a cell that is not whole numbers or a turn that is not a whole number, or a layout asked for by name is not one of the kit's. |
| `BAD_ZIP` | An archive is not a ZIP, is in parts, uses the 64-bit extension, holds an encrypted file, a file packed another way than stored or deflate, a deflated file with no `inflate` given, a name that would leave its folder, two files of one name, or a file whose bytes do not match its checksum. |
| `BAD_LOCK` | The lock file is not one, is not a plain file, or has no pack of the name given. Also `status` and `pin` in a project with no lock file. |
| `PACK_MISMATCH` | A file the manifest of a pack lists is missing, has another size or has another SHA-256. Also `pin` when the files in the project are not the ones the lock file says. |
| `OUTSIDE_PROJECT` | A path would leave the project's folder, as written or through a link: `into`, a folder on the way that is a link to somewhere else, a path in the lock file, or a file that is a link. |
| `FILE_IN_THE_WAY` | A file is where the pack's goes and no install put it there, or it was changed in the project since. Also a folder where the pack has a file, and a file where it needs a folder. `force` replaces the first two. |

Every body is checked before any is exported.

## Checked against a real engine

The test suite includes a proof that runs when a `godot` 4 program is on the path (or its location is in the `GODOT` environment variable). It builds a chamfered block, a cylinder, a file with two coloured bodies and a file with two bodies that have colours on their faces, puts them in a throwaway Godot project in the system's temporary folder, and runs Godot's own editor importer on them with no window (`godot --headless --import`). A GDScript then loads the imported scenes and reports what Godot ended up with, and the test compares that with the facts: node names, mesh size in metres, normals, vertex and triangle counts, materials and colours, and pivot positions.

For the bodies with colours on their faces it checks that each body arrives as one mesh with one surface per colour, in the order the facts list the slots, that each surface has the material, the colour and the triangle and vertex counts the facts state, that the painted triangles are the right ones, and that a cylinder whose side is half one colour and half another is still shaded round across the two lines where the colours meet.

It also imports a post painted across the flat sides of its round wall, which cuts them finer, twice. Written from the cut mesh alone, Godot holds normals that are more than 7 degrees away from straight out from the axis at the points the paint added. Written with `refines`, every normal of the wall is within a tenth of a degree of straight out, and the paint arrives under the name `faceMaterialNames` gave it.

Two game assets from [`exportGameAsset`](#game-assets) go through the same importer:

- **A ring with a hole through it**, 1.2 m across and 0.4 m tall, with twelve wedges given as collision pieces, two lower detail levels, texture coordinates at half a metre a tile and two attach points. Godot builds the collision itself on import: each `Ring_nn-convcolonly` mesh arrives as a `StaticBody3D` named `Ring_nn` holding one `CollisionShape3D` with a `ConvexPolygonShape3D`, twelve in all, with the points the file gave to within a millimetre. No shape reaches the middle of the ring, so the hole stays open. The ring measures what the facts say. `Ring_LOD1` and `Ring_LOD2` arrive as mesh nodes of their own under the ring, hidden, with the triangle counts the facts state. Every level has texture coordinates at the scale asked for and tangents that follow them. The attach points arrive as empty `Node3D` nodes where the facts say, with +Z along the direction given.
- **A wall with a doorway**, 3 m wide and 2.8 m tall, cut into convex parts by the `manifold-3d` kernel. Godot builds three convex shapes, the doorway stays open, and the game checks find that Godot's own character fits through it.

Each convex piece is a static body of its own in Godot, since that is what the name rule makes. A game that wants one body with several shapes moves the shapes under one body after import.

A second proof takes a kit, the add-on and `install` through the same engine. It runs when `godot` is there and is skipped the same way.

- **A closed room of a corridor kit**, eight pieces of three kinds on a 3 m grid, written by [`exportBlockout`](#blockouts) as one file. Godot imports it as one scene with a node for each placement under the names the facts give, every piece in its cell. A piece placed many times is one mesh in Godot too: eight nodes show three meshes. The collision is the file's own: 38 static bodies, each with one convex shape. A `CharacterBody3D` with Godot's default capsule, 1 m across and 2 m tall, is put on the floor and walked with `move_and_slide`: through the doorway, on until the wall at the far end stops it, then along the next side of the room until that wall stops it, on the floor all the way. On the line of a doorpost, the post stops it.
- **The add-on on packs that `install` put there.** A post with two materials and two lower detail levels, and the corridor kit with a lamp in its end cap, are installed into a project with the add-on's folder copied into `addons` and turned on. After one import with no window, the post has a scene that inherits the imported file and states nothing of its own, with its collision body, its three levels all shown and each drawn from where the one before it stops, and its two materials as files of the project under the pack's names and colours. In the scene of a layout, the levels of the lamp are wired in every place the end cap is.
- **The mesh library.** The kit's `MeshLibrary` has an item for each of the seven pieces, with the number and the name the manifest gives it, its mesh around the middle of its first cell, a collision shape for each of its collision pieces and the project's materials. The `GridMap` scene has the kit's cell size. The room painted cell by cell, by the mapping in [A mesh library for a grid of tiles](#a-mesh-library-for-a-grid-of-tiles), is the room of the layout's scene piece for piece, a piece of two cells and two storeys lands on its cells when turned, and the same player walks the painted room the same way.
- **Importing again changes nothing.** A second import leaves every file of the project as it was and the add-on says nothing, and `status` finds the pack's own files as `install` put them.
- **A new revision, in place.** A game's changes are made first: a material override on one surface of the post's scene, a node added under its mesh, another colour for one of the project's materials, and a piece painted on a grid. Then a thicker post and the kit with its pieces in another order are installed over the old ones. The game's scene was not written again, and shows the new mesh and the new collision. Every node is where it was by the same path, the added node and the override are still there, the project's materials are still the project's with the colour the game gave one, the detail levels are wired again, and every item of the library kept its number, so what was painted stays.
- **Turned on later, and the setting.** A pack imported while the add-on was off, into another folder than `assets` and from a folder instead of an archive, is wired when the add-on is turned on, with the project's own distance for detail levels: at half the default the lower level starts half as far away. A material file that comes back under another identifier is pointed at again, once.

Without Godot the proof is skipped and a line on standard error says so. Set `GODOT_PROOF_LOG=1` to print what Godot reported.

It has been run with Godot 4.7.2. Unity and Unreal have not been tested with the engines themselves: for those two the package writes the names their documentation gives and claims nothing about what their importers do with them.

A second check runs when a `blender` program is on the path (or its location is in the `BLENDER` environment variable). Blender is not a game engine, but its glTF importer was written by other people, so it is a second opinion on the same files. A Python script imports the block, the cylinder, the two-body file and the file with colours on the faces with no window and reports what Blender holds, and the test compares that with the facts: body names, triangle counts, where each body is and how large in metres, that every triangle faces outwards, that the normals arrive as written (flat on the block's faces, smooth round the cylinder), material names and colours, and for a body with several colours the number of triangles in each material slot. The painted post is checked there the same two ways as in Godot. Without Blender it is skipped the same way. It has been run with Blender 5.2.2.

### Why there are tangents

Every vertex carries a tangent: a unit vector at a right angle to its normal, with `w` set to 1. Without texture coordinates the tangent says nothing about a texture. It is there for the engine. With [texture coordinates](#texture-coordinates) it points the way u grows, as a texture with a normal map needs.

Godot compresses imported meshes by default, and a compressed mesh stores each normal together with a tangent. For a mesh that has no tangents Godot makes one up from the normal, by a rule that gives a vector of no length when the normal points exactly along `(1, 1, -1)` or `(-1, -1, 1)`. Godot then stores a wrong normal for that vertex. On a block with all eight corners chamfered equally, two of the eight corner faces shade wrongly.

With a tangent in the file Godot never makes one up. The proof imports the chamfered block with Godot's default settings and checks the normals of all 44 triangles, those two corners included, and imports it once more with compression off to check that the positions arrive exactly as written.

## Size in a browser bundle

The package is marked `"sideEffects": false` and does no work when it is imported, so a bundler leaves out everything you do not use. A page that only writes a plain GLB carries none of the collision, check, pack, archive or hash code. `npm run size` measures it: each line is a browser bundle of one import from the main entry, minified by esbuild.

| Import | Minified | Gzipped |
| --- | --- | --- |
| `exportGameGlb` | 31,557 bytes | 12,429 |
| `readPack` | 4,634 | 2,043 |
| `exportGameAsset` | 54,156 | 21,134 |
| `checkGameAsset` | 29,565 | 11,124 |
| `exportGamePack` | 89,001 | 33,674 |
| `readZip` | 3,362 | 1,507 |
| `verifyPack` | 5,087 | 2,368 |
| `planInstall` | 3,379 | 1,525 |
| `checkKit` | 107,653 | 40,100 |
| `exportBlockout` | 79,841 | 30,110 |
| `exportKitPack` | 136,638 | 50,089 |
| everything | 160,268 | 57,944 |

Version 0.1.5, measured the same way, was 31,557 bytes (12,434 gzipped) for `exportGameGlb` and 90,673 (34,432) for everything. The plain export did not grow in 0.1.6: kits, blockouts, the archive reader and the lock file are modules of their own, and an import that does not name them carries none of them. `exportGamePack` did not grow either. A page that checks a kit carries the scene writer, the collision code and the game checks with it, since a kit is measured from the files its pieces are written as. A page that only installs a pack somewhere of its own carries `readZip`, `verifyPack` and `planInstall`: about 8 kB together, 3.5 kB gzipped.

Version 0.1.6 was 52,169 bytes (20,267 gzipped) for `exportGameAsset`, 27,619 (10,453) for `checkGameAsset` and 156,359 (56,445) for everything. Version 0.1.7 added about 2 kB to each of the two: the search that opens a hole through a body and the reasons a body cannot be cut up are in the collision code, and what the checks say in words is in the checks. The plain export and the install tools did not grow.

The test suite bundles each of these and fails when a module that should have been left out is in a bundle, when the plain export passes 32,000 bytes, or when the whole entry passes 165,000 or pulls in a Node built-in. Each new import has a limit of its own there too. `corbelo-game-export/node`, the command line, and the Godot add-on are not part of this: the first is for Node only and the second is GDScript that no bundle reads.

## Limits

These are chosen, not waiting to be done.

- Opaque flat colours only. No textures and no transparency. Texture coordinates are by box projection only: there is no unwrapping.
- Colours are stored at 8 bits per channel.
- One mesh per body, and one material per colour. A body's colours are per triangle: no vertex colours and no blending between them.
- Collision is convex pieces only: no spheres, capsules or triangle meshes. The volume of several pieces is their volumes added up, so overlapping pieces count twice.
- A general convex decomposition needs a kernel you pass in, and cuts along the three axes only. Round and slanted hollows take many parts that way: give them `collisionPieces`.
- Lower detail levels are yours to make. This package measures them and does not simplify meshes.
- In Godot each convex piece is a static body of its own, and the lower detail levels arrive hidden for the game to show, unless the [add-on](#godot-add-on) is on: it puts them on visibility ranges.
- Viewers that do not know `KHR_node_visibility` draw hidden detail levels, and viewers draw collision meshes unless told not to. The facts name every such node.
- The player checks read the visible mesh and look along the X and Z axes. An opening that runs at a slant, or one that is open to the sky, is not found, and sizes are good to about two cells of a 384 cell grid.
- The budgets are this package's own places to start from. No engine sets them.
- Unity and Unreal get the names their documentation gives. Neither engine was run, so nothing is claimed about what their importers do with a file. The add-on is for Godot only, and a kit's mesh library is built for Godot only: for the other two the manifest holds the numbers.
- A kit is on one square grid with one storey height, and its pieces turn by quarter turns about the up axis only. Sockets lie on the faces of cells: a plane turned more than 1 degree from every axis is refused.
- The test layouts are built from sockets on the four sides. A kit that joins only upwards, or only through `mates` of two types, gets fewer of them or none: give `layouts` of your own for those.
- Seams and collision are compared as outlines on the plane between two pieces, sampled along 512 lines, and corners are compared point for point. Trim that reaches into the next piece is measured only with a kernel.
- A blockout repeats each piece's nodes for every place, so its collision is each piece's own shapes again and again. Nothing is merged across pieces.
- Tabletop terrain is not a kit here: nothing is made for printing, bases or tiles of a board.
- The add-on imports packs written for `godot4` only, makes a kit's mesh library from full detail only, and writes a scene, a material file and a `GridMap` scene once and never again. A new detail level distance applies to a file the next time Godot imports it.
- `install` reads archives of one part, without the 64-bit extension and without encryption, and tracks only the files a manifest lists. What an engine writes next to them, like Godot's `.import` files, is the project's own.
- All bodies in one export, their detail levels included, must fit under the triangle limit together.
- The whole file is built in memory. A ZIP archive holds at most 65,535 files and 4 GB, stored without compression.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build        # rebuilds dist/
npm run check:dist   # fails when dist/ is not what src/ builds to
npm run size         # prints the size of the built files and of the minified bundle of each import
```

The Godot and Blender proofs run when those programs are on the path and are skipped with a line on standard error when they are not. The decomposition tests use `manifold-3d`, which is a development dependency only.

Every report a test makes is held to plain words as it is made, by `test/plain-words.setup.ts`: a message or a reason that names a function of this package, an option key or an id fails the test that brought it out. `test/wording.test.ts` walks every check through each state it can be in.

`dist/` is committed. After changing anything in `src/`, run `npm run build` and commit the result with it. The test suite and the CI workflow both fail when `dist/` is stale.

## Licence

MIT. See [LICENSE](LICENSE).
