import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ANIMATIONS_TEMPLATE = `import { ImageSource, SpriteSheet, Animation, range } from "excalibur";
import sheetUrl from "__SHEET__";

export const heroImage = new ImageSource(sheetUrl);

export const heroSheet = SpriteSheet.fromImageSource({
  image: heroImage,
  grid: { rows: 1, columns: __COLUMNS__, spriteWidth: __W__, spriteHeight: __H__ },
});

export const heroAnimations = {
__ANIMATIONS__
};

export const heroAnchor = { x: __AX__, y: __AY__ };
`;

export const EMIT_VERSION = 1;

interface AnimMeta {
  row: number;
  startFrame: number;
  frameCount: number;
  frameDurationMs: number;
}

interface Metadata {
  image: string;
  frameWidth: number;
  frameHeight: number;
  anchor: { x: number; y: number };
  animations: Record<string, AnimMeta>;
}

export interface EmitInput {
  sheetPath: string;
  metadataPath: string;
  outputDir: string;
  previewTemplateDir: string;
}

export interface EmitOutput {
  animationsTsPath: string;
  sheetPath: string;
  metadataPath: string;
  previewDir: string;
}

function renderAnimations(metadata: Metadata): string {
  const lines: string[] = [];
  for (const [name, a] of Object.entries(metadata.animations)) {
    const end = a.startFrame + a.frameCount - 1;
    lines.push(`  ${name}: Animation.fromSpriteSheet(heroSheet, range(${a.startFrame}, ${end}), ${a.frameDurationMs}),`);
  }
  return lines.join("\n");
}

async function renderAnimationsTs(_templatePath: string, metadata: Metadata, sheetRelPath: string): Promise<string> {
  const total = Object.values(metadata.animations).reduce((n, a) => n + a.frameCount, 0);
  return ANIMATIONS_TEMPLATE
    .replaceAll("__SHEET__", sheetRelPath)
    .replaceAll("__COLUMNS__", String(total))
    .replaceAll("__W__", String(metadata.frameWidth))
    .replaceAll("__H__", String(metadata.frameHeight))
    .replaceAll("__ANIMATIONS__", renderAnimations(metadata))
    .replaceAll("__AX__", String(metadata.anchor.x))
    .replaceAll("__AY__", String(metadata.anchor.y));
}

export async function runEmit(input: EmitInput): Promise<EmitOutput> {
  const { sheetPath, metadataPath, outputDir, previewTemplateDir } = input;
  await mkdir(outputDir, { recursive: true });
  const metadata: Metadata = JSON.parse(await readFile(metadataPath, "utf8"));

  const outSheet = path.join(outputDir, path.basename(sheetPath));
  const outMeta = path.join(outputDir, path.basename(metadataPath));
  await copyFile(sheetPath, outSheet);
  await copyFile(metadataPath, outMeta);

  const animsTs = await renderAnimationsTs("", metadata, `./${path.basename(sheetPath)}`);
  const animsTsPath = path.join(outputDir, "animations.ts");
  await writeFile(animsTsPath, animsTs);

  const previewDir = path.join(outputDir, "preview");
  await cp(previewTemplateDir, previewDir, { recursive: true });
  await mkdir(path.join(previewDir, "src"), { recursive: true });
  await copyFile(outSheet, path.join(previewDir, "src", path.basename(sheetPath)));
  await writeFile(path.join(previewDir, "src", "animations.ts"), animsTs);

  return { animationsTsPath: animsTsPath, sheetPath: outSheet, metadataPath: outMeta, previewDir };
}
