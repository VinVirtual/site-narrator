#!/usr/bin/env node
// site-narrator command line. Run `narrate help` for the list of commands.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { collectLines } from './lib/collect.mjs';
import { RECORDER, SKILL, findPython, modelPath, pythonPrints, voicesPath } from './lib/env.mjs';
import { listFiles, measureFiles, readManifest, removeFiles, writeManifest } from './lib/folder.mjs';
import { buildManifest } from './lib/manifest.mjs';
import { planRecording } from './lib/plan.mjs';
import { loadProject, parseArgs } from './lib/project.mjs';
import { serve } from './lib/serve.mjs';
import { verifyVoice } from './lib/verify.mjs';

const HELP = `site-narrator: a pre-recorded voice for a website, made on this machine with Kokoro.

  narrate check                     check the machine (node, Python, Kokoro, model files, MP3 encoder)
  narrate voices                    list the voices in the model
  narrate collect  [project]        list the lines the site wants spoken   [--json] [--out-file lines.json]
  narrate record   [project]        record new and changed lines, delete stale recordings, write manifest.json
  narrate manifest [project]        rewrite manifest.json from the recordings in the folder
  narrate verify   [project]        every line has a recording, no orphans, sizes within limits   [--json]
  narrate serve    [folder]         serve a folder on http://127.0.0.1:4173 to try a page   [--port N]
  narrate test                      run the self-tests

project is a folder with a narrate.json (default: the current folder), or the path of such a file.

options (they override narrate.json)
  --source <file>      .html, .md, .json, or a .js/.mjs collector module
  --out <dir>          folder for the recordings (default voice)
  --voice <name>       default af_heart         --speed 1.0      0.5 to 2
  --lang <code>        default en-us            --bitrate 32     MP3 kbps, mono
  --workers N          lines recorded at once (default 2)
  --encoder <name>     auto, lameenc or ffmpeg (default auto: lameenc when installed)
  --dry-run            record: show what would be recorded and deleted, change nothing
  --force              record: record every line again
  --keep-stale         record: do not delete recordings whose line is gone
`;

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0); // a reader that stops early (narrate collect | head) is not an error
  throw error;
});
const say = (message) => process.stdout.write(`${message}\n`);
const note = (message) => process.stderr.write(`${message}\n`);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const shown = (path) => {
  const short = relative(process.cwd(), resolve(path));
  return short.startsWith('..') ? resolve(path) : short || '.';
};

async function loadLines(rest, flags) {
  const project = loadProject(rest[0], flags);
  const lines = await collectLines({ sources: project.sources, attribute: project.attribute, fixes: project.fixes });
  if (!lines.length) throw new Error(`no lines found in ${project.sources.map(shown).join(', ')}`);
  return { project, lines };
}

function check() {
  const python = findPython();
  const rows = [
    ['node 18 or newer', Number(process.versions.node.split('.')[0]) >= 18, `found ${process.versions.node}; install Node.js from https://nodejs.org`],
    [`python (${python})`, pythonPrints('print(1)', python) === '1', 'install Python 3.10 or newer, or set NARRATE_PYTHON'],
    ['kokoro-onnx', pythonPrints('import kokoro_onnx', python) !== null, `${python} -m pip install kokoro-onnx`],
    [`model (${modelPath()})`, existsSync(modelPath()), 'download kokoro-v1.0.onnx (see README.md), or set KOKORO_MODEL'],
    [`voices (${voicesPath()})`, existsSync(voicesPath()), 'download voices-v1.0.bin (see README.md), or set KOKORO_VOICES'],
  ];
  const encoder = pythonPrints(`import sys; sys.path.insert(0, ${JSON.stringify(join(SKILL, 'cli'))}); import record; print(record.pick_encoder("auto"))`, python);
  rows.push([`MP3 encoder (${encoder ?? 'lameenc or ffmpeg'})`, encoder !== null, `${python} -m pip install lameenc`]);
  for (const [label, ok, fix] of rows) say(ok ? `ok   ${label}` : `MISS ${label}\n       ${fix}`);
  const good = rows.every((row) => row[1]);
  say(good ? 'all good' : 'something is missing: fix the MISS lines above and run this again');
  return good ? 0 : 1;
}

/** Runs record.py. Calls onResult for every line it reports and resolves with its exit code. */
function runRecorder(args, onResult = () => {}) {
  const child = spawn(findPython(), [RECORDER, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      onResult(JSON.parse(line));
    } catch {
      say(line); // not a result: pass it on (the list of voices, for one)
    }
  });
  return new Promise((done, fail) => {
    child.once('error', (error) => fail(new Error(`could not start Python (${findPython()}): ${error.message}. Run "narrate check".`)));
    child.once('close', (code) => done(code ?? 1));
  });
}

const modelArgs = () => ['--model', modelPath(), '--voices', voicesPath()];

async function collect(rest, flags) {
  const { project, lines } = await loadLines(rest, flags);
  if (flags['out-file']) writeFileSync(flags['out-file'], `${JSON.stringify(lines, null, 2)}\n`);
  if (flags.json) say(JSON.stringify(lines, null, 2));
  else {
    for (const line of lines) say(`${line.key}  ${line.text}${line.say === line.text ? '' : `\n${' '.repeat(line.key.length)}  said as: ${line.say}`}`);
    note(`${lines.length} line(s) from ${project.sources.map(shown).join(', ')}`);
  }
  return 0;
}

