#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { OpenRouter } from "./openrouter.js";
import { FalClient } from "./fal.js";
import { runPipeline } from "./pipeline.js";

const program = new Command();
program
  .name("sprite-compiler")
  .description("Compile a character.yaml into an Excalibur.js spritesheet via OpenRouter")
  .version("0.1.0");

program
  .command("build")
  .argument("<config>", "path to character.yaml")
  .option("--force", "ignore cache and re-run all stages", false)
  .option("--work-dir <dir>", "intermediate artifact directory", "work")
  .option("--cache-dir <dir>", "cache directory", ".sprite-cache")
  .action(async (configPath: string, opts: { force: boolean; workDir: string; cacheDir: string }) => {
    try {
      const cfg = await loadConfig(configPath);
      const openRouter = new OpenRouter();
      const fal = new FalClient();
      const previewTemplateDir = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "preview",
      );
      const result = await runPipeline({
        config: cfg,
        workDir: opts.workDir,
        cacheDir: opts.force ? path.join(opts.cacheDir, `force-${Date.now()}`) : opts.cacheDir,
        previewTemplateDir,
        openRouter,
        fal,
        log: (line) => console.log(line),
      });
      console.log(`done → ${result.sheetPath}`);
      console.log(`      ${result.metadataPath}`);
      console.log(`      ${result.animationsTsPath}`);
      console.log(`      ${result.previewDir}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
