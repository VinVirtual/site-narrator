import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPython, modelPath, voicesPath } from '../cli/lib/env.mjs';
import { listFiles, measureFiles, readManifest, writeManifest } from '../cli/lib/folder.mjs';
import { SWITCHES, VALUE_FLAGS, loadProject, parseArgs } from '../cli/lib/project.mjs';
import { handle, isLocalHost, resolveRequest, serve } from '../cli/lib/serve.mjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'narrate-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('parseArgs separates words, values and switches', () => {
  assert.deepEqual(parseArgs(['site', '--voice', 'bm_george', '--speed=0.9', '--dry-run', 'extra']), { rest: ['site', 'extra'], flags: { voice: 'bm_george', speed: '0.9', 'dry-run': true } });
  assert.deepEqual(parseArgs(['--out-file=a=b.json', '--source=', 'x']), { rest: ['x'], flags: { 'out-file': 'a=b.json', source: '' } });
});

test('a switch never takes the next word', () => {
  for (const name of SWITCHES) assert.deepEqual(parseArgs([`--${name}`, 'examples/demo']), { rest: ['examples/demo'], flags: { [name]: true } });
  assert.throws(() => parseArgs(['--force=yes']), /--force takes no value/);
});

test('an unknown or mistyped option is refused, with the list of real ones', () => {
  assert.throws(() => parseArgs(['--dryrun', 'examples/demo']), /unknown option --dryrun\. Options are: .*--dry-run.*--workers/);
  assert.throws(() => parseArgs(['examples/demo', '--Force']), /unknown option --Force/);
  assert.throws(() => parseArgs(['--speeed=2']), /unknown option --speeed/);
});

test('a value flag needs a value, and does not take another flag as one', () => {
  assert.throws(() => parseArgs(['--voice']), /--voice needs a value/);
  assert.throws(() => parseArgs(['--voice', '--dry-run']), /--voice needs a value/);
});

test('every option is a switch or a value flag, never both', () => {
  assert.deepEqual(SWITCHES.filter((name) => VALUE_FLAGS.includes(name)), []);
});

test('loadProject reads narrate.json, resolves paths beside it and fills the defaults', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'narrate.json'), JSON.stringify({ source: ['a.md', 'b.html'], voice: 'bm_george', say: { SQL: 'sequel' } }));
  const project = loadProject(dir);
  assert.deepEqual(project.sources, [join(dir, 'a.md'), join(dir, 'b.html')]);
  assert.equal(project.out, join(dir, 'voice'));
  assert.deepEqual(project.owner, ['../a.md', '../b.html']);
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
  assert.deepEqual(listFiles(dir), ['aaaaaaaa1.mp3', 'bbbbbbbb2.mp3.part', 'manifest.json']);
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

test('the local server does not serve dot-files or dot-folders', (t) => {
  const dir = scratch(t);
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'pages', '.cache'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), 'x');
  writeFileSync(join(dir, '.env'), 'x');
  writeFileSync(join(dir, 'pages', '.cache', 'a.html'), 'x');
  writeFileSync(join(dir, 'pages', 'a.html'), 'x');
  assert.equal(resolveRequest(dir, '/.git/config'), null);
  assert.equal(resolveRequest(dir, '/.env'), null);
  assert.equal(resolveRequest(dir, '/pages/.cache/a.html'), null);
  assert.equal(resolveRequest(dir, '/pages/%2ecache/a.html'), null);
  assert.equal(resolveRequest(dir, '/pages/a.html'), join(dir, 'pages', 'a.html'));
});

test('isLocalHost accepts only names of this machine', () => {
  for (const host of ['localhost', 'localhost:4173', 'LOCALHOST:80', '127.0.0.1:4173', '[::1]:4173', '[::1]']) assert.equal(isLocalHost(host), true, host);
  for (const host of ['example.org', 'example.org:4173', 'localhost.example.org', '127.0.0.1.example.org', '192.168.1.5:4173', '[::2]:80', '', undefined]) assert.equal(isLocalHost(host), false, String(host));
});

test('the local server answers localhost, and refuses other Host names and methods', async (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
  writeFileSync(join(dir, 'a.mp3'), '0123456789');
  const server = await serve(dir, 0);
  t.after(() => server.close());
  const { port } = server.address();
  const get = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init);

  const page = await get('/');
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<p>hi</p>');
  const audio = await get('/a.mp3', { headers: { Range: 'bytes=2-5' } });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await audio.text(), '2345');
  assert.equal((await get('/a.mp3', { headers: { Range: 'bytes=50-60' } })).status, 416);
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/', { method: 'POST' })).status, 405);

  // a request that arrives under another site's name (DNS rebinding) is refused
  const answers = [];
  const fake = (host) => ({ headers: { host }, method: 'GET', url: '/' });
  const reply = { headersSent: false, writeHead: (status) => (answers.push(status), reply), end: () => reply };
  handle(dir, fake('evil.example:4173'), reply);
  handle(dir, fake(undefined), reply);
  assert.deepEqual(answers, [403, 403]);

  // a folder named like a file cannot be read: that request gets an answer, and the server keeps going
  mkdirSync(join(dir, 'broken', 'index.html'), { recursive: true });
  assert.equal((await get('/broken/')).status, 404);
  assert.equal((await get('/')).status, 200);
});
