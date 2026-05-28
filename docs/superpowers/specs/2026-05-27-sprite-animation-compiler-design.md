# AI Game Sprite Animation Compiler for Excalibur.js — Design

**Date:** 2026-05-27
**Status:** Draft for review
**Scope:** MVP

## Product Summary

A Node.js CLI (`sprite-compiler`) that turns a declarative `character.yaml` into a game-ready Excalibur.js spritesheet. It uses OpenRouter to call OpenAI's image model (`openai/gpt-5.4-image-2`) for character references and ByteDance Seed (`bytedance-seed/seed-2.0-lite`) for short motion drafts, then extracts, cleans, and packs the frames into a standard horizontal strip with a metadata JSON and generated Excalibur animation code. A Vite + Excalibur preview app lets the developer see the animations looping in a browser immediately.

## MVP Scope

- **Characters:** one
- **Actions:** `idle`, `run`, `attack`
- **Direction:** facing right only
- **Frame size:** 64 × 64 px, RGBA, anchored at feet-center (anchor `(0.5, 0.9375)` of the cell)
- **Frames per action:** 8 (uniform sampling)
- **Outputs:** `hero.png` (spritesheet), `hero.json` (metadata), `animations.ts` (Excalibur code), `preview/` (runnable Vite scene)

Explicitly out of scope for MVP: multiple directions, multiple characters per config, walk cycles beyond run, palette quantization, normal maps, sprite atlases (multi-row packing), per-frame hitboxes.

## User Workflow

```
$ export OPEN-ROUTER_KEY=sk-or-v1-...
$ sprite-compiler build character.yaml
[reference] hero       running (4.2s)
[video]     idle       running (38.1s)
[video]     run        running (41.7s)
[video]     attack     running (36.5s)
[extract]   idle       running (0.4s)
[extract]   run        running (0.4s)
[extract]   attack     running (0.4s)
[clean]     idle       running (1.1s)
[clean]     run        running (1.2s)
[clean]     attack     running (1.0s)
[pack]      hero       running (0.3s)
[emit]      hero       running (0.1s)
done → out/

$ cd out/preview && npm install && npm run dev
# browser opens, character loops through idle/run/attack with buttons to switch
```

Re-running `sprite-compiler build character.yaml` after only changing post-processing logic reuses the cached video downloads. `--force` re-runs everything.

## Configuration

`character.yaml`:

```yaml
character:
  name: hero
  reference:
    prompt: >
      Pixel art knight character, side view facing right, full body,
      simple armor, sword on hip, neutral pose, T-pose stance,
      solid magenta #FF00FF background, no shadow, no ground.
    seed: 42

actions:
  - name: idle
    prompt: >
      Pixel art knight breathing idle animation, side view facing right,
      subtle chest rise and fall, sword on hip, feet planted,
      solid magenta #FF00FF background.
    frameCount: 8
    frameDurationMs: 125
    seed: 100

  - name: run
    prompt: >
      Pixel art knight running cycle, side view facing right,
      arms swinging, full stride, solid magenta #FF00FF background.
    frameCount: 8
    frameDurationMs: 80
    seed: 101

  - name: attack
    prompt: >
      Pixel art knight sword slash attack, side view facing right,
      windup to follow-through, solid magenta #FF00FF background.
    frameCount: 8
    frameDurationMs: 60
    seed: 102

output:
  frameWidth: 64
  frameHeight: 64
  anchor: { x: 0.5, y: 0.9375 }
  backgroundKey: "#FF00FF"
  backgroundTolerance: 24
  directory: out
```

## Architecture

A single Node.js process runs a linear pipeline of six stages, one stage per `(character, action)` pair. Each stage:

- has a `version` constant — bumping invalidates downstream cache
- takes typed input and produces typed output plus on-disk artifacts
- is content-addressed: cache key = `hash(stage, version, input)`

```
character.yaml
      │
      ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────┐    ┌──────────────┐
│ 1. Reference│ →  │ 2. Video    │ →  │ 3. Frame    │ →  │ 4. Clean   │ →  │ 5. Pack  │ →  │ 6. Emit code │
│   (Image 2) │    │  (Seedance) │    │   extract   │    │  + align   │    │  sheet   │    │  + preview   │
└─────────────┘    └─────────────┘    └─────────────┘    └────────────┘    └──────────┘    └──────────────┘
```

### Stages

1. **Reference** — POST to OpenRouter `openai/gpt-5.4-image-2` with `character.reference.prompt + seed`. Save PNG to `work/<char>/01-reference/<char>.png`. Runs once per character; reused across actions.
2. **Video** — POST to OpenRouter `bytedance-seed/seed-2.0-lite` with the action prompt plus the reference image as multimodal input. Save MP4 to `work/<char>/02-video/<action>.mp4`.
3. **Extract** — `ffmpeg -i <action>.mp4 -vf "select='not(mod(n,STEP))'" -vsync 0 frame-%03d.png` with `STEP` computed so we land on `frameCount` evenly spaced frames. Output to `work/<char>/03-raw-frames/<action>/`.
4. **Clean** — for each raw frame, with `sharp`:
   - Chroma-key: pixels within `backgroundTolerance` of `backgroundKey` → alpha 0.
   - Alpha-bbox crop.
   - If bbox > target cell, scale to fit; otherwise leave at native size.
   - Composite onto a 64×64 transparent canvas at `(centerX, anchorY - bboxHeight)` so the bottom-center of the character bbox lands at the configured anchor pixel.
   - Save to `work/<char>/04-clean-frames/<action>/frame-NNN.png`.
   - Skip frames whose bbox is smaller than 8 × 8 px (background-removal failed). If > 25% of an action's frames are skipped, fail with a hint.
