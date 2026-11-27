// Reading archives, the lock file, and installing a pack into a game project.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  crc32,
  exportGamePack,
  GameExportError,
  LOCK_FILE_NAME,
  lockJson,
  lockStatus,
  packToZip,
  parseLock,
  pinLock,
  planInstall,
  readZip,
  verifyPack,
  writeZip,
  type GamePack,
  type InstallPlan,
  type LockFile,
  type ZipEntry,
} from "../src/index.js";
import { installPack, projectStatus, readPackFiles, runCommand, runPackJob, type CliIo, type InstallResult, type ProjectStatus } from "../src/node.js";
import { binaryStl, box, MM_Z_UP } from "./fixtures.js";
import { corridorKit, flatBoxes } from "./kit-fixtures.js";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function refusal(work: () => unknown): GameExportError {
  try {
    work();
  } catch (error) {
    if (error instanceof GameExportError) return error;
    throw error;
  }
  throw new Error("Nothing was refused.");
}

/** A family of crates. `large` is the side of the large one, and `more` adds a third row. */
function crates(revision: string, large = 900, more = false): GamePack {
  return exportGamePack({
    name: "crate",
    source: MM_Z_UP,
    rows: [
      { name: "small", bodies: [{ name: "Crate", positions: box([0, 0, 0], [400, 400, 400]).positions, color: "#8a5a2b", materialName: "Wood" }], provenance: { part: "crate-small", revision } },
      { name: "large", bodies: [{ name: "Crate", positions: box([0, 0, 0], [large, large, large]).positions, color: "#8a5a2b", materialName: "Wood" }] },
      ...(more ? [{ name: "tall", bodies: [{ name: "Crate", positions: box([0, 0, 0], [400, 400, 1200]).positions, color: "#8a5a2b", materialName: "Wood" }] }] : []),
    ],
    revision,
    provenance: { part: "crates", revision },
  });
}

/** A ZIP written by hand, so that the tests can pack files as other tools do and write what `writeZip` refuses to. */
function zipOf(files: { name: string; bytes: Uint8Array; deflate?: boolean; crc?: number; flags?: number; method?: number }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  for (const file of files) {
    const name = text(file.name);
    const data = file.deflate === true ? deflateRawSync(file.bytes) : file.bytes;
    const method = file.method ?? (file.deflate === true ? 8 : 0);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, file.flags ?? 0x0800, true);
    view.setUint16(8, method, true);
    view.setUint32(14, file.crc ?? crc32(file.bytes), true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(8, file.flags ?? 0x0800, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(16, file.crc ?? crc32(file.bytes), true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, file.bytes.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, at, true);
    entry.set(name, 46);
    parts.push(local, data);
    central.push(entry);
    at += local.length + data.length;
  }
  const size = central.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, size, true);
  endView.setUint32(16, at, true);
  return Buffer.concat([...parts, ...central, end]);
}

const inflate = (data: Uint8Array): Uint8Array => inflateRawSync(data);

describe("readZip", () => {
  const files: ZipEntry[] = [
    { name: "a.txt", bytes: text("first") },
    { name: "folder/b.bin", bytes: Uint8Array.from({ length: 3000 }, (_, at) => at % 7) },
    { name: "empty", bytes: new Uint8Array(0) },
  ];

  it("reads back what writeZip wrote, in order", () => {
    expect(readZip(writeZip(files))).toEqual(files);
  });

  it("reads an archive another tool packed, with a comment after it and folders in it", () => {
    const packed = zipOf([{ name: "folder/", bytes: new Uint8Array(0) }, ...files.map((file) => ({ ...file, deflate: true }))]);
    const withComment = new Uint8Array(packed.length + 9);
    withComment.set(packed);
    withComment.set(text("a comment"), packed.length);
    new DataView(withComment.buffer).setUint16(packed.length - 2, 9, true);
    expect(readZip(withComment, { inflate }).map((file) => [file.name, sha256(file.bytes)])).toEqual(files.map((file) => [file.name, sha256(file.bytes)]));
    expect(packed.length).toBeLessThan(writeZip(files).length);
  });

  it("refuses what it cannot read safely, and says which file", () => {
    const refused = (archive: Uint8Array, options = {}): string => {
      const error = refusal(() => readZip(archive, options));
      expect(error.code).toBe("BAD_ZIP");
      return error.message;
    };
    expect(refused(text("this is not an archive at all"))).toContain("not a ZIP archive");
    expect(refused(new Uint8Array(0))).toContain("not a ZIP archive");
    expect(refused(zipOf([{ name: "a.txt", bytes: text("first"), deflate: true }]))).toContain("no inflate function");
    for (const name of ["../outside.txt", "/etc/passwd", "a/../../b", "a\\b", "C:/x", "a//b", "./a"]) expect(refused(zipOf([{ name, bytes: text("x") }])), name).toContain("stays in the folder");
    expect(refused(zipOf([{ name: "a.txt", bytes: text("x") }, { name: "A.TXT", bytes: text("y") }]))).toContain("two files named");
    expect(refused(zipOf([{ name: "a.txt", bytes: text("first"), crc: 1 }]))).toContain("damaged");
    expect(refused(zipOf([{ name: "a.txt", bytes: text("first"), flags: 0x0801 }]))).toContain("encrypted");
    expect(refused(zipOf([{ name: "a.txt", bytes: text("first"), method: 12 }]))).toContain("method 12");
    // A deflated file that unpacks to more than the archive says.
    const lying = zipOf([{ name: "a.txt", bytes: text("first"), deflate: true }]);
    expect(refused(lying, { inflate: () => text("first and more") })).toContain("another size");
    // An archive cut short.
    expect(refused(writeZip(files).subarray(0, 200))).toContain("not a ZIP archive");
    expect(refusal(() => readZip("zip" as unknown as Uint8Array)).code).toBe("BAD_ZIP");
  });

  it("is damaged when one byte of a file changes", () => {
    const archive = writeZip(files);
    archive[36] = archive[36]! ^ 0xff;
    expect(refusal(() => readZip(archive)).message).toContain("damaged");
  });
});

