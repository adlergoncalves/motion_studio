import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startServer } from '../tools/server.mjs';

function request(url, pathname) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ hostname: target.hostname, port: target.port, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('static server rejects encoded traversal into a sibling path', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-studio-'));
  const root = path.join(parent, 'root');
  const sibling = `${root}-private`;
  fs.mkdirSync(root);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, 'index.html'), 'public');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'must not leak');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const server = await startServer({ root });
  t.after(() => server.close());
  const result = await request(server.url, '/..%2froot-private%2fsecret.txt');

  assert.equal(result.status, 403);
  assert.doesNotMatch(result.body, /must not leak/);
});
