#!/usr/bin/env node
// Renderiza projects/<nome>/index.html quadro a quadro (Playwright + CDP) e gera o vídeo com FFmpeg.
//
// Revisão
//   node render.mjs projects/<p> --stills 8          folha de contato (8 quadros, com tempo e batida)
//   node render.mjs projects/<p> --beats [k]         um quadro a cada k batidas (padrão 1), ¼ de batida após o acerto
//   node render.mjs projects/<p> --at 3.2[,4,4.1]    quadros específicos em PNG (vários = tira lado a lado)
//   ... --phone                                      folha em 360 px de largura: dá para ler no celular?
//   node render.mjs projects/<p> --check             determinismo, zona segura, texto pequeno, fontes, loop
// Vídeo
//   node render.mjs projects/<p>                     master 1080p (fps do projeto, padrão 60)
//   node render.mjs projects/<p> --format all        todos os formatos da cena (STUDIO.formats) com a mesma trilha
//   node render.mjs projects/<p> --draft             rascunho: metade da resolução, 30fps
//   node render.mjs projects/<p> --blur 4            motion blur: 4 subquadros por quadro (obturador 180°)
//   node render.mjs projects/<p> --range 4,7         re-renderiza só os trechos que tocam 4–7s e remonta o vídeo (cache)
//   node render.mjs projects/<p> --social            entrega para redes: bitrate controlado (arquivo menor)
//   node render.mjs projects/<p> --alpha             fundo transparente → ProRes 4444 .mov (para sobrepor em editor)
// Entrega
//   --cover 3.2      capa por formato em PNG          --thumb 3.2     thumbnail do YouTube 1280×720 (cena recebe ?thumb=1)
//   --poster 3.2     o quadro 0 do vídeo vira esse quadro (X/LinkedIn mostram o 1º quadro como capa)
// Gerais
//   --format 16x9|9x16|1x1|4x5|all|"9x16,16x9"   --param chave=valor (repetível; vai para a URL da cena)
//   --fps N   --workers N   --seg 2 (s por trecho do cache)   --no-gpu   --no-pops
//
// Contrato da cena: window.STUDIO = { width, height, duration, fps, bpm?, formats?, chapters?, loop?, seek(t), audio?(), ready? }
// seek(t) é função pura do tempo. Animações CSS / Web Animations são congeladas em t automaticamente.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './tools/server.mjs';
import { launch, openScene } from './tools/browser.mjs';
import { scanPops, printPops } from './tools/pops.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SIZES = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], '4x5': [1080, 1350] };
// zonas seguras (frações) — iguais às de lib/studio.js
const SAFE = { '16x9': [0.05, 0.05, 0.05, 0.05], '9x16': [0.15, 0.15, 0.2, 0.06], '1x1': [0.06, 0.06, 0.06, 0.06], '4x5': [0.06, 0.06, 0.08, 0.06] };
const VALUED = new Set(['format', 'stills', 'at', 'fps', 'blur', 'workers', 'range', 'beats', 'param', 'cover', 'thumb', 'poster', 'seg']);

// ---------- argumentos ----------
const argv = process.argv.slice(2);
const opts = { param: [] };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const key = a.slice(2);
  const next = argv[i + 1];
  if (VALUED.has(key) && next !== undefined && !next.startsWith('--')) {
    if (key === 'param') opts.param.push(next);
    else opts[key] = next;
    i++;
  } else opts[key] = true;
}
if (!positional[0]) {
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(1);
}

const projectDir = path.resolve(positional[0]);
if (!fs.existsSync(path.join(projectDir, 'index.html'))) die(`não achei ${path.join(projectDir, 'index.html')}`);
const name = path.basename(projectDir);
const draft = Boolean(opts.draft);
const alpha = Boolean(opts.alpha);
const social = Boolean(opts.social);
const blur = draft ? 1 : Math.max(1, Number(opts.blur ?? 1));
const outDir = path.join(projectDir, 'out');
fs.mkdirSync(outDir, { recursive: true });
const params = Object.fromEntries(opts.param.map((p) => { const i = p.indexOf('='); return i < 0 ? [p, '1'] : [p.slice(0, i), p.slice(i + 1)]; }));
const paramTag = Object.entries(params).map(([k, v]) => `-${slug(k)}-${slug(v)}`).join('');

