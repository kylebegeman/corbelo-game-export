// What a check says against its message key. A message, a reason and every part of either that
// has a key of its own must be what the English catalog and the named values rebuild, and a
// template must use every value it is given and no other. The setup file walks every report of
// the suite through `notRebuilt`, and messages.test.ts reads `seen` for the keys it brought out.
import { ENGLISH_MESSAGES, fillTemplate, type MessageCatalog, type MessagePart, type MessageValue, type MessageValues } from "../src/messages.js";

interface Keyed {
  id?: string;
  message?: string;
  messageKey?: string;
  messageValues?: MessageValues;
  reason?: string;
  reasonKey?: string;
  reasonValues?: MessageValues;
  values?: unknown;
}

/** Every key a report of this test file was made with. */
export const seen = new Set<string>();

const catalog: MessageCatalog = ENGLISH_MESSAGES;

/** The names a template is filled by, at any depth of its choices. */
export function namesIn(template: string): Set<string> {
  const names = new Set<string>();
  const read = (text: string): void => {
    for (let at = 0; at < text.length; at += 1) {
      if (text[at] !== "{") continue;
      let depth = 0;
      let close = at;
      for (; close < text.length; close += 1) {
        if (text[close] === "{") depth += 1;
        else if (text[close] === "}" && (depth -= 1) === 0) break;
      }
      const inside = text.slice(at + 1, close);
      const comma = inside.indexOf(",");
      names.add((comma < 0 ? inside : inside.slice(0, comma)).trim());
      const next = comma < 0 ? -1 : inside.indexOf(",", comma + 1);
      // What comes after the kind is choices: a word, then what it stands for in braces.
      if (next >= 0) {
        const choices = inside.slice(next + 1);
        for (let from = 0; from < choices.length; ) {
          const open = choices.indexOf("{", from);
          if (open < 0) break;
          let level = 0;
          let end = open;
          for (; end < choices.length; end += 1) {
            if (choices[end] === "{") level += 1;
            else if (choices[end] === "}" && (level -= 1) === 0) break;
          }
          read(choices.slice(open + 1, end));
          from = end + 1;
        }
      }
      at = close;
    }
  };
  read(template);
  return names;
}

const isPart = (value: MessageValue): value is MessagePart => typeof value === "object" && !Array.isArray(value);

function check(where: string, text: string | undefined, key: string | undefined, values: MessageValues | undefined, wrong: string[]): void {
  if (text === undefined && key === undefined) return;
  if (text === undefined || key === undefined || values === undefined) {
    wrong.push(`${where}: a text, its key and its values come together, and one is missing (${String(key)})`);
    return;
  }
  seen.add(key);
  const template = catalog[key];
  if (template === undefined) {
    wrong.push(`${where}: the catalog has no "${key}"`);
    return;
  }
  const rebuilt = fillTemplate(template, values, catalog);
  if (rebuilt !== text) wrong.push(`${where}: "${key}" rebuilds\n  ${rebuilt}\nand the check said\n  ${text}`);
  const used = namesIn(template);
  for (const name of Object.keys(values)) if (!used.has(name)) wrong.push(`${where}: "${key}" is given ${name}, which its template does not use`);
  for (const name of used) if (!Object.hasOwn(values, name)) wrong.push(`${where}: the template of "${key}" uses ${name}, which it was not given`);
  // A part with a key of its own is held to the same rule.
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isPart(item)) check(`${where}, ${name}`, item.text, item.key, item.values, wrong);
    }
  }
}

/** What a report says that its keys and values do not rebuild. Empty when every text is rebuilt. */
export function notRebuilt(report: { results: readonly Keyed[] }): string[] {
  const wrong: string[] = [];
  for (const result of report.results) {
    const where = String(result.id);
    if (result.messageKey !== `${where}.${result.messageKey?.slice(where.length + 1)}`) wrong.push(`${where}: the key "${String(result.messageKey)}" does not start with the id of its check`);
    check(`${where} message`, result.message, result.messageKey, result.messageValues, wrong);
    check(`${where} reason`, result.reason, result.reasonKey, result.reasonValues, wrong);
    if (result.reason !== undefined && result.reasonKey !== `${result.messageKey}.reason`) wrong.push(`${where}: the key of the reason is "${String(result.reasonKey)}"`);
    const skipped = (result.values as { skipped?: Keyed[] } | undefined)?.skipped;
    for (const skip of skipped ?? []) check(`${where} layout left out`, skip.reason, skip.reasonKey, skip.reasonValues, wrong);
  }
  return wrong;
}
