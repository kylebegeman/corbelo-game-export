import { describe, expect, it } from "vitest";
import { convexHull, meshVolume, type Hull } from "../src/hull.js";
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
