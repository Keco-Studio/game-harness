import { Cache } from "./cache.js";
import type { Config } from "./config.js";
import { runReference } from "./stages/reference.js";
import { runVideo } from "./stages/video.js";
import { runExtract, FfmpegRunner, ProbeRunner } from "./stages/extract.js";
import { runClean } from "./stages/clean.js";
import { runPack, PackAction } from "./stages/pack.js";
import { runEmit } from "./stages/emit.js";

export interface PipelineInput {
  config: Config;
  workDir: string;
  cacheDir: string;
  previewTemplateDir: string;
  openRouter: {
    generateImage(req: { model: string; prompt: string; seed: number }): Promise<Buffer>;
  };
  fal: {
    uploadImage(bytes: Buffer, mime?: string): Promise<string>;
    imageToVideo(req: {
      modelId: string;
      prompt: string;
      imageUrl: string;
      seed: number;
      resolution?: string;
      duration?: string;
    }): Promise<Buffer>;
  };
  ffmpeg?: FfmpegRunner;
  probe?: ProbeRunner;
  log?: (line: string) => void;
}

export interface PipelineResult {
  sheetPath: string;
  metadataPath: string;
  animationsTsPath: string;
  previewDir: string;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const log = input.log ?? (() => {});
  const cache = new Cache(input.cacheDir);
  const charWorkDir = `${input.workDir}/${input.config.character.name}`;

  const t0 = Date.now();
  const ref = await runReference({
    character: input.config.character,
    workDir: charWorkDir,
    cache,
    openRouter: input.openRouter,
  });
  log(`[reference] ${input.config.character.name} ${ref.cached ? "cached" : "running"} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const packActions: PackAction[] = [];
  for (const action of input.config.actions) {
    const tv = Date.now();
    const vid = await runVideo({
      characterName: input.config.character.name,
      action,
      referenceBytes: ref.bytes,
      workDir: charWorkDir,
      cache,
      fal: input.fal,
    });
    log(`[video] ${action.name} ${vid.cached ? "cached" : "running"} (${((Date.now() - tv) / 1000).toFixed(1)}s)`);

    const te = Date.now();
    const ex = await runExtract({
      videoPath: vid.path,
      actionName: action.name,
      frameCount: action.frameCount,
      workDir: charWorkDir,
      cache,
      ffmpeg: input.ffmpeg,
      probeFrameCount: input.probe,
    });
    log(`[extract] ${action.name} ${ex.cached ? "cached" : "running"} (${((Date.now() - te) / 1000).toFixed(1)}s)`);

    const tc = Date.now();
    const cl = await runClean({
      frames: ex.frames,
      actionName: action.name,
      workDir: charWorkDir,
      cache,
      output: input.config.output,
    });
    log(`[clean] ${action.name} ${cl.cached ? "cached" : "running"} (${((Date.now() - tc) / 1000).toFixed(1)}s)`);

    packActions.push({ name: action.name, frames: cl.frames, frameDurationMs: action.frameDurationMs });
  }

  const tp = Date.now();
  const packed = await runPack({
    characterName: input.config.character.name,
    actions: packActions,
    workDir: charWorkDir,
    output: input.config.output,
  });
  log(`[pack] ${input.config.character.name} running (${((Date.now() - tp) / 1000).toFixed(1)}s)`);

  const tm = Date.now();
  const emitted = await runEmit({
    sheetPath: packed.sheetPath,
    metadataPath: packed.metadataPath,
    outputDir: input.config.output.directory,
    previewTemplateDir: input.previewTemplateDir,
  });
  log(`[emit] ${input.config.character.name} running (${((Date.now() - tm) / 1000).toFixed(1)}s)`);

  return {
    sheetPath: emitted.sheetPath,
    metadataPath: emitted.metadataPath,
    animationsTsPath: emitted.animationsTsPath,
    previewDir: emitted.previewDir,
  };
}