describe("verifyPack", () => {
  const pack = crates("r1");

  it("takes a pack whose files are the ones its manifest lists", () => {
    const verified = verifyPack(pack.files);
    expect(verified.name).toBe("crate");
    expect(verified.manifestName).toBe("crate.pack.json");
    expect(verified.digest).toBe(sha256(pack.files.at(-1)!.bytes));
    expect(verified.files.map((file) => [file.path, file.role, file.sha256, file.row])).toEqual([
      ["crate_small.glb", "model", sha256(pack.files[0]!.bytes), "small"],
      ["crate_large.glb", "model", sha256(pack.files[1]!.bytes), "large"],
      ["crate.pack.json", "manifest", verified.digest, undefined],
    ]);
    expect(verified.files[0]!.provenance).toEqual({ part: "crate-small", revision: "r1" });
    expect(verified.files[1]!.provenance).toBeUndefined();
    expect(verified.ignored).toEqual([]);
  });

  it("reads a pack out of its archive, also when the archive holds it in a folder with other files", () => {
    expect(verifyPack(readZip(packToZip(pack))).digest).toBe(verifyPack(pack.files).digest);
    const inFolder = [...pack.files.map((file) => ({ name: `crate/${file.name}`, bytes: file.bytes })), { name: "crate/notes.txt", bytes: text("notes") }, { name: "readme.txt", bytes: text("read me") }];
    const verified = verifyPack(inFolder);
    expect(verified.files.map((file) => file.path)).toEqual(["crate_small.glb", "crate_large.glb", "crate.pack.json"]);
    expect(verified.ignored).toEqual(["crate/notes.txt", "readme.txt"]);
  });

  it("refuses a pack whose file is not the one the manifest lists", () => {
    const changed = pack.files.map((file) => ({ name: file.name, bytes: file.bytes.slice() }));
    changed[1]!.bytes[changed[1]!.bytes.length - 1]! ^= 1;
    const error = refusal(() => verifyPack(changed));
    expect(error.code).toBe("PACK_MISMATCH");
    expect(error.message).toContain("crate_large.glb has SHA-256");
    expect(error.message).not.toContain("crate_small.glb");

    expect(refusal(() => verifyPack(pack.files.filter((file) => file.name !== "crate_small.glb"))).message).toContain("crate_small.glb is missing");
    const shorter = pack.files.map((file) => (file.name === "crate_small.glb" ? { name: file.name, bytes: file.bytes.subarray(0, 100) } : file));
    expect(refusal(() => verifyPack(shorter)).message).toContain("crate_small.glb is 100 bytes");
  });

  it("refuses what is not one pack", () => {
    const code = (files: ZipEntry[]): string => refusal(() => verifyPack(files)).code;
    expect(code([{ name: "a.glb", bytes: text("x") }])).toBe("BAD_PACK");
    expect(code([...pack.files, { name: "other.pack.json", bytes: text("{}") }])).toBe("BAD_PACK");
    expect(code([{ name: "crate.pack.json", bytes: text("not json") }])).toBe("BAD_PACK");
    expect(code([{ name: "crate.pack.json", bytes: text("{\"schema\":2}") }])).toBe("BAD_PACK");
    const manifest = (change: (manifest: Record<string, unknown>) => void): ZipEntry[] => {
      const copy = JSON.parse(new TextDecoder().decode(pack.files.at(-1)!.bytes)) as Record<string, unknown>;
      change(copy);
      return [...pack.files.slice(0, -1), { name: "crate.pack.json", bytes: text(JSON.stringify(copy)) }];
    };
    // A manifest that would name a folder or a file outside the place it is installed into.
    expect(refusal(() => verifyPack(manifest((copy) => (copy["name"] = "../crate")))).message).toContain("safe as a folder");
    expect(refusal(() => verifyPack(manifest((copy) => ((copy["files"] as { name: string }[])[0]!.name = "../../crate_small.glb")))).message).toContain("stays in the pack's folder");
    expect(code(manifest((copy) => (copy["name"] = "box")))).toBe("BAD_PACK");
    expect(code(manifest((copy) => (copy["kind"] = "level")))).toBe("BAD_PACK");
    expect(code(manifest((copy) => (copy["files"] = [])))).toBe("BAD_PACK");
  });
});