async function synthesise(project, jobs, flags) {
  const scratch = mkdtempSync(join(tmpdir(), 'narrate-'));
  const fresh = new Map();
  const failures = [];
  try {
    const jobsFile = join(scratch, 'jobs.json');
    writeFileSync(jobsFile, JSON.stringify(jobs.map(({ key, say: spoken }) => ({ key, say: spoken }))));
    const { voice, speed, lang, bitrate } = project.settings;
    const args = [jobsFile, project.out, ...modelArgs(), '--voice', voice, '--speed', String(speed), '--lang', lang, '--bitrate', String(bitrate), '--workers', String(project.workers), '--encoder', flags.encoder ?? 'auto'];
    const code = await runRecorder(args, (result) => {
      if (result.error) failures.push(`${result.key}: ${result.error}`);
      else fresh.set(result.key, result);
      note(result.error ? `  FAIL ${result.key}  ${result.error}` : `  ${fresh.size + failures.length}/${jobs.length}  ${result.key}.mp3  ${result.seconds.toFixed(1)} s  ${kb(result.bytes)}`);
    });
    if (code !== 0 && !failures.length && fresh.size < jobs.length) failures.push('the recorder stopped early (see the message above)');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { fresh, failures };
}

async function record(rest, flags) {
  const { project, lines } = await loadLines(rest, flags);
  const previous = readManifest(project.out);
  const plan = planRecording({ lines, files: listFiles(project.out), manifest: previous, settings: project.settings, force: Boolean(flags.force) });
  const stale = flags['keep-stale'] ? [] : plan.remove;
  say(`${lines.length} line(s): ${plan.record.length} to record, ${plan.keep.length} up to date, ${stale.length} stale recording(s) to delete`);
  if (flags['dry-run']) {
    for (const line of plan.record) say(`  record  ${line.key}.mp3  ${line.say}`);
    for (const name of stale) say(`  delete  ${name}`);
    return 0;
  }
  mkdirSync(project.out, { recursive: true });
  const { fresh, failures } = plan.record.length ? await synthesise(project, plan.record, flags) : { fresh: new Map(), failures: [] };
  if (failures.length) note(`narrate: ${failures.length} line(s) failed:\n  ${failures.join('\n  ')}`);
  if (failures.length && !fresh.size) return 1; // nothing was recorded: leave the folder as it was
  removeFiles(project.out, stale);
  const manifest = buildManifest({ lines, measured: measureFiles(project.out), settings: project.settings, previous, fresh });
  writeManifest(project.out, manifest);
  say(`${fresh.size} recorded, ${stale.length} deleted. ${manifest.count} recording(s) in ${shown(project.out)}: ${kb(manifest.totalBytes)}, ${manifest.totalSeconds.toFixed(1)} s`);
  return failures.length ? 1 : 0;
}

async function manifest(rest, flags) {
  const { project, lines } = await loadLines(rest, flags);
  const built = buildManifest({ lines, measured: measureFiles(project.out), settings: project.settings, previous: readManifest(project.out) });
  writeManifest(project.out, built);
  if (flags.json) say(JSON.stringify(built, null, 2));
  else say(`${shown(join(project.out, 'manifest.json'))}: ${built.count} of ${lines.length} line(s) recorded, ${kb(built.totalBytes)}, ${built.totalSeconds.toFixed(1)} s`);
  return 0;
}

async function verify(rest, flags) {
  const { project, lines } = await loadLines(rest, flags);
  const result = verifyVoice({ lines, measured: measureFiles(project.out), manifest: readManifest(project.out), settings: project.settings, limits: project.limits });
  if (flags.json) say(JSON.stringify(result, null, 2));
  else {
    for (const error of result.errors) say(`ERROR ${error}`);
    for (const warning of result.warnings) say(`warn  ${warning}`);
    const { totals } = result;
    say(`${totals.recorded} of ${totals.lines} line(s) recorded, ${kb(totals.bytes)}, ${totals.seconds.toFixed(1)} s: ${result.ok ? 'ok' : `${result.errors.length} error(s)`}`);
  }
  return result.ok ? 0 : 1;
}

async function serveFolder(rest, flags) {
  const port = Number(flags.port ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be 1 to 65535, got ${flags.port}`);
  await serve(rest[0] ?? '.', port);
  say(`serving ${shown(rest[0] ?? '.')} on http://127.0.0.1:${port}  (Ctrl+C to stop)`);
  return new Promise(() => {}); // runs until interrupted
}

function test() {
  const dir = join(SKILL, 'tests');
  const files = readdirSync(dir).filter((name) => name.endsWith('.test.mjs')).map((name) => join(dir, name));
  return spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1;
}

const COMMANDS = { check, collect, record, manifest, verify, test, serve: serveFolder, voices: () => runRecorder(['-', '-', ...modelArgs(), '--list-voices']) };

async function main() {
  const [command = 'help', ...argv] = process.argv.slice(2);
  const { rest, flags } = parseArgs(argv);
  if (['help', '--help', '-h'].includes(command) || flags.help) {
    say(HELP);
    return 0;
  }
  if (!COMMANDS[command]) throw new Error(`unknown command "${command}". Run "narrate help".`);
  return COMMANDS[command](rest, flags);
}

main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    note(`narrate: ${error.message}`);
    process.exit(1);
  },
);
