#!/usr/bin/env node
// Cria um projeto novo: node tools/new.mjs <nome> [--brand <marca>]
// Copia projects/_template. Os projetos usam o kit compartilhado em /lib, evitando
// cópias divergentes de runtime e fontes. Cria brief.md a partir do modelo de briefing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const name = args[0];
if (!name || args.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Uso: node tools/new.mjs <nome-em-kebab-case>');
  process.exit(1);
}
const dest = path.join(ROOT, 'projects', name);
if (fs.existsSync(dest)) {
  console.error(`✗ projects/${name} já existe — nunca sobrescreva um projeto anterior.`);
  process.exit(1);
}

fs.cpSync(path.join(ROOT, 'projects', '_template'), dest, { recursive: true, filter: (src) => !/\/out(\/|$)/.test(src.slice(ROOT.length)) });
fs.mkdirSync(path.join(dest, 'assets'), { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const template = fs.readFileSync(path.join(ROOT, 'templates', 'briefing.md'), 'utf8');
const brief = `# ${name}\n\nCriado em ${today}.\n\n${template}`;
fs.writeFileSync(path.join(dest, 'brief.md'), brief);

// planejamento de texto: a cena não começa antes dele (tools/plan.mjs --check)
const roteiro = fs.readFileSync(path.join(ROOT, 'templates', 'roteiro.md'), 'utf8');
fs.writeFileSync(path.join(dest, 'roteiro.md'), `# ${name}\n\nCriado em ${today}.\n\n${roteiro}`);

console.log(`✓ projects/${name} criado (template + kit compartilhado + brief.md + roteiro.md)
Próximos passos:
  1. preencha projects/${name}/brief.md e projects/${name}/roteiro.md
  1b. node tools/plan.mjs projects/${name} --check
  2. node tools/preview.mjs projects/${name}
  3. node render.mjs projects/${name} --stills 8
  4. node render.mjs projects/${name} --check`);
