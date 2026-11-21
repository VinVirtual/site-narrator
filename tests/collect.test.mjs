import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { collectLines, collectSource, linesFromHtml, linesFromJson, linesFromMarkdown, toLines } from '../cli/lib/collect.mjs';
import { tidy } from '../player/player.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

test('HTML: collects elements marked data-narrate, with entities decoded and tags removed', async () => {
  const lines = (await collectSource(fixture('page.html'))).map(tidy);
  assert.deepEqual(lines, ['Tea & toast, “quoted” and plain.', 'Outer inner bold tail → end — done', 'A heading']);
});

test('HTML: falls back to every paragraph when nothing is marked', async () => {
  assert.deepEqual(toLines(await collectSource(fixture('plain.html'))).map((line) => line.text), ['First paragraph.', 'Second paragraph.']);
});

test('HTML: another attribute name can be used', () => {
  assert.deepEqual(linesFromHtml('<p data-say>Yes</p><p data-narrate>No</p>', 'data-say'), ['Yes']);
  assert.deepEqual(linesFromHtml('<p data-narrated>near miss</p><p>para</p>'), ['near miss', 'para']);
});

test('Markdown: one line per heading, paragraph and list item; code, tables and front matter skipped', () => {
  const lines = linesFromMarkdown('# T\n\ntext\n');
  assert.deepEqual(lines, ['T', 'text']);
});

test('Markdown: the fixture gives clean text', async () => {
  assert.deepEqual(await collectSource(fixture('notes.md')), [
    'A bold heading',
    'A paragraph with a link, code, and a second line of the same paragraph.',
    'First item',
    'Done item',
    'Numbered item',
    'A quoted line.',
    'Last paragraph with snake_case_name and emphasis.',
  ]);
});

test('JSON: strings, {text} objects and a {lines} wrapper', async () => {
  assert.deepEqual(await collectSource(fixture('lines.json')), ['One.', 'Two.', 'One.']);
  assert.deepEqual(linesFromJson(['a', { text: 'b' }]), ['a', 'b']);
  assert.throws(() => linesFromJson({ nope: 1 }), /array of lines/);
  assert.throws(() => linesFromJson(['a', 3]), /line 2/);
});

test('collector module: default export may be an async function', async () => {
  assert.deepEqual(await collectSource(fixture('collector.mjs')), ['Start', 'Recap one.', 'Recap two.']);
});

test('errors name the file and say what is wrong', async () => {
  await assert.rejects(collectSource(fixture('bad-collector.mjs')), /bad-collector\.mjs: a collector module must export/);
  await assert.rejects(collectSource(fixture('missing.md')), /missing\.md/);
  await assert.rejects(collectSource(fixture('../../LICENSE')), /unknown source type/);
});

test('toLines removes duplicates and lines with nothing to say, and keeps the order', () => {
  const lines = toLines(['B', ' A ', 'B', '', '   ', '...', 'A']);
  assert.deepEqual(lines.map((line) => line.text), ['B', 'A']);
});

test('toLines keeps the written text and adds the spoken text', () => {
  const [line] = toLines(['Use SQL at 5 °C'], { SQL: 'sequel' });
  assert.equal(line.text, 'Use SQL at 5 °C');
  assert.equal(line.say, 'Use sequel at 5 degrees Celsius');
});

test('collectLines joins several sources into one list', async () => {
  const lines = await collectLines({ sources: [fixture('lines.json'), fixture('collector.mjs')] });
  assert.deepEqual(lines.map((line) => line.text), ['One.', 'Two.', 'Start', 'Recap one.', 'Recap two.']);
});
