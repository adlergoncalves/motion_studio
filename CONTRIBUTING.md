# Contributing

## Before opening a change

1. Keep scenes local and self-contained; do not add client or copyrighted production assets.
2. Do not introduce remote font, image, audio or API dependencies into the demo.
3. Preserve the `seek(t)` contract: frame output must derive from `t`, not mutable playback state.
4. Keep the shared runtime in `lib/`; new projects must not copy it.

## Verification

```bash
npm ci
npx playwright install chromium
npm test
npm run check:demo
node render.mjs projects/_template --stills 8
```

For renderer or visual changes, inspect the generated contact sheet and describe the expected visual delta in the pull request.

## Scope

Motion Studio is intentionally narrow: short motion graphics by code. New features should reinforce composition, preview, render correctness or delivery QA rather than turn the repository into an asset catalog, hosted editor or content-management system.
