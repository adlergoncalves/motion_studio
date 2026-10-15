# Composition (`lib/compose.js`)

`cine.js` controls how a piece is *shot*. `compose.js` controls how the frame is *built* — which is where
the idea lives. Grain, vignette and a slow push-in on top of centred text still reads as a slide with grain.

Load it after `studio.js` (order against `cine.js` does not matter):

```html
<script src="/lib/studio.js"></script>
<script src="/lib/cine.js"></script>
<script src="/lib/compose.js"></script>
```

## Slats — the frame as strips

```js
const sl = slats(plate.el, { n: 8, W, H });
const clones = sl.fill(field);                       // same composition cloned into every strip
const offs = sl.converge(t, 1.7, { amp: W * 0.92 }); // amplitude decays to zero at the beat
clones.forEach((c, i) => sl.shift(i, Math.round(offs[i])));
```

Each strip clips the same composition at its own height, so when every offset reaches zero the image
reassembles itself. Misalignment becomes narrative: the sentence only exists when the strips stop fighting.

Round the offsets. Fractional translation on large type rasterises differently between Chromium tabs, and
the renderer uses one tab per segment.

## Card — collage, not a text box

```js
const c = card(plate.el, { w: W * 0.62, rot: -2.2, bg: '#f2efe6', ink: '#0b0b0b' });
c.place(x, y, scale, extraRot);
```

Solid block, slightly crooked, hard offset shadow. It reads as paper dropped on the frame.

## Strike, ruler, tick

- `strike(parent, { color })` → `.at(box, k)`: a correction made in front of the viewer, not a transition.
- `ruler(parent, { W, y, ticks })` → `.reveal(k)`: production mark that gives the frame scale and intent.
- `tick(t, a, b, from, to, steps)`: counters that land on a value instead of interpolating smoothly.

## Rules learned while building this

- Vary the framing between beats. Four centred boxes in a row is a slide deck, whatever the optics.
- Change the framing through **integer font size**, not through `scale()` on the element: large type under a
  fractional scale rasterises differently between tabs and shimmers at segment boundaries.
- Use `cine.apply(el, cam, depth, { snap: true })` for any plane carrying text.
- A scene with a large high-contrast type field should render with `--workers 1`.

## Working reference

`projects/alinhamento` (10s, 9:16): type field three screens wide, eight strips, four alignments, red
correction marks and a paper card at the close.
