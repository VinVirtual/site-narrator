// Reads and changes the folder of recordings.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mp3Info } from './mp3.mjs';
import { MANIFEST_NAME } from './plan.mjs';

/** Names of the files in the folder (no sub-folders, no hidden files). */
export function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
}

/** Map of file name -> { bytes, seconds }. seconds is null for an .mp3 that holds no MP3 frames. */
export function measureFiles(dir, names = listFiles(dir)) {
  const measured = new Map();
  for (const name of names) {
    const path = join(dir, name);
    const bytes = statSync(path).size;
    const info = name.endsWith('.mp3') ? mp3Info(readFileSync(path)) : null;
    measured.set(name, { bytes, seconds: info?.seconds ?? null });
  }
  return measured;
}

/** The manifest in the folder, or null when there is none or it cannot be read. */
export function readManifest(dir) {
  const path = join(dir, MANIFEST_NAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`narrate: ignoring unreadable ${path}: ${error.message}\n`);
    return null;
  }
}

export function writeManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

export const removeFiles = (dir, names) => names.forEach((name) => rmSync(join(dir, name)));
