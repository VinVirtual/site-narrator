import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownsManifest, planRecording, takeOf } from '../cli/lib/plan.mjs';

const settings = { voice: 'af_heart', speed: 1, lang: 'en-us', bitrate: 32 };
const line = (key, say = key) => ({ key: `${key}00000000`.slice(0, 9), text: say, say });
const file = (entry) => `${entry.key}.mp3`;
const manifestFor = (lines, how = settings) => ({ lines: Object.fromEntries(lines.map((entry) => [entry.key, { file: file(entry), take: takeOf(entry.say, how) }])) });

test('records only lines that have no file', () => {
  const [a, b, c] = [line('a'), line('b'), line('c')];
  const plan = planRecording({ lines: [a, b, c], files: [file(a), file(c)], settings });
  assert.deepEqual(plan.record, [b]);
  assert.deepEqual(plan.keep, [a, c]);
  assert.deepEqual(plan.remove, []);
});

test('recordings this project made whose line is gone are stale', () => {
  const [a, old, older] = [line('a'), line('d'), line('e')];
  const plan = planRecording({ lines: [a], files: [file(a), file(old), file(older)], manifest: manifestFor([a, old, older]), settings });
  assert.deepEqual(plan.remove, [file(old), file(older)].sort());
  assert.deepEqual(plan.foreign, []);
});

test('a recording the manifest does not list is never deleted, even when it is named like one', () => {
  const [a, old] = [line('a'), line('d')];
  const files = [file(a), file(old), 'deadbeef12.mp3', '0badc0de7.mp3', 'intro-music.mp3', 'README.txt', 'ABCDEF123.mp3', 'manifest.json'];
  const plan = planRecording({ lines: [a], files, manifest: manifestFor([a, old]), settings });
  assert.deepEqual(plan.remove, [file(old)]);
  assert.deepEqual(plan.foreign, ['0badc0de7.mp3', 'ABCDEF123.mp3', 'README.txt', 'deadbeef12.mp3', 'intro-music.mp3']);
});

test('with no manifest nothing is deleted', () => {
  const a = line('a');
  for (const manifest of [null, {}, { lines: {} }]) {
    const plan = planRecording({ lines: [a], files: [file(a), 'deadbeef12.mp3'], manifest, settings });
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.foreign, ['deadbeef12.mp3']);
  }
});

test('a manifest entry cannot make the plan delete a file that is not a recording', () => {
  const manifest = { lines: { x: { file: 'manifest.json' }, y: { file: '../secret.mp3' }, z: { file: 'notes.txt' } } };
  const plan = planRecording({ lines: [], files: ['manifest.json', 'notes.txt'], manifest, settings });
  assert.deepEqual(plan.remove, []);
});

test('half-written files of this project are planned for clean-up, others are left', () => {
  const [a, old] = [line('a'), line('d')];
  const files = [`${file(a)}.part`, `${file(old)}.part`, 'deadbeef12.mp3.part', 'download.part'];
  const plan = planRecording({ lines: [a], files, manifest: manifestFor([old]), settings });
  assert.deepEqual(plan.partial, [`${file(a)}.part`, `${file(old)}.part`].sort());
  assert.deepEqual(plan.foreign, ['deadbeef12.mp3.part', 'download.part']);
  assert.deepEqual(plan.remove, []);
});

test('ownsManifest is true only for a manifest written for the same sources', () => {
  assert.equal(ownsManifest({ sources: ['../index.html'] }, ['../index.html']), true);
  assert.equal(ownsManifest({ sources: ['../other.html'] }, ['../index.html']), false);
  assert.equal(ownsManifest({ lines: {} }, ['../index.html']), false);
  assert.equal(ownsManifest(null, ['../index.html']), false);
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
