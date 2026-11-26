# corbelo-game-export

Turns exact CAD bodies into one game-engine-ready GLB file, plus a set of facts computed from the geometry that was written.

It takes triangles as a CAD kernel tessellates them (often triangle soup, in millimetres, with Z up) and writes a glTF 2.0 binary that a game engine imports cleanly: metres, Y up, welded and indexed, with hard and soft edges in the right places, sensible pivots, one named node per body and one material per colour.

It is used by Corbelo and Corbelo Studio. It has no runtime dependencies, runs in Node 22 or later and in browsers, and bundles to about 24 kB minified (under 10 kB gzipped).

## Install

The built `dist/` folder is committed, so the package installs straight from a git tag with no build step:

```sh
npm install github:kylebegeman/corbelo-game-export#v0.1.1
```

Where the build machine has no `git` program, install the tag's tarball instead. The lock file then holds a plain HTTPS address and a checksum:

```sh
npm install https://github.com/kylebegeman/corbelo-game-export/archive/refs/tags/v0.1.1.tar.gz
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
| `materialName` | Optional. Names the material. Without it the name comes from the colour. |
| `faceIds` | Optional. One whole number per triangle saying which exact CAD face it came from. |

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
| `placement` | `"origin"` | `"origin"` puts every node at the scene origin. `"designed"` keeps each body where it was modelled. |
| `creaseAngle` | `30` | Degrees. Edges sharper than this are hard. |
| `normals` | `"angle-area"` | `"angle-area"` or `"face-weighted"`. See [Normals](#normals). |
| `weldTolerance` | `0.000001` | Metres. Vertices closer than this become one. `0` welds only identical positions. |
| `maxTriangles` | `2000000` | The export is refused when all bodies together hold more triangles than this. |
| `colorSpace` | `"srgb"` | How `[r, g, b]` colours are read. Set `"linear"` if yours are linear light. Hex colours are always sRGB. |
| `provenance` | none | Any plain JSON. Stored untouched next to the facts inside the file. |

## What is in the GLB

- Valid glTF 2.0: metres, +Y up, right-handed, counter-clockwise front faces. The test suite runs the Khronos glTF validator over the output and expects no errors and no warnings. The validator leaves one note per mesh, that no texture uses the tangents; see [why there are tangents](#why-there-are-tangents).
- One node per body, with one mesh each, all direct children of one scene.
- Indexed triangles with `POSITION`, `NORMAL` and `TANGENT`. Indices are 16-bit when a body has at most 65,535 vertices, otherwise 32-bit.
- One material per distinct colour, shared between bodies: `baseColorFactor` in linear light, `metallicFactor` 0, `roughnessFactor` 0.8.
- `asset.generator` is `corbelo-game-export <version>`.
- `scenes[0].extras.corbeloGameExport` holds `{ schema, profile, facts, provenance }`.

There are no textures, UVs, vertex colours, collision shapes or detail levels in this version.

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

### Names

Node and mesh names keep letters, digits, `_` and `-`. Accents are stripped, everything else becomes `_`, and names are cut to 60 characters. Names are made unique without regard to letter case by adding `_2`, `_3` and so on in input order. The same input always gives the same names.

Game engines read some names as instructions. Godot turns a mesh named `wall-col` into a collision shape, and Unreal reads `UCX_Wall` as a collision hull. A body must never be mistaken for one of these, so a name that starts or ends like one is changed: `wall-col` becomes `wall-col_body`, `UCX_Crate` becomes `body_UCX_Crate` and `part_LOD0` becomes `part_LOD0_body`. The name you gave is kept in the facts as `sourceName`.

### Materials

Colours are rounded to 8 bits per channel in sRGB, so `"#ff0000"`, `"#F00"` and `[1, 0, 0]` are one material. A material is named `color_rrggbb` unless you give a `materialName`. Using one material name with two different colours is refused.

## Facts

Facts are measured from the geometry that was written, not from the input. A shortened example for one 1000 x 500 x 250 mm box, modelled Z-up in millimetres and exported with the `unreal5` profile:

```json
{
  "schema": 1,
  "generator": "corbelo-game-export 0.1.1",
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

- `vertices` is the count after splitting along hard edges, which is what an engine reports.
- `openEdges` counts edges used by one triangle only. It is 0 for a closed body. `nonManifoldEdges` counts edges used by more than two.
- `bounds` is where the body sits in the scene. `localBounds` is the vertex data as stored, relative to the pivot. They are the same when `placement` is `"origin"`.
- Every box and pivot is given twice. `meters` is glTF space: metres, +Y up. `engine` is the same thing in the profile's unit, with the up value moved to the profile's up axis. For a Z-up profile that means glTF `(x, y, z)` is reported as `(x, z, y)`. It describes sizes and heights. It is not a promise about which way an engine's importer turns the model around the up axis.
- `pivot.source` is the pivot in your own units and axes.

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

This version does not generate collision shapes or detail levels. The conventions are there so the name rules above can avoid them, and so a later version can add them.

You can pass your own profile object with the same shape instead of an id.

## Reading files back

```ts
import { readGlb, readAccessor, readPack, readStl } from "corbelo-game-export";

const { json, bin } = readGlb(glb);         // the glTF JSON and the binary chunk
const positions = readAccessor({ json, bin }, 1);
const pack = readPack(glb);                 // generator, profile, facts, provenance, bodies
const stl = readStl(bytes);                 // { positions, triangles, format, name }
```

`readPack` returns each body's name, translation, positions, normals, indices and material. The GLB reader is small on purpose. It reads the files this package writes and other plain GLB files, refuses sparse accessors and external buffers, and does not decode compressed meshes.

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

## Refusals

Bad input is refused with a `GameExportError`. Its `code` is stable and its `message` says what is wrong and where. Nothing is fixed silently.

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
| `TOO_MANY_TRIANGLES` | The bodies together hold more than `maxTriangles` triangles (2,000,000 unless changed). |
| `BAD_NAME` | A body has no name, or an empty material name. |
| `BAD_COLOR` | A colour cannot be read. Transparency is not supported. |
| `MATERIAL_CONFLICT` | One material name is used with two colours. |
| `BAD_SOURCE_SPACE` | `source` is missing or has a bad unit, up axis or handedness. |
| `BAD_OPTION` | An option is outside its range, or the profile is unknown. |
| `BAD_PROVENANCE` | `provenance` is not plain JSON. |
| `BAD_STL` | An STL file cannot be read. |
| `BAD_GLB` | A GLB file cannot be read. |
| `BAD_JOB` | A job file is missing, is not valid JSON or has a wrong or unknown key. |

Every body is checked before any is exported.

## Checked against a real engine

The test suite includes a proof that runs when a `godot` 4 program is on the path (or its location is in the `GODOT` environment variable). It builds a chamfered block, a cylinder and a file with two coloured bodies, puts them in a throwaway Godot project in the system's temporary folder, and runs Godot's own editor importer on them with no window (`godot --headless --import`). A GDScript then loads the imported scenes and reports what Godot ended up with, and the test compares that with the facts: node names, mesh size in metres, normals, vertex and triangle counts, materials and colours, and pivot positions.

Without Godot the proof is skipped and a line on standard error says so. Set `GODOT_PROOF_LOG=1` to print what Godot reported.

It has been run with Godot 4.7.2. Unity and Unreal have not been tested with the engines themselves.

A second check runs when a `blender` program is on the path (or its location is in the `BLENDER` environment variable). Blender is not a game engine, but its glTF importer was written by other people, so it is a second opinion on the same files. A Python script imports the block, the cylinder and the two-body file with no window and reports what Blender holds, and the test compares that with the facts: body names, triangle counts, where each body is and how large in metres, that every triangle faces outwards, that the normals arrive as written (flat on the block's faces, smooth round the cylinder), and material names and colours. Without Blender it is skipped the same way. It has been run with Blender 5.2.2.

### Why there are tangents

Every vertex carries a tangent: a unit vector at a right angle to its normal, with `w` set to 1. The bodies have no texture coordinates, so the tangent says nothing about a texture. It is there for the engine.

Godot compresses imported meshes by default, and a compressed mesh stores each normal together with a tangent. For a mesh that has no tangents Godot makes one up from the normal, by a rule that gives a vector of no length when the normal points exactly along `(1, 1, -1)` or `(-1, -1, 1)`. Godot then stores a wrong normal for that vertex. On a block with all eight corners chamfered equally, two of the eight corner faces shade wrongly.

With a tangent in the file Godot never makes one up. The proof imports the chamfered block with Godot's default settings and checks the normals of all 44 triangles, those two corners included, and imports it once more with compression off to check that the positions arrive exactly as written.

## Limits

- Opaque flat colours only. No textures, UVs or transparency.
- Colours are stored at 8 bits per channel.
- One mesh and one material per body.
- No collision shapes and no detail levels yet.
- All bodies in one export must fit under the triangle limit together.
- The whole file is built in memory.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build        # rebuilds dist/
npm run check:dist   # fails when dist/ is not what src/ builds to
npm run size         # prints the size of the built files and of the minified bundle
```

`dist/` is committed. After changing anything in `src/`, run `npm run build` and commit the result with it. The test suite and the CI workflow both fail when `dist/` is stale.

## Licence

MIT. See [LICENSE](LICENSE).
