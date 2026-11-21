// Text as it is spoken: pronunciation fixes applied to a line before it goes to the voice model.
// The page keeps the original spelling; only the recording uses the fixed text.

/** Symbols a voice would otherwise skip or stumble on. A project's own fixes are applied before these. */
export const DEFAULT_FIXES = Object.freeze({
  '°C': ' degrees Celsius',
  '°F': ' degrees Fahrenheit',
  '°': ' degrees',
  '×': ' times ',
  '→': ', then ',
  ' = ': ' equals ',
  ' & ': ' and ',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '–': ', ',
  '—': ', ',
  '…': '...',
});

const WORD_EDGE = /[\p{L}\p{N}_]/u;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One fix as a pattern. A fix that starts or ends with a letter or digit only matches whole words. */
function toPattern(from) {
  const start = WORD_EDGE.test(from[0]) ? '(?<![\\p{L}\\p{N}_])' : '';
  const end = WORD_EDGE.test(from.at(-1)) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(start + escapeRegExp(from) + end, 'gu');
}

/** Checks a `say` table from a config file and returns it as a list of [pattern, replacement] pairs, longest first. */
export function compileFixes(fixes = {}) {
  if (typeof fixes !== 'object' || fixes === null || Array.isArray(fixes)) throw new Error('"say" must be an object of "written": "spoken" pairs');
  const all = { ...DEFAULT_FIXES, ...fixes };
  return Object.entries(all)
    .map(([from, to]) => {
      if (!from || typeof to !== 'string') throw new Error(`"say" entry ${JSON.stringify(from)} must map non-empty text to a string`);
      return [from, to];
    })
    .sort((a, b) => b[0].length - a[0].length)
    .map(([from, to]) => [toPattern(from), to]);
}

/** A line as it should be spoken. */
export function sayable(text, compiled = compileFixes()) {
  const fixed = compiled.reduce((line, [pattern, to]) => line.replace(pattern, () => to), text);
  return fixed.replace(/\s+/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
}
