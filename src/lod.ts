/** The most points of one mesh that are measured against the other. Past it, every so many are. */
export const DEVIATION_MAX_SAMPLES = 20_000;

const LEAF_TRIANGLES = 4;

/** Triangles of a mesh in a tree of boxes, for finding the point of the mesh nearest to a point. */
interface Tree {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Triangle numbers, ordered so every node of the tree holds a run of them. */
  order: Uint32Array;
  /** Six numbers per node: the least x, y, z and the greatest. */
  boxes: Float64Array;
  /** Per node: the first of its two children, or -1 for a leaf. The second child is the next node. */
  child: Int32Array;
  /** Per node: where its run of triangles starts in `order`, and how many it holds. */
  start: Uint32Array;
  count: Uint32Array;
}

function buildTree(positions: ArrayLike<number>, indices: ArrayLike<number>): Tree {
  const triangles = indices.length / 3;
  const order = new Uint32Array(triangles);
  const middles = new Float64Array(triangles * 3);
  for (let t = 0; t < triangles; t += 1) {
    order[t] = t;
    for (let axis = 0; axis < 3; axis += 1) {
      middles[t * 3 + axis] = (positions[indices[t * 3]! * 3 + axis]! + positions[indices[t * 3 + 1]! * 3 + axis]! + positions[indices[t * 3 + 2]! * 3 + axis]!) / 3;
    }
  }
  const capacity = Math.max(1, 2 * triangles);
  const boxes = new Float64Array(capacity * 6);
  const child = new Int32Array(capacity).fill(-1);
  const start = new Uint32Array(capacity);
  const count = new Uint32Array(capacity);
  let nodes = 1;
  start[0] = 0;
  count[0] = triangles;
  const pending = [0];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const from = start[node]!;
    const to = from + count[node]!;
    for (let axis = 0; axis < 3; axis += 1) {
      boxes[node * 6 + axis] = Infinity;
      boxes[node * 6 + 3 + axis] = -Infinity;
    }
    const spread = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let at = from; at < to; at += 1) {
      const t = order[at]!;
      for (let axis = 0; axis < 3; axis += 1) {
        for (let k = 0; k < 3; k += 1) {
          const value = positions[indices[t * 3 + k]! * 3 + axis]!;
          if (value < boxes[node * 6 + axis]!) boxes[node * 6 + axis] = value;
          if (value > boxes[node * 6 + 3 + axis]!) boxes[node * 6 + 3 + axis] = value;
        }
        const middle = middles[t * 3 + axis]!;
        if (middle < spread[axis]!) spread[axis] = middle;
        if (middle > spread[axis + 3]!) spread[axis + 3] = middle;
      }
    }
    if (count[node]! <= LEAF_TRIANGLES) continue;
    // Divide the run at the middle of the axis the triangles are spread along most.
    let axis = 0;
    for (let other = 1; other < 3; other += 1) {
      if (spread[other + 3]! - spread[other]! > spread[axis + 3]! - spread[axis]!) axis = other;
    }
    const cut = (spread[axis]! + spread[axis + 3]!) / 2;
    let low = from;
    let high = to - 1;
    while (low <= high) {
      if (middles[order[low]! * 3 + axis]! < cut) {
        low += 1;
      } else {
        const moved = order[low]!;
        order[low] = order[high]!;
        order[high] = moved;
        high -= 1;
      }
    }
    // Triangles whose middles are all in one place cannot be divided: cut the run in half.
    if (low === from || low === to) low = from + (count[node]! >> 1);
    child[node] = nodes;
    start[nodes] = from;
    count[nodes] = low - from;
    start[nodes + 1] = low;
    count[nodes + 1] = to - low;
    pending.push(nodes, nodes + 1);
    nodes += 2;
  }
  return { positions, indices, order, boxes, child, start, count };
}

/** The square of the distance from a point to a triangle. */
function toTriangleSquared(px: number, py: number, pz: number, positions: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = positions[a]!;
  const ay = positions[a + 1]!;
  const az = positions[a + 2]!;
  const abx = positions[b]! - ax;
  const aby = positions[b + 1]! - ay;
  const abz = positions[b + 2]! - az;
  const acx = positions[c]! - ax;
  const acy = positions[c + 1]! - ay;
  const acz = positions[c + 2]! - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;
  // The nearest point is a + s * ab + t * ac, with s and t found for the region the point is over.
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  let s: number;
  let t: number;
  if (d1 <= 0 && d2 <= 0) {
    s = 0;
    t = 0;
  } else {
    const d3 = d1 - (abx * abx + aby * aby + abz * abz);
    const d4 = d2 - (abx * acx + aby * acy + abz * acz);
    const d5 = d1 - (abx * acx + aby * acy + abz * acz);
    const d6 = d2 - (acx * acx + acy * acy + acz * acz);
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      s = 1;
      t = 0;
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      s = d1 / (d1 - d3);
      t = 0;
    } else if (d6 >= 0 && d5 <= d6) {
      s = 0;
      t = 1;
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      s = 0;
      t = d2 / (d2 - d6);
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      t = (d4 - d3) / (d4 - d3 + (d5 - d6));
      s = 1 - t;
    } else {
      const sum = va + vb + vc;
      s = vb / sum;
      t = vc / sum;
    }
  }
  const dx = apx - s * abx - t * acx;
  const dy = apy - s * aby - t * acy;
  const dz = apz - s * abz - t * acz;
  return dx * dx + dy * dy + dz * dz;
}

