import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runEmit } from "../../src/stages/emit.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "emit-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("runEmit", () => {
  it("writes sheet, metadata, animations.ts, and preview scaffold", async () => {
    const sheetSrc = path.join(dir, "hero.png");
    const metaSrc = path.join(dir, "hero.json");
    await writeFile(sheetSrc, Buffer.from([1, 2, 3]));
    const metadata = {
      image: "hero.png",
      frameWidth: 64,
      frameHeight: 64,
      anchor: { x: 0.5, y: 0.9375 },
      animations: {
        idle:   { row: 0, startFrame: 0, frameCount: 8, frameDurationMs: 125 },
        run:    { row: 0, startFrame: 8, frameCount: 8, frameDurationMs: 80 },
        attack: { row: 0, startFrame: 16, frameCount: 8, frameDurationMs: 60 },
      },
    };
    await writeFile(metaSrc, JSON.stringify(metadata));

    const outDir = path.join(dir, "out");
    await runEmit({
      sheetPath: sheetSrc,
      metadataPath: metaSrc,
      outputDir: outDir,
      previewTemplateDir: path.join(process.cwd(), "preview"),
    });

    const files = await readdir(outDir);
    expect(files).toEqual(expect.arrayContaining(["hero.png", "hero.json", "animations.ts", "preview"]));
    const animsTs = await readFile(path.join(outDir, "animations.ts"), "utf8");
    expect(animsTs).toContain("range(0, 7)");
    expect(animsTs).toContain("range(8, 15)");
    expect(animsTs).toContain("range(16, 23)");
    expect(animsTs).toContain('"./hero.png"');
    expect(animsTs).toContain("x: 0.5");

    const previewMain = await readFile(path.join(outDir, "preview", "src", "main.ts"), "utf8");
    expect(previewMain).toContain("heroAnimations");

    const previewAnims = await readFile(path.join(outDir, "preview", "src", "animations.ts"), "utf8");
    expect(previewAnims).toContain("heroAnimations");
  });
});
