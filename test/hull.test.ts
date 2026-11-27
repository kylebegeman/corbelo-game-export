import { describe, expect, it } from "vitest";
import { convexHull, HULL_FLATNESS, meshVolume, type Hull } from "../src/hull.js";
import { sha256Hex } from "../src/sha256.js";
import { box, chamferedBlock, cylinder, ell, seeded, signedVolume, tube } from "./fixtures.js";

/** How far the furthest point is outside the hull, measured from the plane of each triangle. */
function furthestOutside(hull: Hull, points: ArrayLike<number>): number {
  let worst = -Infinity;
  for (let t = 0; t < hull.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [...hull.positions.subarray(hull.indices[t + k]! * 3, hull.indices[t + k]! * 3 + 3)]) as [number[], number[], number[]];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    for (let p = 0; p < points.length; p += 3) {
      const distance = ((points[p]! - a[0]!) * n[0]! + (points[p + 1]! - a[1]!) * n[1]! + (points[p + 2]! - a[2]!) * n[2]!) / length;
      if (distance > worst) worst = distance;
    }
  }
  return worst;
}

/** Every edge is used once each way: the surface is closed and faces one way throughout. */
function isClosed(hull: Hull): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < hull.indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const key = `${hull.indices[t + k]!}>${hull.indices[t + ((k + 1) % 3)]!}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    const [from, to] = key.split(">");
    if (count !== 1 || edges.get(`${to}>${from}`) !== 1) return false;
  }
  return true;
}

function sphereCloud(count: number, seed: number): Float64Array {
  const random = seeded(seed);
  const points = new Float64Array(count * 3);
  for (let p = 0; p < count; p += 1) {
    // Evenly over a ball: a direction, and a distance that fills the volume.
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const reach = Math.cbrt(random());
    const flat = Math.sqrt(1 - z * z);
    points[p * 3] = flat * Math.cos(angle) * reach;
    points[p * 3 + 1] = flat * Math.sin(angle) * reach;
    points[p * 3 + 2] = z * reach;
  }
  return points;
}

/** The points of a ring with a round section, lying flat: `around` sides by `across`, read from 32-bit floats. */
function ringPoints(major: number, minor: number, around: number, across: number): Float32Array {
  const points = new Float32Array(around * across * 3);
  for (let i = 0; i < around; i += 1) {
    for (let j = 0; j < across; j += 1) {
      const a = (i / around) * Math.PI * 2;
      const b = (j / across) * Math.PI * 2;
      points.set([(major + minor * Math.cos(b)) * Math.cos(a), (major + minor * Math.cos(b)) * Math.sin(a), minor * Math.sin(b)], (i * across + j) * 3);
    }
  }
  return points;
}

/** The points of a ball of radius 1: its two ends, then `around` points on each of `across - 1` rings. */
function ballPoints(around: number, across: number): Float32Array {
  const points = [0, 0, 1, 0, 0, -1];
  for (let j = 1; j < across; j += 1) {
    for (let i = 0; i < around; i += 1) {
      const a = (i / around) * Math.PI * 2;
      const b = (j / across) * Math.PI;
      points.push(Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b));
    }
  }
  return Float32Array.from(points);
}

/** A hull in a few words: its corners, its triangles, its volume and the start of a digest of each array. */
function digest(hull: Hull): string {
  const start = (values: Float64Array | Uint32Array): string => sha256Hex(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).slice(0, 16);
  return `${hull.positions.length / 3} ${hull.indices.length / 3} ${hull.volume} ${start(hull.positions)} ${start(hull.indices)}`;
}

/** The least of a few runs, in milliseconds: what the work takes when nothing else is in the way. */
function quickest(work: () => unknown, runs = 5): number {
  let least = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const from = performance.now();
    work();
    least = Math.min(least, performance.now() - from);
  }
  return least;
}

describe("convex hull", () => {
  it("is the box itself for the points of a box", () => {
    const hull = convexHull(box([1, 2, 3], [4, 6, 8]).positions)!;
    expect(hull.positions).toHaveLength(8 * 3);
    expect(hull.indices).toHaveLength(12 * 3);
    expect(hull.volume).toBeCloseTo(3 * 4 * 5, 9);
    expect(hull.capped).toBe(false);
    expect(isClosed(hull)).toBe(true);
  });

  it("drops points inside, and points that lie on a side or along an edge", () => {
    const points: number[] = [];
    for (let x = 0; x <= 6; x += 1) for (let y = 0; y <= 6; y += 1) for (let z = 0; z <= 6; z += 1) points.push(x, y, z);
    const hull = convexHull(points)!;
    expect(hull.positions).toHaveLength(8 * 3);
    expect(hull.indices).toHaveLength(12 * 3);
    expect(hull.volume).toBeCloseTo(216, 9);
    expect(isClosed(hull)).toBe(true);
  });

  it("is the shape itself for a convex shape", () => {
    const block = chamferedBlock([1000, 500, 250], 20);
    const hull = convexHull(block.positions)!;
    expect(hull.positions).toHaveLength(24 * 3);
    expect(hull.volume / signedVolume(block.positions)).toBeCloseTo(1, 9);
    expect(isClosed(hull)).toBe(true);
  });

  it("fills in what a shape that is not convex leaves open", () => {
    // An L is three quarters of its square, and its hull is seven eighths of it.
    const hull = convexHull(ell(2, 1).positions)!;
    expect(signedVolume(ell(2, 1).positions)).toBeCloseTo(3, 6);
    expect(hull.volume).toBeCloseTo(3.5, 9);
    // A tube's hull is the cylinder around it: a prism on a polygon of 48 sides.
    const round = convexHull(tube(150, 100, 400, 48).positions)!;
    expect(round.volume / signedVolume(cylinder(150, 400, 48).positions)).toBeCloseTo(1, 6);
    expect(round.positions).toHaveLength(96 * 3);
  });

  it("holds every point of a scattered cloud, and faces outwards all the way round", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const points = sphereCloud(4000, seed);
      const hull = convexHull(points)!;
      expect(isClosed(hull)).toBe(true);
      expect(furthestOutside(hull, points)).toBeLessThan(1e-6);
      expect(hull.volume).toBeGreaterThan(3.5);
      expect(hull.volume).toBeLessThan((4 / 3) * Math.PI);
      expect(meshVolume(hull.positions, hull.indices)).toBe(hull.volume);
    }
  });

  it("holds every point of a cloud read from 32-bit floats on a round side", () => {
    // Many points on one cylinder, where four in a row nearly share a plane.
    const points = cylinder(1, 2, 256).positions;
    const hull = convexHull(points)!;
    expect(isClosed(hull)).toBe(true);
    expect(furthestOutside(hull, points)).toBeLessThan(1e-5);
    expect(hull.positions).toHaveLength(512 * 3);
  });

  it("stops at the most corners allowed, with the furthest points in first", () => {
    const points = sphereCloud(4000, 7);
    const whole = convexHull(points)!;
    const capped = convexHull(points, 16)!;
    expect(capped.positions.length / 3).toBeLessThanOrEqual(16);
    expect(capped.capped).toBe(true);
    expect(isClosed(capped)).toBe(true);
    expect(capped.volume).toBeLessThan(whole.volume);
    expect(capped.volume).toBeGreaterThan(whole.volume * 0.6);
    // A limit under four still gives a shape with a volume.
    expect(convexHull(points, 1)!.positions).toHaveLength(4 * 3);
  });

  it("gives the same hull for the same points every time", () => {
    const points = sphereCloud(1500, 11);
    const first = convexHull(points)!;
    const second = convexHull(Float64Array.from(points))!;
    expect([...second.positions]).toEqual([...first.positions]);
    expect([...second.indices]).toEqual([...first.indices]);
  });

  it("gives fine round shapes the hull that version 0.1.7 gave them, to the last number", () => {
    // Written down from 0.1.7, which found each next point by looking at every face it had made.
    expect(digest(convexHull(ringPoints(1, 0.25, 96, 24))!)).toBe("1248 2492 2.2433566533473424 e95222ef85cef20a 7733445266200308");
    expect(digest(convexHull(ringPoints(1, 0.25, 96, 24), 64)!)).toBe("64 124 2.0873582467252834 e2a68cf9ba02b083 d478e278e831a40f");
    expect(digest(convexHull(ballPoints(64, 32))!)).toBe("1986 3968 4.171995693260485 d715da462c796562 9dc95eee795a267e");
    expect(digest(convexHull(ballPoints(256, 128), 64)!)).toBe("64 124 3.7947825550786107 d10299f64dee22d0 b07bf48d40b9c0ce");
  });

  it("takes a fine round solid with no limit on its corners in the time its points call for", () => {
    // Four times the points, and about four times the work: the next point comes off the top of
    // a heap. Looking at every face for each point took eleven to twenty times as long.
    const coarse = ringPoints(1, 0.25, 128, 32);
    const fine = ringPoints(1, 0.25, 256, 64);
    expect(convexHull(fine)!.positions).toHaveLength(8448 * 3);
    expect(quickest(() => convexHull(fine)) / quickest(() => convexHull(coarse))).toBeLessThan(8);
  });

  it("has a hull for a ball too fine for a point level with a face to count as seeing it", () => {
    // Next to the ends of the ball the rings are close together, and a face much larger than
    // the new ones around it leaves a dent when a point just under it counts as seeing it.
    const points = ballPoints(256, 128);
    const hull = convexHull(points)!;
    expect(hull).not.toBeNull();
    expect(isClosed(hull)).toBe(true);
    expect(hull.capped).toBe(false);
    expect(hull.volume).toBeGreaterThan(4.187);
    expect(hull.volume).toBeLessThan((4 / 3) * Math.PI);
    // Every point is in it, to the flatness a hull is built to. One point in seven is looked at.
    const sample = points.filter((_, at) => Math.floor(at / 3) % 7 === 0);
    expect(furthestOutside(hull, sample)).toBeLessThan(Math.hypot(2, 2, 2) * HULL_FLATNESS * 8);
  });

  it("has nothing to give for points with no volume between them", () => {
    expect(convexHull([0, 0, 0, 1, 0, 0, 0, 1, 0])).toBeNull();
    expect(convexHull([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0])).toBeNull();
    expect(convexHull([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.5, 0.5, 0])).toBeNull();
    expect(convexHull([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])).toBeNull();
    expect(convexHull([])).toBeNull();
  });
});

describe("mesh volume", () => {
  it("measures a closed mesh the same wherever it sits", () => {
    const here = convexHull(box([0, 0, 0], [1, 2, 3]).positions)!;
    const far = convexHull(box([5000, 5000, 5000], [5001, 5002, 5003]).positions)!;
    expect(here.volume).toBeCloseTo(6, 12);
    expect(far.volume).toBeCloseTo(6, 9);
  });
});
