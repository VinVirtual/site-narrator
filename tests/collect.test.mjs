import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { collectLines, collectSource, decodeEntities, linesFromHtml, linesFromJson, linesFromMarkdown, toLines } from '../cli/lib/collect.mjs';
import { ENTITIES, LEGACY } from '../cli/lib/entities.mjs';
import { tidy, voiceKey } from '../player/player.js';

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

// Each pair is HTML source and the textContent a browser gives for it (checked in Chromium, see README).
const BROWSER_TEXT = [
  ['Caf&eacute; cr&egrave;me', 'Café crème'],
  ['&Eacute;cole &ne; &eacute;cole', 'École ≠ école'],
  ['na&iuml;ve &amp; fa&ccedil;ade', 'naïve & façade'],
  ['5&nbsp;&euro; &times; 2 &rarr; 10&thinsp;&euro;', '5\u00a0€ × 2 → 10\u2009€'],
  ['&alpha;&beta;&Gamma; &hearts; &trade; &frac12;', 'αβΓ ♥ ™ ½'],
  ['&NotEqualTilde; &fjlig;', '\u2242\u0338 fj'],
  ['&#233; &#xE9; &#Xe9; &#128512;', 'é é é 😀'],
  ['&#150; &#x99; &#0; &#xD800; &#x110000;', '– ™ \ufffd \ufffd \ufffd'],
  ['&copy 2026, &eacutecole, &notit; &amp', '© 2026, école, ¬it; &'],
  ['AT&T, a & b, &unknown; &; &#;', 'AT&T, a & b, &unknown; &; &#;'],
  ['&lt;p&gt; &amp;amp; &quot;q&quot; &apos;', '<p> &amp; "q" \''],
];

test('entities decode to the text a browser shows', () => {
  for (const [html, text] of BROWSER_TEXT) assert.equal(decodeEntities(html), text, html);
});

test('a line with entities gets the key the browser computes, and is spoken as the real characters', () => {
  for (const [html, text] of BROWSER_TEXT) {
    const [line] = toLines(linesFromHtml(`<p data-narrate>Say ${html} now</p>`));
    assert.equal(line.key, voiceKey(`Say ${text} now`), html);
    assert.equal(line.text, tidy(`Say ${text} now`));
  }
  assert.equal(toLines(linesFromHtml('<p>Caf&eacute;</p>'))[0].say, 'Café');
});

test('the entity table is the full HTML list, and names are case-sensitive', () => {
  assert.equal(ENTITIES.size, 2125);
  assert.equal(LEGACY.size, 106);
  assert.equal(ENTITIES.get('Eacute'), 'É');
  assert.equal(ENTITIES.get('eacute'), 'é');
  assert.equal(decodeEntities('&EACUTE;'), '&EACUTE;');
  for (const name of LEGACY) assert.ok(ENTITIES.has(name), name);
});
