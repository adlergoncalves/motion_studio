// Motion Studio — composição. Carregue depois de studio.js.
//
// cine.js cuida de como a peça é FILMADA (câmera, profundidade, óptica).
// compose.js cuida de como o quadro é CONSTRUÍDO: a parte onde mora a ideia.
// Óptica bonita sobre texto centralizado continua sendo um slide com grão.
//
// Primitivas, não presets fechados — combine para achar a direção da peça.
(function () {
  'use strict';
  const S = window.Studio;
  if (!S) throw new Error('compose.js precisa de studio.js carregado antes');
  const { clamp, prog, mix, noise1, E } = S;

  const el = (tag, parent, css = '') => {
    const n = document.createElement(tag);
    n.style.cssText = css;
    if (parent) parent.appendChild(n);
    return n;
  };

  /** Faixas: o quadro é fatiado em n tiras que deslizam independentes.
   *  Cada tira mostra a MESMA composição, recortada na sua altura — então quando todos os
   *  deslocamentos vão a zero, a imagem se remonta. Desalinhar e alinhar vira narrativa. */
  function slats(parent, { n = 5, W, H, z = 10, vertical = false } = {}) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const size = (vertical ? W : H) / n;
      const row = el('div', parent,
        vertical
          ? `position:absolute;top:0;left:${(i * size).toFixed(2)}px;width:${size.toFixed(2)}px;height:${H}px;overflow:hidden;z-index:${z}`
          : `position:absolute;left:0;top:${(i * size).toFixed(2)}px;width:${W}px;height:${size.toFixed(2)}px;overflow:hidden;z-index:${z}`);
      const inner = el('div', row,
        vertical
          ? `position:absolute;top:0;left:${(-i * size).toFixed(2)}px;width:${W}px;height:${H}px;will-change:transform`
          : `position:absolute;left:0;top:${(-i * size).toFixed(2)}px;width:${W}px;height:${H}px;will-change:transform`);
      rows.push({ el: row, inner, i });
    }
    return {
      rows,
      /** Preenche cada tira com um clone do bloco (o recorte é feito pelo overflow). */
      fill(node) {
        rows.forEach((r) => { r.inner.innerHTML = ''; r.inner.appendChild(node.cloneNode(true)); });
        return rows.map((r) => r.inner.firstElementChild);
      },
      shift(i, dx, dy = 0, extra = '') {
        rows[i].inner.style.transform = `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0)${extra ? ' ' + extra : ''}`;
      },
      /** Deslocamento por tira: amplitude que cai a zero em `at` (o instante do alinhamento). */
      converge(t, at, { amp = 1, dur = 0.9, ease = E.outExpo, seed = 1, dirs = null } = {}) {
        const k = 1 - ease(clamp(prog(t, at - dur, at)));
        return rows.map((r, i) => {
          const dir = dirs ? dirs[i % dirs.length] : (i % 2 ? 1 : -1);
          const spread = 0.45 + 0.55 * Math.abs(noise1(i * 1.7, seed));
          return dir * amp * spread * k;
        });
      },
    };
  }

  /** Recorte de papel: bloco sólido levemente torto, com sombra dura. Colagem, não caixa de texto. */
  function card(parent, { w, h = null, rot = -1.5, bg = '#f2efe6', ink = '#0b0b0b', z = 60, pad = null } = {}) {
    const p = pad === null ? Math.round(w * 0.085) : pad;
    const node = el('div', parent,
      `position:absolute;width:${w}px;${h ? `height:${h}px;` : ''}background:${bg};color:${ink};padding:${p}px;` +
      `box-shadow:${Math.round(w * 0.02)}px ${Math.round(w * 0.028)}px 0 rgba(0,0,0,.55);z-index:${z};transform-origin:50% 50%`);
    return {
      el: node,
      place(x, y, k = 1, extraRot = 0) {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.transform = `rotate(${(rot + extraRot).toFixed(2)}deg) scale(${k.toFixed(4)})`;
      },
    };
  }

  /** Risco sobre o texto: uma correção à vista, não uma transição. */
  function strike(parent, { color = '#e0301e', thickness = 10, z = 70 } = {}) {
    const line = el('div', parent, `position:absolute;height:${thickness}px;background:${color};transform-origin:left center;z-index:${z};pointer-events:none`);
    return {
      el: line,
      at(box, k, { tilt = -1.2 } = {}) {
        line.style.left = `${box.x}px`;
        line.style.top = `${box.y + box.h * 0.56}px`;
        line.style.width = `${box.w}px`;
        line.style.transform = `rotate(${tilt}deg) scaleX(${clamp(k).toFixed(3)})`;
        line.style.opacity = k > 0.001 ? '1' : '0';
      },
    };
  }

  /** Contador mecânico: números que não interpolam suave — eles batem. */
  const tick = (t, a, b, from, to, steps = null) => {
    const k = clamp(prog(t, a, b));
    const n = steps || Math.max(1, Math.round(Math.abs(to - from)));
    return Math.round(from + (to - from) * (Math.round(E.outExpo(k) * n) / n));
  };

  /** Régua de medida: marca de produção, dá escala e intenção ao quadro. */
  function ruler(parent, { W, y, ticks = 24, color = '#f2efe6', z = 65 } = {}) {
    const wrap = el('div', parent, `position:absolute;left:0;top:${y}px;width:${W}px;height:${Math.round(W * 0.03)}px;z-index:${z};opacity:.55`);
    for (let i = 0; i <= ticks; i++) {
      const big = i % 4 === 0;
      el('div', wrap, `position:absolute;left:${((i / ticks) * 100).toFixed(3)}%;top:0;width:2px;height:${big ? 100 : 45}%;background:${color}`);
    }
    return { el: wrap, reveal(k) { wrap.style.clipPath = `inset(0 ${(100 - clamp(k) * 100).toFixed(2)}% 0 0)`; } };
  }

  window.Studio.compose = { slats, card, strike, ruler, tick };
})();
