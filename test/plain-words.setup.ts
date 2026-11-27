// Holds every report any test of the suite makes to plain words: each message and each reason
// of an asset check or a kit check is walked as it is made, wherever it is made, and a text that
// names a function, an option key or an id of this package fails the test that brought it out.
// See plain-words.ts for the rule and wording.test.ts for the checks walked on purpose.
//
// The same walk holds every text to its message key: what the English catalog and the named
// values of a result rebuild is the text the result came with, to the letter. See message-keys.ts.
import { beforeAll, vi } from "vitest";
import { notRebuilt } from "./message-keys.js";
import { identifiersIn, textsOf, vocabularyOf, walked, type Vocabulary } from "./plain-words.js";

type Report = Parameters<typeof textsOf>[0];

let vocabulary: Vocabulary | undefined;
/** Reports made while a test file was still loading, before the package's names were read. */
const waiting: Report[] = [];

function hold(report: Report): void {
  const named = textsOf(report).flatMap(({ id, status, text }) => {
    const found = identifiersIn(text, vocabulary!);
    return found.length > 0 ? [`${id} (${status}) names ${found.join(", ")}: ${text}`] : [];
  });
  walked.reports += 1;
  walked.texts += textsOf(report).length;
  if (named.length > 0) throw new Error(`A check says something that is not in plain words.\n${named.join("\n")}`);
}

function walk<Made extends Report>(report: Made): Made {
  // Every text is also what the English catalog and the values of the result rebuild.
  const rebuilt = notRebuilt(report);
  if (rebuilt.length > 0) throw new Error(`A check says something its key and values do not rebuild.\n${rebuilt.join("\n")}`);
  if (vocabulary === undefined) waiting.push(report);
  else hold(report);
  return report;
}

beforeAll(async () => {
  vocabulary = vocabularyOf(await import("../src/index.js"));
  for (const report of waiting.splice(0)) hold(report);
});

vi.mock("../src/checks.js", async (original) => {
  const real = await original<typeof import("../src/checks.js")>();
  const checkGameAsset: typeof real.checkGameAsset = (glb, options) => walk(real.checkGameAsset(glb, options));
  return { ...real, checkGameAsset };
});

vi.mock("../src/kit-checks.js", async (original) => {
  const real = await original<typeof import("../src/kit-checks.js")>();
  const checkKit: typeof real.checkKit = (input, options) => walk(real.checkKit(input, options));
  return { ...real, checkKit };
});
