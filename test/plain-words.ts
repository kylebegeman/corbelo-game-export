// What a check may say to a person. A message or a reason is read by someone who models parts,
// not by someone who calls this package, so it names none of the package's own functions,
// option keys or ids: it says what is missing and what to do in plain words.
//
// This file imports nothing from src/, so the setup file that holds every report of the suite
// to the rule can load it before the package itself.

/** The names a message may not hold. */
export interface Vocabulary {
  /** What the main entry exports as functions. */
  functions: string[];
  /** Ids the package gives things: checks, asset classes, engine profiles, players and the values of options. */
  ids: string[];
}

/** Option keys that are not caught as camelCase because they are one lower-case word that is not a word of English. */
export const OPTION_KEYS = ["lods", "texcoords"] as const;

/** Values of options that read as ids, next to the ones the package lists itself. */
export const OPTION_VALUES = ["base-center", "min-corner", "angle-area", "face-weighted"] as const;

/** A name written the way code writes one: lower case, then a capital inside the word. */
const CAMEL_CASE = /(?<![\w-])[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*(?![\w-])/g;

/**
 * An id counts when it cannot be mistaken for a word: it has a hyphen or a digit in it. The
 * checks named "size" and "collision" are also words a sentence needs.
 */
const readsAsId = (id: string): boolean => /[-0-9]/.test(id);

/** The vocabulary of the package, read off what its main entry exports. */
export function vocabularyOf(api: Record<string, unknown>): Vocabulary {
  const list = (name: string): string[] => (Array.isArray(api[name]) ? (api[name] as string[]) : []);
  const keys = (name: string): string[] => Object.keys((api[name] ?? {}) as object);
  const players = Object.values((api["PLAYER_PROFILES"] ?? {}) as Record<string, { id: string }>).map((player) => player.id);
  return {
    functions: Object.keys(api).filter((name) => typeof api[name] === "function" && !/^[A-Z]/.test(name)),
    ids: [...list("CHECK_IDS"), ...list("KIT_CHECK_IDS"), ...keys("ASSET_BUDGETS"), ...keys("ENGINE_PROFILES"), ...players, ...OPTION_VALUES].filter(readsAsId),
  };
}

const whole = (text: string, name: string): boolean => {
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const before = at === 0 ? " " : text[at - 1]!;
    const after = at + name.length >= text.length ? " " : text[at + name.length]!;
    if (!/[\w-]/.test(before) && !/[\w-]/.test(after)) return true;
  }
  return false;
};

/** Every name of the package's own that a text holds. Empty for a text in plain words. */
export function identifiersIn(text: string, vocabulary: Vocabulary): string[] {
  const found = new Set<string>();
  // A function with a capital inside its name is camelCase too. It is looked for by name as
  // well, so that the rule still holds if the pattern is ever loosened.
  for (const name of vocabulary.functions) if (/[A-Z]/.test(name) && whole(text, name)) found.add(name);
  for (const match of text.matchAll(CAMEL_CASE)) found.add(match[0]);
  for (const name of [...OPTION_KEYS, ...vocabulary.ids]) if (whole(text, name)) found.add(name);
  return [...found];
}

interface Said {
  id: string;
  status: string;
  message: string;
  reason?: string;
  values?: unknown;
}

/** Every text of a report a person reads: each message and reason, and why a test layout was not built. */
export function textsOf(report: { results: readonly Said[] }): { id: string; status: string; text: string }[] {
  const texts: { id: string; status: string; text: string }[] = [];
  for (const result of report.results) {
    texts.push({ id: result.id, status: result.status, text: result.message });
    if (result.reason !== undefined) texts.push({ id: result.id, status: result.status, text: result.reason });
    const skipped = (result.values as { skipped?: { reason: string }[] } | undefined)?.skipped;
    for (const skip of skipped ?? []) texts.push({ id: result.id, status: result.status, text: skip.reason });
  }
  return texts;
}

/** How much the setup file has walked in this test file, for the test that shows it is at work. */
export const walked = { reports: 0, texts: 0 };
