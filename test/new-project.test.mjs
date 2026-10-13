import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = 'test-shared-kit';
const project = path.join(ROOT, 'projects', name);

test('new projects use the shared root kit instead of copying lib', (t) => {
  fs.rmSync(project, { recursive: true, force: true });
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  execFileSync(process.execPath, ['tools/new.mjs', name], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(fs.existsSync(path.join(project, 'lib')), false);
  const scene = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
  assert.match(scene, /src="\/lib\/studio\.js"/);
  assert.match(scene, /url\(\/lib\/fonts\/Archivo-latin\.woff2\)/);
});