// macOS: impede o repouso por inatividade enquanto o render roda (sem isso o Mac dorme no meio
// e um render de 2 min vira 15). O caffeinate termina sozinho quando este processo acaba (-w).
if (process.platform === 'darwin') spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();

// O servidor serve a raiz do estúdio (ou a pasta-mãe, se o projeto estiver fora dela).
const serveRoot = projectDir.startsWith(ROOT + path.sep) ? ROOT : path.dirname(projectDir);
const server = await startServer({ root: serveRoot });
const browser = await launch({ gpu: !opts['no-gpu'] });
const relUrl = path.relative(serveRoot, projectDir).split(path.sep).map(encodeURIComponent).join('/');

/** Contexto de um formato: URL da cena, tamanho, sufixo dos arquivos e como abrir. */
function ctxFor(fmt, extra = {}) {
  const [W0, H0] = SIZES[fmt ?? '16x9'];
  const qs = new URLSearchParams({ render: '1', ...(fmt ? { format: fmt } : {}), ...(alpha ? { alpha: '1' } : {}), ...params, ...extra.params });
  const url = `${server.url}/${relUrl}/index.html?${qs}`;
  const suffix = (fmt ? `-${fmt}` : '') + (draft ? '-draft' : '') + paramTag;
  const scale = extra.scale ?? (draft ? 0.5 : 1);
  return { fmt, W0, H0, url, suffix, scale, safeName: fmt ?? '16x9', open: () => openScene(browser, { url, width: W0, height: H0, scale, alpha }) };
}

