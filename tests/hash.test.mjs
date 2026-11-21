import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createNarrator, readingMs, tidy, voiceKey } from '../player/player.js';
import { collectSource, toLines } from '../cli/lib/collect.mjs';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('voiceKey is 32-bit FNV-1a in hex followed by the text length in hex', () => {
  // published FNV-1a test vectors
  assert.equal(voiceKey('a'), 'e40c292c' + '1');
  assert.equal(voiceKey('foobar'), 'bf9cf968' + '6');
  assert.equal(voiceKey(''), '811c9dc5' + '0');
});

test('voiceKey pads short hashes to eight digits', () => {
  for (const text of ['a', 'Hello.', 'A much longer line of text, with punctuation!']) assert.match(voiceKey(text), /^[0-9a-f]{8}[0-9a-f]+$/);
});

test('voiceKey ignores differences in white space and Unicode composition', () => {
  assert.equal(voiceKey('  one\n   two three '), voiceKey('one two three'));
  assert.equal(voiceKey('café'), voiceKey('café'));
  assert.notEqual(voiceKey('one two'), voiceKey('one two.'));
});

test('tidy folds white space and trims', () => {
  assert.equal(tidy(' a \t b\r\n c '), 'a b c');
});

test('the recorder and the player name the same file for the same text', () => {
  const narrator = createNarrator({ base: '/voice', storageKey: null });
  for (const { key, text } of toLines(['A first line.', 'Temperature: 20 °C → mild', 'naïve café, 日本語']))
    assert.equal(narrator.urlFor(text), `/voice/${key}.mp3`);
});

test('a line collected from HTML has the key the browser computes from textContent', async () => {
  const [line] = toLines(await collectSource(fixture('page.html')));
  // what element.textContent holds for the first data-narrate element of the fixture: raw white space, entities decoded
  const textContent = '\n        Tea &   toast,\n        “quoted” and plain.\n      ';
  assert.equal(line.key, voiceKey(textContent));
});

test('the committed demo recordings are named by the keys of the demo page', async () => {
  const demo = fileURLToPath(new URL('../examples/demo/', import.meta.url));
  const manifest = JSON.parse(readFileSync(`${demo}voice/manifest.json`, 'utf8'));
  const keys = toLines(await collectSource(`${demo}index.html`)).map((line) => line.key);
  assert.deepEqual(Object.keys(manifest.lines).sort(), [...keys].sort());
});

test('readingMs grows with the number of words and has a floor', () => {
  assert.equal(readingMs('Hi.'), 1800);
  assert.ok(readingMs('one two three four five six seven eight nine ten eleven twelve thirteen') > 4900);
});
