# sprite-compiler

Turns a `character.yaml` into an Excalibur.js spritesheet, metadata JSON,
animation code, and a runnable preview app — using OpenRouter
(`openai/gpt-5.4-image-2` + `bytedance-seed/seed-2.0-lite`) for AI generation.

## Requirements

- Node ≥ 20
- `ffmpeg` and `ffprobe` on PATH
- `OPEN-ROUTER_KEY` env var

## Install

```bash
npm install
npm run build
```

## Use

```bash
node --env-file=.env dist/cli.js build examples/character.yaml
```

Outputs land in `./out/`:

- `hero.png` — spritesheet
- `hero.json` — metadata
- `animations.ts` — generated Excalibur code
- `preview/` — runnable Vite + Excalibur scene

```bash
cd out/preview
npm install
npm run dev
```

Open `http://localhost:5173` to see the idle / run / attack cycle.

## How it works

Six-stage pipeline; each stage is content-addressed and cached under
`.sprite-cache/`. Re-running after only changing post-processing
reuses the API outputs.

1. **Reference** — Image 2 generates a side-view character reference.
2. **Video** — Seedance generates a short motion draft from the reference + prompt.
3. **Extract** — ffmpeg samples N evenly spaced frames.
4. **Clean** — chroma-key removes the magenta background; alpha-bbox crop;
   place at feet-center on a 64 × 64 transparent canvas.
5. **Pack** — composite all action frames into one horizontal strip.
6. **Emit** — render `animations.ts` and copy the preview scaffold.

Pass `--force` to ignore the cache.

## Limits (MVP)

- One character per config
- Three actions: `idle`, `run`, `attack`
- Single direction (facing right)
- 64 × 64 frames
- Uniform frame sampling; no pose-aware selection
