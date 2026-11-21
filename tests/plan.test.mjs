import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRecording, takeOf } from '../cli/lib/plan.mjs';

const settings = { voice: 'af_heart', speed: 1, lang: 'en-us', bitrate: 32 };
const line = (key, say = key) => ({ key: `${key}00000000`.slice(0, 9), text: say, say });
const file = (entry) => `${entry.key}.mp3`;
const manifestFor = (lines, how = settings) => ({ lines: Object.fromEntries(lines.map((entry) => [entry.key, { take: takeOf(entry.say, how) }])) });

test('records only lines that have no file', () => {
  const [a, b, c] = [line('a'), line('b'), line('c')];
  const plan = planRecording({ lines: [a, b, c], files: [file(a), file(c)], settings });
  assert.deepEqual(plan.record, [b]);
  assert.deepEqual(plan.keep, [a, c]);
  assert.deepEqual(plan.remove, []);
});

test('recordings whose line is gone are stale', () => {
  const a = line('a');
  const plan = planRecording({ lines: [a], files: [file(a), 'deadbeef12.mp3', '0badc0de7.mp3'], settings });
  assert.deepEqual(plan.remove, ['0badc0de7.mp3', 'deadbeef12.mp3']);
});

test('never plans to delete files it did not make', () => {
  const plan = planRecording({ lines: [], files: ['manifest.json', 'intro-music.mp3', 'README.txt', 'ABCDEF123.mp3'], settings });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.foreign, ['ABCDEF123.mp3', 'README.txt', 'intro-music.mp3']);
});

test('a change of voice, speed or pronunciation records the line again', () => {
  const a = line('a', 'Use SQL');
  const manifest = manifestFor([a]);
  const same = planRecording({ lines: [a], files: [file(a)], manifest, settings });
  assert.deepEqual(same.record, []);
  for (const changed of [{ ...settings, voice: 'bm_george' }, { ...settings, speed: 0.9 }, { ...settings, bitrate: 48 }])
    assert.deepEqual(planRecording({ lines: [a], files: [file(a)], manifest, settings: changed }).record, [a]);
  const respoken = { ...a, say: 'Use sequel' };
  assert.deepEqual(planRecording({ lines: [respoken], files: [file(a)], manifest, settings }).record, [respoken]);
});

test('with no manifest, files that exist are trusted', () => {
  const a = line('a');
  assert.deepEqual(planRecording({ lines: [a], files: [file(a)], manifest: null, settings }).record, []);
  assert.deepEqual(planRecording({ lines: [a], files: [file(a)], manifest: { lines: {} }, settings }).record, []);
});

test('force records everything', () => {
  const [a, b] = [line('a'), line('b')];
  const plan = planRecording({ lines: [a, b], files: [file(a), file(b)], manifest: manifestFor([a, b]), settings, force: true });
  assert.deepEqual(plan.record, [a, b]);
  assert.deepEqual(plan.keep, []);
});

test('the plan does not change its inputs', () => {
  const lines = Object.freeze([Object.freeze(line('a'))]);
  const files = Object.freeze(['zzz.txt', 'deadbeef12.mp3']);
  planRecording({ lines, files, settings });
  assert.deepEqual(files, ['zzz.txt', 'deadbeef12.mp3']);
});
