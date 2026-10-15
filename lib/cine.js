// Motion Studio — camada cinematográfica. Carregue depois de studio.js (antes ou depois de gl.js).
//
// O que ela resolve: cena de tipografia sobre fundo chapado parece slide. Cinema é câmera que
// nunca para, profundidade em planos, óptica (vinheta, grão, halação, borrão de obturador) e
// gradação de cor. Tudo aqui é função pura de t — nada de relógio, timer ou estado entre quadros.
//
//   const C = Studio.cine.rig($('stage'), { W, H, look: 'noir' });
//   const planos = [C.plate({ depth: 1.0 }), C.plate({ depth: 0.45 }), C.plate({ depth: 0.12 })];
//   // dentro do seek(t):
//   const cam = C.move(t, [[0, 1.00, 0, 0], [6, 1.12, 40, -20]]);   // keys de Studio.camera
//   C.apply(planos[0].el, cam, 1.0); ... C.render(t, { bars: 1, flash: ..., exposure: ... });
(function () {
  'use strict';
  const S = window.Studio;
  if (!S) throw new Error('cine.js precisa de studio.js carregado antes');
  const { clamp, prog, mix, noise1, E, camera } = S;

  // ---------- looks (gradação) ----------
  // sombra = cor que entra nos pretos (multiply) · luz = cor que entra nas altas (screen)
  const LOOKS = {
    neutral:  { shadow: '#000000', shadowK: 0.00, light: '#ffffff', lightK: 0.00, vignette: 0.28, grain: 0.05, halation: '#ffffff' },
    noir:     { shadow: '#0a1016', shadowK: 0.30, light: '#cfd8e3', lightK: 0.06, vignette: 0.52, grain: 0.09, halation: '#9fb6cc' },
    teal:     { shadow: '#06222b', shadowK: 0.22, light: '#ffb27a', lightK: 0.12, vignette: 0.40, grain: 0.07, halation: '#ff9f5a' },
    print:    { shadow: '#2a211a', shadowK: 0.18, light: '#fff3dc', lightK: 0.10, vignette: 0.30, grain: 0.11, halation: '#ffe6bd' },
    ember:    { shadow: '#1b0a06', shadowK: 0.34, light: '#ff7a2f', lightK: 0.14, vignette: 0.48, grain: 0.08, halation: '#ff6a21' },
  };

  const div = (parent, z, css = '') => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${z};${css}`;
    parent.appendChild(el);
    return el;
  };

  /** Filtro SVG de borrão direcional (obturador). Um por documento; stdDeviation setado por quadro. */
  let smearN = 0;
  function smearFilter(parent) {
    const id = `cine-smear-${smearN++}`;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0';
    const f = document.createElementNS(ns, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '-25%'); f.setAttribute('y', '-25%');
    f.setAttribute('width', '150%'); f.setAttribute('height', '150%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const b = document.createElementNS(ns, 'feGaussianBlur');
    b.setAttribute('in', 'SourceGraphic');
    b.setAttribute('stdDeviation', '0 0');
    f.appendChild(b);
    svg.appendChild(f);
    parent.appendChild(svg);
    return { id, node: b };
  }

  /** Monta a pilha óptica sobre o palco e devolve o controlador da câmera.
   *  opts: { W, H, look, vignette, grain, bars (0..0.5 da altura), grainFps, z } */
  function rig(stage, opts = {}) {
    const { W, H, look = 'neutral', z = 600, grainFps = 30 } = opts;
    const K = { ...LOOKS[look] || LOOKS.neutral, ...opts.look === undefined ? {} : {} };
    if (typeof opts.vignette === 'number') K.vignette = opts.vignette;
    if (typeof opts.grain === 'number') K.grain = opts.grain;

    // ordem: planos (abaixo, criados sob demanda) → conteúdo → gradação → vinheta → leak → barras → flash → grão
    const shadow = div(stage, z + 1, `background:${K.shadow};mix-blend-mode:multiply;opacity:0`);
    const light = div(stage, z + 2, `background:${K.light};mix-blend-mode:screen;opacity:0`);
    const vig = div(stage, z + 3,
      `background:radial-gradient(130% 95% at 50% 46%, rgba(0,0,0,0) 38%, rgba(0,0,0,.55) 78%, rgba(0,0,0,.92) 100%);opacity:0`);
    const leak = div(stage, z + 4,
      `background:linear-gradient(105deg, rgba(255,255,255,0) 32%, ${K.halation} 50%, rgba(255,255,255,0) 68%);mix-blend-mode:screen;opacity:0;filter:blur(${Math.round(Math.min(W, H) * 0.06)}px)`);
    const barT = div(stage, z + 5, 'inset:0 0 auto 0;height:0;background:#000');
    const barB = div(stage, z + 5, 'inset:auto 0 0 0;height:0;background:#000');
    const flashEl = div(stage, z + 6, 'background:#fff;opacity:0');
    const gr = S.grain(stage, { W, H, fps: grainFps, opacity: K.grain, blend: 'overlay', variants: 8, every: 2, seed: 11 });
    gr.el.style.zIndex = String(z + 7);

    const sm = smearFilter(stage);
    const plates = [];

    const api = {
      look: K,
      layers: { shadow, light, vig, leak, barT, barB, flash: flashEl, grain: gr },

      /** Plano de profundidade: depth 1 = fundo (move menos), 0 = colado na câmera. */
      plate({ depth = 1, z: pz = null, blur = 0 } = {}) {
        const el = div(stage, pz === null ? Math.round(100 - depth * 90) : pz, 'inset:0;will-change:transform');
        el.dataset.depth = String(depth);
        if (blur) el.style.filter = `blur(${blur}px)`;
        const p = { el, depth };
        plates.push(p);
        return p;
      },

      /** Câmera: keys de Studio.camera + respiração de mão somada. */
      move(t, keys, { handheld = 1, breath = 0.006, seed = 3 } = {}) {
        const cam = camera(t, keys);
        const a = handheld;
        return {
          ...cam,
          zoom: cam.zoom * (1 + Math.sin(t * 0.9 + seed) * breath),
          hx: noise1(t * 0.23, seed) * 9 * a + noise1(t * 0.71, seed + 11) * 2.5 * a,
          hy: noise1(t * 0.19, seed + 5) * 7 * a + noise1(t * 0.67, seed + 17) * 2.0 * a,
          rot: noise1(t * 0.13, seed + 31) * 0.28 * a,
        };
      },

      /** Aplica a câmera num elemento com fator de profundidade (paralaxe + escala). */
      /** `snap: true` trava a translação em pixel inteiro e dispensa a escala quando ela é ~1.
       *  Tipografia grande sob escala fracionária rasteriza diferente entre abas do Chromium —
       *  e como o render divide o vídeo em trechos por aba, isso vira tremor no corte. */
      apply(el, cam, depth = 1, extra = {}) {
        const par = mix(1, 0.18, clamp(depth === 0 ? 1 : 1 - depth)); // fundo (depth 1) desloca menos
        const dx = (-(cam.x || 0) + (cam.hx || 0)) * par * (extra.parallax ?? 1);
        const dy = (-(cam.y || 0) + (cam.hy || 0)) * par * (extra.parallax ?? 1);
        const sc = 1 + (cam.zoom - 1) * mix(1.35, 0.85, clamp(depth)) * (extra.zoomK ?? 1);
        const scale = sc * (extra.punch || 1);
        const rot = (cam.rot || 0) * mix(1.2, 0.6, clamp(depth));
        el.style.transformOrigin = extra.origin || '50% 50%';
        if (extra.snap) {
          const parts = [`translate3d(${Math.round(dx)}px, ${Math.round(dy)}px, 0)`];
          if (Math.abs(rot) > 0.01) parts.push(`rotate(${rot.toFixed(3)}deg)`);
          if (Math.abs(scale - 1) > 0.0005) parts.push(`scale(${scale.toFixed(4)})`);
          el.style.transform = parts.join(' ');
          return;
        }
        el.style.transform =
          `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) rotate(${rot.toFixed(3)}deg) scale(${scale.toFixed(5)})`;
      },

      /** Borrão de obturador: amount em px, dir em graus (0 = horizontal). */
      smear(el, amount = 0, dir = 0) {
        if (amount < 0.05) { if (el.style.filter.includes('url(')) el.style.filter = el.style.filter.replace(/url\([^)]*\)\s*/g, '').trim(); return; }
        const r = (dir * Math.PI) / 180;
        sm.node.setAttribute('stdDeviation', `${(Math.abs(Math.cos(r)) * amount).toFixed(2)} ${(Math.abs(Math.sin(r)) * amount).toFixed(2)}`);
        const base = el.style.filter.replace(/url\([^)]*\)\s*/g, '').trim();
        el.style.filter = `${base} url(#${sm.id})`.trim();
      },

      /** Foco: profundidade de campo barata. */
      focus(el, px = 0) {
        const base = el.style.filter.replace(/blur\([^)]*\)\s*/g, '').trim();
        el.style.filter = px > 0.1 ? `${base} blur(${px.toFixed(2)}px)`.trim() : base;
      },

      /** Halação: luz sangrando do tipo claro (faz o texto parecer filmado, não colado). */
      halation(el, px = 0, color = K.halation, alpha = 0.45, contact = 0.5) {
        if (px <= 0.2) { el.style.textShadow = ''; return; }
        const glow = `0 0 ${px.toFixed(1)}px ${hexA(color, alpha)}, 0 0 ${(px * 2.6).toFixed(1)}px ${hexA(color, alpha * 0.45)}`;
        const drop = contact > 0 ? `, 0 ${(px * 0.30).toFixed(1)}px ${(px * 1.6).toFixed(1)}px rgba(0,0,0,${(0.62 * contact).toFixed(2)})` : '';
        el.style.textShadow = glow + drop;
      },

      /** Desenha a óptica do quadro. Chame uma vez por seek, depois de posicionar tudo.
       *  p: { bars 0..1, grade 0..1, vignette 0..1, flash 0..1, leak 0..1, exposure (-1..1) } */
      render(t, p = {}) {
        const barsK = clamp(p.bars ?? 0);
        const h = Math.round(H * 0.112 * barsK); // ~2.39:1 dentro de 16:9; em vertical vira janela
        barT.style.height = `${h}px`;
        barB.style.height = `${h}px`;
        const g = p.grade ?? 1;
        const ex = p.exposure ?? 0;
        shadow.style.opacity = (K.shadowK * g * (1 - clamp(ex, 0, 1) * 0.6)).toFixed(3);
        light.style.opacity = (clamp(K.lightK * g + Math.max(0, ex) * 0.22)).toFixed(3);
        vig.style.opacity = ((p.vignette ?? 1) * K.vignette).toFixed(3);
        const lk = clamp(p.leak ?? 0);
        leak.style.opacity = (lk * 0.5).toFixed(3);
        if (lk > 0) leak.style.transform = `translateX(${(noise1(t * 0.18, 71) * 0.35 + (t * 0.012) % 1 - 0.3) * W}px) rotate(${(noise1(t * 0.1, 91) * 3).toFixed(2)}deg)`;
        flashEl.style.opacity = clamp(p.flash ?? 0).toFixed(3);
        gr.el.style.opacity = ((p.grain ?? 1) * K.grain).toFixed(3);
        gr.render(t);
      },
    };
    return api;
  }

  // ---------- temporizadores de linguagem de corte ----------
  /** Flash de um quadro no corte: flash(t, at) → 0..1 que sobe em 1 quadro e cai em ~0,12s. */
  const flash = (t, at, dur = 0.14, peak = 0.85) => {
    const d = t - at;
    if (d < -0.02 || d > dur) return 0;
    return d < 0 ? peak * (1 + d / 0.02) : peak * (1 - d / dur) ** 2;
  };
  /** Tranco de câmera no impacto (px). */
  const shake = (t, at, amp = 14, dur = 0.4, seed = 5) => {
    const d = t - at;
    if (d < 0 || d > dur) return { x: 0, y: 0 };
    const k = (1 - d / dur) ** 2;
    return { x: noise1(d * 38, seed) * amp * k, y: noise1(d * 41, seed + 9) * amp * k };
  };
  /** Rampa de velocidade: devolve o tempo "de cena" com uma desaceleração em torno de `at`. */
  const ramp = (t, at, width = 0.5, slow = 0.35) => {
    const d = (t - at) / width;
    if (Math.abs(d) > 1) return t - Math.sign(d) * 0 ;
    return at + width * Math.sign(d) * (Math.abs(d) ** (1 / clamp(slow, 0.05, 1)));
  };
  /** Velocidade aparente da câmera entre dois quadros — alimenta smear() sem derivada manual. */
  const swing = (t, keys, dt = 1 / 30) => {
    const a = camera(t - dt, keys), b = camera(t + dt, keys);
    return { vx: (b.x - a.x) / (2 * dt), vy: (b.y - a.y) / (2 * dt), vz: (b.zoom - a.zoom) / (2 * dt) };
  };

  const hexA = (hex, a) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  window.Studio.cine = { rig, flash, shake, ramp, swing, LOOKS, hexA };
})();
