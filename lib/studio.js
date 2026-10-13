// Motion Studio — kit compartilhado para cenas seek(t).
// Script clássico (funciona em file:// e por HTTP): expõe window.Studio.
// Cada projeto recebe uma CÓPIA desta pasta (tools/new.mjs), então mudar o kit não altera
// vídeos antigos. Tudo aqui é função pura do tempo, salvo onde dito.
(function () {
  'use strict';

  // ---------- tempo ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const mix = (a, b, k) => a + (b - a) * k;
  /** Grade de batidas: const b = beats(120); b(4) → 2s */
  const beats = (bpm) => (n) => (n * 60) / bpm;
  /** Entrada e saída num só número (0 = fora, 1 = presente). */
  const life = (t, inA, inB, outA = 1e9, outB = 1e9, eIn = E.outExpo, eOut = E.inExpo) =>
    eIn(prog(t, inA, inB)) - eOut(prog(t, outA, outB));

  // ---------- curvas (retornam 0 e 1 exatos nas pontas) ----------
  const E = {
    linear: (x) => x,
    outQuad: (x) => 1 - (1 - x) ** 2,
    outCubic: (x) => 1 - (1 - x) ** 3,
    outQuart: (x) => 1 - (1 - x) ** 4,
    outQuint: (x) => 1 - (1 - x) ** 5,
    outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inQuad: (x) => x * x,
    inCubic: (x) => x ** 3,
    inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
    inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outBack: (x, s = 1.4) => (x >= 1 ? 1 : 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2),
  };
  /** Bézier cúbica igual à do CSS: bezier(.2,.8,.2,1). */
  function bezier(x1, y1, x2, y2) {
    const f = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 28; i++) { f(x1, x2, t) < x ? (lo = t) : (hi = t); t = (lo + hi) / 2; }
      return f(y1, y2, t);
    };
  }

  // ---------- molas fechadas (sem simulação: qualquer quadro em qualquer ordem) ----------
  // response = período em s (estilo SwiftUI); damping = razão de amortecimento ζ.
  const SPRINGS = {
    snappy: { response: 0.22, damping: 0.8 }, // botões, indicadores, pops (~1,5% overshoot)
    default: { response: 0.4, damping: 0.86 }, // cartões, painéis, câmera
    heavy: { response: 0.5, damping: 1.0 }, // tipografia grande, logo (sem overshoot)
    playful: { response: 0.5, damping: 0.45 }, // mascotes — nunca UI ou texto
  };
  /** Resposta ao degrau 0 → 1 de uma mola solta há tau segundos. */
  function step(tau, preset = 'default') {
    if (!(tau > 0)) return 0;
    const { response, damping: z } = typeof preset === 'string' ? SPRINGS[preset] : preset;
    const w = (2 * Math.PI) / response;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
    }
    if (z === 1) return 1 - Math.exp(-w * tau) * (1 + w * tau);
    const wd = w * Math.sqrt(z * z - 1);
    return 1 - Math.exp(-z * w * tau) * (Math.cosh(wd * tau) + ((z * w) / wd) * Math.sinh(wd * tau));
  }
  const spring = (t, t0, from, to, preset) => from + (to - from) * step(t - t0, preset);
  /** Valor com vários alvos: soma de uma mola por mudança (mantém a velocidade entre alvos).
   *  keys: [[t, valor, preset?], ...] em ordem; o primeiro é o valor inicial. */
  function track(t, keys, preset) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [ti, vi, pi] = keys[i];
      if (t <= ti) break;
      v += (vi - keys[i - 1][1]) * step(t - ti, pi || preset);
    }
    return v;
  }

  // ---------- ruído determinístico ----------
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function mulberry32(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let r = Math.imul(s ^ (s >>> 15), 1 | s);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Ruído suave 1D em [-1, 1]. */
  function noise1(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    const g = (k) => hash(k + seed * 101.3) * 2 - 1;
    return mix(g(i) * f, g(i + 1) * (f - 1), u) * 2;
  }

  // ---------- câmera ----------
  /** keys: [[t, zoom, x, y, ease?], ...] — x,y = ponto do mundo no centro da tela.
   *  Zoom interpolado em espaço log (aproximações parecem uniformes). */
  function camera(t, keys) {
    if (t <= keys[0][0]) return { zoom: keys[0][1], x: keys[0][2], y: keys[0][3] };
    for (let i = 1; i < keys.length; i++) {
      const [t1, z1, x1, y1, ease] = keys[i];
      const [t0, z0, x0, y0] = keys[i - 1];
      if (t <= t1) {
        const k = (ease || E.inOutCubic)(prog(t, t0, t1));
        return { zoom: Math.exp(mix(Math.log(z0), Math.log(z1), k)), x: mix(x0, x1, k), y: mix(y0, y1, k) };
      }
    }
    const l = keys[keys.length - 1];
    return { zoom: l[1], x: l[2], y: l[3] };
  }
  /** Aplica a câmera num contêiner "mundo" (origem 0,0 no canto). */
  function applyCamera(el, cam, W, H, extra = {}) {
    const s = cam.zoom * (extra.punch || 1);
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${W / 2 + (extra.x || 0)}px, ${H / 2 + (extra.y || 0)}px) rotate(${extra.rotate || 0}deg) scale(${s}) translate(${-cam.x}px, ${-cam.y}px)`;
  }
  /** Golpe de escala que decai, num acerto de batida: punch(t, b(8)) → 1..1+amount */
  const punch = (t, at, amount = 0.03, dur = 0.35) => { const d = t - at; return d < 0 || d > dur ? 1 : 1 + amount * (1 - d / dur) ** 3; };
  /** Deriva de câmera na mão (px). */
  const drift = (t, amp = 6, freq = 0.35, seed = 3) => ({ x: noise1(t * freq, seed) * amp, y: noise1(t * freq, seed + 5) * amp });

  // ---------- texto ----------
  /** Parte o texto em letras ou palavras dentro de máscaras (overflow:hidden com folga para
   *  acentos e descendentes). Chame UMA vez na montagem; devolve os spans animáveis. */
  function split(el, { by = 'chars', mask = true } = {}) {
    const text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    const pieces = [];
    for (const w of text.split(/(\s+)/)) {
      if (!w) continue;
      if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); continue; }
      const word = document.createElement('span');
      word.style.cssText = 'display:inline-block;white-space:nowrap';
      for (const u of by === 'words' ? [w] : [...w]) {
        const s = document.createElement('span');
        s.textContent = u;
        s.style.display = 'inline-block';
        if (mask) {
          const m = document.createElement('span');
          m.style.cssText = 'display:inline-block;overflow:clip;vertical-align:bottom;padding:.22em .25em .12em;margin:-.22em -.25em -.12em';
          m.appendChild(s);
          word.appendChild(m);
        } else word.appendChild(s);
        pieces.push(s);
      }
      el.appendChild(word);
    }
    return pieces;
  }
  /** Peças sobem pela máscara (entrada) e saem por cima (saída).
   *  Entrada a partir de `from` (1.6 = 160% abaixo: esconde acentos de maiúsculas); saída até `to` (2.0 = 200% acima:
   *  descendentes e cedilhas passam da folga de cima da máscara). Antes de entrar e depois de sair a peça fica
   *  invisível — nenhum fiapo de letra sobra no quadro.
   *  opts: { stagger: 0.035, dur: 0.7, ease: E.outExpo, out: tempo de saída, outDur: 0.45, outStagger: stagger × 0.6, from: 1.6, to: 2.0, rot: graus }
   *  outStagger pequeno (0.005–0.01) faz a linha sair inteira de uma vez — a próxima pode entrar logo depois. */
  function rise(pieces, t, start, opts = {}) {
    const { stagger = 0.035, dur = 0.7, ease = E.outExpo, out = 1e9, outDur = 0.45, from = 1.6, to = 2.0, rot = 0 } = opts;
    const outStagger = opts.outStagger ?? stagger * 0.6;
    pieces.forEach((s, i) => {
      const a = start + i * stagger, o = out + i * outStagger;
      const kin = ease(prog(t, a, a + dur));
      const kout = E.inExpo(prog(t, o, o + outDur));
      const y = (1 - kin) * from - kout * to;
      const r = (1 - kin) * rot;
      s.style.transform = `translateY(${(y * 100).toFixed(3)}%)` + (Math.abs(r) > 1e-3 ? ` rotate(${r.toFixed(3)}deg)` : '');
      s.style.visibility = t <= a || kout >= 1 ? 'hidden' : '';
    });
  }
  /** Ajusta o font-size para o texto ocupar `width` px (tipografia que enche o quadro). */
  function fit(el, width, { min = 10, max = 2000 } = {}) {
    el.style.fontSize = '100px';
    el.style.whiteSpace = 'nowrap';
    // mede a largura do conteúdo (max-content), não a do bloco — um <div> ocupa a largura do pai
    const prev = el.style.width;
    el.style.width = 'max-content';
    const w = el.getBoundingClientRect().width;
    el.style.width = prev;
    if (!w) { console.error(`fit(): "${el.textContent.slice(0, 30)}" mediu 0 px — o elemento (ou uma cena acima dele) está com display:none. Monte com tudo visível.`); return el.style.fontSize = `${min}px`, min; }
    const size = clamp((100 * width) / w, min, max);
    el.style.fontSize = `${size}px`;
    return size;
  }
  const typeOn = (s, k) => [...s].slice(0, Math.round([...s].length * clamp(k))).join('');
  /** Contador com números tabulares (use font-variant-numeric: tabular-nums). */
  const counter = (from, to, k, { decimals = 0, locale = 'pt-BR' } = {}) =>
    mix(from, to, k).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  // ---------- transições que transformam ----------
  /** Inundação: círculo nasce em (x,y) e cobre até o canto mais distante. k 0..1. */
  function flood(el, k, x, y, W, H) {
    const r = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y)) * 1.04;
    el.style.clipPath = `circle(${(r * clamp(k)).toFixed(2)}px at ${x}px ${y}px)`;
  }
  /** Wipe a partir de uma borda ('left'|'right'|'top'|'bottom'). k 0..1 = revelado. */
  function wipe(el, k, from = 'left') {
    const h = (1 - clamp(k)) * 100;
    const ins = { left: `0 ${h}% 0 0`, right: `0 0 0 ${h}%`, top: `0 0 ${h}% 0`, bottom: `${h}% 0 0 0` }[from];
    el.style.clipPath = `inset(${ins})`;
  }
  /** Mostra/esconde de verdade (display), sem herdar visibility. */
  const show = (el, on) => {
    el.style.display = on ? '' : 'none';
    // limpar o inline devolve o display do CSS — se o CSS esconde (display:none), força block
    if (on && getComputedStyle(el).display === 'none') el.style.display = 'block';
  };

  // ---------- formato e zonas seguras ----------
  const FORMATS = {
    '16x9': { W: 1920, H: 1080, safe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 } },
    '9x16': { W: 1080, H: 1920, safe: { top: 0.15, right: 0.15, bottom: 0.2, left: 0.06 } },
    '1x1': { W: 1080, H: 1080, safe: { top: 0.06, right: 0.06, bottom: 0.06, left: 0.06 } },
    '4x5': { W: 1080, H: 1350, safe: { top: 0.06, right: 0.06, bottom: 0.08, left: 0.06 } },
  };
  const params = new URLSearchParams(location.search);
  /** Formato pedido (?format=), com tamanho, zona segura em px e um seletor pick({...}). */
  function format(fallback = '16x9') {
    const name = FORMATS[params.get('format')] ? params.get('format') : fallback;
    const f = FORMATS[name];
    const safe = { top: f.safe.top * f.H, right: f.safe.right * f.W, bottom: f.safe.bottom * f.H, left: f.safe.left * f.W };
    return {
      name, W: f.W, H: f.H, safe,
      vertical: f.H > f.W,
      /** pick({ '9x16': a, default: b }) */
      pick: (map) => (name in map ? map[name] : map.default),
    };
  }


  // ---------- layout que recompõe por formato ----------
  /** Grade e regiões a partir do formato. Escreva a cena contra REGIÕES, não pixels:
   *  o mesmo código fica lado a lado no 16:9 e empilhado no 9:16.
   *    const L = layout(format());
   *    const [texto, midia] = L.split(0.55);      // 16:9 → esquerda|direita · 9:16/1:1/4:5 → cima/baixo
   *    L.place(el, texto);                         // left/top/width/height em px
   *  L.box = área útil (margem de 6% do lado menor, nunca dentro da zona de UI do app)
   *  L.type = escala tipográfica de vídeo (px): hero, title, sub, body, small (≥ 28 px) */
  function layout(F, { margin = 0.06, gap = 0.04 } = {}) {
    const m = Math.min(F.W, F.H) * margin;
    const left = Math.max(m, F.safe.left), right = Math.max(m, F.safe.right);
    const top = Math.max(m, F.safe.top), bottom = Math.max(m, F.safe.bottom);
    const box = { x: left, y: top, w: F.W - left - right, h: F.H - top - bottom };
    const orient = F.W > F.H * 1.15 ? 'landscape' : F.H > F.W * 1.15 ? 'portrait' : 'square';
    const g = Math.min(F.W, F.H) * gap;
    const u = Math.min(F.W, F.H) / 1080;
    const type = { hero: 190 * u, title: 104 * u, sub: 60 * u, body: 42 * u, small: 30 * u };
    /** Divide uma região em duas: lado a lado na horizontal, empilhado nos outros (ou force dir). */
    const split = (ratio = 0.5, r = box, dir = orient === 'landscape' ? 'row' : 'column') =>
      dir === 'row'
        ? [{ x: r.x, y: r.y, w: (r.w - g) * ratio, h: r.h }, { x: r.x + (r.w - g) * ratio + g, y: r.y, w: (r.w - g) * (1 - ratio), h: r.h }]
        : [{ x: r.x, y: r.y, w: r.w, h: (r.h - g) * ratio }, { x: r.x, y: r.y + (r.h - g) * ratio + g, w: r.w, h: (r.h - g) * (1 - ratio) }];
    /** n colunas (ou linhas) iguais dentro de r. */
    const cols = (n, r = box) => Array.from({ length: n }, (_, i) => ({ x: r.x + i * ((r.w - g * (n - 1)) / n + g), y: r.y, w: (r.w - g * (n - 1)) / n, h: r.h }));
    const rows = (n, r = box) => Array.from({ length: n }, (_, i) => ({ x: r.x, y: r.y + i * ((r.h - g * (n - 1)) / n + g), w: r.w, h: (r.h - g * (n - 1)) / n }));
    /** Encolhe uma região (px ou fração) e alinha: inset(r, 0.1) */
    const inset = (r, k) => { const d = k < 1 ? Math.min(r.w, r.h) * k : k; return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d }; };
    /** Maior retângulo com proporção a (w/h) dentro de r, alinhado (ax, ay de 0 a 1). */
    const fitRect = (r, a, ax = 0.5, ay = 0.5) => {
      const w = Math.min(r.w, r.h * a), h = w / a;
      return { x: r.x + (r.w - w) * ax, y: r.y + (r.h - h) * ay, w, h };
    };
    const place = (el, r, { size = true } = {}) => {
      Object.assign(el.style, { position: 'absolute', left: `${r.x}px`, top: `${r.y}px` });
      if (size) Object.assign(el.style, { width: `${r.w}px`, height: `${r.h}px` });
      return r;
    };
    /** Área útil que continua dentro da zona segura depois de uma aproximação de câmera z (zoom no centro). */
    const camSafe = (z, r = box) => ({ x: F.W / 2 - (F.W / 2 - r.x) / z, y: F.H / 2 - (F.H / 2 - r.y) / z, w: r.w / z, h: r.h / z });
    return { ...F, orient, box, gap: g, u, type, split, cols, rows, inset, fitRect, place, camSafe };
  }

  // ---------- grão (canvas 2D, semente fixa) ----------
  /** Grão de filme: quebra o banding de degradados e dá matéria a fundos lisos.
   *  Chame na montagem; depois grain.render(t) dentro do seek. */
  function grain(parent, { W, H, fps = 30, opacity = 0.06, tile = 256, variants = 6, every = 2, blend = 'multiply', seed = 7 } = {}) {
    const rnd = mulberry32(seed);
    const tiles = [];
    for (let v = 0; v < variants; v++) {
      const c = document.createElement('canvas');
      c.width = c.height = tile;
      const g = c.getContext('2d');
      const img = g.createImageData(tile, tile);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = 128 + (rnd() - 0.5) * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      tiles.push(c);
    }
    const el = document.createElement('canvas');
    el.width = W; el.height = H;
    el.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:900;opacity:${opacity};mix-blend-mode:${blend}`;
    parent.appendChild(el);
    const g = el.getContext('2d');
    const pats = tiles.map((c) => g.createPattern(c, 'repeat'));
    return {
      el,
      render(t) {
        const k = Math.floor((t * fps) / every);
        g.setTransform(1, 0, 0, 1, (k * 37) % tile - tile, (k * 61) % tile - tile);
        g.fillStyle = pats[k % variants];
        g.fillRect(0, 0, W + tile, H + tile);
      },
    };
  }

  // ---------- imagens ----------
  /** Promessa que resolve quando todas as <img> (e fontes) estão decodificadas. */
  const ready = (extra = []) =>
    Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode().catch(() => {})), ...extra]);

  // ---------- som sintetizado (mesma grade da imagem) ----------
  /** Kit de síntese num OfflineAudioContext: const s = Studio.synth(ctx, master); s.kick(b(2)). */
  function synth(ctx, out) {
    const sr = ctx.sampleRate;
    const noise = ctx.createBuffer(1, sr, sr);
    const r = mulberry32(99);
    noise.getChannelData(0).forEach((_, i, d) => (d[i] = r() * 2 - 1));
    const env = (g, at, a, peak, d) => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + a);
      g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
    };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const src = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; return s; };
    return {
      kick(at, vol = 1) {
        const o = osc('sine', 150), g = ctx.createGain();
        o.frequency.setValueAtTime(150, at);
        o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
        env(g, at, 0.002, vol, 0.38);
        o.connect(g).connect(out); o.start(at); o.stop(at + 0.45);
      },
      hat(at, vol = 0.16) {
        const s = src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'highpass'; f.frequency.value = 8000;
        env(g, at, 0.001, vol, 0.05);
        s.connect(f).connect(g).connect(out); s.start(at); s.stop(at + 0.07);
      },
      tick(at, vol = 0.05, f = 2400) {
        const o = osc('square', f), g = ctx.createGain();
        env(g, at, 0.001, vol, 0.02);
        o.connect(g).connect(out); o.start(at); o.stop(at + 0.03);
      },
      pop(at, vol = 0.25, f = 600) {
        const o = osc('sine', f), g = ctx.createGain();
        o.frequency.setValueAtTime(f, at);
        o.frequency.exponentialRampToValueAtTime(f * 2.2, at + 0.06);
        env(g, at, 0.002, vol, 0.09);
        o.connect(g).connect(out); o.start(at); o.stop(at + 0.12);
      },
      /** Whoosh que TERMINA no corte (to). */
      whoosh(from, to, vol = 0.3) {
        const s = src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'bandpass'; f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, from); f.frequency.exponentialRampToValueAtTime(6000, to);
        g.gain.setValueAtTime(0.0001, from); g.gain.exponentialRampToValueAtTime(vol, to - 0.02); g.gain.linearRampToValueAtTime(0, to);
        s.connect(f).connect(g).connect(out); s.start(from); s.stop(to);
      },
      /** Subida tensa (serra + passa-baixa abrindo) que termina no acerto. */
      riser(from, to, vol = 0.12) {
        const o = osc('sawtooth', 110), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.frequency.setValueAtTime(110, from); o.frequency.exponentialRampToValueAtTime(440, to);
        f.type = 'lowpass'; f.frequency.setValueAtTime(300, from); f.frequency.exponentialRampToValueAtTime(5000, to);
        g.gain.setValueAtTime(0.0001, from); g.gain.exponentialRampToValueAtTime(vol, to); g.gain.linearRampToValueAtTime(0, to + 0.01);
        o.connect(f).connect(g).connect(out); o.start(from); o.stop(to + 0.02);
      },
      /** Impacto do reveal principal: sub + ruído grave com cauda. */
      impact(at, vol = 0.9) {
        this.kick(at, vol);
        const s = src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.frequency.value = 900;
        env(g, at, 0.003, vol * 0.5, 0.9);
        s.connect(f).connect(g).connect(out); s.start(at); s.stop(at + 1);
      },
      /** Pad de acorde (notas MIDI), ataque lento. */
      pad(at, dur, notes, vol = 0.05) {
        const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = 'lowpass'; f.frequency.value = 1400;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.6, dur / 3));
        g.gain.setValueAtTime(vol, at + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        f.connect(g).connect(out);
        for (const n of notes) for (const det of [-6, 6]) {
          const o = osc('sawtooth', 440 * 2 ** ((n - 69) / 12)); o.detune.value = det;
          o.connect(f); o.start(at); o.stop(at + dur + 0.05);
        }
      },
      /** Baixo curto (nota MIDI). */
      bass(at, note, dur = 0.25, vol = 0.35) {
        const o = osc('sine', 440 * 2 ** ((note - 69) / 12)), g = ctx.createGain();
        env(g, at, 0.005, vol, dur);
        o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.05);
      },
    };
  }


  // ---------- cenas e capítulos ----------
  /** Organiza vídeos longos: cada cena tem início/fim e recebe o tempo LOCAL.
   *  const run = scenes([{ el, start: 0, end: b(16), render: (lt, t) => {...} }, ...]); run(t) no seek.
   *  Cenas fora do tempo ficam com display:none. */
  function scenes(list) {
    const last = list[list.length - 1];
    return (t) => {
      for (const s of list) {
        const on = t >= s.start && (t < s.end || (s === last && t <= s.end));
        if (s.el) show(s.el, on);
        if (on && s.render) s.render(t - s.start, t);
      }
    };
  }

  // ---------- legendas palavra a palavra ----------
  /** Agrupa palavras ({ w|word|text, start, end }, de tools/transcribe.py) em blocos de legenda:
   *  no máx. maxChars por bloco, quebra em pausa/pontuação, cada bloco ≥ minDur e sem buracos curtos. */
  function captionBlocks(words, { maxChars = 18, maxWords = 4, minDur = 0.7, pause = 0.35, fillGap = 0.3 } = {}) {
    const W = words.map((x) => ({ w: String(x.w ?? x.word ?? x.text).trim(), start: x.start, end: x.end })).filter((x) => x.w);
    const blocks = [];
    let cur = null;
    for (const x of W) {
      const len = cur ? cur.words.reduce((n, y) => n + y.w.length + 1, 0) + x.w.length : x.w.length;
      const prev = cur && cur.words[cur.words.length - 1];
      const brk = !cur || len > maxChars || cur.words.length >= maxWords || x.start - prev.end > pause || /[.!?…:;]$/.test(prev.w) || (/,$/.test(prev.w) && cur.words.length >= 2);
      if (brk) { cur = { words: [], start: x.start, end: x.end }; blocks.push(cur); }
      cur.words.push(x);
      cur.end = x.end;
    }
    blocks.forEach((bl, i) => {
      const next = blocks[i + 1];
      bl.end = Math.max(bl.end, bl.start + minDur);
      if (next && next.start - bl.end < fillGap) bl.end = next.start;   // sem piscar entre blocos
      if (next && bl.end > next.start) bl.end = next.start;
      bl.text = bl.words.map((y) => y.w).join(' ');
    });
    return blocks;
  }
  /** Legenda pronta: monta o bloco ativo dentro de `el` e destaca a palavra falada.
   *  mode 'karaoke' (bloco inteiro, palavra atual com classe .on) ou 'pop' (palavras aparecem quando ditas).
   *  Estilize no CSS: .cap-w { } .cap-w.on { color: var(--accent) } */
  function captions(el, words, { mode = 'karaoke', ...opts } = {}) {
    const blocks = captionBlocks(words, opts);
    let shown = -1, spans = [];
    return {
      blocks,
      render(t) {
        const i = blocks.findIndex((bl) => t >= bl.start && t < bl.end);
        if (i !== shown) {
          shown = i;
          el.textContent = '';
          spans = i < 0 ? [] : blocks[i].words.map((x) => {
            const s = document.createElement('span');
            s.className = 'cap-w';
            s.textContent = x.w;
            el.appendChild(s);
            el.appendChild(document.createTextNode(' '));
            return s;
          });
        }
        if (i < 0) return;
        const bl = blocks[i];
        const k = E.outBack(prog(t, bl.start, bl.start + 0.16), 1.6);
        el.style.transform = `scale(${mix(0.9, 1, k).toFixed(4)})`;
        bl.words.forEach((x, j) => {
          spans[j].classList.toggle('on', t >= x.start && (j === bl.words.length - 1 || t < bl.words[j + 1].start));
          if (mode === 'pop') spans[j].style.visibility = t >= x.start ? 'visible' : 'hidden';
        });
      },
    };
  }

  // ---------- vídeo dentro da cena ----------
  /** Quadros extraídos com tools/clip.mjs tocando num <img>, presos ao tempo da cena.
   *  const clip = frames(img, { dir: 'assets/clip', fps: 30, count: 240, start: b(4) }); await clip(t) no seek. */
  function frames(img, { dir, fps = 30, count, start = 0, loop = false, ext = 'jpg' }) {
    return async (t) => {
      let i = Math.floor((t - start) * fps + 1e-6);
      i = loop ? ((i % count) + count) % count : clamp(i, 0, count - 1);
      const src = `${dir}/${String(i + 1).padStart(5, '0')}.${ext}`;
      if (img.getAttribute('src') !== src) {
        img.setAttribute('src', src);
        await img.decode().catch(() => {});
      }
    };
  }

  // ---------- registro da cena ----------
  /** Define window.STUDIO e, fora do render, um preview simples em loop (rAF só aqui).
   *  Para revisar com barra de tempo use: node tools/preview.mjs projects/<p> */
  function define(cfg) {
    window.STUDIO = { fps: 60, ready: document.fonts.ready, ...cfg };
    // ?alpha=1 (render --alpha): fundo transparente. Esconda camadas de fundo com o CSS `.alpha .bg { display: none }`.
    if (params.has('alpha')) {
      document.documentElement.classList.add('alpha');
      for (const el of [document.documentElement, document.body, document.getElementById('stage')]) if (el) el.style.background = 'transparent';
    }
    if (!params.has('render')) {
      const t0 = performance.now();
      const start = params.has('t') ? Number(params.get('t')) : null;
      const loop = () => {
        const t = start ?? ((performance.now() - t0) / 1000) % cfg.duration;
        cfg.seek(t);
        if (start === null) requestAnimationFrame(loop);
      };
      Promise.resolve(window.STUDIO.ready).then(loop);
    }
    return window.STUDIO;
  }

  window.Studio = {
    clamp, prog, mix, beats, life, E, bezier,
    SPRINGS, step, spring, track,
    hash, mulberry32, noise1,
    camera, applyCamera, punch, drift,
    split, rise, fit, typeOn, counter,
    flood, wipe, show,
    FORMATS, format, params, layout,
    scenes, captionBlocks, captions, frames,
    grain, ready, synth, define,
  };
})();
