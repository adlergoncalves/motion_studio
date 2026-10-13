// Procura "pops" de um quadro num MP4: o quadro n difere dos dois vizinhos enquanto os
// vizinhos são parecidos entre si (algo apareceu/sumiu por 1 quadro). Também lista os
// maiores saltos entre quadros — cortes secos intencionais aparecem aí; confira se são.
//
// Uso: node tools/pops.mjs arquivo.mp4
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const W = 240;

export async function scanPops(file) {
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file]);
  const [w, h, rate] = probe.trim().split(',');
  const H = Math.max(2, Math.round((W * Number(h)) / Number(w) / 2) * 2);
  const [num, den] = rate.split('/').map(Number);
  const fps = num / (den || 1);
  const raw = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const size = W * H;
  const n = Math.floor(raw.length / size);
  const frame = (i) => raw.subarray(i * size, (i + 1) * size);
  const diff = (a, b) => {
    const A = frame(a), B = frame(b);
    let s = 0;
    for (let k = 0; k < size; k++) s += Math.abs(A[k] - B[k]);
    return s / size;
  };
  const step = Array.from({ length: n - 1 }, (_, i) => diff(i, i + 1));
  const pops = [];
  for (let i = 1; i < n - 1; i++) {
    const m = Math.min(step[i - 1], step[i]);
    if (m > 1.5 && diff(i - 1, i + 1) < 0.5 * m) pops.push({ frame: i, t: +(i / fps).toFixed(3), diff: +m.toFixed(2) });
  }
  const jumps = step
    .map((d, i) => ({ frame: i + 1, t: +((i + 1) / fps).toFixed(3), diff: +d.toFixed(2) }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 6)
    .sort((a, b) => a.frame - b.frame);
  return { frames: n, fps, pops, jumps };
}

export function printPops({ frames, pops, jumps }) {
  console.log(`pops: ${frames} quadros verificados — ${pops.length ? pops.map((p) => `t=${p.t}s (q${p.frame}, Δ${p.diff})`).join(', ') : 'nenhum'}`);
  console.log(`maiores saltos (cortes intencionais aparecem aqui): ${jumps.map((j) => `t=${j.t}s Δ${j.diff}`).join(' · ')}`);
}

function run(cmd, argv) {
  return runBuffer(cmd, argv).then((b) => b.toString());
}
function runBuffer(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.slice(-1500)))));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) {
    console.error('Uso: node tools/pops.mjs arquivo.mp4');
    process.exit(1);
  }
  printPops(await scanPops(process.argv[2]));
}
