# Motion Studio

A local, code-first toolkit for short motion graphics. A scene is an `index.html` whose visual state is defined by time; Motion Studio previews it in Chromium and renders frame-by-frame with Playwright and FFmpeg.

It is intentionally a toolkit, not a hosted editor, asset library, campaign manager, or full post-production suite.

## What it does

- Preview a deterministic `seek(t)` scene with a timeline player.
- Render MP4, social variants, stills, covers, thumbnails and ProRes 4444 alpha overlays.
- Validate scene behavior before delivery: deterministic frame seeking, unsafe text placement, too-small text, missing fonts, network requests and loop continuity.
- Generate contact sheets, beat-based review frames, frame strips and one-frame pop reports.
- Share one runtime kit across projects: `lib/` is never copied into new projects.

## Requirements

- Node.js 20+
- FFmpeg and FFprobe on `PATH`
- Chromium installed by Playwright

## Quick start

```bash
npm ci
npx playwright install chromium
npm test
npm run check:demo
node render.mjs projects/_template --stills 8
node render.mjs projects/_template --format all --social
```

The demo outputs to `projects/_template/out/`, which is ignored by Git.

## Create a scene

```bash
node tools/new.mjs launch-card
node tools/preview.mjs projects/launch-card
node render.mjs projects/launch-card --check
node render.mjs projects/launch-card --stills 8
node render.mjs projects/launch-card --format all --social
```

Projects use the shared `/lib` runtime. That avoids duplicated fonts and runtime code; update the kit once and validate all active projects before delivery.

## Scene contract

A scene must register a time-driven contract:

```js
Studio.define({
  width: 1920,
  height: 1080,
  duration: 8,
  fps: 30,
  formats: ['16x9', '9x16'],
  seek(t) {
    // Set every visible state from t.
  },
});
```

`seek(t)` must be pure: the same time should produce the same frame regardless of seek order. Do not use wall-clock time, timers, uncontrolled video playback, remote resources, or mutable state that survives a frame.

## Commands

```bash
node tools/preview.mjs projects/<name>
node render.mjs projects/<name> --check
node render.mjs projects/<name> --stills 8
node render.mjs projects/<name> --at 1.0,1.5,2.0
node render.mjs projects/<name> --format 16x9,9x16 --social
node render.mjs projects/<name> --alpha
node render.mjs projects/<name> --range 4,7
```

Run `node render.mjs` without arguments for the complete CLI reference.

## Project layout

```text
lib/                   shared runtime, WebGL helpers and bundled fonts
projects/_template/    runnable demo and source template
templates/              project brief template
tools/                  preview, media and QA utilities
render.mjs              renderer and validation CLI
test/                   Node test suite
```

Do not commit client footage, voices, screenshots, brands, renders, caches, API credentials or copyrighted reference collections. Keep those in a private production workspace.

## Output and limits

Motion Studio is designed for short, code-driven graphics. It does not replace a non-linear editor or a color-managed finishing workflow. Validate the actual output for the destination platform; the renderer's checks are safeguards, not a substitute for human creative review.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Please include a reproducible scene or test with renderer changes.

## License

MIT. Bundled font notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
