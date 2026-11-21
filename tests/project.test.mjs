import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPython, modelPath, voicesPath } from '../cli/lib/env.mjs';
import { listFiles, measureFiles, readManifest, writeManifest } from '../cli/lib/folder.mjs';
import { loadProject, parseArgs } from '../cli/lib/project.mjs';
import { resolveRequest } from '../cli/lib/serve.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'narrate-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('parseArgs separates words, values and switches', () => {
  assert.deepEqual(parseArgs(['site', '--voice', 'bm_george', '--speed=0.9', '--dry-run', 'extra']), { rest: ['site', 'extra'], flags: { voice: 'bm_george', speed: '0.9', 'dry-run': true } });
  assert.throws(() => parseArgs(['--voice']), /--voice needs a value/);
});

test('loadProject reads narrate.json, resolves paths beside it and fills the defaults', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'narrate.json'), JSON.stringify({ source: ['a.md', 'b.html'], voice: 'bm_george', say: { SQL: 'sequel' } }));
  const project = loadProject(dir);
  assert.deepEqual(project.sources, [join(dir, 'a.md'), join(dir, 'b.html')]);
  assert.equal(project.out, join(dir, 'voice'));
  assert.deepEqual(project.settings, { voice: 'bm_george', speed: 1, lang: 'en-us', bitrate: 32 });
  assert.equal(project.workers, 2);
  assert.deepEqual(project.fixes, { SQL: 'sequel' });
  assert.deepEqual(loadProject(join(dir, 'narrate.json')).sources, project.sources);
});

test('flags override the file, and a folder with no file works when --source is given', (t) => {
  const dir = scratch(t);
  const project = loadProject(dir, { source: 'page.html', out: 'audio', speed: '0.9', workers: '1' });
  assert.equal(project.file, null);
  assert.equal(project.out, join(dir, 'audio'));
  assert.equal(project.settings.speed, 0.9);
  assert.equal(project.workers, 1);
});

test('loadProject refuses bad input with a message that names it', (t) => {
  const dir = scratch(t);
  assert.throws(() => loadProject(dir), /no source/);
  assert.throws(() => loadProject(join(dir, 'nowhere')), /no such file or folder/);
  assert.throws(() => loadProject(dir, { source: 'a.md', speed: '9' }), /"speed" must be a number from 0.5 to 2/);
  assert.throws(() => loadProject(dir, { source: 'a.md', workers: '1.5' }), /"workers" must be a whole number/);
  assert.throws(() => loadProject(dir, { source: 'a.md', attribute: 'x y' }), /attribute/);
  writeFileSync(join(dir, 'narrate.json'), '{ "sauce": "a.md" }');
  assert.throws(() => loadProject(dir), /unknown field\(s\): sauce/);
  writeFileSync(join(dir, 'narrate.json'), '{ nope');
  assert.throws(() => loadProject(dir), /narrate\.json: /);
});

test('environment variables choose Python and the model files', () => {
  assert.equal(findPython({ NARRATE_PYTHON: '/opt/py/bin/python' }), '/opt/py/bin/python');
  assert.equal(modelPath({ KOKORO_HOME: '/models' }), join('/models', 'kokoro-v1.0.onnx'));
  assert.equal(voicesPath({ KOKORO_HOME: '/models', KOKORO_VOICES: '/other/v.bin' }), '/other/v.bin');
});

test('the folder helpers list, measure and round-trip the manifest', (t) => {
  const dir = scratch(t);
  assert.deepEqual(listFiles(join(dir, 'missing')), []);
  assert.equal(readManifest(dir), null);
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'aaaaaaaa1.mp3'), 'not really mp3');
  writeFileSync(join(dir, 'bbbbbbbb2.mp3.part'), 'half written');
  writeFileSync(join(dir, '.hidden'), '');
  writeManifest(dir, { version: 1, lines: {} });
  assert.deepEqual(listFiles(dir), ['aaaaaaaa1.mp3', 'manifest.json']);
  assert.deepEqual(measureFiles(dir).get('aaaaaaaa1.mp3'), { bytes: 14, seconds: null });
  assert.deepEqual(readManifest(dir), { version: 1, lines: {} });
});

test('the local server only resolves files inside its folder', (t) => {
  const dir = scratch(t);
  mkdirSync(join(dir, 'site', 'voice'), { recursive: true });
  writeFileSync(join(dir, 'site', 'index.html'), '<p>hi</p>');
  writeFileSync(join(dir, 'site', 'voice', 'a b.mp3'), 'x');
  writeFileSync(join(dir, 'secret.txt'), 'x');
  const root = join(dir, 'site');
  assert.equal(resolveRequest(root, '/'), join(root, 'index.html'));
  assert.equal(resolveRequest(root, '/voice/a%20b.mp3?x=1'), join(root, 'voice', 'a b.mp3'));
  assert.equal(resolveRequest(root, '/../secret.txt'), null);
  assert.equal(resolveRequest(root, '/%2e%2e/secret.txt'), null);
  assert.equal(resolveRequest(root, '/voice/'), null);
  assert.equal(resolveRequest(root, '/nope.mp3'), null);
  assert.equal(resolveRequest(root, '/%E0%A4%A'), null);
});
