import { ENGINE_PROFILES } from "./profiles.js";

const MAX_NAME_LENGTH = 60;

/**
 * Other name endings Godot's scene importer acts on. They are not collision or detail-level
 * rules, so they are not part of a profile, but a body must not trigger them by accident.
 */
const OTHER_GODOT_HINTS = ["noimp", "navmesh", "occ", "rigid", "vehicle", "wheel"];

const reservedPrefixes: string[] = [];
const reservedEndings: string[] = [...OTHER_GODOT_HINTS];
for (const profile of Object.values(ENGINE_PROFILES)) {
  for (const rule of [...profile.conventions.collision, ...profile.conventions.lod]) {
    const list = rule.affix === "prefix" ? reservedPrefixes : reservedEndings;
    const text = rule.affix === "prefix" ? rule.text.toLowerCase() : rule.text.replace(/^[-_]/, "").toLowerCase();
    if (!list.includes(text)) list.push(text);
  }
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
  return reservedPrefixes.some((prefix) => lower.startsWith(prefix));
}

/**
 * Importers ignore trailing digits and underscores when they look for an ending, and accept
 * either `-` or `_` in front of it, so `wall_col_2` counts the same as `wall-col`.
 */
export function hasReservedEnding(name: string): boolean {
  const lower = name.toLowerCase().replace(/[0-9_]+$/, "");
  return reservedEndings.some((ending) => lower.endsWith(`-${ending}`) || lower.endsWith(`_${ending}`));
}

/**
 * Node names for bodies, in order. Each is safe for the built-in engines, clear of their
 * collision and detail-level naming rules, and unique without regard to letter case.
 * The same list of names always gives the same result.
 */
export function nodeNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let base = safeName(name, "body");
    if (hasReservedPrefix(base)) base = `body_${base}`;
    if (hasReservedEnding(base)) base = `${base}_body`;
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base}_${n}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
