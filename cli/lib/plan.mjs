// Decides what a recording run has to do: which lines to record, which files to keep, which to delete.
import { voiceKey } from '../../player/player.js';

/** Files this tool made: a voice key and the extension. Anything else in the folder is never deleted. */
export const RECORDING_NAME = /^[0-9a-f]{9,}\.mp3$/;
export const MANIFEST_NAME = 'manifest.json';

/** A fingerprint of how a line was recorded. When any part changes, the line is recorded again. */
export const takeOf = (say, { voice, speed, lang, bitrate }) => voiceKey([say, voice, speed, lang, bitrate].join('|'));

/**
 * lines     [{ key, text, say }] wanted now
 * files     names of the files in the output folder
 * manifest  the manifest written by the last run, or null
 * settings  { voice, speed, lang, bitrate }
 * Returns { record, keep, remove, foreign }: lines to record, lines whose file is current, stale
 * recordings to delete, and files that are not recordings (left alone, reported by verify).
 */
export function planRecording({ lines, files, manifest = null, settings, force = false }) {
  const present = new Set(files);
  const wanted = new Set(lines.map((line) => `${line.key}.mp3`));
  const isCurrent = (line) => {
    if (force || !present.has(`${line.key}.mp3`)) return false;
    const before = manifest?.lines?.[line.key]?.take;
    return before === undefined || before === takeOf(line.say, settings); // no record of the take: trust the file
  };
  return {
    record: lines.filter((line) => !isCurrent(line)),
    keep: lines.filter(isCurrent),
    remove: files.filter((name) => RECORDING_NAME.test(name) && !wanted.has(name)).sort(),
    foreign: files.filter((name) => !RECORDING_NAME.test(name) && name !== MANIFEST_NAME).sort(),
  };
}