function toBoxSquared(px: number, py: number, pz: number, boxes: Float64Array, node: number): number {
  const dx = Math.max(boxes[node * 6]! - px, 0, px - boxes[node * 6 + 3]!);
  const dy = Math.max(boxes[node * 6 + 1]! - py, 0, py - boxes[node * 6 + 4]!);
  const dz = Math.max(boxes[node * 6 + 2]! - pz, 0, pz - boxes[node * 6 + 5]!);
  return dx * dx + dy * dy + dz * dz;
}

function nearestSquared(tree: Tree, px: number, py: number, pz: number, stack: number[]): number {
  let best = Infinity;
  stack.length = 0;
  stack.push(0);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (toBoxSquared(px, py, pz, tree.boxes, node) >= best) continue;
    const first = tree.child[node]!;
    if (first < 0) {
      for (let at = tree.start[node]!; at < tree.start[node]! + tree.count[node]!; at += 1) {
        const t = tree.order[at]! * 3;
        const distance = toTriangleSquared(px, py, pz, tree.positions, tree.indices[t]! * 3, tree.indices[t + 1]! * 3, tree.indices[t + 2]! * 3);
        if (distance < best) best = distance;
      }
      continue;
    }
    // The nearer child goes on last, so it is looked at first.
    const near = toBoxSquared(px, py, pz, tree.boxes, first) <= toBoxSquared(px, py, pz, tree.boxes, first + 1) ? first : first + 1;
    stack.push(near === first ? first + 1 : first, near);
  }
  return best;
}

/** The greatest distance from a vertex or the middle of a triangle of one mesh to the nearest point of the other. */
function oneWay(positions: ArrayLike<number>, indices: ArrayLike<number>, tree: Tree, maxSamples: number): number {
  const stack: number[] = [];
  let worst = 0;
  const vertices = positions.length / 3;
  const vertexStep = Math.max(1, Math.ceil(vertices / maxSamples));
  for (let vertex = 0; vertex < vertices; vertex += vertexStep) {
    const distance = nearestSquared(tree, positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!, stack);
    if (distance > worst) worst = distance;
  }
  const triangles = indices.length / 3;
  const triangleStep = Math.max(1, Math.ceil(triangles / maxSamples));
  for (let t = 0; t < triangles; t += triangleStep) {
    const a = indices[t * 3]! * 3;
    const b = indices[t * 3 + 1]! * 3;
    const c = indices[t * 3 + 2]! * 3;
    const distance = nearestSquared(
      tree,
      (positions[a]! + positions[b]! + positions[c]!) / 3,
      (positions[a + 1]! + positions[b + 1]! + positions[c + 1]!) / 3,
      (positions[a + 2]! + positions[b + 2]! + positions[c + 2]!) / 3,
      stack,
    );
    if (distance > worst) worst = distance;
  }
  return Math.sqrt(worst);
}

/**
 * How far apart the surfaces of two meshes are: the greatest distance from a vertex or the
 * middle of a triangle of either mesh to the nearest point of the other mesh. Both meshes are
 * x, y, z per vertex and three vertex numbers per triangle, in the same frame and unit.
 *
 * Zero for the same surface cut into different triangles. For a round shape made with fewer
 * sides, it is how far the flat sides sit inside the round one.
 *
 * A mesh with more than `maxSamples` vertices or triangles is measured at every so many of
 * them, the same ones every time.
 */
export function meshDeviation(
  aPositions: ArrayLike<number>,
  aIndices: ArrayLike<number>,
  bPositions: ArrayLike<number>,
  bIndices: ArrayLike<number>,
  maxSamples = DEVIATION_MAX_SAMPLES,
): number {
  if (aIndices.length === 0 || bIndices.length === 0) return 0;
  return Math.max(oneWay(aPositions, aIndices, buildTree(bPositions, bIndices), maxSamples), oneWay(bPositions, bIndices, buildTree(aPositions, aIndices), maxSamples));
}
