#!/usr/bin/env node
// Preview com barra de tempo: node tools/preview.mjs projects/<nome> [--format 9x16] [--param chave=valor] [--port 4321]
// Abre no navegador um player que chama o mesmo STUDIO.seek(t) do render: o que você vê
// aqui é o que sai no MP4. Recarregue (R) depois de editar o index.html.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!target) {
  console.error('Uso: node tools/preview.mjs projects/<nome> [--format 9x16] [--port 4321]');
  process.exit(1);
}
const dir = path.resolve(target);
if (!dir.startsWith(ROOT + path.sep) || !fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`✗ ${target} precisa ser uma pasta de projects/ com index.html`);
  process.exit(1);
}
const rel = path.relative(ROOT, dir).split(path.sep).join('/');

let server;
for (const port of [Number(opt('port') ?? 4321), 0]) {
  try { server = await startServer({ root: ROOT, port }); break; } catch {}
}
// --param chave=valor (repetível) vai para a cena, como no render
const extra = args.flatMap((a, i) => (args[i - 1] === '--param' ? [a] : [])).map((p) => { const k = p.indexOf('='); return `&${encodeURIComponent(p.slice(0, k))}=${encodeURIComponent(p.slice(k + 1))}`; }).join('');
const url = `${server.url}/tools/player.html?p=${encodeURIComponent(rel)}${extra}${opt('format') ? `#f=${opt('format')}` : ''}`;
console.log(`Preview: ${url}\nCtrl+C para sair.`);
if (process.platform === 'darwin' && !args.includes('--no-open')) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
