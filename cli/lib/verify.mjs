// Checks a folder of recordings against the lines the site wants spoken.
import { MANIFEST_NAME, RECORDING_NAME, takeOf } from './plan.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  maxTotalBytes: 10 * 1024 * 1024, // a whole site's voice: past this, think about which lines need one
  maxFileBytes: 512 * 1024, // one line: past this, split the line
  minSeconds: 0.3,
  minLevel: 0.005, // RMS of the recording as measured by the recorder; below this it is silence
});

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/**
 * lines     [{ key, text, say }] wanted now
 * measured  Map of file name -> { bytes, seconds } (seconds is null when the file is not readable MP3)
 * manifest  the manifest in the folder, or null
 * Returns { ok, errors, warnings, totals }. Errors mean the site would be missing or serving the wrong audio.
 */
export function verifyVoice({ lines, measured, manifest = null, settings = null, limits = {} }) {
  const limit = { ...DEFAULT_LIMITS, ...limits };
  const errors = [];
  const warnings = [];
  const wanted = new Set(lines.map((line) => `${line.key}.mp3`));
  let totalBytes = 0;
  let totalSeconds = 0;

  for (const line of lines) {
    const size = measured.get(`${line.key}.mp3`);
    const label = `${line.key}.mp3 ("${line.text.slice(0, 48)}${line.text.length > 48 ? '...' : ''}")`;
    if (!size) {
      errors.push(`no recording: ${label}`);
      continue;
    }
    totalBytes += size.bytes;
    totalSeconds += size.seconds ?? 0;
    const entry = manifest?.lines?.[line.key];
    if (size.seconds === null) errors.push(`not readable as MP3: ${label}`);
    else if (size.seconds < limit.minSeconds) errors.push(`too short (${size.seconds.toFixed(2)} s): ${label}`);
    if (size.bytes > limit.maxFileBytes) warnings.push(`large file (${kb(size.bytes)}): ${label}`);
    if (!entry) warnings.push(`not in ${MANIFEST_NAME}: ${label}`);
    else {
      if (entry.bytes !== size.bytes) warnings.push(`size differs from ${MANIFEST_NAME}: ${label}`);
      if (entry.level !== undefined && entry.level < limit.minLevel) errors.push(`silent recording (level ${entry.level}): ${label}`);
      if (settings && entry.take !== takeOf(line.say, settings)) warnings.push(`recorded with other settings or pronunciation: ${label}`);
    }
  }

  for (const name of [...measured.keys()].sort()) {
    if (name === MANIFEST_NAME || wanted.has(name)) continue;
    if (RECORDING_NAME.test(name)) errors.push(`orphan recording (no line says this any more): ${name}`);
    else warnings.push(`file that is not a recording: ${name}`);
  }
  for (const key of Object.keys(manifest?.lines ?? {})) if (!wanted.has(`${key}.mp3`)) warnings.push(`${MANIFEST_NAME} lists a line that is gone: ${key}`);
  if (!manifest) warnings.push(`no ${MANIFEST_NAME}: run "narrate manifest"`);
  if (totalBytes > limit.maxTotalBytes) warnings.push(`total size ${kb(totalBytes)} is over ${kb(limit.maxTotalBytes)}`);

  return { ok: errors.length === 0, errors, warnings, totals: { lines: lines.length, recorded: lines.length - errors.filter((e) => e.startsWith('no recording')).length, bytes: totalBytes, seconds: Number(totalSeconds.toFixed(2)) } };
}
