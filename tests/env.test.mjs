// Python probes must not run modules planted in the folder the command is started from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pythonPrints } from '../cli/lib/env.mjs';

test('pythonPrints never imports modules planted in the current folder', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'narrate-planted-'));
  const was = process.cwd();
  const marker = join(dir, 'RAN');
  for (const name of ['json', 'kokoro_onnx', 'lameenc', 'numpy']) {
    writeFileSync(join(dir, `${name}.py`), `open(${JSON.stringify(marker)}, "w").write("${name}")\nraise SystemExit(0)\n`);
  }
  process.chdir(dir);
  t.after(() => {
    process.chdir(was);
    rmSync(dir, { recursive: true, force: true });
  });
  const where = pythonPrints('import json; print(json.__file__)');
  assert.ok(where, 'python did not run');
  assert.ok(!where.startsWith(dir), `json came from the planted folder: ${where}`);
  pythonPrints('import kokoro_onnx');
  pythonPrints('import lameenc');
  assert.equal(existsSync(marker), false, 'a planted module ran');
});
