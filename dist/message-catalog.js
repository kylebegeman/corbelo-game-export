// What the asset checks and the kit checks say, as templates by key. Nothing of the main entry
// loads this file: a result carries its English text already, so only a caller that wants the
// text in other words pays for any of it.
import { templateOf } from "./message-fill.js";
const ASSET_CLASS = "{assetClass, select, small-prop {small prop} large-prop {large prop} other {kit piece}}";
const PIVOT = "{mode, select, base-center {the middle of the base} center {the middle of the body} min-corner {the lowest corner of the box around the body} origin {the origin the body was modelled around} other {a point that was given}}";
const UNIT = "select, millimetres {millimetres} centimetres {centimetres} inches {inches} other {metres}";
const EDGES = "{hard, plural, one {# hard edge} other {# hard edges}} and {soft, plural, one {# soft edge} other {# soft edges}}. Normals are weighted by {normals, select, face-weighted {the whole flat face each triangle belongs to} other {the area and angle of each triangle}}.";
const CAPSULE = "{player} (a capsule {width} m wide and {height} m tall)";
const CUT_INTO = ' "{name}" was cut into {pieces, plural, one {# convex piece} other {# convex pieces}}';
const NO_VOLUME = "{why, join, with {, and }}, so {count, plural, one {it encloses} other {they enclose}} no volume to compare the collision volume with.";
const SOCKETS = "{count, plural, one {# socket} other {# sockets}}: {sockets, join, with {, }}{more, plural, =0 {} other {, ...}}.";
const NO_SOCKETS = "The kit has no sockets.";
const NO_SOCKETS_REASON = "No piece was given a socket, so no two pieces are said to meet.";
const NO_PAIRS = "No two sockets of the kit can meet.";
const NO_PAIRS_REASON = "Every socket type is used once, or only on sides that never face each other.";
const TRIM_UNMEASURED = "Every joint touches, but trim reaches the box of a body next to it in {count, plural, one {# place} other {# places}}, and whether it runs into that body was not measured.";
const NO_POINTS = "No seam has points to compare.";
/**
 * What every check says, in English, by message key. A key is the id of a check, then what the
 * check found: `size.expected`. The key of a reason is the key of its message, then `.reason`.
 * A part of a message that has a template of its own has a key of the same kind.
 *
 * A template names the values it is filled with in braces. `{count, plural, one {# body} other
 * {# bodies}}` picks by a number, `{mode, select, center {...} other {...}}` picks by a text, and
 * `{names, join, with {, }}` writes a list with what is to stand between its items.
 */