5. **Pack** — composite all clean frames for all actions into one horizontal strip `work/<char>/05-sheets/<char>.png` (order: `idle`, `run`, `attack`, by action declaration order in the config). Emit `<char>.json` (see Metadata schema below).
6. **Emit** — render `out/animations.ts` from a string template using the metadata. Copy the checked-in `preview/` Vite scaffold to `out/preview/` and import the generated animations.

### Components (file layout)

```
src/
  cli.ts              # commander: `build <config>`, --force
  config.ts           # Zod schemas: Character, Action, Output
  pipeline.ts         # orchestrator; cache lookup/store protocol
  cache.ts            # content-addressed file cache under .sprite-cache/
  openrouter.ts       # single HTTP client; OPEN-ROUTER_KEY env; typed errors
  stages/
    reference.ts
    video.ts
    extract.ts
    clean.ts
    pack.ts
    emit.ts
  templates/
    animations.ts.tmpl
preview/              # checked-in Vite + Excalibur scaffold, copied to out/preview/
  index.html
  package.json
  src/main.ts
test/
  fixtures/
  *.test.ts
```

## Data Contracts

### Metadata JSON

The contract between `pack` and `emit`. Any hand-authored spritesheet matching this schema works with the generated code path.

```json
{
  "image": "hero.png",
  "frameWidth": 64,
  "frameHeight": 64,
  "anchor": { "x": 0.5, "y": 0.9375 },
  "animations": {
    "idle":   { "row": 0, "startFrame": 0,  "frameCount": 8, "frameDurationMs": 125 },
    "run":    { "row": 0, "startFrame": 8,  "frameCount": 8, "frameDurationMs": 80 },
    "attack": { "row": 0, "startFrame": 16, "frameCount": 8, "frameDurationMs": 60 }
  }
}
```

### Generated `animations.ts` (shape)

```ts
import { ImageSource, SpriteSheet, Animation, range } from "excalibur";
import sheetUrl from "./hero.png";

export const heroImage = new ImageSource(sheetUrl);

export const heroSheet = SpriteSheet.fromImageSource({
  image: heroImage,
  grid: { rows: 1, columns: 24, spriteWidth: 64, spriteHeight: 64 },
});

export const heroAnimations = {
  idle:   Animation.fromSpriteSheet(heroSheet, range(0, 7),   125),
  run:    Animation.fromSpriteSheet(heroSheet, range(8, 15),  80),
  attack: Animation.fromSpriteSheet(heroSheet, range(16, 23), 60),
};

export const heroAnchor = { x: 0.5, y: 0.9375 };
```

### Preview scene

`out/preview/src/main.ts` constructs an Excalibur `Engine`, an `Actor` using `heroAnimations.idle`, and three on-screen buttons (HTML overlay) that swap the active animation. Anchor applied via `actor.anchor`.

## Caching

- Location: `.sprite-cache/<sha256-of-key>` next to a `meta.json` describing what produced it.
- Key inputs hashed as canonical JSON: `{stage, version, ...stageInputs}`.
- Upstream artifact hashes are part of downstream keys, so editing a stage's logic and bumping its `version` invalidates only that stage + downstream.
- `--force` ignores cache reads but still writes.
- Corrupt cache entries are treated as misses, never crash.

## Error Handling

- **Config:** Zod errors print YAML path + expected; exit 1 before any API call.
- **OpenRouter:** typed errors — `AuthError` (401/403, no retry), `RateLimitError` (429, exponential backoff up to 3 tries), `ServerError` (5xx, 3 retries), `ContentError` (2xx but missing image/video URL, no retry). All include OpenRouter `x-request-id`.
- **Missing ffmpeg:** detected at startup with `ffmpeg -version`; clear install message if absent.
- **Empty frames after clean:** drop and warn; > 25 % drop rate in an action fails the action with a hint to tighten the background-color prompt or raise `backgroundTolerance`.
- Logs use `[stage] [action] cached|running (Xs)` so failures localize.

## Testing

- **Unit (vitest):**
  - `config.ts` — good / bad YAML samples
  - `cache.ts` — hash determinism, miss-then-hit, corruption → miss
  - `clean.ts` — chroma-key + anchor placement on synthetic fixtures (a magenta square with a coloured rectangle in known positions)
  - `pack.ts` — strip dimensions and frame ordering
  - `emit.ts` — snapshot the generated TS from a fixed metadata fixture
- **Integration:** full pipeline with `openrouter.ts` and `ffmpeg` mocked; asserts artifact tree + metadata shape.
- **Smoke (manual, not CI):** `make smoke` against real OpenRouter with a tiny fixture character. Cost-bounded by being a single short action.
- **Excluded:** no automated test of the running Excalibur preview — that's the human visual check.

## Dependencies

- **Runtime:** Node ≥ 20, ffmpeg on PATH.
- **npm:**
  - `commander` — CLI
  - `zod` — config schema
  - `yaml` — config parsing
  - `sharp` — image processing
  - `undici` — HTTP (built into Node, used via fetch)
- **Dev:** `typescript`, `vitest`, `@types/node`.
- **Preview app:** `vite`, `excalibur`.

## Non-Goals (MVP)

- Multi-direction sprites (left/up/down). Achievable later by mirroring + separate prompts; needs row-based packing.
- Multiple characters per config.
- Pose-detection or perceptual-hash frame selection.
- Background removal via ML (rembg/U²-Net).
- Sprite atlas tooling (TexturePacker-style multi-row).
- Palette quantization or pixel-art snap.
- Hot reload between the pipeline and the preview app (manual refresh is fine).
