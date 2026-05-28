const QUEUE_BASE = "https://queue.fal.run";

export class FalError extends Error {}

export interface FalClientOptions {
  apiKey?: string;
  pollIntervalMs?: number;
}

export class FalClient {
  private readonly apiKey: string;
  private readonly pollIntervalMs: number;

  constructor(opts: FalClientOptions = {}) {
    const key = opts.apiKey ?? process.env["FAL-KEY"];
    if (!key) throw new FalError("FAL-KEY env var not set");
    this.apiKey = key;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3000;
  }

  async imageToVideo(req: {
    modelId: string;
    prompt: string;
    imageUrl: string;
    seed: number;
    resolution?: string;
    duration?: string;
  }): Promise<Buffer> {
    const submitRes = await fetch(`${QUEUE_BASE}/${req.modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_url: req.imageUrl,
        seed: req.seed,
        resolution: req.resolution ?? "720p",
        duration: req.duration ?? "auto",
        generate_audio: false,
      }),
    });

    if (!submitRes.ok) {
      const txt = await submitRes.text();
      throw new FalError(`fal submit ${submitRes.status}: ${txt}`);
    }

    const { status_url, response_url } = (await submitRes.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };

    // poll until complete
    while (true) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      const statusRes = await fetch(status_url, {
        headers: { Authorization: `Key ${this.apiKey}` },
      });
      if (!statusRes.ok) {
        const txt = await statusRes.text();
        throw new FalError(`fal status ${statusRes.status}: ${txt}`);
      }
      const status = (await statusRes.json()) as { status: string };
      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED") throw new FalError("fal job failed");
    }

    const resultRes = await fetch(response_url, {
      headers: { Authorization: `Key ${this.apiKey}` },
    });
    if (!resultRes.ok) {
      const txt = await resultRes.text();
      throw new FalError(`fal result ${resultRes.status}: ${txt}`);
    }
    const result = (await resultRes.json()) as { video: { url: string } };
    if (!result.video?.url) throw new FalError("fal result missing video URL");

    const videoRes = await fetch(result.video.url);
    if (!videoRes.ok) throw new FalError(`fal video download ${videoRes.status}`);
    return Buffer.from(await videoRes.arrayBuffer());
  }

  // Upload a buffer as a data URL for use as image_url
  async uploadImage(imageBytes: Buffer, mimeType = "image/png"): Promise<string> {
    const b64 = imageBytes.toString("base64");
    return `data:${mimeType};base64,${b64}`;
  }
}