describe("planInstall and the lock file", () => {
  const first = verifyPack(crates("r1").files);
  const second = verifyPack(crates("r2", 1000).files);
  const nothing = (): undefined => undefined;

  /** A project in memory: the files an install leaves. */
  function apply(plan: InstallPlan, project: Map<string, string>): void {
    for (const file of plan.write) project.set(file.path, sha256(file.bytes));
    for (const path of plan.remove) project.delete(path);
  }

  it("plans a first install: every file added, the revision in the build", () => {
    const plan = planInstall(first, undefined, nothing);
    expect(plan).toMatchObject({ pack: "crate", kind: "family", into: "assets/crate", to: { revision: "r1", digest: first.digest }, inTheBuild: { revision: "r1", digest: first.digest }, pinned: true });
    expect(plan.from).toBeUndefined();
    expect(plan.counts).toEqual({ added: 3, changed: 0, unchanged: 0, removed: 0, kept: 0 });
    expect(plan.changes.map((change) => [change.path, change.change])).toEqual([
      ["assets/crate/crate.pack.json", "added"],
      ["assets/crate/crate_large.glb", "added"],
      ["assets/crate/crate_small.glb", "added"],
    ]);
    expect(plan.write.map((file) => file.path).sort()).toEqual(plan.changes.map((change) => change.path));
    expect(plan.remove).toEqual([]);
    expect(plan.lock.packs).toHaveLength(1);
  });

  it("writes a lock file a person can read and a program can read back", () => {
    const lock = planInstall(first, undefined, nothing).lock;
    const written = lockJson(lock);
    expect(parseLock(written)).toEqual(lock);
    expect(lockJson(parseLock(written))).toBe(written);
    const lines = written.split("\n");
    expect(lines.slice(0, 4)).toEqual(["{", "  \"schema\": 1,", "  \"packs\": [", "    {"]);
    expect(lines).toContain("      \"name\": \"crate\",");
    expect(lines).toContain("      \"into\": \"assets/crate\",");
    expect(lines).toContain("      \"revision\": \"r1\",");
    expect(lines).toContain(`      "inTheBuild": { "revision": "r1", "digest": "${first.digest}" },`);
    expect(lines).toContain("      \"provenance\": { \"part\": \"crates\", \"revision\": \"r1\" },");
    // One line for each file, with the provenance a file has of its own.
    const small = first.files[0]!;
    expect(lines).toContain(`        { "path": "crate_small.glb", "role": "model", "bytes": ${small.bytes.length}, "sha256": "${small.sha256}", "asset": "crate_small", "row": "small", "provenance": { "part": "crate-small", "revision": "r1" } }`);
    expect(lines.filter((line) => line.includes("\"path\"")).map((line) => /"path": "([^"]+)"/.exec(line)![1])).toEqual(["crate.pack.json", "crate_large.glb", "crate_small.glb"]);
    expect(written.endsWith("}\n")).toBe(true);
    // The order of the keys is the lock file's own, whatever order they were given in.
    const shuffled: LockFile = { schema: 1, packs: lock.packs.map((pack) => Object.fromEntries(Object.entries(pack).reverse()) as unknown as LockFile["packs"][number]) };
    expect(lockJson(shuffled)).toBe(written);
  });

  it("updates in place: only what changed is written, and the diff of the lock file is small", () => {
    const project = new Map<string, string>();
    const one = planInstall(first, undefined, (path) => project.get(path));
    apply(one, project);
    const two = planInstall(second, one.lock, (path) => project.get(path));
    expect(two.from).toEqual({ revision: "r1", digest: first.digest });
    expect(two.to).toEqual({ revision: "r2", digest: second.digest });
    // The small crate has the same shape, and its own provenance says another revision.
    expect(two.changes.map((change) => [change.path, change.change])).toEqual([
      ["assets/crate/crate.pack.json", "changed"],
      ["assets/crate/crate_large.glb", "changed"],
      ["assets/crate/crate_small.glb", "changed"],
    ]);
    // Without a pin the revision in the build stays where it was.
    expect(two.inTheBuild).toEqual({ revision: "r1", digest: first.digest });
    expect(two.pinned).toBe(false);
    expect(planInstall(second, one.lock, (path) => project.get(path), { pin: true })).toMatchObject({ pinned: true, inTheBuild: { revision: "r2", digest: second.digest } });

    const before = lockJson(one.lock).split("\n");
    const after = lockJson(two.lock).split("\n");
    expect(after).toHaveLength(before.length);
    const differing = after.filter((line, at) => line !== before[at]);
    // The revision, the digest, the pack's provenance, and one line for each file that changed.
    expect(differing.map((line) => line.trim().split(":")[0])).toEqual(["\"revision\"", "\"digest\"", "\"provenance\"", "{ \"path\"", "{ \"path\"", "{ \"path\""]);

    // The same pack again changes nothing.
    apply(two, project);
    const again = planInstall(second, two.lock, (path) => project.get(path));
    expect(again.counts).toEqual({ added: 0, changed: 0, unchanged: 3, removed: 0, kept: 0 });
    expect(again.write).toEqual([]);
    expect(lockJson(again.lock)).toBe(lockJson(two.lock));
  });

  it("takes away what only the revision before had, and keeps it when it was changed in the project", () => {
    const three = verifyPack(crates("r1", 900, true).files);
    const project = new Map<string, string>();
    const one = planInstall(three, undefined, (path) => project.get(path));
    apply(one, project);
    const two = planInstall(first, one.lock, (path) => project.get(path));
    expect(two.changes.filter((change) => change.change !== "unchanged").map((change) => [change.path, change.change])).toEqual([
      ["assets/crate/crate.pack.json", "changed"],
      ["assets/crate/crate_tall.glb", "removed"],
    ]);
    expect(two.remove).toEqual(["assets/crate/crate_tall.glb"]);
    expect(two.lock.packs[0]!.files.map((file) => file.path)).toEqual(["crate.pack.json", "crate_large.glb", "crate_small.glb"]);

    project.set("assets/crate/crate_tall.glb", "edited");
    const kept = planInstall(first, one.lock, (path) => project.get(path));
    expect(kept.changes.find((change) => change.path.endsWith("crate_tall.glb"))).toEqual({ path: "assets/crate/crate_tall.glb", change: "kept", from: "edited", to: "edited" });
    expect(kept.remove).toEqual([]);
    const forced = planInstall(first, one.lock, (path) => project.get(path), { force: true });
    expect(forced.changes.find((change) => change.path.endsWith("crate_tall.glb"))).toEqual({ path: "assets/crate/crate_tall.glb", change: "removed", from: "edited", forced: true });
  });

  it("refuses a file in the way unless told to replace it", () => {
    const foreign = new Map([["assets/crate/crate_small.glb", "someone else's"]]);
    const error = refusal(() => planInstall(first, undefined, (path) => foreign.get(path)));
    expect(error.code).toBe("FILE_IN_THE_WAY");
    expect(error.message).toContain("assets/crate/crate_small.glb is already in the project and no installed pack put it there");
    expect(planInstall(first, undefined, (path) => foreign.get(path), { force: true }).changes.find((change) => change.forced === true)).toMatchObject({ path: "assets/crate/crate_small.glb", change: "changed" });

    const project = new Map<string, string>();
    const one = planInstall(first, undefined, (path) => project.get(path));
    apply(one, project);
    project.set("assets/crate/crate_large.glb", "edited");
    expect(refusal(() => planInstall(second, one.lock, (path) => project.get(path))).message).toContain("crate_large.glb was changed in the project since it was installed");
    // A file that already has the new bytes is not in the way, whoever put it there.
    const same = new Map(first.files.map((file) => [`assets/crate/${file.path}`, file.sha256]));
    expect(planInstall(first, undefined, (path) => same.get(path)).counts.unchanged).toBe(3);
  });

  it("installs where it is told, stays there, and moves when told again", () => {
    const project = new Map<string, string>();
    const one = planInstall(first, undefined, (path) => project.get(path), { into: "art/props/" });
    expect(one.into).toBe("art/props/crate");
    apply(one, project);
    expect(planInstall(second, one.lock, (path) => project.get(path)).into).toBe("art/props/crate");
    const moved = planInstall(first, one.lock, (path) => project.get(path), { into: "." });
    expect(moved.into).toBe("crate");
    expect(moved.counts).toEqual({ added: 3, changed: 0, unchanged: 0, removed: 3, kept: 0 });
    expect(moved.remove.sort()).toEqual(["art/props/crate/crate.pack.json", "art/props/crate/crate_large.glb", "art/props/crate/crate_small.glb"]);
    expect(planInstall(first, undefined, nothing, { into: "art\\props" }).into).toBe("art/props/crate");
    for (const into of ["../elsewhere", "/tmp", "assets/../../x", "C:\\games", "a//b"]) expect(refusal(() => planInstall(first, undefined, nothing, { into })).code, into).toBe("OUTSIDE_PROJECT");
  });

  it("keeps the other packs of the lock file, in the order of their names", () => {
    const other = verifyPack(exportGamePack({ name: "barrel", source: MM_Z_UP, bodies: [{ name: "Barrel", positions: box([0, 0, 0], [500, 500, 800]).positions }] }).files);
    const one = planInstall(first, undefined, nothing);
    const two = planInstall(other, one.lock, nothing);
    expect(two.lock.packs.map((pack) => pack.name)).toEqual(["barrel", "crate"]);
    expect(two.lock.packs[1]).toEqual(one.lock.packs[0]);
    expect(two.lock.packs[0]).not.toHaveProperty("revision");
    expect(two.lock.packs[0]!.inTheBuild).toEqual({ digest: other.digest });
  });

  it("compares a project with its lock file, and pins", () => {
    const project = new Map<string, string>();
    const one = planInstall(first, undefined, (path) => project.get(path));
    apply(one, project);
    expect(lockStatus(one.lock, (path) => project.get(path))).toEqual({
      ok: true,
      packs: [{ name: "crate", kind: "family", into: "assets/crate", installed: { revision: "r1", digest: first.digest }, inTheBuild: { revision: "r1", digest: first.digest }, pinned: true, matches: true, counts: { same: 3, changed: 0, missing: 0 }, changed: [], missing: [] }],
    });
    const two = planInstall(second, one.lock, (path) => project.get(path));
    apply(two, project);
    const ahead = lockStatus(two.lock, (path) => project.get(path));
    expect(ahead).toMatchObject({ ok: false, packs: [{ pinned: false, matches: true }] });
    const pinned = pinLock(two.lock, "crate");
    expect(pinned.packs[0]!.inTheBuild).toEqual({ revision: "r2", digest: second.digest });
    expect(two.lock.packs[0]!.inTheBuild).toEqual({ revision: "r1", digest: first.digest });
    expect(lockStatus(pinned, (path) => project.get(path)).ok).toBe(true);
    expect(pinLock(two.lock)).toEqual(pinned);
    expect(refusal(() => pinLock(two.lock, "barrel")).code).toBe("BAD_LOCK");

    project.set("assets/crate/crate_small.glb", "edited");
    project.delete("assets/crate/crate_large.glb");
    expect(lockStatus(pinned, (path) => project.get(path))).toMatchObject({ ok: false, packs: [{ matches: false, counts: { same: 1, changed: 1, missing: 1 }, changed: ["assets/crate/crate_small.glb"], missing: ["assets/crate/crate_large.glb"] }] });
  });

  it("refuses a lock file that is not one, and one that points outside the project", () => {
    const good = planInstall(first, undefined, nothing).lock;
    const broken = (change: (lock: { packs: Record<string, unknown>[] } & Record<string, unknown>) => void): GameExportError => {
      const copy = JSON.parse(lockJson(good)) as { packs: Record<string, unknown>[] } & Record<string, unknown>;
      change(copy);
      const error = refusal(() => parseLock(JSON.stringify(copy)));
      expect(error.code).toBe("BAD_LOCK");
      return error;
    };
    expect(refusal(() => parseLock("{")).code).toBe("BAD_LOCK");
    expect(refusal(() => parseLock("[]")).code).toBe("BAD_LOCK");
    expect(broken((lock) => (lock["schema"] = 2)).message).toContain("newer version");
    expect(broken((lock) => (lock["note"] = "x")).message).toContain("unknown key \"note\"");
    expect(broken((lock) => (lock.packs[0]!["into"] = "../../elsewhere")).message).toContain("inside the project");
    expect(broken((lock) => (lock.packs[0]!["into"] = "/tmp/x")).message).toContain("inside the project");
    expect(broken((lock) => ((lock.packs[0]!["files"] as { path: string }[])[0]!.path = "../x.glb")).message).toContain("inside the pack's folder");
    expect(broken((lock) => ((lock.packs[0]!["files"] as { sha256: string }[])[0]!.sha256 = "abc")).message).toContain("sha256");
    expect(broken((lock) => (lock.packs[0]!["digest"] = "abc")).message).toContain("digest");
    expect(broken((lock) => delete lock.packs[0]!["inTheBuild"]).message).toContain("inTheBuild");
    expect(broken((lock) => lock.packs.push(lock.packs[0]!)).message).toContain("twice");
    expect(broken((lock) => (lock.packs[0]!["kind"] = "level")).message).toContain("kind");
  });
});

