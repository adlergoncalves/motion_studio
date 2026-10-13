// Chromium sem janela: abre uma cena, posiciona com STUDIO.seek(t) e fotografa via CDP.
import { chromium } from 'playwright';

const BASE_ARGS = [
  '--force-color-profile=srgb', // cores da marca iguais em qualquer máquina
  '--font-render-hinting=none',
  '--disable-lcd-text', // antialias em cinza, sem franja colorida no texto
  '--hide-scrollbars',
  '--mute-audio',
];
// WebGL na GPU (no M1, Metal). Sem isso o headless cai no SwiftShader (software, lento).
const GPU_ARGS = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];

export async function launch({ gpu = true } = {}) {
  return chromium.launch({ args: [...BASE_ARGS, ...(gpu ? GPU_ARGS : [])] });
}

// Injetado antes de qualquer script da cena: Math.random com semente fixa e contagem de
// relógio/timers usados DENTRO do seek (que quebrariam a regra "função pura de t").
const GUARD = () => {
  let s = 0x2f6b9a1d;
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = (window.__guard = { inSeek: false, hits: {} });
  const realRAF = window.requestAnimationFrame.bind(window);
  window.__realRAF = realRAF;
  const watch = (obj, key, label) => {
    const fn = obj[key].bind(obj);
    obj[key] = (...a) => {
      if (g.inSeek) g.hits[label] = (g.hits[label] || 0) + 1;
      return fn(...a);
    };
  };
  watch(window, 'setTimeout', 'setTimeout');
  watch(window, 'setInterval', 'setInterval');
  watch(window, 'requestAnimationFrame', 'requestAnimationFrame');
  watch(performance, 'now', 'performance.now');
  watch(Date, 'now', 'Date.now');
};

/**
 * Abre a cena e espera STUDIO + ready + fontes. Devolve helpers de seek/shot.
 * opts: { url, width, height, scale, alpha }
 */
export async function openScene(browser, { url, width = 1920, height = 1080, scale = 1, alpha = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const issues = { pageErrors: [], console: [], external: new Set() };
  await context.addInitScript(GUARD);
  const page = await context.newPage();
  page.on('pageerror', (e) => issues.pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && issues.console.push(m.text()));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) issues.external.add(u.origin);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.STUDIO, null, { timeout: 15000 }).catch(() => {
    throw new Error(`a cena não definiu window.STUDIO. ${issues.pageErrors.join(' | ')}`);
  });
  await page.evaluate(async () => {
    await window.STUDIO.ready;
    await document.fonts.ready;
  });
  if (issues.pageErrors.length) throw new Error(`erro na cena: ${issues.pageErrors[0]}`);

  const meta = await page.evaluate(() => {
    const { width, height, duration, fps, bpm, formats, chapters, loop } = window.STUDIO;
    return { width, height, duration, fps: fps ?? 60, bpm, formats, chapters, loop: Boolean(loop), hasAudio: typeof window.STUDIO.audio === 'function' };
  });
  if (meta.width !== width || meta.height !== height) await page.setViewportSize({ width: meta.width, height: meta.height });

  const cdp = await context.newCDPSession(page);
  if (alpha) await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

  return {
    page,
    meta,
    issues,
    /** Pinta o quadro t e espera dois rAF (layout e pintura terminados antes da foto). */
    async seek(t) {
      await page.evaluate(async (t) => {
        window.__guard.inSeek = true;
        try {
          await window.STUDIO.seek(t);
        } finally {
          window.__guard.inSeek = false;
        }
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = t * 1000;
        }
        await new Promise((r) => window.__realRAF(() => window.__realRAF(r)));
      }, t);
      if (issues.pageErrors.length) throw new Error(`erro na cena em t=${t}: ${issues.pageErrors[0]}`);
    },
    /** Foto do quadro atual (Buffer PNG/JPEG) direto pelo CDP: mais rápido que page.screenshot. */
    async shot({ format = 'png', quality = 92 } = {}) {
      const r = await cdp.send('Page.captureScreenshot', {
        format,
        ...(format === 'jpeg' ? { quality } : {}),
        optimizeForSpeed: true,
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: meta.width, height: meta.height, scale },
      });
      return Buffer.from(r.data, 'base64');
    },
    guardHits: () => page.evaluate(() => window.__guard.hits),
    close: () => context.close(),
  };
}
