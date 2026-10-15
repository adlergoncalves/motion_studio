# Cinematic language (`lib/cine.js`)

A flat background with text swapping in front of it reads as a slide, not as film. `lib/cine.js` adds the
four things that make short motion look shot rather than assembled: a camera that never stops, separate
depth planes, optics, and per-chapter grading. Everything stays a pure function of `t`.

Load it after `studio.js`:

```html
<script src="/lib/studio.js"></script>
<script src="/lib/gl.js"></script>
<script src="/lib/cine.js"></script>
```

## Rig

```js
const C = Studio.cine.rig(stage, { W, H, look: 'teal', vignette: 0.46, grain: 0.075 });
```

`look` is a grading preset: `neutral`, `noir`, `teal`, `print`, `ember`. Each defines the colour pushed into
the shadows (multiply), into the highlights (screen), vignette strength, grain amount and halation colour.

The rig builds, above the scene: grade layers, vignette, light leak, letterbox bars, flash frame and film grain.

## Depth planes

```js
const bg  = C.plate({ depth: 1.0, z: 0 });    // atmosphere — moves least
const mid = C.plate({ depth: 0.42, z: 20 });  // typography
const fg  = C.plate({ depth: 0.10, z: 40 });  // editorial frame — moves most
```

`depth` drives parallax and how much of the camera zoom each plane receives. Three planes is the minimum
for the frame to feel like it has air in it.

## Camera

```js
const CAM = [[0, 1.00, -30, 10], [2.45, 1.07, 34, -14], [9, 1.10, 0, 0]];  // Studio.camera keys
const cam = C.move(t, CAM, { handheld: 1, breath: 0.007 });
C.apply(bg.el,  cam, 1.0, { zoomK: 1.5 });
C.apply(mid.el, cam, 0.42);
C.apply(fg.el,  cam, 0.10, { parallax: 0.55 });
```

`move` adds deterministic handheld noise and a slow breathing zoom on top of the keyframed move. Size the
safe area for the largest zoom you reach (`layout(F).camSafe(zoomMax * 1.15)`), otherwise `--check` will
report text leaving the safe area at the end of the push-in.

## Optics

```js
C.smear(mid.el, px, angleDeg);   // shutter blur, driven by C.swing(t, CAM)
C.focus(fg.el, px);              // depth of field
C.halation(el, px);              // glow + contact shadow: separates type from the plate
C.render(t, { bars, grade, vignette, leak, flash, exposure, grain });
```

Call `C.render(t, ...)` once per `seek(t)`, after positioning everything.

Cut helpers: `Studio.cine.flash(t, at)` for a one-frame flash, `Studio.cine.shake(t, at, amp)` for an impact
kick, `Studio.cine.swing(t, keys)` for apparent camera speed.

## Budget

Shutter blur and depth of field are full-frame filters. On a 2 vCPU box they roughly halve throughput:
measure with `--draft` before committing to a long piece. Keep `smear` under ~3px — above that the type
stops being readable in a still, and stills are how clients review.

## Working reference

`projects/cine-demo` is the reference scene: volumetric haze shader on the back plate,
typography on the mid plate, editorial frame on the front plate, per-chapter grading, flash cuts and bars.
