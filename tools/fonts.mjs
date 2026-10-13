#!/usr/bin/env node
// Baixa uma família do Google Fonts para uma pasta local e escreve fonts.css.
//   node tools/fonts.mjs "Manrope" "200..800" projects/<p>/assets/fonts
//   node tools/fonts.mjs "Archivo" "wdth,wght@62..125,100..900" lib/fonts
// Por quê: fonte remota carrega pedaços (unicode-range) sob demanda — o primeiro quadro que
// usa um caractere novo sai com a fonte substituta. Local + font-display:block = sempre igual.
import fs from 'node:fs';
import path from 'node:path';

const [family, axes = '400..700', outDir] = process.argv.slice(2);
if (!family || !outDir) {
  console.error('Uso: node tools/fonts.mjs "<Família>" "<pesos ou eixos>" <pasta-destino>');
  process.exit(1);
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const spec = axes.includes('@') ? axes : `wght@${axes}`;
const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${spec}&display=block`;
const css = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
if (!css.includes('@font-face')) {
  console.error(`✗ Google Fonts não reconheceu "${family}" com "${spec}":\n${css.slice(0, 300)}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const slug = family.replace(/\s+/g, '');
let out = `/* ${family} — baixada de Google Fonts (${new Date().toISOString().slice(0, 10)}); licença OFL na página da família */\n`;
const KEEP = new Set(['latin', 'latin-ext']);
for (const m of css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face \{([\s\S]*?)\}/g)) {
  const [, subset, body] = m;
  if (!KEEP.has(subset)) continue;
  const style = body.match(/font-style: (\w+)/)[1];
  const file = `${slug}-${subset}${style === 'italic' ? '-italic' : ''}.woff2`;
  const src = body.match(/url\((\S+?)\)/)[1];
  if (!fs.existsSync(path.join(outDir, file))) fs.writeFileSync(path.join(outDir, file), Buffer.from(await (await fetch(src)).arrayBuffer()));
  out += `@font-face {${body.replace(/url\(\S+?\)/, `url(${file})`).replace(/font-display: \w+/, 'font-display: block')}}\n`;
  console.log(`  ${subset} ${style} → ${file}`);
}
fs.writeFileSync(path.join(outDir, `${slug}.css`), out);
console.log(`✓ ${path.join(outDir, `${slug}.css`)} — use <link rel="stylesheet" href="…/${slug}.css"> e document.fonts.load() antes de medir texto.`);
