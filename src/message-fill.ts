// The function that fills a template of a message with its named values. It is a file of its
// own so that a caller with a catalog of its own carries this and not the English catalog.

/** A value a template is filled with: text, a number, a part with a key of its own, or a list of those. */
export type MessageValue = string | number | MessagePart | readonly (string | number | MessagePart)[];

/** The values a template is filled with, by the names the template uses. */
export type MessageValues = Readonly<Record<string, MessageValue>>;

/** A part of a message that has a template of its own, like one of the things a mesh has wrong. */
export interface MessagePart {
  key: string;
  values?: MessageValues;
  /** The part in English, as the message has it. */
  text?: string;
}

/** Templates by message key. */
export type MessageCatalog = Readonly<Record<string, string>>;

/** What a catalog or the values have under a name, and never what any object has of itself, like `constructor`. */
function own<Value>(record: Readonly<Record<string, Value>>, name: string): Value | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/** The template a catalog has for a key. Nothing when it has none, or has something that is not text there. */
export function templateOf(catalog: MessageCatalog, key: string | undefined): string | undefined {
  const template = key === undefined ? undefined : own(catalog, key);
  return typeof template === "string" ? template : undefined;
}

interface Filling {
  catalog: MessageCatalog;
  /** Which form of a word a number takes in the language of the catalog. */
  forms: Intl.PluralRules;
}

/** Where the brace opened at `from` is closed. The end of the text when it never is. */
function closing(template: string, from: number): number {
  let depth = 0;
  for (let at = from; at < template.length; at += 1) {
    if (template[at] === "{") depth += 1;
    else if (template[at] === "}" && (depth -= 1) === 0) return at;
  }
  return template.length;
}

/** The choices after a kind: each a word and what it stands for in braces, like `one {# body} other {# bodies}`. */
function choicesOf(text: string): Map<string, string> {
  const choices = new Map<string, string>();
  for (let at = 0; at < text.length; ) {
    const open = text.indexOf("{", at);
    if (open < 0) break;
    const close = closing(text, open);
    choices.set(text.slice(at, open).trim(), text.slice(open + 1, close));
    at = close + 1;
  }
  return choices;
}

function write(value: MessageValue | undefined, filling: Filling, between = ", ", each = "#"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item: string | number | MessagePart) => fill(each, {}, filling, write(item, filling) ?? "")).join(between);
  const part = value as MessagePart;
  const template = templateOf(filling.catalog, part.key);
  return template === undefined ? String(part.text ?? part.key) : fill(template, part.values ?? {}, filling);
}

/** Fills a template. `count` is what `#` stands for: the number a choice was made by, or one item of a list. */
function fill(template: string, values: MessageValues, filling: Filling, count?: string): string {
  let out = "";
  for (let at = 0; at < template.length; at += 1) {
    const letter = template[at]!;
    if (letter === "#" && count !== undefined) {
      out += count;
    } else if (letter !== "{") {
      out += letter;
    } else {
      const close = closing(template, at);
      const inside = template.slice(at + 1, close);
      const comma = inside.indexOf(",");
      const name = (comma < 0 ? inside : inside.slice(0, comma)).trim();
      const value = own(values, name);
      const next = comma < 0 ? -1 : inside.indexOf(",", comma + 1);
      const kind = comma < 0 ? "" : inside.slice(comma + 1, next < 0 ? undefined : next).trim();
      const choices = choicesOf(next < 0 ? "" : inside.slice(next + 1));
      const pick = (chosen: string | undefined, as?: string): string => fill(chosen ?? choices.get("other") ?? "", values, filling, as ?? count);
      if (value === undefined) out += template.slice(at, close + 1);
      else if (kind === "plural") out += pick(choices.get(`=${Number(value)}`) ?? choices.get(filling.forms.select(Number(value))), String(value));
      else if (kind === "select") out += pick(choices.get(String(value)));
      else out += write(value, filling, kind === "join" ? choices.get("with") : undefined, kind === "join" ? choices.get("each") : undefined);
      at = close;
    }
  }
  return out;
}

/**
 * Fills a template with its named values. A value that is a part with a key of its own is filled
 * from the catalog, and is said in English, as the check said it, where the catalog has no
 * template for it. A name the values do not have stays in the text as it is written, braces and
 * all.
 *
 * `locale` is the language of the catalog, which decides the form a number picks: English has
 * `one` and `other`, and another language may have `few` and `many` as well.
 */
export function fillTemplate(template: string, values: MessageValues = {}, catalog: MessageCatalog = {}, locale = "en"): string {
  return fill(template, values, { catalog, forms: new Intl.PluralRules(locale) });
}

/**
 * The message of a result of a check, from a catalog. The English text the result came with is
 * returned as it is for a key the catalog does not have, and for a result written before
 * version 0.1.8, which has no key.
 */
export function fillMessage(result: { message: string; messageKey?: string; messageValues?: MessageValues }, catalog: MessageCatalog, locale = "en"): string {
  const template = templateOf(catalog, result.messageKey);
  return template === undefined ? result.message : fillTemplate(template, result.messageValues, catalog, locale);
}

/**
 * The reason of a result that was not measured, or of a test layout that was not built, from a
 * catalog. The English reason where the catalog has no template for it, and nothing for a result
 * with no reason.
 */
export function fillReason(result: { reason?: string; reasonKey?: string; reasonValues?: MessageValues }, catalog: MessageCatalog, locale = "en"): string | undefined {
  const template = templateOf(catalog, result.reasonKey);
  return template === undefined ? result.reason : fillTemplate(template, result.reasonValues, catalog, locale);
}