export const ENGLISH_MESSAGES = {
    // The asset checks.
    "size.expected": `The asset is {longest} {unit} on its longest side, a size a ${ASSET_CLASS} has.`,
    "size.unexpected": `The asset is {longest} {unit} on its longest side, and a ${ASSET_CLASS} is expected to be from {min} to {max} m.`,
    "size.units": `The asset is {longest} {unit} on its longest side, and a ${ASSET_CLASS} is expected to be from {min} to {max} m. This looks like {read, ${UNIT}} read as {as, ${UNIT}}: a scale of {scale} would fit.`,
    "pivot.off-grid": "{count, plural, one {# body has} other {# bodies have}} a pivot off the {grid} m grid, so the kit piece will not snap into place.",
    "pivot.far": "{count, plural, one {# body has} other {# bodies have}} a pivot further from the body than the body is long.",
    "pivot.none": "There are no bodies.",
    "pivot.same": `The pivot is at ${PIVOT}{offGrid, plural, =0 {, on the {grid} m grid} other {}}.`,
    "pivot.own": "Each body has a pivot of its own: {bodies, join, with {, }}{offGrid, plural, =0 {. All are on the {grid} m grid} other {}}.",
    "pivot.body": `"{name}" at ${PIVOT}`,
    "triangles.budget": `{count} triangles, against a budget of {budget} for a ${ASSET_CLASS}.`,
    "vertices.budget": `{count} vertices after hard edges split, against a budget of {budget} for a ${ASSET_CLASS}.`,
    "shading.no-normals": "A body has no normals.",
    "shading.back-facing": "{count, plural, one {# corner has} other {# corners have}} a normal that points away from its own triangle.",
    "shading.wide": `A normal is {angle} degrees from the face it shades, over {limit}. A lower crease angle would make that edge hard. ${EDGES}`,
    "shading.edges": `${EDGES}{normals, select, face-weighted {} other { Weighting by the whole flat face is there to ask for.}}`,
    "clean-mesh.found": "The mesh has {found, join, with {, }}.",
    "clean-mesh.clean": "Every body is closed, faces outwards and has no sliver triangles.",
    "clean-mesh.flipped": "{count, plural, one {# edge} other {# edges}} between faces that point opposite ways",
    "clean-mesh.inside-out": "{count, plural, one {# body} other {# bodies}} turned inside out",
    "clean-mesh.non-manifold": "{count, plural, one {# edge} other {# edges}} shared by more than two triangles",
    "clean-mesh.open": "{count, plural, one {# open edge} other {# open edges}}",
    "clean-mesh.slivers": "{count, plural, one {# sliver triangle} other {# sliver triangles}}",
    "clean-mesh.dropped": "{count, plural, one {# triangle} other {# triangles}} with no area left out",
    "material-slots.budget": `{count, plural, one {# material slot} other {# material slots}} on the body with the most, against a budget of {budget} for a ${ASSET_CLASS}.`,
    "collision.none": "The file has no collision shape.",
    "collision.none.reason": "No collision was written with the file. Write it again with a collision shape to have it measured.",
    "collision.beyond": 'The collision of "{name}" ({shape}, {pieces, plural, one {# piece} other {# pieces}}) is {percent}% {direction, select, more {more} other {less}} volume than the visible part, over the {allowed}% allowed.{advice}',
    "collision.nearer.refused": " A kernel was given, but no convex decomposition was made. {why}",
    "collision.nearer.most": `${CUT_INTO}, the most allowed. {given, plural, =0 {More pieces, or the pieces the part was built from,} other {More pieces}} would bring it nearer.`,
    "collision.nearer.cut": `${CUT_INTO}, and no further cut that fits brought it nearer.{given, plural, =0 { The pieces the part was built from would.} other {}}`,
    "collision.nearer.pieces": " The pieces the part was built from would bring it nearer.",
    "collision.nearer.kernel": "{given, plural, =0 { The pieces the part was built from, or a solid kernel to cut it into convex pieces, would bring it nearer.} other { A solid kernel to cut it into convex pieces would bring it nearer.}}",
    "collision.missing": "{count, plural, one {# body has} other {# bodies have}} no collision shape.",
    "collision.inwards": 'A collision shape was written, but {names, join, with {, } each {"#"}} {count, plural, one {encloses} other {enclose}} no volume.',
    "collision.inwards.reason": `${NO_VOLUME} Turn the faces to point outwards to have its collision measured.`,
    "collision.open": 'A collision shape was written, but {names, join, with {, } each {"#"}} {count, plural, one {is} other {are}} not closed.',
    "collision.open.reason": `${NO_VOLUME} Close the mesh to have its collision measured.`,
    "collision.has-edges": '"{name}" has {edges, join, with { and }}',
    "collision.faces-inwards": '"{name}" is closed with its faces pointing inwards',
    "collision.within": "Collision in {pieces, plural, one {# convex piece} other {# convex pieces}}, within {percent}% of the visible volume.",
    "collision.within-each": "Collision in {pieces, plural, one {# convex piece} other {# convex pieces}}, each body within the share of its visible volume allowed for it.",
    "detail-levels.none": "The file has no lower detail levels.",
    "detail-levels.none.reason": "No body was given lower detail levels. Engines that make their own levels on import need none.",
    "detail-levels.found": "Detail levels: {found, join, with {; }}.",
    "detail-levels.more": 'level {level} of "{name}" has more triangles than level {above}',
    "detail-levels.same": 'level {level} of "{name}" has as many triangles as level {above}',
    "detail-levels.open": 'level {level} of "{name}" is not closed, and level 0 is',
    "detail-levels.moved": "level {level} of \"{name}\" moves the outline by {percent}% of the body's size",
    "detail-levels.smaller": "{count, plural, one {# lower detail level} other {# lower detail levels}}, each smaller than the one above and within {percent}% of the outline.",
    "player-openings.expected": "An opening for {player} was expected, and none was found.",
    "player-openings.none": "The asset has no opening for a player to pass.",
    "player-openings.none.reason": "No opening closed over the top was found along the X or Z axis. A gap that is open to the sky is not counted.",
    "player-openings.passes": `${CAPSULE} passes an opening {openingWidth} m wide and {openingHeight} m tall.`,
    "player-openings.sill": "{player} fits an opening, but its sill is {sill} m up and this player steps up {step} m.",
    "player-openings.fits-none": `${CAPSULE} fits none of {count, plural, one {# opening} other {# openings}}. The largest is {openingWidth} m wide and {openingHeight} m tall.`,
    "player-steps.expected": "Steps were expected, and none were found.",
    "player-steps.none": "The asset has no steps.",
    "player-steps.none.reason": "No two rises in a row of {limit} m or less were found between flat levels a player can stand on.",
    "player-steps.climbed": "{count, plural, one {# rise} other {# rises}} of up to {rise} m, and {player} steps up {step} m.",
    "player-steps.tall": "The tallest rise is {rise} m, and {step, plural, =0 {{player} climbs no steps} other {{player} steps up # m}}.{clears, plural, =0 {} other { A jump clears it, or collision can be a ramp.}}",
    "player-ramps.expected": "A ramp was expected, and none was found.",
    "player-ramps.none": "The asset has no ramps.",
    "player-ramps.none.reason": "No flat slope from {min} to {max} degrees was found that is large enough to stand on.",
    "player-ramps.steep": "{count, plural, one {# slope is} other {# slopes are}} steeper than the {walkable} degrees {player} walks up. The steepest is {steepest} degrees.",
    "player-ramps.walked": "{count, plural, one {# slope} other {# slopes}} of up to {steepest} degrees, and {player} walks up {walkable}.",
    // The kit checks.
    "on-grid.off": "Off the grid of {module} m by {storey} m: {off, join, with {; }}.",
    "on-grid.size": '"{piece}" is {modules, join, with { by }} modules',
    "on-grid.pivot": 'the pivot of "{piece}" is {meters} m from a corner of the grid',
    "on-grid.socket": 'a socket of "{piece}" is {meters} m from the face of its cell',
    "on-grid.whole": "{count, plural, one {# piece} other {# pieces}} of whole modules of {module} m and storeys of {storey} m, each with its pivot on a corner of the grid.",
    "seams.no-sockets": NO_SOCKETS,
    "seams.no-sockets.reason": NO_SOCKETS_REASON,
    "seams.empty": `Nothing of the piece lies on the plane of ${SOCKETS}`,
    "seams.differ": 'Sockets of type "{type}" do not have one outline: {a} and {b} differ by {area} m2.',
    "seams.no-pairs": NO_PAIRS,
    "seams.no-pairs.reason": NO_PAIRS_REASON,
    "seams.match": "{count, plural, one {# pair} other {# pairs}} of sockets that can meet, each with one outline to within {area} m2.",
    "in-cells.out": "Out of its cells: {out, join, with {; }}.",
    "in-cells.piece": '"{piece}" reaches {meters} m past its cells',
    "in-cells.trim": 'the trim of "{piece}" reaches {meters} m past its cells, and trim may reach {allowed} m',
    "in-cells.in": "Every piece stays in its cells.",
    "in-cells.in-with-trim": "Every piece stays in its cells, and trim reaches at most {meters} m past them.",
    "layouts.none": "No test layout could be built from the kit's sockets.",
    "layouts.none.reason": "{skipped, join, with { }}",
    "layouts.left-out": '"{name}": {reason}',
    "layouts.skipped.no-piece": "No piece has {layout, select, run {two sockets on opposite sides of one storey} tee {three sockets on one storey} cross {four sockets on one storey} rise {two sockets on different storeys} other {two sockets at a right angle on one storey}}.",
    "layouts.skipped.no-mate": 'No piece has a socket that meets a socket of "{piece}".',
    "layouts.skipped.no-row": 'The sockets of "{piece}" do not meet each other, so no two through pieces go in a row.',
    "layouts.skipped.no-ring": 'Four of "{piece}"{throughs, plural, =0 {} other { with a through piece between each two}} do not close a ring.',
    "layouts.open": "Layouts do not close: {layouts, join, with {; }}.",
    "layouts.layout": '"{name}": {found, join, with {, }}',
    "layouts.doubled": "{count, plural, one {# cell has} other {# cells have}} two pieces in it",
    "layouts.blocked": "{count, plural, one {# socket faces} other {# sockets face}} a side with no socket",
    "layouts.mismatched": "{count, plural, one {# joint has} other {# joints have}} two types that do not meet",
    "layouts.apart": "{count, plural, one {# joint does} other {# joints do}} not touch",
    "layouts.apart-by": "{count, plural, one {# joint does} other {# joints do}} not touch, {meters} m apart at most",
    "layouts.overlap": "a piece reaches {meters} m into the piece it meets",
    "layouts.trim": "trim runs into the piece next to it by {volume} m3",
    "layouts.no-joints": "no two sockets meet",
    "layouts.no-kernel": TRIM_UNMEASURED,
    "layouts.no-kernel.reason": "No kernel was given, and measuring what two bodies both fill needs one.",
    "layouts.not-solid": TRIM_UNMEASURED,
    "layouts.not-solid.reason": 'The kernel could not make solids of "{trim}" of "{piece}" against "{body}" of "{other}": a body that is not closed has no inside to measure.',
    "layouts.closed": "{count, plural, one {# layout} other {# layouts}} ({names, join, with {, }}) with {joints, plural, one {# joint} other {# joints}}, each touching with no overlap.",
    "corners.differ": NO_POINTS,
    "corners.differ.reason": "The outlines of the sockets that can meet differ, so they have no shared seam to compare points along. Seams match says by how much.",
    "corners.no-pairs": NO_POINTS,
    "corners.no-pairs.reason": NO_PAIRS,
    "corners.off": "{count, plural, one {# point} other {# points}} of a seam lie off the outline they meet, by up to {meters} m: {a} and {b}.",
    "corners.on-edge": "{count, plural, one {# point} other {# points}} of a seam lie along an edge of the outline they meet, where it has no point: {a} and {b}. The outlines agree, but a renderer can show a crack there.",
    "corners.match": "{points, plural, one {# point} other {# points}} along {seams, plural, one {# seam} other {# seams}}, each on a point of the outline it meets.",
    "walkable.blocked": "Not walkable for {player}: {found, join, with {; }}{more, plural, =0 {} other {; and # more}}.",
    "walkable.narrow": 'the player does not fit through {socket} of "{piece}": the opening is {width} m wide and {height} m tall',
    "walkable.shut": 'the way through {socket} of "{piece}" is shut',
    "walkable.rise": '"{piece}" has a rise of {rise} m, and {step, plural, =0 {this player climbs no steps} other {the player steps up # m}}',
    "walkable.slope": '"{piece}" has a slope of {degrees} degrees, and the player walks up {walkable}',
    "walkable.floor": "the floor at {a} is {meters} m from the floor at {b}",
    "walkable.nothing": "The kit has nothing said to be walked through.",
    "walkable.nothing.reason": "No socket on a side is marked as a passage, and no piece has a slope large enough to stand on.",
    "walkable.passes": `${CAPSULE} passes {count, plural, one {# passage} other {# passages}}, with rises of up to {rise} m and slopes of up to {slope} degrees.`,
    "collision-tiles.no-sockets": NO_SOCKETS,
    "collision-tiles.no-sockets.reason": NO_SOCKETS_REASON,
    "collision-tiles.no-shapes": "The pieces bring no collision shapes.",
    "collision-tiles.no-shapes.reason": "The kit was written with collision set to none.",
    "collision-tiles.missing": "{count, plural, one {# piece has} other {# pieces have}} sockets and no collision shape, next to pieces that have one: {pieces, join, with {, }}.",
    "collision-tiles.empty": `No collision shape reaches the plane of ${SOCKETS}`,
    "collision-tiles.lip": 'The collision at sockets of type "{type}" does not meet flush: {a} and {b} differ by {area} m2, a lip a moving body can catch on.',
    "collision-tiles.no-pairs": NO_PAIRS,
    "collision-tiles.no-pairs.reason": NO_PAIRS_REASON,
    "collision-tiles.flush": "The collision shapes at {count, plural, one {# pair} other {# pairs}} of sockets meet flush, to within {area} m2.",
};
/** Every key of the catalog, in the order the checks come in. */
export const MESSAGE_KEYS = /* @__PURE__ */ Object.keys(ENGLISH_MESSAGES);
/** The keys of the English catalog that a catalog has no template for. Empty for a whole catalog. */
export function missingMessageKeys(catalog) {
    return MESSAGE_KEYS.filter((key) => templateOf(catalog, key) === undefined);
}
