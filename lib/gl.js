// Motion Studio — camadas de shader (WebGL) controladas por t. Carregue depois de studio.js.
// O render liga a GPU (Metal no Mac); sem ela o Chromium usa SwiftShader (correto, mais lento).
//
//   const ink = Studio.gl.layer(stage, { W, H, frag: Studio.gl.INK, z: 50 });
//   ink.render({ uP: k, uOrigin: [x, y], uColor: hex('#135BEC') });   // dentro do seek
//
// Toda uniforme é função de t passada no render — nada de relógio interno.
(function () {
  'use strict';

  const HEADER = `precision highp float;
uniform vec2 uRes;
uniform float uTime;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
// coordenadas em px com origem no canto superior esquerdo (igual ao DOM)
vec2 px(){ return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); }
`;

  /** Tinta que inunda a partir de um ponto, com borda orgânica (domain warp).
   *  uP 0..1 (cobertura), uOrigin px, uColor rgb 0..1, uWarp (0.15), uScale (2.5), uLinear: 0 radial / 1 de baixo p/ cima */
  const INK = `${HEADER}
uniform float uP; uniform vec2 uOrigin; uniform vec3 uColor; uniform float uWarp; uniform float uScale; uniform float uLinear;
void main(){
  vec2 p = px();
  vec2 q = p / uRes.y * uScale;
  float w = fbm(q + fbm(q + uTime * 0.15) * 1.6);
  float R = max(max(length(uOrigin), length(uOrigin - vec2(uRes.x, 0.0))), max(length(uOrigin - vec2(0.0, uRes.y)), length(uOrigin - uRes)));
  float d = mix(length(p - uOrigin) / R, 1.0 - p.y / uRes.y, uLinear);
  float edge = uP * (1.0 + 2.0 * uWarp) - uWarp;           // garante 0 = vazio e 1 = cheio
  float v = d + (w - 0.5) * 2.0 * uWarp;
  float aa = 1.5 / uRes.y;
  float a = 1.0 - smoothstep(edge - aa, edge + aa, v);
  gl_FragColor = vec4(uColor * a, a);
}`;

  /** Campo de cor com matéria: duas cores da marca misturadas por ruído lento + grão.
   *  uA, uB rgb; uAmount 0..1 (quanto de uB); uScale (1.2); uGrain (0.04) */
  const FIELD = `${HEADER}
uniform vec3 uA; uniform vec3 uB; uniform float uAmount; uniform float uScale; uniform float uGrain;
void main(){
  vec2 p = px();
  vec2 q = p / uRes.y * uScale;
  float n = fbm(q + vec2(uTime * 0.05, -uTime * 0.03) + fbm(q * 1.7 - uTime * 0.04));
  vec3 c = mix(uA, uB, smoothstep(0.35, 0.75, n) * uAmount);
  float g = hash(p + floor(uTime * 24.0) * 13.7) - 0.5;
  gl_FragColor = vec4(c + g * uGrain, 1.0);
}`;

  /** Retícula (halftone) de uma imagem: pontos na cor da tinta sobre o papel.
   *  uImg (textura), uRect [x,y,w,h] px onde a imagem fica, uCell px, uInk/uPaper rgb,
   *  uMix 0 = só pontos, 1 = imagem original; uAngle rad */
  const HALFTONE = `${HEADER}
uniform sampler2D uImg; uniform vec4 uRect; uniform float uCell; uniform vec3 uInk; uniform vec3 uPaper; uniform float uMix; uniform float uAngle;
void main(){
  vec2 p = px();
  vec2 uv = (p - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  mat2 r = mat2(cos(uAngle), -sin(uAngle), sin(uAngle), cos(uAngle));
  vec2 g = r * p / uCell;
  vec2 cell = floor(g) + 0.5;
  vec2 center = (transpose(r) * cell) * uCell;
  vec3 src = texture2D(uImg, (center - uRect.xy) / uRect.zw).rgb;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float rad = sqrt(1.0 - lum) * 0.62;
  float d = length(g - cell);
  float dot_ = 1.0 - smoothstep(rad - 0.06, rad + 0.06, d);
  vec3 ht = mix(uPaper, uInk, dot_);
  vec3 photo = texture2D(uImg, uv).rgb;
  gl_FragColor = vec4(mix(ht, photo, uMix), 1.0);
}`.replace('transpose(r)', 'mat2(r[0][0], r[1][0], r[0][1], r[1][1])');

  const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

  /** Cria uma camada <canvas> com um fragment shader. Devolve { el, render(uniforms), texture(name, img) }. */
  function layer(parent, { W, H, frag, z = 0, style = '' }) {
    const el = document.createElement('canvas');
    el.width = W; el.height = H;
    el.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z};${style}`;
    parent.appendChild(el);
    const gl = el.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error('WebGL indisponível');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const textures = {};
    const set = (name, v) => {
      const u = gl.getUniformLocation(prog, name);
      if (!u) return;
      if (name in textures) { gl.activeTexture(gl.TEXTURE0 + textures[name].unit); gl.bindTexture(gl.TEXTURE_2D, textures[name].tex); gl.uniform1i(u, textures[name].unit); return; }
      if (typeof v === 'number') gl.uniform1f(u, v);
      else if (v.length === 2) gl.uniform2fv(u, v);
      else if (v.length === 3) gl.uniform3fv(u, v);
      else if (v.length === 4) gl.uniform4fv(u, v);
    };
    return {
      el,
      /** Imagem já decodificada (await img.decode() no ready). */
      texture(name, img) {
        const tex = gl.createTexture();
        const unit = Object.keys(textures).length;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        textures[name] = { tex, unit };
      },
      /** Desenha um quadro. Passe uTime = t (ou um múltiplo) e as uniformes do shader. */
      render(uniforms = {}) {
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        set('uRes', [W, H]);
        for (const [k, v] of Object.entries({ uTime: 0, uWarp: 0.15, uScale: 2.5, uLinear: 0, uGrain: 0.04, uMix: 0, uAngle: 0.26, ...uniforms })) set(k, v);
        for (const name of Object.keys(textures)) set(name);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
    };
  }

  /** '#135BEC' → [r, g, b] em 0..1 */
  const rgb = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  window.Studio = window.Studio || {};
  window.Studio.gl = { layer, rgb, INK, FIELD, HALFTONE, HEADER };
})();
