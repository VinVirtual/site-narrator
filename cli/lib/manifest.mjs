// The manifest: for every line, its file, length and size, plus how the set was recorded.
import { takeOf } from './plan.mjs';

const round = (value, places) => Number(value.toFixed(places));

/**
 * lines     [{ key, text, say }]
 * measured  Map of file name -> { bytes, seconds } read from the folder
 * owner     the project's sources as seen from the folder: says whose recordings these are
 * previous  this project's manifest already in the folder, or null (takes and levels of kept files come from it)
 * fresh     Map of key -> { level } reported by the recorder for lines recorded in this run
 * Lines without a file are left out. The result has no dates, so the same input gives the same file.
 */
export function buildManifest({ lines, measured, settings, owner = [], previous = null, fresh = new Map() }) {
  const entries = {};
  let totalBytes = 0;
  let totalSeconds = 0;
  for (const line of lines) {
    const file = `${line.key}.mp3`;
    const size = measured.get(file);
    if (!size) continue;
    const recorded = fresh.get(line.key);
    const before = previous?.lines?.[line.key];
    const level = recorded?.level ?? before?.level;
    entries[line.key] = {
      file,
      seconds: round(size.seconds, 2),
      bytes: size.bytes,
      take: recorded ? takeOf(line.say, settings) : (before?.take ?? takeOf(line.say, settings)),
      ...(level === undefined ? {} : { level }),
      text: line.text,
    };
    totalBytes += size.bytes;
    totalSeconds += size.seconds;
  }
  return {
    version: 1,
    sources: owner,
    voice: settings.voice,
    speed: settings.speed,
    lang: settings.lang,
    bitrate: settings.bitrate,
    notice: 'Computer-generated voice (Kokoro text-to-speech).',
    count: Object.keys(entries).length,
    totalBytes,
    totalSeconds: round(totalSeconds, 2),
    lines: entries,
  };
}
