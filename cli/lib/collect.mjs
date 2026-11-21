// Collects the lines a site wants spoken, from a JSON, Markdown or HTML file or from a collector module.
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tidy, voiceKey } from '../../player/player.js';
import { compileFixes, sayable } from './text.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', deg: '°', times: '×', rarr: '→' };
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source']);

const decodeEntities = (text) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

/** What `element.textContent` would be for a fragment of simple HTML. */
const htmlText = (fragment) => decodeEntities(fragment.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ''));

/** The inner HTML of the element whose opening tag ends at `from`, counting nested tags of the same name. */
function innerHtml(html, tag, from) {
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, match.index);
  }
  return html.slice(from);
}

/**
 * Lines of an HTML file: the text of every element that carries the attribute (default `data-narrate`),
 * or of every <p> when no element has it. Meant for simple hand-written pages; for anything built by a
 * framework, export the lines from a collector module instead.
 */
export function linesFromHtml(html, attribute = 'data-narrate') {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '');
  const find = (pattern) => {
    const found = [];
    for (const match of body.matchAll(pattern)) {
      const tag = match[1].toLowerCase();
      if (!VOID_TAGS.has(tag)) found.push(htmlText(innerHtml(body, tag, match.index + match[0].length)));
    }
    return found;
  };
  const marked = find(new RegExp(`<([a-z][a-z0-9-]*)\\b[^>]*\\s${attribute}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s/>])[^>]*>`, 'gi'));
  return marked.length ? marked : find(/<(p)\b[^>]*>/gi);
}

const stripInline = (text) =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}])[*_](.+?)[*_](?![\p{L}\p{N}])/gu, '$1')
    .replace(/<[^>]+>/g, '');

/** Lines of a Markdown file: one per heading, paragraph and list item. Code blocks, tables and front matter are skipped. */
export function linesFromMarkdown(markdown) {
  const lines = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) lines.push(stripInline(paragraph.join(' ')));
    paragraph = [];
  };
  const source = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^#{1,6}\s+(.*?)\s*#*$/);
    const item = line.match(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (!line || /^([-*_]\s*){3,}$/.test(line) || line.startsWith('|')) flush();
    else if (heading || item) {
      flush();
      lines.push(stripInline((heading ?? item)[1]));
    } else paragraph.push(line.replace(/^>\s?/, ''));
  }
  flush();
  return lines;
}

/** Lines of a JSON value: an array of strings or of objects with a `text` field, or an object with a `lines` array. */
export function linesFromJson(value) {
  const list = Array.isArray(value) ? value : value?.lines;
  if (!Array.isArray(list)) throw new Error('expected an array of lines, or an object with a "lines" array');
  return list.map((entry, index) => {
    const text = typeof entry === 'string' ? entry : entry?.text;
    if (typeof text !== 'string') throw new Error(`line ${index + 1} is not a string and has no "text" field`);
    return text;
  });
}

/** Lines from a collector module: its default export (or `lines` export), an array or a function that returns one. */
async function linesFromModule(path) {
  const module = await import(pathToFileURL(path).href);
  const exported = module.default ?? module.lines;
  if (exported === undefined) throw new Error('a collector module must export the lines as `default` or `lines` (an array, or a function that returns one)');
  return linesFromJson(typeof exported === 'function' ? await exported() : exported);
}

/** Reads one source file and returns its lines as plain strings, in order. */
export async function collectSource(path, { attribute } = {}) {
  const file = resolve(path);
  const type = extname(file).toLowerCase();
  try {
    if (['.js', '.mjs'].includes(type)) return await linesFromModule(file);
    const content = await readFile(file, 'utf8');
    if (type === '.json') return linesFromJson(JSON.parse(content));
    if (['.md', '.markdown'].includes(type)) return linesFromMarkdown(content);
    if (['.html', '.htm'].includes(type)) return linesFromHtml(content, attribute);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
  throw new Error(`${path}: unknown source type "${type}". Use .json, .md, .html, or a .js/.mjs collector module.`);
}

/** Turns collected text into the recorder's list: one entry per distinct line, `{ key, text, say }`. */
export function toLines(texts, fixes = {}) {
  const compiled = compileFixes(fixes);
  const seen = new Map();
  for (const raw of texts) {
    const text = tidy(raw);
    const say = text && sayable(text, compiled);
    if (say && /[\p{L}\p{N}]/u.test(say) && !seen.has(voiceKey(text))) seen.set(voiceKey(text), { key: voiceKey(text), text, say });
  }
  return [...seen.values()];
}

/** Collects every source of a project. */
export async function collectLines({ sources, attribute, fixes }) {
  const texts = [];
  for (const source of sources) texts.push(...(await collectSource(source, { attribute })));
  return toLines(texts, fixes);
}
