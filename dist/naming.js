import { refuse } from "./errors.js";
import { safeName } from "./names.js";
/**
 * How assets of a family are named for each built-in engine, the way each engine's own
 * projects usually name them. A custom profile uses the Godot pattern unless one is given.
 */
export const DEFAULT_NAME_PATTERNS = {
    godot4: "{family}_{row}",
    unity6: "{Family}_{Row}",
    unreal5: "SM_{Family}_{Row}",
};
const TOKEN = /\{([A-Za-z]+)\}/g;
const TOKENS = ["family", "Family", "FAMILY", "row", "Row", "ROW"];
/** The words of a name: runs of letters and digits, with a new word where a capital follows a small letter or a digit. */
function words(text) {
    return text
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter((word) => word !== "");
}
function inCase(text, token) {
    const parts = words(text);
    if (token === token.toLowerCase())
        return parts.map((word) => word.toLowerCase()).join("_");
    if (token === token.toUpperCase())
        return parts.map((word) => word.toUpperCase()).join("_");
    // A word written all in capitals, like an acronym, is kept as it is.
    return parts.map((word) => (word === word.toUpperCase() ? word : word[0].toUpperCase() + word.slice(1).toLowerCase())).join("");
}
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
 * The same pattern, family and row always give the same name.
 */
export function assetName(pattern, family, row) {
    if (typeof pattern !== "string" || pattern.trim() === "")
        refuse("BAD_NAME", "A name pattern must be a string like \"{family}_{row}\".");
    if (typeof family !== "string" || words(family).length === 0)
        refuse("BAD_NAME", `A family needs a name with at least one letter or digit. Got ${JSON.stringify(family)}.`);
    if (row !== undefined && (typeof row !== "string" || words(row).length === 0))
        refuse("BAD_NAME", `A row needs a name with at least one letter or digit. Got ${JSON.stringify(row)}.`);
    let hasFamily = false;
    for (const match of pattern.matchAll(TOKEN)) {
        const token = match[1];
        if (!TOKENS.includes(token))
            refuse("BAD_NAME", `The name pattern "${pattern}" has an unknown part {${token}}. Known parts: ${TOKENS.map((name) => `{${name}}`).join(", ")}.`);
        if (token.toLowerCase() === "family")
            hasFamily = true;
    }
    if (!hasFamily)
        refuse("BAD_NAME", `The name pattern "${pattern}" needs {family}, {Family} or {FAMILY}.`);
    const filled = pattern
        // Without a row, the separator in front of it goes too.
        .replace(/[_-]*\{(row|Row|ROW)\}/g, (whole, token) => (row === undefined ? "" : whole.replace(`{${token}}`, inCase(row, token))))
        .replace(/\{(family|Family|FAMILY)\}/g, (_, token) => inCase(family, token));
    return safeName(filled, "asset");
}
