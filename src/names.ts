import { ENGINE_PROFILES } from "./profiles.js";

const MAX_NAME_LENGTH = 60;

/**
 * Other name endings Godot's scene importer acts on. They are not collision or detail-level
 * rules, so they are not part of a profile, but a body must not trigger them by accident.
 */
const OTHER_GODOT_HINTS = ["noimp", "navmesh", "occ", "rigid", "vehicle", "wheel"];

let reserved: { prefixes: string[]; endings: string[] } | undefined;

/** The prefixes and endings the built-in profiles act on, worked out the first time a name is checked. */
function reservedAffixes(): { prefixes: string[]; endings: string[] } {
  if (reserved === undefined) {
    const prefixes: string[] = [];
    const endings: string[] = [...OTHER_GODOT_HINTS];
    for (const profile of Object.values(ENGINE_PROFILES)) {
      for (const rule of [...profile.conventions.collision, ...profile.conventions.lod]) {
        const list = rule.affix === "prefix" ? prefixes : endings;
        const text = rule.affix === "prefix" ? rule.text.toLowerCase() : rule.text.replace(/^[-_]/, "").toLowerCase();
        if (!list.includes(text)) list.push(text);
      }
    }
    reserved = { prefixes, endings };
  }
  return reserved;
}

/** Letters, digits, `_` and `-` only. Accents are dropped from letters; anything else becomes `_`. */
export function safeName(name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^[_-]+|[_-]+$/g, "");
  return cleaned === "" ? fallback : cleaned;
}

/** True when a built-in engine profile would read the name as a collision shape or a detail level. */
export function hasReservedPrefix(name: string): boolean {
  const lower = name.toLowerCase();
  return reservedAffixes().prefixes.some((prefix) => lower.startsWith(prefix));
}

/**
 * Importers ignore trailing digits and underscores when they look for an ending, and accept
 * either `-` or `_` in front of it, so `wall_col_2` counts the same as `wall-col`.
 */
export function hasReservedEnding(name: string): boolean {
  const lower = name.toLowerCase().replace(/[0-9_]+$/, "");
  return reservedAffixes().endings.some((ending) => lower.endsWith(`-${ending}`) || lower.endsWith(`_${ending}`));
}

/**
 * A name nothing in `used` has yet, without regard to letter case: `base`, or `base_2`, `base_3`
 * and so on. `wrap` gives the full name for a candidate, for a name that must keep an ending or
 * a prefix. The name is added to `used`.
 */
export function uniqueName(used: Set<string>, base: string, wrap: (candidate: string) => string = (candidate) => candidate): string {
  let name = wrap(base);
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = wrap(`${base}_${n}`);
  used.add(name.toLowerCase());
  return name;
}

/** A safe name that no built-in engine profile reads as a collision shape or a detail level. */
export function clearName(name: string, fallback: string): string {
  let base = safeName(name, fallback);
  if (hasReservedPrefix(base)) base = `${fallback}_${base}`;
  if (hasReservedEnding(base)) base = `${base}_${fallback}`;
  return base;
}

/**
 * Node names for bodies, in order. Each is safe for the built-in engines, clear of their
 * collision and detail-level naming rules, and unique without regard to letter case.
 * The same list of names always gives the same result.
 */
export function nodeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => uniqueName(used, clearName(name, "body")));
}