describe("install, status and pin", () => {
  let dir: string;
  let project: string;
  let packs: string;

  beforeAll(() => {
    // A path with spaces in it, as a person's projects folder has.
    dir = realpathSync(mkdtempSync(join(tmpdir(), "corbelo game export install ")));
    project = join(dir, "My Game Project");
    packs = join(dir, "packs from the app");
    mkdirSync(project);
    mkdirSync(packs);
    writeFileSync(join(project, "project.godot"), "; a game\n");
    writeFileSync(join(packs, "crate r1.zip"), packToZip(crates("r1")));
    writeFileSync(join(packs, "crate r2.zip"), packToZip(crates("r2", 1000)));
    mkdirSync(join(packs, "crate folder"));
    for (const file of crates("r1").files) writeFileSync(join(packs, "crate folder", file.name), file.bytes);
    writeFileSync(join(packs, "crate folder", "notes.txt"), "not part of the pack");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  async function command(args: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = "";
    let err = "";
    const io: CliIo = { out: (chunk) => (out += chunk), err: (chunk) => (err += chunk) };
    const code = await runCommand(args, io);
    return { code, out, err };
  }

  /** Every file under a folder, as paths with "/" from it. */
  const filesIn = (folder: string): string[] =>
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1))
      .sort();

  it("installs an archive into a project on a path with spaces, and writes the lock file", async () => {
    const { code, out, err } = await command(["install", join(packs, "crate r1.zip"), "--project", project]);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(out.trimEnd()).not.toContain("\n");
    const result = JSON.parse(out) as InstallResult;
    expect(result).toMatchObject({ project, lockFile: join(project, LOCK_FILE_NAME), pack: "crate", kind: "family", into: "assets/crate", to: { revision: "r1" }, pinned: true, counts: { added: 3, changed: 0, unchanged: 0, removed: 0, kept: 0 }, ignored: [] });
    expect(result).not.toHaveProperty("write");
    expect(result).not.toHaveProperty("lock");
    expect(filesIn(project)).toEqual(["assets/crate/crate.pack.json", "assets/crate/crate_large.glb", "assets/crate/crate_small.glb", LOCK_FILE_NAME, "project.godot"]);
    const pack = crates("r1");
    for (const file of pack.files) expect(readFileSync(join(project, "assets/crate", file.name)).equals(file.bytes), file.name).toBe(true);
    const lock = parseLock(readFileSync(join(project, LOCK_FILE_NAME), "utf8"));
    expect(lock.packs[0]).toMatchObject({ name: "crate", into: "assets/crate", revision: "r1", provenance: { part: "crates", revision: "r1" }, inTheBuild: { revision: "r1" } });
    expect(lock.packs[0]!.files.map((file) => [file.path, file.sha256])).toEqual(pack.files.map((file) => [file.name, sha256(file.bytes)]).sort());
    expect(readFileSync(join(project, LOCK_FILE_NAME), "utf8")).toBe(lockJson(lock));
  });

  it("says the project matches its lock file", async () => {
    const { code, out } = await command(["status", "--project", project, "--strict"]);
    expect(code).toBe(0);
    expect(JSON.parse(out) as ProjectStatus).toMatchObject({ project, ok: true, packs: [{ name: "crate", pinned: true, matches: true, counts: { same: 3, changed: 0, missing: 0 } }] });
    const said = await command(["status", "--project", project, "--text"]);
    expect(said.out).toContain("crate (family) in assets/crate: r1 (");
    expect(said.out).toContain("3 files as installed");
    expect(said.out).toContain("in the build: the revision installed");
  });

  it("installs the same pack from a folder and changes nothing", async () => {
    const lockBefore = readFileSync(join(project, LOCK_FILE_NAME));
    const { code, out } = await command(["install", join(packs, "crate folder"), "--project", project]);
    expect(code).toBe(0);
    expect(JSON.parse(out) as InstallResult).toMatchObject({ counts: { added: 0, changed: 0, unchanged: 3, removed: 0, kept: 0 }, ignored: [] });
    expect(readFileSync(join(project, LOCK_FILE_NAME)).equals(lockBefore)).toBe(true);
    // From a folder only the manifest and the files it lists are read.
    expect(readPackFiles(join(packs, "crate folder")).map((file) => file.name)).toEqual(["crate.pack.json", "crate_small.glb", "crate_large.glb"]);
  });

  it("says what a newer pack would change without writing, then updates in place and keeps the names", async () => {
    // What the game added next to the files stays: an engine writes its own files there.
    writeFileSync(join(project, "assets/crate/crate_small.glb.import"), "[remap]\n");
    const before = filesIn(project);
    const lockBefore = readFileSync(join(project, LOCK_FILE_NAME), "utf8");
    const dry = await command(["install", join(packs, "crate r2.zip"), "--project", project, "--dry-run", "--text"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("Would install crate (family) into assets/crate: r1 (");
    expect(dry.out).toContain("-> r2 (");
    expect(dry.out).toContain("  changed   assets/crate/crate_large.glb");
    expect(readFileSync(join(project, LOCK_FILE_NAME), "utf8")).toBe(lockBefore);
    expect(readFileSync(join(project, "assets/crate/crate_large.glb")).equals(crates("r1").files[1]!.bytes)).toBe(true);

    const { code, out } = await command(["install", join(packs, "crate r2.zip"), "--project", project]);
    expect(code).toBe(0);
    const result = JSON.parse(out) as InstallResult;
    expect(result).toMatchObject({ from: { revision: "r1" }, to: { revision: "r2" }, inTheBuild: { revision: "r1" }, pinned: false, counts: { added: 0, changed: 3, unchanged: 0, removed: 0, kept: 0 } });
    expect(filesIn(project)).toEqual(before);
    expect(readFileSync(join(project, "assets/crate/crate_large.glb")).equals(crates("r2", 1000).files[1]!.bytes)).toBe(true);
    // Nothing is left of the files written next to their places first.
    expect(filesIn(project).some((path) => path.endsWith(".part"))).toBe(false);

    // The files match, and the build still says the first revision: strict says no.
    const status = await command(["status", "--project", project, "--strict"]);
    expect(status.code).toBe(3);
    expect(JSON.parse(status.out) as ProjectStatus).toMatchObject({ ok: false, packs: [{ matches: true, pinned: false, installed: { revision: "r2" }, inTheBuild: { revision: "r1" } }] });
    expect((await command(["status", "--project", project])).code).toBe(0);
  });

  it("pins the installed revision as the one in the build", async () => {
    const { code, out } = await command(["pin", "crate", "--project", project]);
    expect(code).toBe(0);
    expect(JSON.parse(out) as ProjectStatus).toMatchObject({ ok: true, packs: [{ pinned: true, inTheBuild: { revision: "r2" } }] });
    expect((await command(["status", "--project", project, "--strict"])).code).toBe(0);
    const missing = await command(["pin", "barrel", "--project", project]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("error [BAD_LOCK]");
  });

  it("sees a file changed or taken out of the project, and will not pin or overwrite it", async () => {
    const place = join(project, "assets/crate/crate_small.glb");
    const original = readFileSync(place);
    writeFileSync(place, "edited in the project");
    const status = await command(["status", "--project", project, "--strict", "--text"]);
    expect(status.code).toBe(3);
    expect(status.out).toContain("1 changed, 0 missing");
    expect(status.out).toContain("  changed   assets/crate/crate_small.glb");
    const pin = await command(["pin", "--project", project]);
    expect(pin.code).toBe(1);
    expect(pin.err).toContain("error [PACK_MISMATCH]");

    const install = await command(["install", join(packs, "crate r1.zip"), "--project", project]);
    expect(install.code).toBe(1);
    expect(install.err).toContain("error [FILE_IN_THE_WAY]");
    expect(install.err).toContain("crate_small.glb was changed in the project since it was installed");
    // Nothing was written: not the other files either.
    expect(readFileSync(place, "utf8")).toBe("edited in the project");
    expect(readFileSync(join(project, "assets/crate/crate_large.glb")).equals(crates("r2", 1000).files[1]!.bytes)).toBe(true);

    const forced = await command(["install", join(packs, "crate r2.zip"), "--project", project, "--force"]);
    expect(forced.code).toBe(0);
    expect((JSON.parse(forced.out) as InstallResult).changes.find((change) => change.forced === true)).toMatchObject({ path: "assets/crate/crate_small.glb", change: "changed" });
    expect(readFileSync(place).equals(original)).toBe(true);
    expect((await command(["status", "--project", project, "--strict"])).code).toBe(0);
  });

  it("refuses a pack whose files are not the ones its manifest lists, and writes nothing", async () => {
    const fresh = join(dir, "fresh project");
    mkdirSync(fresh);
    const pack = crates("r3");
    const tampered = pack.files.map((file) => ({ name: file.name, bytes: file.bytes.slice() }));
    tampered[0]!.bytes[tampered[0]!.bytes.length - 2]! ^= 0x20;
    writeFileSync(join(packs, "tampered.zip"), writeZip(tampered));
    const { code, err, out } = await command(["install", join(packs, "tampered.zip"), "--project", fresh]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("error [PACK_MISMATCH]");
    expect(err).toContain("crate_small.glb has SHA-256");
    expect(filesIn(fresh)).toEqual([]);

    // The same from a folder, and an archive damaged on the way.
    mkdirSync(join(packs, "tampered folder"));
    for (const file of tampered) writeFileSync(join(packs, "tampered folder", file.name), file.bytes);
    expect((await command(["install", join(packs, "tampered folder"), "--project", fresh])).err).toContain("error [PACK_MISMATCH]");
    const damaged = packToZip(pack);
    damaged[100] = damaged[100]! ^ 0xff;
    writeFileSync(join(packs, "damaged.zip"), damaged);
    expect((await command(["install", join(packs, "damaged.zip"), "--project", fresh])).err).toContain("error [BAD_ZIP]");
    writeFileSync(join(packs, "notes.zip"), "not an archive");
    expect((await command(["install", join(packs, "notes.zip"), "--project", fresh])).err).toContain("error [BAD_ZIP]");
    expect((await command(["install", join(packs, "missing.zip"), "--project", fresh])).err).toContain("error [BAD_PACK]");
    expect((await command(["install", join(packs, "crate r1.zip"), "--project", join(dir, "no such project")])).err).toContain("error [BAD_OPTION]");
    expect(filesIn(fresh)).toEqual([]);
  });

  it("never writes outside the project: not by a path, not through a link, not by a lock file", async () => {
    const fresh = join(dir, "contained project");
    const outside = join(dir, "outside the project");
    mkdirSync(fresh);
    mkdirSync(outside);
    const pack = join(packs, "crate r1.zip");
    for (const into of ["../outside the project", outside, "assets/../../outside the project"]) {
      const { code, err } = await command(["install", pack, "--project", fresh, "--into", into]);
      expect(code, into).toBe(1);
      expect(err, into).toContain("error [OUTSIDE_PROJECT]");
    }
    // A folder of the project that is a link to somewhere else.
    symlinkSync(outside, join(fresh, "assets"));
    const linked = await command(["install", pack, "--project", fresh]);
    expect(linked.code).toBe(1);
    expect(linked.err).toContain("error [OUTSIDE_PROJECT]");
    expect(linked.err).toContain("is a link to");
    expect(filesIn(outside)).toEqual([]);
    rmSync(join(fresh, "assets"));
    // A link to nothing.
    symlinkSync(join(dir, "nowhere"), join(fresh, "assets"));
    expect((await command(["install", pack, "--project", fresh])).err).toContain("error [OUTSIDE_PROJECT]");
    rmSync(join(fresh, "assets"));
    // A link inside the project to another folder of the project is the project.
    mkdirSync(join(fresh, "art"));
    symlinkSync(join(fresh, "art"), join(fresh, "assets"));
    expect((await command(["install", pack, "--project", fresh])).code).toBe(0);
    expect(filesIn(join(fresh, "art"))).toEqual(["crate/crate.pack.json", "crate/crate_large.glb", "crate/crate_small.glb"]);

    // A file of the pack that is a link out of the project is not followed.
    const target = join(outside, "target.glb");
    writeFileSync(target, "outside");
    rmSync(join(fresh, "art/crate/crate_small.glb"));
    symlinkSync(target, join(fresh, "art/crate/crate_small.glb"));
    const through = await command(["install", join(packs, "crate r2.zip"), "--project", fresh, "--force"]);
    expect(through.code).toBe(1);
    expect(through.err).toContain("error [OUTSIDE_PROJECT]");
    expect(readFileSync(target, "utf8")).toBe("outside");

    // A lock file that was edited to point outside is refused before anything is read or removed.
    const lockPlace = join(fresh, LOCK_FILE_NAME);
    const lock = JSON.parse(readFileSync(lockPlace, "utf8")) as { packs: { into: string }[] };
    lock.packs[0]!.into = "../outside the project";
    writeFileSync(lockPlace, JSON.stringify(lock));
    for (const args of [["install", pack, "--project", fresh], ["status", "--project", fresh], ["pin", "--project", fresh]]) {
      const { code, err } = await command(args);
      expect(code).toBe(1);
      expect(err).toContain("error [BAD_LOCK]");
    }
    expect(filesIn(outside)).toEqual(["target.glb"]);

    // A project that is itself reached through a link is the folder it points to.
    const real = join(dir, "real project");
    mkdirSync(real);
    symlinkSync(real, join(dir, "linked project"));
    const reached = await command(["install", pack, "--project", join(dir, "linked project")]);
    expect(reached.code).toBe(0);
    expect((JSON.parse(reached.out) as InstallResult).project).toBe(real);
    expect(filesIn(real)).toContain("assets/crate/crate_small.glb");
  });

  it("refuses a file or a folder in the way, and replaces a file with --force", async () => {
    const fresh = join(dir, "busy project");
    mkdirSync(join(fresh, "assets/crate"), { recursive: true });
    writeFileSync(join(fresh, "assets/crate/crate_small.glb"), "the game's own");
    const pack = join(packs, "crate r1.zip");
    const refused = await command(["install", pack, "--project", fresh]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("error [FILE_IN_THE_WAY]");
    expect(filesIn(fresh)).toEqual(["assets/crate/crate_small.glb"]);
    expect((await command(["install", pack, "--project", fresh, "--force"])).code).toBe(0);
    expect(readFileSync(join(fresh, "assets/crate/crate_small.glb")).equals(crates("r1").files[0]!.bytes)).toBe(true);

    const blocked = join(dir, "blocked project");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "assets"), "a file named as the folder");
    const inTheWay = await command(["install", pack, "--project", blocked, "--force"]);
    expect(inTheWay.code).toBe(1);
    expect(inTheWay.err).toContain("assets is a file where the pack needs a folder");
  });

  it("moves a pack to another folder, takes the old files away, and leaves what the game put there", async () => {
    const fresh = join(dir, "moving project");
    mkdirSync(fresh);
    const pack = join(packs, "crate r1.zip");
    expect((await command(["install", pack, "--project", fresh, "--into", "art/props"])).code).toBe(0);
    writeFileSync(join(fresh, "art/props/crate/crate_small.tscn"), "[gd_scene]\n");
    const { code, out } = await command(["install", pack, "--project", fresh, "--into", "models"]);
    expect(code).toBe(0);
    expect((JSON.parse(out) as InstallResult).counts).toEqual({ added: 3, changed: 0, unchanged: 0, removed: 3, kept: 0 });
    expect(filesIn(fresh)).toEqual(["art/props/crate/crate_small.tscn", LOCK_FILE_NAME, "models/crate/crate.pack.json", "models/crate/crate_large.glb", "models/crate/crate_small.glb"]);
    // Without the game's file the folders the pack leaves empty go too.
    rmSync(join(fresh, "art/props/crate/crate_small.tscn"));
    expect((await command(["install", pack, "--project", fresh, "--into", "art/props"])).code).toBe(0);
    expect((await command(["install", pack, "--project", fresh, "--into", "models"])).code).toBe(0);
    expect(existsSync(join(fresh, "art"))).toBe(false);
  });

  it("has a wrong command line exit with 2 and a project without a lock file with 1", async () => {
    const wrong: string[][] = [
      ["install"],
      ["install", join(packs, "crate r1.zip")],
      ["install", join(packs, "crate r1.zip"), "--project"],
      ["install", "a.zip", "b.zip", "--project", project],
      ["install", "a.zip", "--project", project, "--strict"],
      ["status", "extra", "--project", project],
      ["status", "--into", "assets"],
      ["pin", "crate"],
      ["pin", "a", "b", "--project", project],
    ];
    for (const args of wrong) {
      const { code, err, out } = await command(args);
      expect(code, args.join(" ")).toBe(2);
      expect(err, args.join(" ")).toContain("corbelo-game-export:");
      expect(out).toBe("");
    }
    const empty = join(dir, "empty project");
    mkdirSync(empty);
    const none = await command(["status", "--project", empty]);
    expect(none.code).toBe(1);
    expect(none.err).toContain("error [BAD_LOCK]");
    expect(none.err).toContain("has no lock file");
    expect(() => projectStatus(empty)).toThrow(GameExportError);
    expect((await command(["--help"])).out).toContain("corbelo-game-export install <pack.zip | folder> --project <dir>");
  });

  it("installs a kit pack made by the pack command, with its scenes", async () => {
    // The kit as a job: every piece's boxes as STL files.
    const kit = corridorKit();
    const grid = { moduleMeters: 3, storeyMeters: 3, trimMeters: 0.1 };
    const jobDir = join(dir, "kit job");
    mkdirSync(jobDir);
    const open = { straight: ["+x", "-x"], endcap: ["+x"] } as const;
    const pieces = Object.entries(open).map(([name, sides]) => {
      const boxes = flatBoxes(grid, sides).map(([min, max]) => box(min, max));
      const all = new Float32Array(boxes.reduce((total, shape) => total + shape.positions.length, 0));
      let at = 0;
      for (const shape of boxes) {
        all.set(shape.positions, at);
        at += shape.positions.length;
      }
      writeFileSync(join(jobDir, `${name}.stl`), binaryStl(all));
      boxes.forEach((shape, index) => writeFileSync(join(jobDir, `${name}-${index}.stl`), binaryStl(shape.positions)));
      return {
        name,
        bodies: [{ name, stl: `${name}.stl`, color: "#8a8f98", materialName: "Concrete", collisionPieces: boxes.map((_, index) => ({ stl: `${name}-${index}.stl` })) }],
        sockets: sides.map((side) => ({ type: "corridor", side, passage: true })),
      };
    });
    const job = { name: "hall", source: kit.source, grid: kit.grid, collision: "pieces", pieces, revision: "k1", output: { zip: "hall.zip" } };
    // The job is one the published schema for kit jobs takes.
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
    for (const name of ["pack", "check-report", "kit-check-report"]) ajv.addSchema(JSON.parse(readFileSync(join(import.meta.dirname, "..", "schema", `${name}.schema.json`), "utf8")) as object);
    const validJob = ajv.compile(JSON.parse(readFileSync(join(import.meta.dirname, "..", "schema", "kit-job.schema.json"), "utf8")) as object);
    expect(validJob(job), JSON.stringify(validJob.errors)).toBe(true);
    const result = await runPackJob(job, { base: jobDir });
    expect(result.name).toBe("hall");
    expect(result.pack.manifest.kind).toBe("kit");
    expect(result.pack.manifest.kit!.checks!.results.map((check) => [check.id, check.status])).toEqual([
      ["on-grid", "pass"],
      ["seams", "pass"],
      ["in-cells", "pass"],
      ["layouts", "pass"],
      ["corners", "pass"],
      ["walkable", "pass"],
      ["collision-tiles", "pass"],
    ]);
    expect(result.files.map((file) => [file.name, file.sha256 !== undefined])).toEqual([["hall_straight.glb", true], ["hall_endcap.glb", true], ["hall_layout_run.glb", true], ["hall.pack.json", false]]);

    const fresh = join(dir, "kit project");
    mkdirSync(fresh);
    const installed = installPack(join(jobDir, "hall.zip"), fresh);
    expect(installed).toMatchObject({ pack: "hall", kind: "kit", into: "assets/hall", to: { revision: "k1" }, counts: { added: 4 } });
    const lock = parseLock(readFileSync(join(fresh, LOCK_FILE_NAME), "utf8"));
    expect(lock.packs[0]!.files.map((file) => [file.path, file.role, file.row ?? file.layout])).toEqual([
      ["hall.pack.json", "manifest", undefined],
      ["hall_endcap.glb", "model", "endcap"],
      ["hall_layout_run.glb", "blockout", "run"],
      ["hall_straight.glb", "model", "straight"],
    ]);
  });

  it("refuses a kit job that is not one", async () => {
    const code = async (job: unknown): Promise<string> => {
      try {
        await runPackJob(job, { base: dir });
      } catch (error) {
        return (error as GameExportError).code;
      }
      return "nothing";
    };
    const base = { name: "hall", source: MM_Z_UP, grid: { moduleMeters: 3, storeyMeters: 3 } };
    expect(await code({ ...base, pieces: [] })).toBe("BAD_JOB");
    expect(await code({ ...base, pieces: [{ name: "a" }] })).toBe("BAD_JOB");
    expect(await code({ ...base, pieces: [{ name: "a", glb: "a.glb", bodies: [] }] })).toBe("BAD_JOB");
    expect(await code({ ...base, pieces: [{ name: "a", glb: "missing.glb" }] })).toBe("BAD_JOB");
    expect(await code({ ...base, pieces: [{ name: "a", glb: "a.glb", colour: "red" }] })).toBe("BAD_JOB");
    expect(await code({ ...base, rows: [], pieces: [{ name: "a", glb: "a.glb" }] })).toBe("BAD_JOB");
  });
});