try {
  if (opts.thumb !== undefined) await thumb(Number(opts.thumb));
  else {
    const formats = await resolveFormats();
    let audioMix;
    for (const fmt of formats) {
      const ctx = ctxFor(fmt);
      if (formats.length > 1) console.log(`\n■ ${fmt}`);
      if (opts.check) await check(ctx);
      else if (opts.at !== undefined) await frames(ctx, String(opts.at).split(',').map(Number));
      else if (opts.cover !== undefined) await cover(ctx, Number(opts.cover));
      else if (opts.stills || opts.beats) await contactSheet(ctx);
      else audioMix = await master(ctx, audioMix);
    }
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}

async function resolveFormats() {
  const f = opts.format;
  if (f === undefined || f === true) return [undefined];
  if (f === 'all') {
    const probe = await ctxFor(undefined).open();
    const list = probe.meta.formats ?? Object.keys(SIZES);
    await probe.close();
    return list;
  }
  const list = String(f).split(',');
  for (const x of list) if (!SIZES[x]) die(`formato desconhecido: ${x} (use ${Object.keys(SIZES).join(', ')} ou all)`);
  return list;
}

// ---------- quadros avulsos, capa e thumbnail ----------
async function frames(ctx, times) {
  const scene = await ctx.open();
  const files = [];
  for (const t of times) {
    await scene.seek(t);
    const file = path.join(outDir, `frame-${t}${ctx.suffix}.png`);
    fs.writeFileSync(file, await scene.shot());
    files.push(file);
    console.log(file);
  }
  if (times.length > 1) {
    const file = path.join(outDir, `strip${ctx.suffix}.png`);
    await sheet(files.map((f, i) => ({ file: f, label: label(times[i], scene.meta.bpm) })), file, { cols: times.length, tileW: Math.round(scene.meta.width / 4) });
    console.log(file);
  }
  await scene.close();
}

async function cover(ctx, t) {
  const scene = await ctx.open();
  await scene.seek(t);
  const file = path.join(outDir, `${name}-cover${ctx.suffix}.png`);
  fs.writeFileSync(file, await scene.shot());
  console.log(file);
  await scene.close();
}

/** Thumbnail do YouTube: 1280×720 JPEG (< 2 MB). A cena recebe ?thumb=1 para mostrar um título de capa, se quiser. */
async function thumb(t) {
  const ctx = ctxFor('16x9', { scale: 1280 / 1920, params: { thumb: '1' } });
  const scene = await ctx.open();
  await scene.seek(t);
  const file = path.join(outDir, `${name}-thumb${paramTag}.jpg`);
  const buf = await scene.shot({ format: 'jpeg', quality: 92 });
  fs.writeFileSync(file, buf);
  console.log(`${file}  (1280×720 · ${(buf.length / 1e6).toFixed(2)} MB${buf.length > 2e6 ? ' — acima de 2 MB, o YouTube recusa' : ''})`);
  await scene.close();
}

// ---------- folha de contato ----------
async function contactSheet(ctx) {
  const scene = await ctx.open();
  const { duration, bpm } = scene.meta;
  let times;
  if (opts.beats) {
    const beat = 60 / (bpm || die('--beats precisa de STUDIO.bpm na cena'));
    const k = opts.beats === true ? 1 : Number(opts.beats);
    times = [];
    for (let t = beat * 0.25; t < duration; t += beat * k) times.push(+t.toFixed(3));
  } else {
    const n = Number(opts.stills);
    times = Array.from({ length: n }, (_, i) => +(((i + 0.5) / n) * duration).toFixed(3));
  }
  const dir = path.join(outDir, 'stills');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tiles = [];
  for (const [i, t] of times.entries()) {
    await scene.seek(t);
    const file = path.join(dir, `s_${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(file, await scene.shot());
    tiles.push({ file, label: label(t, bpm) });
  }
  const n = times.length;
  const cols = n <= 8 ? Math.min(4, n) : n <= 18 ? 6 : 8;
  const tileW = opts.phone ? 360 : Math.round(scene.meta.width / (n <= 8 ? 3 : 4));
  const file = path.join(outDir, `contact${opts.phone ? '-phone' : ''}${ctx.suffix}.png`);
  await sheet(tiles, file, { cols, tileW });
  console.log(file);
  console.log('Tempos (s):', times.map((t) => t.toFixed(2)).join(', '));
  await scene.close();
}

function label(t, bpm) {
  return `${t.toFixed(2)}s` + (bpm ? ` · batida ${(t / (60 / bpm)).toFixed(2)}` : '');
}

/** Monta a folha numa página HTML (rótulos legíveis, sem depender de fontes do ffmpeg). */
async function sheet(tiles, file, { cols, tileW }) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#111;font:600 15px/1 ui-monospace,Menlo,monospace;color:#ddd}
    .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:6px;padding:6px;width:max-content}
    figure{margin:0} img{width:${tileW}px;display:block} figcaption{padding:5px 2px 2px}
  </style><div class="g">${tiles
    .map((t) => `<figure><img src="data:image/png;base64,${fs.readFileSync(t.file).toString('base64')}"><figcaption>${t.label}</figcaption></figure>`)
    .join('')}</div>`;
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('.g').screenshot({ path: file });
  await ctx.close();
}

// ---------- verificação ----------
async function check(ctx) {
  const errors = [];
  const warns = [];
  const STATIC = [
    [/translate3d|translateZ|will-change|perspective\s*\(|rotate[XY]\s*\(/, 'camada 3D/GPU no CSS: o raster pode depender do quadro anterior — o teste de determinismo abaixo confirma'],
    [/transition\s*:\s*(?!\s*none)[^;'"]+/, 'transition CSS: anime em seek(t)'],
    [/fonts\.(googleapis|gstatic)\.com/, 'fonte remota: baixe para assets/ (o render não deveria depender de rede)'],
    [/<video[^>]*autoplay/, '<video autoplay>: use tools/clip.mjs + Studio.frames'],
  ];
  const files = fs
    .readdirSync(projectDir, { recursive: true })
    .map(String)
    .filter((f) => /\.(html|js|css)$/.test(f) && !/(^|\/)(out|lib|node_modules)\//.test(f))
    .filter((f) => fs.statSync(path.join(projectDir, f)).size < 1e6);
  for (const f of files) {
    fs.readFileSync(path.join(projectDir, f), 'utf8').split('\n').forEach((line, i) => {
      for (const [re, msg] of STATIC) if (re.test(line)) warns.push(`${f}:${i + 1}  ${msg}`);
    });
  }

  // 1. determinismo: mesmos t em ordem, invertidos e em outra aba
  const A = await ctx.open();
  const { duration, fps, width, height } = A.meta;
  const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => Math.round(p * duration * fps) / fps);
  const pass = async (scene, order) => {
    const out = {};
    for (const t of order) { await scene.seek(t); out[t] = await scene.shot(); }
    return out;
  };
  const h1 = await pass(A, times);
  const h2 = await pass(A, [...times].reverse());
  const B = await ctx.open();
  const h3 = await pass(B, [times[2], times[0], times[4], times[1], times[3]]);
  for (const t of times) {
    const [x, why] = !h1[t].equals(h2[t])
      ? [h2[t], 'muda conforme a ordem dos quadros (seek não define tudo o que anima, estado entre quadros ou camada de GPU)']
      : !h1[t].equals(h3[t])
        ? [h3[t], 'muda entre abas (estado fora do seek, aleatoriedade sem semente ou camada de GPU)']
        : [];
    if (!x) continue;
    const d = await pixelDiff(h1[t], x);
    // Diferença mínima e espalhada = antialias de subpixel; grande = algo realmente fora do lugar.
    const real = d.block > 24 || (d.share > 0.01 && d.block > 8);
    (real ? errors : warns).push(`t=${t}s ${why} — ${(d.share * 100).toFixed(3)}% dos pixels, máx. ${d.max}/255, em blocos ${d.block}/255${d.box}${real ? '' : ' (só borda/antialias: invisível no vídeo)'}`);
  }
  await B.close();
  const hits = await A.guardHits();
  for (const [k, v] of Object.entries(hits)) errors.push(`${k} chamado ${v}× dentro do seek: use só t`);

  // 2. zona segura e tamanho mínimo de texto, em 12 instantes
  const [st, sr, sb, sl] = SAFE[ctx.safeName];
  const safe = { x0: sl * width, y0: st * height, x1: width - sr * width, y1: height - sb * height };
  const minPx = Math.round(28 * (Math.min(width, height) / 1080));
  const issues = new Map();
  for (let i = 0; i < 12; i++) {
    const t = +(((i + 0.5) / 12) * duration).toFixed(3);
    await A.seek(t);
    const found = await A.page.evaluate(({ safe, minPx, W, H }) => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        let r = el.getBoundingClientRect();
        let box = { x0: Math.max(0, r.left), y0: Math.max(0, r.top), x1: Math.min(W, r.right), y1: Math.min(H, r.bottom) };
        // recorta pelos ancestrais com overflow (máscaras de texto): o que está escondido não conta
        for (let p = el.parentElement; p && box.x1 > box.x0 && box.y1 > box.y0; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflow === 'visible' && cs.clipPath === 'none') continue;
          const q = p.getBoundingClientRect();
          box = { x0: Math.max(box.x0, q.left), y0: Math.max(box.y0, q.top), x1: Math.min(box.x1, q.right), y1: Math.min(box.y1, q.bottom) };
        }
        if (box.x1 - box.x0 < 4 || box.y1 - box.y0 < 4) continue;
        // letras/palavras de split(): reporta pelo bloco de texto inteiro (sobe até achar uma frase)
        let host = el;
        for (let k = 0; k < 5 && host.parentElement && host.textContent.trim().length < 4; k++) host = host.parentElement;
        const text = host.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
        const out_ = { left: safe.x0 - box.x0, top: safe.y0 - box.y0, right: box.x1 - safe.x1, bottom: box.y1 - safe.y1 };
        const side = Object.entries(out_).filter(([, v]) => v > 6).map(([k]) => k);
        // tamanho visual = font-size × escala da transformação acumulada
        const fs_ = parseFloat(getComputedStyle(el).fontSize) * (r.height / Math.max(1, el.offsetHeight || r.height));
        out.push({ text, side, small: fs_ < minPx ? Math.round(fs_) : 0 });
      }
      return out;
    }, { safe, minPx, W: width, H: height });
    // conta em quantas amostras o problema aparece: texto de passagem (entrando/saindo) aparece em uma só
    const note = (k, msg) => { const o = issues.get(k) ?? { n: 0, msg, last: false }; o.n++; o.last ||= i === 11; issues.set(k, o); };
    for (const f of found) {
      if (f.side.length) note(`zona:${f.text}`, `t=${t}s texto fora da zona segura (${f.side.join(', ')}): "${f.text}"`);
      if (f.small) note(`peq:${f.text}`, `t=${t}s texto pequeno (${f.small}px < ${minPx}px no celular): "${f.text}"`);
    }
  }
  for (const o of issues.values()) if (o.n >= 2 || o.last) warns.push(o.msg);

  // 3. loop: o último instante precisa encaixar no primeiro
  if (A.meta.loop) {
    await A.seek(0); const a = await A.shot();
    await A.seek(duration); const z = await A.shot();
    const d = await pixelDiff(a, z);
    (d.block > 6 ? errors : warns).push(`loop: quadro final × quadro 0 — diferença em blocos ${d.block}/255${d.block > 6 ? ' (vai pular na emenda)' : ' (ok)'}`);
  }

  // 4. fontes e rede
  const fonts = await A.page.evaluate(() => {
    const used = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      used.add(getComputedStyle(el).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''));
    }
    const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/^["']|["']$/g, '')));
    return { used: [...used], missing: [...used].filter((f) => !loaded.has(f) && !/^(ui-|system-ui|monospace|sans-serif|serif)/.test(f)) };
  });
  for (const m of fonts.missing) errors.push(`a fonte "${m}" não carregou: aparece a substituta`);
  if (fonts.used.length > 3) warns.push(`${fonts.used.length} famílias tipográficas (${fonts.used.join(', ')}): o normal é 1 de título + 1 de apoio`);
  for (const o of A.issues.external) warns.push(`recurso de rede durante o render: ${o}`);
  for (const c of A.issues.console) warns.push(`console: ${c}`);
  await A.close();

  for (const w of new Set(warns)) console.warn(`! ${w}`);
  for (const e of new Set(errors)) console.error(`✗ ${e}`);
  console.log(`${duration}s @ ${fps}fps · ${width}×${height} · fontes: ${fonts.used.join(', ') || '—'} · determinismo em ${times.length} instantes, zona segura em 12`);
  if (errors.length) throw new Error(`${new Set(errors).size} problema(s) em ${name}${ctx.fmt ? ` (${ctx.fmt})` : ''}`);
  console.log(`✓ ${name} passa na verificação${warns.length ? ` (${new Set(warns).size} aviso(s))` : ''}`);
}

/** Compara dois PNG num canvas: fração de pixels diferentes, maior diferença e diferença média em blocos 8×8. */
async function pixelDiff(a, b) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const r = await page.evaluate(async ([a, b]) => {
    const load = async (s) => { const i = new Image(); i.src = `data:image/png;base64,${s}`; await i.decode(); return i; };
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const data = (img) => {
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const A = data(ia), B = data(ib);
    let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > 0) n++;
      if (d > max) max = d;
      if (d > 8) {
        const x = (i / 4) % ia.width, y = Math.floor(i / 4 / ia.width);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    // Média em blocos de 8×8: diferença só de borda (antialias de subpixel) some; conteúdo fora do lugar não.
    const w = ia.width, h = ia.height, S = 8;
    let block = 0;
    for (let by = 0; by + S <= h; by += S)
      for (let bx = 0; bx + S <= w; bx += S) {
        let sa = 0, sb = 0;
        for (let y = by; y < by + S; y++)
          for (let x = bx; x < bx + S; x++) {
            const i = (y * w + x) * 4;
            sa += A[i] + A[i + 1] + A[i + 2];
            sb += B[i] + B[i + 1] + B[i + 2];
          }
        block = Math.max(block, Math.abs(sa - sb) / (S * S * 3));
      }
    return { share: n / (A.length / 4), max, block: Math.round(block), box: x1 < 0 ? '' : ` na região x${x0}–${x1}, y${y0}–${y1}` };
  }, [a.toString('base64'), b.toString('base64')]);
  await ctx.close();
  return r;
}

// ---------- master (com cache de trechos) ----------
async function master(ctx, sharedMix) {
  const first = await ctx.open();
  const meta = first.meta;
  const fps = draft ? 30 : Number(opts.fps ?? meta.fps);
  const total = Math.round(meta.duration * fps);
  const segFrames = Math.max(1, Math.round(Number(opts.seg ?? 2) * fps));
  const nSeg = Math.ceil(total / segFrames);
  const ext = alpha ? 'mov' : 'mp4';
  const poster = opts.poster !== undefined ? Number(opts.poster) : null;

  // Cache: um diretório por variante; invalida se algo que muda os pixels mudou.
  const variant = `${ctx.fmt ?? 'padrao'}${draft ? '-draft' : ''}${alpha ? '-alpha' : ''}${social ? '-social' : ''}${blur > 1 ? `-blur${blur}` : ''}${paramTag}`;
  const cacheDir = path.join(outDir, '.cache', variant);
  const manifest = JSON.stringify({ fps, total, segFrames, w: meta.width, h: meta.height, scale: ctx.scale, blur, alpha, social, poster });
  const manFile = path.join(cacheDir, 'manifest.json');
  if (!fs.existsSync(manFile) || fs.readFileSync(manFile, 'utf8') !== manifest) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(manFile, manifest);
  }
  const segFile = (i) => path.join(cacheDir, `seg_${String(i).padStart(4, '0')}.${ext}`);

  let [fA, fB] = [0, total];
  if (opts.range) {
    const [a, b] = String(opts.range).split(',').map(Number);
    fA = Math.max(0, Math.floor(a * fps));
    fB = Math.min(total, Math.ceil(b * fps));
    if (!(fB > fA)) die(`--range vazio: ${opts.range}`);
  }
  const todo = [];
  for (let i = Math.floor(fA / segFrames); i <= Math.floor((fB - 1) / segFrames); i++) todo.push(i);
  const count = todo.reduce((s, i) => s + Math.min(segFrames, total - i * segFrames), 0);

  const nWorkers = Math.max(1, Math.min(Number(opts.workers ?? Math.min(4, Math.max(1, os.cpus().length / 2))), todo.length));
  const scenes = [first];
  for (let k = 1; k < nWorkers; k++) scenes.push(await ctx.open());

  // Com --blur N capturamos N subquadros por quadro, espalhados por meio quadro (obturador 180°);
  // o tmix tira a média de cada grupo e o select fica com o último quadro de cada grupo.
  const vf = [
    ...(blur > 1 ? [`tmix=frames=${blur}`, `select='eq(mod(n\\,${blur})\\,${blur - 1})'`, `setpts=N/${fps}/TB`] : []),
    ...(alpha ? ['format=yuva444p10le'] : ['scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p']),
  ].join(',');
  const pixels = meta.width * meta.height * ctx.scale * ctx.scale;
  const codec = alpha
    ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0']
    : ['-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '20' : social ? '19' : '16',
       // redes: teto de bitrate (grão em tela cheia faria o arquivo explodir); 1080p ≈ 14 Mb/s
       ...(social ? ['-maxrate', `${Math.round((14 * pixels) / 2073600)}M`, '-bufsize', `${Math.round((28 * pixels) / 2073600)}M`] : []),
       '-g', String(fps * 2),
       '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

  let done = 0;
  const started = Date.now();
  const progress = () => {
    const el = (Date.now() - started) / 1000;
    const rate = done / Math.max(el, 0.001);
    const line = `${name}: quadro ${done}/${count} · ${rate.toFixed(1)} q/s · ${el.toFixed(0)}s · faltam ~${Math.round((count - done) / Math.max(rate, 0.01))}s`;
    if (process.stderr.isTTY) { if (done % 10 === 0 || done === count) process.stderr.write(`\r${line}   `); }
    else if (done === count || done % Math.max(1, Math.round(count / 4)) === 0) console.error(line);
  };
  console.log(`${Math.round(meta.width * ctx.scale)}×${Math.round(meta.height * ctx.scale)} · ${fps}fps · ${count} quadros em ${todo.length} trecho(s) · ${scenes.length} aba(s)${blur > 1 ? ` · blur ${blur}` : ''}${social ? ' · social' : ''}`);

  // Fila de trechos: cada aba pega o próximo e alimenta seu próprio encoder.
  const queue = [...todo];
  await Promise.all(
    scenes.map(async (scene, k) => {
      while (queue.length) {
        const i = queue.shift();
        const a = i * segFrames, b = Math.min(total, a + segFrames);
        const tmp = segFile(i).replace(`.${ext}`, `.tmp.${ext}`);
        const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps * blur), '-i', '-', '-vf', vf, '-r', String(fps), ...codec, tmp], { stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        ff.stderr.on('data', (d) => (err += d));
        const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg (trecho ${i}): ${err.slice(-800)}`)))));
        for (let f = a; f < b; f++) {
          for (let s = 0; s < blur; s++) {
            const t = f === 0 && poster !== null ? poster : f / fps + (s / blur) * (0.5 / fps);
            await scene.seek(t);
            const png = await scene.shot();
            if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
          }
          done++;
          progress();
        }
        ff.stdin.end();
        await closed;
        fs.renameSync(tmp, segFile(i));
      }
    }),
  );
  if (process.stderr.isTTY) process.stderr.write('\n');
  await Promise.all(scenes.slice(1).map((s) => s.close()));

  // Vídeo completo se todos os trechos existem no cache; senão, só o trecho pedido.
  const all = Array.from({ length: nSeg }, (_, i) => i);
  const complete = all.every((i) => fs.existsSync(segFile(i)));
  const segs = complete ? all : todo;
  const startT = (segs[0] * segFrames) / fps;
  const endT = Math.min(total, (segs[segs.length - 1] + 1) * segFrames) / fps;
  const dur = endT - startT;
  const tag = complete ? '' : `-${startT}-${endT}`.replace(/\./g, '_');
  const file = path.join(outDir, `${name}${ctx.suffix}${alpha ? '-alpha' : ''}${social ? '-social' : ''}${tag}.${ext}`);
  const list = path.join(cacheDir, 'list.txt');
  fs.writeFileSync(list, segs.map((i) => `file '${path.basename(segFile(i))}'`).join('\n'));
  const video = path.join(cacheDir, `video.${ext}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', video]);

  const mix = sharedMix ?? (await buildAudio(first, meta.duration));
  if (mix) {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-ss', String(startT), '-t', String(dur), '-i', mix,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...(alpha ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', social ? '192k' : '256k']),
      '-t', String(dur), ...(alpha ? [] : ['-movflags', '+faststart']), file]);
  } else {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-c', 'copy', ...(alpha ? [] : ['-movflags', '+faststart']), file]);
  }
  fs.rmSync(video, { force: true });

  const got = Number((await run('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file])).trim());
  const expected = Math.round(dur * fps);
  if (got !== expected) console.warn(`! esperava ${expected} quadros e o arquivo tem ${got}`);
  const mb = fs.statSync(file).size / 1e6;
  console.log(`${file}  (${mb.toFixed(1)} MB · ${((Date.now() - started) / 1000).toFixed(0)}s${mix ? ' · com áudio' : ''}${complete && opts.range ? ` · re-render de ${todo.length} trecho(s), o resto veio do cache` : ''})`);
  if (!alpha && !opts['no-pops']) printPops(await scanPops(file));
  if (complete) deliveryNotes(meta, ctx, mb);
  await first.close();
  return mix;
}

/** Capítulos do YouTube e limites das plataformas. */
function deliveryNotes(meta, ctx, mb) {
  const d = meta.duration;
  const fmt = ctx.fmt ?? `${meta.width}x${meta.height}`;
  if (meta.chapters?.length) {
    const ts = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const lines = meta.chapters.map((c) => `${ts(c.t)} ${c.title}`);
    const file = path.join(outDir, `${name}-capitulos.txt`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const gaps = meta.chapters.map((c, i, a) => (a[i + 1]?.t ?? d) - c.t);
    const bad = meta.chapters[0].t !== 0 || meta.chapters.length < 3 || gaps.some((g) => g < 10);
    console.log(`capítulos → ${file}${bad ? '  ! o YouTube exige o 1º em 0:00, ≥ 3 capítulos e ≥ 10s cada' : ' (cole na descrição do YouTube)'}`);
  }
  const notes = [];
  if (fmt === '9x16' || meta.height > meta.width) {
    if (d > 180) notes.push('Shorts aceita até 3 min');
    if (d > 90) notes.push('Reels/anúncios rendem melhor até ~90s');
  }
  if (!social && mb > 100) notes.push(`arquivo grande (${mb.toFixed(0)} MB): para redes use --social`);
  if (notes.length) console.log(`! entrega: ${notes.join(' · ')}`);
}

/** Áudio: STUDIO.audio() (síntese) ou audio.* na pasta. Loudnorm em duas passadas → −14 LUFS, pico −1,5 dBTP. */
async function buildAudio(scene, duration) {
  let src = fs.readdirSync(projectDir).filter((f) => /^audio\.(wav|mp3|m4a|aac|ogg|aiff)$/.test(f)).map((f) => path.join(projectDir, f))[0];
  if (scene.meta.hasAudio) {
    const b64 = await scene.page.evaluate(async () => {
      const buf = await window.STUDIO.audio();
      const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
      const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
      const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
      str(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE');
      str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
      data.setUint16(22, ch, true); data.setUint32(24, sr, true);
      data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true);
      data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, len * ch * 2, true);
      const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
      let o = 44;
      for (let i = 0; i < len; i++)
        for (let c = 0; c < ch; c++, o += 2) data.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 0x7fff, true);
      const bytes = new Uint8Array(data.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    });
    src = path.join(outDir, 'audio.wav');
    fs.writeFileSync(src, Buffer.from(b64, 'base64'));
  }
  if (!src) return null;

  const LN = 'loudnorm=I=-14:TP=-1.5:LRA=11';
  const m = parseLoudnorm(await run('ffmpeg', ['-hide_banner', '-i', src, '-af', `${LN}:print_format=json`, '-f', 'null', '-'], true));
  const mix = path.join(outDir, 'mix.wav');
  // apad + atrim: o áudio tem exatamente a duração do vídeo (nada de -shortest cortando o final).
  const out = parseLoudnorm(await run('ffmpeg', ['-hide_banner', '-y', '-i', src, '-af',
    `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json,aresample=48000,apad,atrim=0:${duration}`,
    '-c:a', 'pcm_s24le', mix], true));
  console.log(`áudio: ${out.output_i} LUFS · pico ${out.output_tp} dBTP · ${out.normalization_type}${out.normalization_type !== 'linear' ? ' (o pico limitou o ganho: baixe o som mais alto)' : ''}`);
  return mix;
}

function parseLoudnorm(stderr) {
  return JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
}

function run(cmd, args, wantStderr = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? resolve(wantStderr ? err : out) : reject(new Error(`${cmd}: ${err.slice(-1500)}`))));
  });
}

function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24).toLowerCase();
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
