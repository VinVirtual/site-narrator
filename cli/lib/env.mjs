// Where site-narrator finds Python, Kokoro and its model files.
// Every location has a default and an environment variable that overrides it (see README.md).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL = resolve(CLI, '..');
export const RECORDER = join(CLI, 'record.py');

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const onPath = (name) => {
  try {
    return run(process.platform === 'win32' ? 'where' : 'which', [name]).split('\n')[0];
  } catch {
    return null;
  }
};

export const kokoroHome = (env = process.env) => env.KOKORO_HOME || join(homedir(), 'kokoro');
export const modelPath = (env = process.env) => env.KOKORO_MODEL || join(kokoroHome(env), 'kokoro-v1.0.onnx');
export const voicesPath = (env = process.env) => env.KOKORO_VOICES || join(kokoroHome(env), 'voices-v1.0.bin');

/** Python that can import kokoro_onnx: $NARRATE_PYTHON, else the venv in $KOKORO_HOME, else python3 on PATH. */
export function findPython(env = process.env) {
  if (env.NARRATE_PYTHON) return env.NARRATE_PYTHON;
  const home = kokoroHome(env);
  for (const candidate of [join(home, '.venv', 'bin', 'python'), join(home, '.venv', 'Scripts', 'python.exe')]) if (existsSync(candidate)) return candidate;
  return onPath('python3') || onPath('python') || 'python3';
}

/** Runs a line of Python and returns what it printed, or null when it fails. */
export function pythonPrints(code, python = findPython()) {
  try {
    return run(python, ['-c', code]);
  } catch {
    return null;
  }
}
