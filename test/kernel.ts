// The solid kernel the tests give to collision: manifold-3d, a development dependency only.
import Module from "manifold-3d";
import { manifoldKernel, type CollisionKernel, type KernelSolid } from "../src/index.js";

let loading: Promise<CollisionKernel> | undefined;

export function loadKernel(): Promise<CollisionKernel> {
  loading ??= Module().then((wasm) => {
    wasm.setup();
    return manifoldKernel(wasm);
  });
  return loading;
}

/** A kernel that counts the solids it hands out and the ones given back, to show none are left behind. */
export function counting(kernel: CollisionKernel): { kernel: CollisionKernel; made: () => number; freed: () => number } {
  let made = 0;
  let freed = 0;
  const wrap = (solid: KernelSolid): KernelSolid => {
    made += 1;
    const wrapped: KernelSolid & { inner: KernelSolid } = {
      hull: () => wrap(solid.hull()),
      splitByPlane: (normal, offset) => solid.splitByPlane(normal, offset).map(wrap),
      volume: () => solid.volume(),
      getMesh: () => solid.getMesh(),
      decompose: () => solid.decompose!().map(wrap),
      intersect: (other) => wrap(solid.intersect!((other as KernelSolid & { inner: KernelSolid }).inner)),
      inner: solid,
      delete: () => {
        freed += 1;
        solid.delete!();
      },
    };
    return wrapped;
  };
  return { kernel: { solid: (positions, indices) => wrap(kernel.solid(positions, indices)) }, made: () => made, freed: () => freed };
}
