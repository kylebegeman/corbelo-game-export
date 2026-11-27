// The entry `corbelo-game-export/messages`: the English catalog of what the checks say, and the
// functions that say a result from a catalog. It only passes on what two files hold, so a
// bundler gives a caller with a catalog of its own the functions and leaves the English out.
export { ENGLISH_MESSAGES, MESSAGE_KEYS, missingMessageKeys, type MessageKey } from "./message-catalog.js";
export { fillMessage, fillReason, fillTemplate, type MessageCatalog, type MessagePart, type MessageValue, type MessageValues } from "./message-fill.js";
