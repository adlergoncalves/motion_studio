import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = 'test-script-gate';
const project = path.join(ROOT, 'projects', name);

const plan = (args) => {
  try {
    const out = execFileSync(process.execPath, ['tools/plan.mjs', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
};

test('the script gate rejects a plan that is still boilerplate and accepts a filled one', (t) => {
  fs.rmSync(project, { recursive: true, force: true });
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));

  execFileSync(process.execPath, ['tools/new.mjs', name], { cwd: ROOT, encoding: 'utf8' });
  const file = path.join(project, 'roteiro.md');
  assert.equal(fs.existsSync(file), true, 'new projects must ship a roteiro.md');

  const boilerplate = plan([`projects/${name}`, '--check']);
  assert.equal(boilerplate.code, 1, 'an unfilled plan must fail');
  assert.match(boilerplate.out, /seção vazia/);

  fs.writeFileSync(file, `# ${name}

## Promessa

Uma peça de teste que prova o portão do roteiro.

## Locução / narração

\`\`\`
01  primeira linha falada
\`\`\`

## Texto em tela

| # | Destaque | Apoio | Entra | Sai |
|---|---|---|---|---|
| 01 | TESTE | apoio do teste | 0,1 | 2,0 |

## Capítulos

| Capítulo | Início → fim | Ideia | Virada |
|---|---|---|---|
| 01 | 0,0 → 2,0 | abrir | barras entram |

## Direção por capítulo

| Capítulo | Câmera (movimento) | Plano de fundo | Gradação (look) | Óptica |
|---|---|---|---|---|
| 01 | push-in lento | névoa fria | \`teal\` | grão 0,07 |

## Som

Sem trilha.

## Critério de aceite

2 s, 1920×1080, --check sem erro.
`);

  const filled = plan([`projects/${name}`, '--check']);
  assert.equal(filled.code, 0, filled.out);
  assert.match(filled.out, /pode escrever a cena/);
});
