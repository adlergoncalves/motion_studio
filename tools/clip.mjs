#!/usr/bin/env node
// Prepara um vídeo (gravação de tela, câmera, b-roll livre) para entrar numa cena: extrai os quadros
// em JPEG numerados. Na cena, Studio.frames(img, {...}) troca o quadro conforme t — determinístico,
// ao contrário de um <video> tocando.
//
//   node tools/clip.mjs gravacao.mp4 projects/<p>/assets/clip [--fps 30] [--width 1080] [--from 2 --to 8]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const [src, dest] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!src || !dest) {
  console.error('Uso: node tools/clip.mjs video.mp4 projects/<p>/assets/<pasta> [--fps 30] [--width 1080] [--from s --to s]');
  process.exit(1);
}
const fps = Number(opt('fps', 30));
const width = Number(opt('width', 1080));
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
const ff = [
  '-v', 'error',
  ...(opt('from') ? ['-ss', opt('from')] : []),
  ...(opt('to') ? ['-to', opt('to')] : []),
  '-i', src,
  '-vf', `fps=${fps},scale=${width}:-2:flags=lanczos`,
  '-q:v', '3',
  path.join(dest, '%05d.jpg'),
];
await new Promise((res, rej) => {
  const p = spawn('ffmpeg', ff, { stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg saiu com ${c}`))));
});
const count = fs.readdirSync(dest).filter((f) => f.endsWith('.jpg')).length;
const rel = path.relative(path.resolve(dest, '..', '..'), dest).split(path.sep).join('/');
console.log(`✓ ${count} quadros (${(count / fps).toFixed(2)}s a ${fps}fps) em ${dest}
Na cena:
  <img id="clip">
  const clip = Studio.frames(document.getElementById('clip'), { dir: '${rel}', fps: ${fps}, count: ${count}, start: 0 });
  async function seek(t) { await clip(t); ... }
Áudio do vídeo (se quiser): ffmpeg -i "${src}" -vn ${path.join(path.dirname(dest), 'clip.wav')}`);
