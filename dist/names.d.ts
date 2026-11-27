/** Letters, digits, `_` and `-` only. Accents are dropped from letters; anything else becomes `_`. */
export declare function safeName(name: string, fallback: string): string;
/** True when a built-in engine profile would read the name as a collision shape or a detail level. */
export declare function hasReservedPrefix(name: string): boolean;
/**
 * Importers ignore trailing digits and underscores when they look for an ending, and accept
 * either `-` or `_` in front of it, so `wall_col_2` counts the same as `wall-col`.
 */
export declare function hasReservedEnding(name: string): boolean;
/**
 * A name nothing in `used` has yet, without regard to letter case: `base`, or `base_2`, `base_3`
 * and so on. `wrap` gives the full name for a candidate, for a name that must keep an ending or
 * a prefix. The name is added to `used`.
 */
export declare function uniqueName(used: Set<string>, base: string, wrap?: (candidate: string) => string): string;
/** A safe name that no built-in engine profile reads as a collision shape or a detail level. */
export declare function clearName(name: string, fallback: string): string;
/**
 * Node names for bodies, in order. Each is safe for the built-in engines, clear of their
 * collision and detail-level naming rules, and unique without regard to letter case.
 * The same list of names always gives the same result.
 */
export declare function nodeNames(names: readonly string[]): string[];
