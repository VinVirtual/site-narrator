import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../cli/lib/manifest.mjs';
import { mp3Info } from '../cli/lib/mp3.mjs';
import { takeOf } from '../cli/lib/plan.mjs';
import { verifyVoice } from '../cli/lib/verify.mjs';

const settings = { voice: 'af_heart', speed: 1, lang: 'en-us', bitrate: 32 };
const lines = [
  { key: 'aaaaaaaa1', text: 'One.', say: 'One.' },
  { key: 'bbbbbbbb2', text: 'Two °', say: 'Two degrees' },
];
const measured = new Map([
  ['aaaaaaaa1.mp3', { bytes: 4000, seconds: 1.004 }],
  ['bbbbbbbb2.mp3', { bytes: 8000, seconds: 2.0 }],
]);

/** A silent MPEG-2 Layer III frame header (24 kHz, 32 kbit/s, mono) followed by padding to the frame size. */
function fakeMp3(frames, { id3 = 0, info = false } = {}) {
  const frame = Buffer.alloc(96);
  frame.set([0xff, 0xf3, 0x44, 0xc4]);
  const first = Buffer.from(frame);
  if (info) first.write('Info', 13, 'latin1');
  const tag = id3 ? Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, id3]), Buffer.alloc(id3)]) : Buffer.alloc(0);
  return new Uint8Array(Buffer.concat([tag, ...(info ? [first] : []), ...Array.from({ length: frames }, () => frame)]));
}

test('mp3Info counts frames: 576 samples each at 24 kHz', () => {
  const info = mp3Info(fakeMp3(100));
  assert.equal(info.frames, 100);
  assert.equal(info.sampleRate, 24000);
  assert.equal(info.bitrate, 32);
  assert.equal(info.seconds, (100 * 576) / 24000);
});

test('mp3Info skips an ID3 tag and the encoder info frame', () => {
  assert.equal(mp3Info(fakeMp3(50, { id3: 30, info: true })).frames, 50);
});

test('mp3Info returns null for data that is not MP3', () => {
  assert.equal(mp3Info(new Uint8Array(Buffer.from('<html>not found</html>'))), null);
  assert.equal(mp3Info(new Uint8Array(0)), null);
});

test('mp3Info measures the committed demo recordings: length matches size at a constant bit rate', () => {
  const demo = fileURLToPath(new URL('../examples/demo/voice/', import.meta.url));
  const manifest = JSON.parse(readFileSync(`${demo}manifest.json`, 'utf8'));
  for (const entry of Object.values(manifest.lines)) {
    const data = readFileSync(demo + entry.file);
    const info = mp3Info(new Uint8Array(data));
    assert.equal(data.length, entry.bytes);
    assert.equal(info.bitrate, manifest.bitrate);
    assert.ok(Math.abs(info.seconds - entry.seconds) < 0.01, `${entry.file}: ${info.seconds} vs ${entry.seconds}`);
    // 32 kbit/s is 4000 bytes a second, so the size gives the length independently of the frame count
    assert.ok(Math.abs(data.length / ((manifest.bitrate * 1000) / 8) - info.seconds) < 0.1, entry.file);
  }
});

test('manifest maps each key to its file, length and size, and totals them', () => {
  const manifest = buildManifest({ lines, measured, settings });
  assert.equal(manifest.count, 2);
  assert.equal(manifest.totalBytes, 12000);
  assert.equal(manifest.totalSeconds, 3);
  assert.deepEqual(manifest.lines.aaaaaaaa1, { file: 'aaaaaaaa1.mp3', seconds: 1, bytes: 4000, take: takeOf('One.', settings), text: 'One.' });
  assert.equal(manifest.voice, 'af_heart');
  assert.match(manifest.notice, /computer-generated/i);
});

test('manifest leaves out lines that have no recording', () => {
  const manifest = buildManifest({ lines, measured: new Map([['aaaaaaaa1.mp3', measured.get('aaaaaaaa1.mp3')]]), settings });
  assert.deepEqual(Object.keys(manifest.lines), ['aaaaaaaa1']);
});

