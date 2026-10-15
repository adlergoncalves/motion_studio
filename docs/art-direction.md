# Art direction before code

A scene starts as a direction sheet and a script, never as an empty `index.html`.

## 1. Script gate

```bash
node tools/plan.mjs projects/<name>            # creates roteiro.md from templates/roteiro.md
node tools/plan.mjs projects/<name> --check    # fails while the plan is still boilerplate
```

`roteiro.md` holds the promise, the narration line by line, every on-screen block, the chapter map and the
per-chapter camera and optics direction. The check is part of delivery: a piece whose plan never closed is a
piece whose copy was improvised inside the renderer.

## 2. Direction sheet

Motion Studio does not vendor third-party design skills — they carry their own licences and live in their own
repositories. Link them instead, into `.claude/skills/` (ignored by Git):

```bash
mkdir -p .claude/skills
ln -s /path/to/taste-skill/skills/taste-skill            .claude/skills/taste-skill
ln -s /path/to/agent-skills/skills/web-design-guidelines .claude/skills/web-design-guidelines
ln -s /path/to/taste-skill/skills/imagegen-frontend-web  .claude/skills/imagegen-frontend-web
```

Draw a sheet and adopt it whole, instead of diluting it with the layout you would have made anyway:

```bash
node .claude/skills/taste-skill/scripts/draw.mjs --sector <sector>
```

## 3. Translating a web sheet to motion

These references are written for web pages. The mapping:

| On the sheet | In motion |
|---|---|
| viewport / `vw` | frame / fraction of `W` |
| scroll | time, `seek(t)` |
| page sections | chapters of the piece |
| hover and scroll-driven motion | `camera`, `punch`, `drift`, `rise`, `split`, `flood`, `cine.rig` |
| photography floor | does not transfer — a short piece lives on type, colour and movement |

Transfers directly: the central idea, the composition logic (scale, position, asymmetry), the type system
(one family, five steps, tuned tracking and leading), the palette (one ground, one ink, one accent) and the
motion recipe.

Does not transfer: required real photography, nav, CTA, SEO, footer blueprint.

## 4. House rule

Three centred phrases swapping blocks is not art direction. If the piece has no idea, no composition and no
movement of its own, it is not ready — see `docs/cinematic-language.md` for the camera, depth and optics layer.
