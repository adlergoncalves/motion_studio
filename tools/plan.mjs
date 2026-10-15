#!/usr/bin/env node
// Planejamento de texto antes da cena.
//   node tools/plan.mjs projects/<nome>            cria roteiro.md a partir do modelo
//   node tools/plan.mjs projects/<nome> --check    verifica se o roteiro foi realmente preenchido
//
// O gate é simples de propósito: um roteiro com seções vazias não passa, e `--check` devolve
// código 1 para poder entrar em script de entrega.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const checking = args.includes('--check');

if (!target) {
  console.error('Uso: node tools/plan.mjs projects/<nome> [--check]');
  process.exit(1);
}

const dir = path.resolve(ROOT, target);
if (!fs.existsSync(dir)) {
  console.error(`✗ ${target} não existe — crie o projeto antes (node tools/new.mjs <nome>).`);
  process.exit(1);
}

const file = path.join(dir, 'roteiro.md');
const model = fs.readFileSync(path.join(ROOT, 'templates', 'roteiro.md'), 'utf8');

if (!checking) {
  if (fs.existsSync(file)) {
    console.error(`✗ ${path.relative(ROOT, file)} já existe — nunca sobrescreva um roteiro.`);
    process.exit(1);
  }
  const name = path.basename(dir);
  fs.writeFileSync(file, `# ${name}\n\nCriado em ${new Date().toISOString().slice(0, 10)}.\n\n${model}`);
  console.log(`✓ ${path.relative(ROOT, file)} criado
Preencha promessa, locução, texto em tela, capítulos e direção antes de escrever index.html.
Depois: node tools/plan.mjs ${target} --check`);
  process.exit(0);
}

if (!fs.existsSync(file)) {
  console.error(`✗ ${target} não tem roteiro.md — rode: node tools/plan.mjs ${target}`);
  process.exit(1);
}

const txt = fs.readFileSync(file, 'utf8');
const sections = txt.split(/^## /m).slice(1).map((s) => {
  const [head, ...rest] = s.split('\n');
  return { title: head.trim(), body: rest.join('\n') };
});

const REQUIRED = ['Promessa', 'Locução', 'Texto em tela', 'Capítulos', 'Direção por capítulo', 'Critério de aceite'];
const problems = [];

for (const want of REQUIRED) {
  const sec = sections.find((s) => s.title.toLowerCase().startsWith(want.toLowerCase().slice(0, 8)));
  if (!sec) { problems.push(`seção ausente: ${want}`); continue; }
  // conteúdo útil = linhas que não são instrução do modelo, tabela vazia ou bloco de código vazio
  const modelSec = model.split(/^## /m).slice(1).find((s) => s.startsWith(sec.title));
  const modelBody = modelSec ? modelSec.split('\n').slice(1).join('\n') : '';
  const useful = sec.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('|---') && !/^\|(\s*\|)+$/.test(l.replace(/\s/g, ' ')) && !/^(```|0\d)$/.test(l))
    .filter((l) => !modelBody.includes(l));
  if (useful.length === 0) problems.push(`seção vazia: ${sec.title}`);
}

const tableRows = (title) => {
  const sec = sections.find((s) => s.title.toLowerCase().startsWith(title.toLowerCase().slice(0, 8)));
  if (!sec) return 0;
  return sec.body.split('\n').filter((l) => /^\|/.test(l.trim()) && !/^\|\s*-/.test(l.trim())).length - 1; // menos o cabeçalho
};
if (tableRows('Capítulos') < 1) problems.push('nenhum capítulo descrito');
if (tableRows('Direção por capítulo') < 1) problems.push('nenhuma direção de câmera/óptica por capítulo');

if (problems.length) {
  console.error(`✗ roteiro incompleto em ${path.relative(ROOT, file)}`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`✓ roteiro de ${path.basename(dir)} preenchido — pode escrever a cena`);
