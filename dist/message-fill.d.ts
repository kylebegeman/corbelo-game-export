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
/** The template a catalog has for a key. Nothing when it has none, or has something that is not text there. */
export declare function templateOf(catalog: MessageCatalog, key: string | undefined): string | undefined;
/**
 * Fills a template with its named values. A value that is a part with a key of its own is filled
 * from the catalog, and is said in English, as the check said it, where the catalog has no
 * template for it. A name the values do not have stays in the text as it is written, braces and
 * all.
 *
 * `locale` is the language of the catalog, which decides the form a number picks: English has
 * `one` and `other`, and another language may have `few` and `many` as well.
 */
export declare function fillTemplate(template: string, values?: MessageValues, catalog?: MessageCatalog, locale?: string): string;
/**
 * The message of a result of a check, from a catalog. The English text the result came with is
 * returned as it is for a key the catalog does not have, and for a result written before
 * version 0.1.8, which has no key.
 */
export declare function fillMessage(result: {
    message: string;
    messageKey?: string;
    messageValues?: MessageValues;
}, catalog: MessageCatalog, locale?: string): string;
/**
 * The reason of a result that was not measured, or of a test layout that was not built, from a
 * catalog. The English reason where the catalog has no template for it, and nothing for a result
 * with no reason.
 */
export declare function fillReason(result: {
    reason?: string;
    reasonKey?: string;
    reasonValues?: MessageValues;
}, catalog: MessageCatalog, locale?: string): string | undefined;
