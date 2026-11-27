import type { EngineProfileId } from "./profiles.js";
/**
 * How assets of a family are named for each built-in engine, the way each engine's own
 * projects usually name them. A custom profile uses the Godot pattern unless one is given.
 */
export declare const DEFAULT_NAME_PATTERNS: Readonly<Record<EngineProfileId, string>>;
/**
 * The name of one asset of a family, from a pattern.
 *
 * `{family}` and `{row}` are written in small letters with `_` between words, `{Family}` and
 * `{Row}` with a capital at the start of each word and nothing between, and `{FAMILY}` and
 * `{ROW}` in capitals with `_` between. Everything else in the pattern is kept.
 *
 *   assetName("SM_{Family}_{Row}", "crate", "small")   "SM_Crate_Small"
 *   assetName("{family}_{row}", "Crate", "Small")      "crate_small"
 *
 * Without a row, the row and the separator in front of it are left out: "SM_Crate".
 * A pattern may write the family out itself and keep only the row: "SM_Crate_{Row}". It needs
 * one of the two, so that two rows cannot come out with one name, and it must leave an asset
 * with no row something to be called.
 * The same pattern, family and row always give the same name.
 */
export declare function assetName(pattern: string, family: string, row?: string): string;
