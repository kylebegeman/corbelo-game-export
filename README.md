# corbelo-game-export

Turns exact CAD bodies into one game-engine-ready GLB file, plus a set of facts computed from the geometry that was written.

It takes triangles as a CAD kernel tessellates them (often triangle soup, in millimetres, with Z up) and writes a glTF 2.0 binary that a game engine imports cleanly: metres, Y up, welded and indexed, with hard and soft edges in the right places, sensible pivots, one named node per body and one material per colour. A body may have one colour or a colour on each of its faces.

On request it also writes what a game needs around the mesh: a collision shape named the way the engine reads it, lower detail levels, texture coordinates and attach points. It checks the result against a budget and against the engine's own player, and packs one asset or a family of them with a manifest.

| Function | What it does |
| --- | --- |
| [`exportGameGlb`](#use) | The plain export: one GLB and its facts. |
| [`exportGameAsset`](#game-assets) | The same, with collision, detail levels, texture coordinates and attach points. |
| [`checkGameAsset`](#game-checks) | Twelve checks on a GLB this package wrote: pass, warn, fail or not measured, with the numbers. |
| [`exportGamePack`](#packs) | One asset or a family of them: the GLBs and a JSON manifest, and a ZIP archive of both. |

It is used by Corbelo and Corbelo Studio. It has no runtime dependencies and runs in Node 22 or later and in browsers. A bundler leaves out what you do not import: the plain export alone is about 32 kB minified (about 12 kB gzipped). See [Size in a browser bundle](#size-in-a-browser-bundle).

## Install

The built `dist/` folder is committed, so the package installs straight from a git tag with no build step:

```sh
npm install github:kylebegeman/corbelo-game-export#v0.1.5
```

Where the build machine has no `git` program, install the tag's tarball instead. The lock file then holds a plain HTTPS address and a checksum:

```sh
npm install https://github.com/kylebegeman/corbelo-game-export/archive/refs/tags/v0.1.5.tar.gz
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
  "generator": "corbelo-game-export 0.1.5",
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

Two more schemas sit next to it, both checked against real output in the same way:

| File | What it describes |
| --- | --- |
| `schema/pack.schema.json` | The scene extras of a GLB, and the facts in them. |
| `schema/check-report.schema.json` | What [`checkGameAsset`](#game-checks) returns and the `check` command prints. The player profile is its `#/$defs/PlayerProfile`. |
| `schema/pack-manifest.schema.json` | The `<name>.pack.json` file of a [pack](#packs). It refers to the other two by file name, so keep the three together. |

```js
import facts from "corbelo-game-export/schema/pack.schema.json" with { type: "json" };
import report from "corbelo-game-export/schema/check-report.schema.json" with { type: "json" };
import manifest from "corbelo-game-export/schema/pack-manifest.schema.json" with { type: "json" };
```

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

A shape asked for by name is built, or refused with `BAD_COLLISION` when it cannot be: `"pieces"` without `collisionPieces`, `"decomposition"` without a `kernel` or for a body that is not closed, or any shape for a flat body.

`"auto"` builds the shapes in that order and takes the first whose volume is within `tolerance` of the visible body's. Volume error is `(collision volume - visible volume) / visible volume`, so 0.39 means the collision holds 39% more than the body does. The default tolerance is 0.05. A shape that cannot be built is passed over and the facts say why in `notes`. When no shape is within the tolerance, the nearest one is taken, `withinTolerance` is `false` and the [collision check](#game-checks) fails. A body that is not closed has no volume to compare with and gets its convex hull.

| Setting | Default | Meaning |
| --- | --- | --- |
| `shape` | `"auto"` | As above. |
| `tolerance` | `0.05` | How far the collision volume may be from the visible volume, as a share of it. |
| `maxPieces` | `8` | The most parts a decomposition makes. |
| `maxHullVertices` | `64` | The most corners one convex piece has. A piece stopped there may leave points outside it, and its facts say `capped: true`. |

The hulls are built by this package, with no dependency. Each piece is a node of its own with a mesh that holds positions only, a child of the body's node, named the way the profile's engine reads it:

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

The decomposition cuts the body by planes along the three axes. It takes the part whose hull adds the most volume, tries up to 12 places along each axis where that part has vertices, and keeps the cut that leaves the least extra volume. It stops when the hulls together are within the tolerance or there are `maxPieces` parts. A wall with a doorway comes out as three parts with no extra volume. A round or slanted hollow needs many parts by this method: a ring 1.2 m across needs 17 parts to come within 5% and is 27% over at the default of 8. Give `collisionPieces` from the construction for such a body, or raise `maxPieces`.

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
  "generator": "corbelo-game-export 0.1.5",
  "profile": "godot4",
  "assetClass": "small-prop",
  "budget": { "maxTriangles": 2000, "maxVertices": 4000, "maxMaterialSlots": 2 },
  "player": { "id": "godot4-character-body", "name": "Godot 4 CharacterBody3D", "origin": "built-in", "engine": "godot", "capsuleRadiusM": 0.5, "capsuleHeightM": 2, "stepHeightM": 0, "walkableSlopeDeg": 45, "jumpHeightM": 1.03, "note": "..." },
  "gridMeters": 1,
  "status": "pass",
  "counts": { "pass": 8, "warn": 0, "fail": 0, "notMeasured": 4 },
  "results": [
    { "id": "size", "status": "pass", "message": "The asset is 1 m on its longest side, a size a small-prop has.", "values": { "...": "..." } },
    { "id": "collision", "status": "pass", "message": "Collision in 2 convex pieces, within 5% of the visible volume.", "values": { "tolerance": 0.05, "bodies": [{ "name": "Corner_Bench", "requested": "auto", "shape": "pieces", "pieces": 2, "error": 0, "withinTolerance": true }] } },
    { "id": "detail-levels", "status": "not-measured", "message": "The file has no lower detail levels.", "reason": "No body was given lods. Engines that make their own levels on import need none.", "values": { "maxDeviationShare": 0.05, "bodies": [] } }
  ]
}
```

Every result has `id`, `status`, a `message` of one sentence for a person, and `values`, the numbers it was judged by. `status` is `"pass"`, `"warn"`, `"fail"` or `"not-measured"`, and a result that was not measured always has a `reason`. The report's own `status` is the worst of the results, and what was not measured does not count against it. `CHECK_IDS` lists the ids in order.

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
- **Shading.** Hard and soft edges are counted from the file. The message says which normal rule the file was written with, and that face-weighted normals are there to ask for.
- **Clean mesh.** A sliver is a triangle whose doubled area is under 1% of its longest edge squared.
- **Collision.** The volume error the facts state, against `collisionTolerance` or else the tolerance the file was written with.
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
  "generator": "corbelo-game-export 0.1.5",
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

- `kind` is `"asset"` for one GLB and `"family"` for one per row. `row` appears only in a family.
- `bytes` and `sha256` are the size and the SHA-256 of the file as written, so a download can be checked. `sha256Hex(bytes)` is the function, with no dependencies.
- `facts` is exactly what the GLB carries in its scene extras, and `checks` is the report of `checkGameAsset` for that file.
- `assetClass`, `budget`, `player`, `status` and each file's `checks` are there only when checks ran. `status` is the worst of any file.
- `materials` lists every material of the pack by name, with the files that use it.
- `generatedAt`, `revision` and `provenance` are there only when given.

The manifest is written with two spaces a level and a short list on one line, so a person can read it and a change shows up clearly in a diff.

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

### check

```sh
corbelo-game-export check <file.glb> [--class <class>] [--options <file.json>] [--strict]
```

Runs the [game checks](#game-checks) on a GLB this package wrote and prints the report as one line of JSON. `--class` is `small-prop`, `large-prop` or `kit-piece`. `--options` names a JSON file with the options of `checkGameAsset`, and `--class` wins over the class in it. The command exits with 0 whatever the checks say, unless `--strict` is given: then a report whose `status` is `"fail"` exits with 3.

From code in Node: `checkFile(path, options)` in `corbelo-game-export/node`.

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
| `MATERIAL_CONFLICT` | One material name is used with two colours, or one colour of a body is given two names. In a family, also one name with two colours in two rows. |
| `BAD_SOURCE_SPACE` | `source` is missing or has a bad unit, up axis or handedness. |
| `BAD_OPTION` | An option is outside its range, or the profile is unknown. This covers the collision settings, `texcoords`, `kernel` and the options of the checks. |
| `BAD_PROVENANCE` | `provenance` is not plain JSON. |
| `BAD_STL` | An STL file cannot be read. |
| `BAD_GLB` | A GLB file cannot be read, or one given to the checks was not written by this package. |
| `BAD_JOB` | A job file is missing, is not valid JSON or has a wrong or unknown key. Also a pack job with nowhere to write, or one that names a kernel that is not installed. |
| `BAD_LOD` | `lods` is not a list of meshes. A level's own positions, indices, face ids and face colours are refused under the codes above, and the message names the level. |
| `BAD_COLLISION` | `collisionPieces` is not a list of at least four finite points each, a collision shape asked for by name cannot be built, or the kernel failed. |
| `BAD_ATTACH_POINT` | An attach point has no name, no position of three finite numbers, or a direction of no length. |
| `BAD_PACK` | A pack has both `bodies` and `rows` or neither, an empty or badly formed row, two rows that come out with one name, or `checks`, `generatedAt` or `revision` of the wrong kind. |

Every body is checked before any is exported.

## Checked against a real engine

The test suite includes a proof that runs when a `godot` 4 program is on the path (or its location is in the `GODOT` environment variable). It builds a chamfered block, a cylinder, a file with two coloured bodies and a file with two bodies that have colours on their faces, puts them in a throwaway Godot project in the system's temporary folder, and runs Godot's own editor importer on them with no window (`godot --headless --import`). A GDScript then loads the imported scenes and reports what Godot ended up with, and the test compares that with the facts: node names, mesh size in metres, normals, vertex and triangle counts, materials and colours, and pivot positions.

For the bodies with colours on their faces it checks that each body arrives as one mesh with one surface per colour, in the order the facts list the slots, that each surface has the material, the colour and the triangle and vertex counts the facts state, that the painted triangles are the right ones, and that a cylinder whose side is half one colour and half another is still shaded round across the two lines where the colours meet.

It also imports a post painted across the flat sides of its round wall, which cuts them finer, twice. Written from the cut mesh alone, Godot holds normals that are more than 7 degrees away from straight out from the axis at the points the paint added. Written with `refines`, every normal of the wall is within a tenth of a degree of straight out, and the paint arrives under the name `faceMaterialNames` gave it.

Two game assets from [`exportGameAsset`](#game-assets) go through the same importer:

- **A ring with a hole through it**, 1.2 m across and 0.4 m tall, with twelve wedges given as collision pieces, two lower detail levels, texture coordinates at half a metre a tile and two attach points. Godot builds the collision itself on import: each `Ring_nn-convcolonly` mesh arrives as a `StaticBody3D` named `Ring_nn` holding one `CollisionShape3D` with a `ConvexPolygonShape3D`, twelve in all, with the points the file gave to within a millimetre. No shape reaches the middle of the ring, so the hole stays open. The ring measures what the facts say. `Ring_LOD1` and `Ring_LOD2` arrive as mesh nodes of their own under the ring, hidden, with the triangle counts the facts state. Every level has texture coordinates at the scale asked for and tangents that follow them. The attach points arrive as empty `Node3D` nodes where the facts say, with +Z along the direction given.
- **A wall with a doorway**, 3 m wide and 2.8 m tall, cut into convex parts by the `manifold-3d` kernel. Godot builds three convex shapes, the doorway stays open, and the game checks find that Godot's own character fits through it.

Each convex piece is a static body of its own in Godot, since that is what the name rule makes. A game that wants one body with several shapes moves the shapes under one body after import.

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
| `exportGameGlb` | 31,557 bytes | 12,434 |
| `readPack` | 4,634 | 2,043 |
| `exportGameAsset` | 52,169 | 20,262 |
| `checkGameAsset` | 27,643 | 10,460 |
| `exportGamePack` | 85,127 | 32,193 |
| everything | 90,673 | 34,432 |

Version 0.1.4, measured the same way, was 29,100 bytes (11,576 gzipped) for `exportGameGlb` and 35,046 (13,757) for everything. The plain export grew by 2,457 bytes (858 gzipped) in 0.1.5. All of that is in the scene writer it shares with `exportGameAsset`, which can now also write detail levels, texture coordinates and slots in name order. The bytes a plain export writes did not change.

The test suite bundles each of these and fails when a module that should have been left out is in a bundle, when the plain export passes 32,000 bytes, or when the whole entry passes 100,000 or pulls in a Node built-in. `corbelo-game-export/node`, the command line, is for Node only and is not part of this.

## Limits

These are chosen, not waiting to be done.

- Opaque flat colours only. No textures and no transparency. Texture coordinates are by box projection only: there is no unwrapping.
- Colours are stored at 8 bits per channel.
- One mesh per body, and one material per colour. A body's colours are per triangle: no vertex colours and no blending between them.
- Collision is convex pieces only: no spheres, capsules or triangle meshes. The volume of several pieces is their volumes added up, so overlapping pieces count twice.
- A general convex decomposition needs a kernel you pass in, and cuts along the three axes only. Round and slanted hollows take many parts that way: give them `collisionPieces`.
- Lower detail levels are yours to make. This package measures them and does not simplify meshes.
- In Godot each convex piece is a static body of its own, and the lower detail levels arrive hidden for the game to show.
- Viewers that do not know `KHR_node_visibility` draw hidden detail levels, and viewers draw collision meshes unless told not to. The facts name every such node.
- The player checks read the visible mesh and look along the X and Z axes. An opening that runs at a slant, or one that is open to the sky, is not found, and sizes are good to about two cells of a 384 cell grid.
- The budgets are this package's own places to start from. No engine sets them.
- Unity and Unreal get the names their documentation gives. Neither engine was run, so nothing is claimed about what their importers do with a file.
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

`dist/` is committed. After changing anything in `src/`, run `npm run build` and commit the result with it. The test suite and the CI workflow both fail when `dist/` is stale.

## Licence

MIT. See [LICENSE](LICENSE).
