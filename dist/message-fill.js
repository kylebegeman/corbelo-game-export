// The function that fills a template of a message with its named values. It is a file of its
// own so that a caller with a catalog of its own carries this and not the English catalog.
/** What a catalog or the values have under a name, and never what any object has of itself, like `constructor`. */
function own(record, name) {
    return Object.hasOwn(record, name) ? record[name] : undefined;
}
/** The template a catalog has for a key. Nothing when it has none, or has something that is not text there. */
export function templateOf(catalog, key) {
    const template = key === undefined ? undefined : own(catalog, key);
    return typeof template === "string" ? template : undefined;
}
/** Where the brace opened at `from` is closed. The end of the text when it never is. */
function closing(template, from) {
    let depth = 0;
    for (let at = from; at < template.length; at += 1) {
        if (template[at] === "{")
            depth += 1;
        else if (template[at] === "}" && (depth -= 1) === 0)
            return at;
    }
    return template.length;
}
/** The choices after a kind: each a word and what it stands for in braces, like `one {# body} other {# bodies}`. */
function choicesOf(text) {
    const choices = new Map();
    for (let at = 0; at < text.length;) {
        const open = text.indexOf("{", at);
        if (open < 0)
            break;
        const close = closing(text, open);
        choices.set(text.slice(at, open).trim(), text.slice(open + 1, close));
        at = close + 1;
    }
    return choices;
}
function write(value, filling, between = ", ", each = "#") {
    if (value === undefined)
        return undefined;
    if (typeof value === "string")
        return value;
    if (typeof value === "number")
        return String(value);
    if (Array.isArray(value))
        return value.map((item) => fill(each, {}, filling, write(item, filling) ?? "")).join(between);
    const part = value;
    const template = templateOf(filling.catalog, part.key);
    return template === undefined ? String(part.text ?? part.key) : fill(template, part.values ?? {}, filling);
}
/** Fills a template. `count` is what `#` stands for: the number a choice was made by, or one item of a list. */
function fill(template, values, filling, count) {
    let out = "";
    for (let at = 0; at < template.length; at += 1) {
        const letter = template[at];
        if (letter === "#" && count !== undefined) {
            out += count;
        }
        else if (letter !== "{") {
            out += letter;
        }
        else {
            const close = closing(template, at);
            const inside = template.slice(at + 1, close);
            const comma = inside.indexOf(",");
            const name = (comma < 0 ? inside : inside.slice(0, comma)).trim();
            const value = own(values, name);
            const next = comma < 0 ? -1 : inside.indexOf(",", comma + 1);
            const kind = comma < 0 ? "" : inside.slice(comma + 1, next < 0 ? undefined : next).trim();
            const choices = choicesOf(next < 0 ? "" : inside.slice(next + 1));
            const pick = (chosen, as) => fill(chosen ?? choices.get("other") ?? "", values, filling, as ?? count);
            if (value === undefined)
                out += template.slice(at, close + 1);
            else if (kind === "plural")
                out += pick(choices.get(`=${Number(value)}`) ?? choices.get(filling.forms.select(Number(value))), String(value));
            else if (kind === "select")
                out += pick(choices.get(String(value)));
            else
                out += write(value, filling, kind === "join" ? choices.get("with") : undefined, kind === "join" ? choices.get("each") : undefined);
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
export function fillTemplate(template, values = {}, catalog = {}, locale = "en") {
    return fill(template, values, { catalog, forms: new Intl.PluralRules(locale) });
}
/**
 * The message of a result of a check, from a catalog. The English text the result came with is
 * returned as it is for a key the catalog does not have, and for a result written before
 * version 0.1.8, which has no key.
 */
export function fillMessage(result, catalog, locale = "en") {
    const template = templateOf(catalog, result.messageKey);
    return template === undefined ? result.message : fillTemplate(template, result.messageValues, catalog, locale);
}
/**
 * The reason of a result that was not measured, or of a test layout that was not built, from a
 * catalog. The English reason where the catalog has no template for it, and nothing for a result
 * with no reason.
 */
export function fillReason(result, catalog, locale = "en") {
    const template = templateOf(catalog, result.reasonKey);
    return template === undefined ? result.reason : fillTemplate(template, result.reasonValues, catalog, locale);
}
