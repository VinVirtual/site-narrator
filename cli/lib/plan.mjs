// Decides what a recording run has to do: which lines to record, which files to keep, which to delete.
import { voiceKey } from '../../player/player.js';

/** The shape of a recording's name: a voice key and the extension. */
export const RECORDING_NAME = /^[0-9a-f]{9,}\.mp3$/;
export const PARTIAL_SUFFIX = '.part';
export const MANIFEST_NAME = 'manifest.json';

/** A fingerprint of how a line was recorded. When any part changes, the line is recorded again. */
export const takeOf = (say, { voice, speed, lang, bitrate }) => voiceKey([say, voice, speed, lang, bitrate].join('|'));

/** True when the manifest was written for these sources. A manifest without `sources` belongs to nobody we know. */
export const ownsManifest = (manifest, owner) => Array.isArray(manifest?.sources) && JSON.stringify(manifest.sources) === JSON.stringify(owner);

/** File names the manifest says this project recorded. */
export const listedFiles = (manifest) => new Set(Object.values(manifest?.lines ?? {}).map((entry) => entry.file));

/**
 * lines     [{ key, text, say }] wanted now
 * files     names of the files in the output folder (half-written `.part` files included)
 * manifest  this project's manifest from the last run, or null
 * settings  { voice, speed, lang, bitrate }
 * Returns:
 *   record   lines to record
 *   keep     lines whose file is current
 *   remove   stale recordings: listed in the manifest, no longer wanted. Nothing else is ever deleted.
 *   partial  half-written files left by an interrupted run, for a line of this project
 *   foreign  every other file that is neither a wanted recording nor the manifest (left alone)
 */
export function planRecording({ lines, files, manifest = null, settings, force = false }) {
  const present = new Set(files);
  const wanted = new Set(lines.map((line) => `${line.key}.mp3`));
  const ours = listedFiles(manifest);
  const isCurrent = (line) => {
    if (force || !present.has(`${line.key}.mp3`)) return false;
    const before = manifest?.lines?.[line.key]?.take;
    return before === undefined || before === takeOf(line.say, settings); // no record of the take: trust the file
  };
  const remove = files.filter((name) => ours.has(name) && RECORDING_NAME.test(name) && !wanted.has(name)).sort();
  const partial = files.filter((name) => name.endsWith(PARTIAL_SUFFIX) && (wanted.has(name.slice(0, -PARTIAL_SUFFIX.length)) || ours.has(name.slice(0, -PARTIAL_SUFFIX.length)))).sort();
  const handled = new Set([...remove, ...partial, MANIFEST_NAME]);
  return {
    record: lines.filter((line) => !isCurrent(line)),
    keep: lines.filter(isCurrent),
    remove,
    partial,
    foreign: files.filter((name) => !handled.has(name) && !wanted.has(name)).sort(),
  };
}