test('manifest keeps the take and level of files that were not recorded again', () => {
  const old = { ...settings, voice: 'bm_george' };
  const previous = { lines: { aaaaaaaa1: { take: takeOf('One.', old), level: 0.07 } } };
  const fresh = new Map([['bbbbbbbb2', { level: 0.05 }]]);
  const manifest = buildManifest({ lines, measured, settings, previous, fresh });
  assert.equal(manifest.lines.aaaaaaaa1.take, takeOf('One.', old));
  assert.equal(manifest.lines.aaaaaaaa1.level, 0.07);
  assert.equal(manifest.lines.bbbbbbbb2.take, takeOf('Two degrees', settings));
  assert.equal(manifest.lines.bbbbbbbb2.level, 0.05);
});

test('the same input gives the same manifest', () => {
  assert.equal(JSON.stringify(buildManifest({ lines, measured, settings })), JSON.stringify(buildManifest({ lines, measured, settings })));
});

test('verify passes a complete folder', () => {
  const manifest = buildManifest({ lines, measured, settings });
  const result = verifyVoice({ lines, measured: new Map([...measured, ['manifest.json', { bytes: 300, seconds: null }]]), manifest, settings });
  assert.deepEqual(result, { ok: true, errors: [], warnings: [], totals: { lines: 2, recorded: 2, bytes: 12000, seconds: 3 } });
});

test('verify reports a missing recording and an orphan as errors', () => {
  const manifest = buildManifest({ lines, measured, settings });
  const folder = new Map([['aaaaaaaa1.mp3', measured.get('aaaaaaaa1.mp3')], ['cccccccc3.mp3', { bytes: 10, seconds: 1 }], ['notes.txt', { bytes: 1, seconds: null }]]);
  const result = verifyVoice({ lines, measured: folder, manifest, settings });
  assert.equal(result.ok, false);
  assert.equal(result.totals.recorded, 1);
  assert.match(result.errors.join('\n'), /no recording: bbbbbbbb2\.mp3/);
  assert.match(result.errors.join('\n'), /orphan recording .*cccccccc3\.mp3/);
  assert.match(result.warnings.join('\n'), /not a recording: notes\.txt/);
});

test('verify reports unreadable, too short and silent recordings', () => {
  const manifest = buildManifest({ lines, measured, settings, fresh: new Map([['bbbbbbbb2', { level: 0.0001 }]]) });
  const broken = new Map([['aaaaaaaa1.mp3', { bytes: 4000, seconds: null }], ['bbbbbbbb2.mp3', { bytes: 8000, seconds: 2 }]]);
  const result = verifyVoice({ lines, measured: broken, manifest, settings });
  assert.match(result.errors.join('\n'), /not readable as MP3: aaaaaaaa1/);
  assert.match(result.errors.join('\n'), /silent recording .*bbbbbbbb2/);
  const short = verifyVoice({ lines, measured: new Map([...measured, ['aaaaaaaa1.mp3', { bytes: 4000, seconds: 0.1 }]]), manifest: null });
  assert.match(short.errors.join('\n'), /too short/);
});

test('verify warns about size limits, a stale take and a missing manifest', () => {
  const manifest = buildManifest({ lines, measured, settings });
  const result = verifyVoice({ lines, measured, manifest, settings: { ...settings, speed: 1.2 }, limits: { maxTotalBytes: 10000, maxFileBytes: 5000 } });
  assert.equal(result.ok, true);
  assert.match(result.warnings.join('\n'), /large file \(8 KB\): bbbbbbbb2/);
  assert.match(result.warnings.join('\n'), /total size 12 KB is over 10 KB/);
  assert.match(result.warnings.join('\n'), /recorded with other settings/);
  assert.match(verifyVoice({ lines, measured }).warnings.join('\n'), /no manifest\.json/);
});
