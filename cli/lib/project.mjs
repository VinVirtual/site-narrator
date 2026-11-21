// Command-line arguments and the project file (narrate.json).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const CONFIG_NAME = 'narrate.json';
export const DEFAULTS = Object.freeze({ out: 'voice', voice: 'af_heart', speed: 1, lang: 'en-us', bitrate: 32, workers: 2, attribute: 'data-narrate', say: {} });
const SWITCHES = new Set(['dry-run', 'force', 'keep-stale', 'json', 'help']);
const KNOWN = new Set(['source', 'out', 'voice', 'speed', 'lang', 'bitrate', 'workers', 'attribute', 'say', 'limits']);

/** Splits arguments into positional words and --flags. `--name value`, `--name=value` and switches are understood. */
export function parseArgs(argv) {
  const rest = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (!word.startsWith('--')) rest.push(word);
    else if (word.includes('=')) flags[word.slice(2, word.indexOf('='))] = word.slice(word.indexOf('=') + 1);
    else if (SWITCHES.has(word.slice(2))) flags[word.slice(2)] = true;
    else if (index + 1 < argv.length) flags[word.slice(2)] = argv[(index += 1)];
    else throw new Error(`${word} needs a value`);
  }
  return { rest, flags };
}

function numberIn(name, value, min, max, whole = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (whole && !Number.isInteger(number))) throw new Error(`"${name}" must be ${whole ? 'a whole number' : 'a number'} from ${min} to ${max}, got ${JSON.stringify(value)}`);
  return number;
}

function readConfig(file) {
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof config !== 'object' || config === null || Array.isArray(config)) throw new Error('expected a JSON object');
    const unknown = Object.keys(config).filter((key) => !KNOWN.has(key));
    if (unknown.length) throw new Error(`unknown field(s): ${unknown.join(', ')}`);
    return config;
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/**
 * Resolves a project: a folder holding narrate.json, a path to such a file, or a folder with none when
 * --source is given. Flags override the file. Paths in the file are relative to it.
 */
export function loadProject(target = '.', flags = {}) {
  const given = resolve(target);
  if (!existsSync(given)) throw new Error(`${target}: no such file or folder`);
  const isDir = statSync(given).isDirectory();
  const file = isDir ? join(given, CONFIG_NAME) : given;
  const root = isDir ? given : dirname(given);
  const config = existsSync(file) ? readConfig(file) : {};
  const merged = { ...DEFAULTS, ...config };
  for (const key of ['source', 'out', 'voice', 'speed', 'lang', 'bitrate', 'workers', 'attribute']) if (flags[key] !== undefined) merged[key] = flags[key];
  const sources = [merged.source].flat().filter(Boolean);
  if (!sources.length) throw new Error(`no source: add "source" to ${file}, or pass --source <file>`);
  if (!/^[a-z][a-z0-9-]*$/i.test(merged.attribute)) throw new Error(`"attribute" must be an HTML attribute name, got ${JSON.stringify(merged.attribute)}`);
  return {
    root,
    file: existsSync(file) ? file : null,
    sources: sources.map((source) => resolve(root, String(source))),
    out: resolve(root, String(merged.out)),
    attribute: merged.attribute,
    fixes: merged.say,
    limits: merged.limits ?? {},
    workers: numberIn('workers', merged.workers, 1, 16, true),
    settings: {
      voice: String(merged.voice),
      speed: numberIn('speed', merged.speed, 0.5, 2),
      lang: String(merged.lang),
      bitrate: numberIn('bitrate', merged.bitrate, 8, 160, true),
    },
  };
}
