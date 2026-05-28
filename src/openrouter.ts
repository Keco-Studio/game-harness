const API_BASE = "https://openrouter.ai/api/v1";

export class AuthError extends Error {}
export class RateLimitError extends Error {}
export class ServerError extends Error {}
export class ContentError extends Error {}

export interface OpenRouterOptions {
  apiKey?: string;
  maxRetries?: number;
  backoffBaseMs?: number;
}

interface ChatRequest {
  model: string;
  prompt: string;
  images?: string[];
  seed?: number;
}

interface ImageRequest {
  model: string;
  prompt: string;
  seed: number;
  referenceImage?: Buffer;
}

interface VideoRequest {
  model: string;
  prompt: string;
  seed: number;
  referenceImage: Buffer;
}

export class OpenRouter {
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(opts: OpenRouterOptions = {}) {
    const key = opts.apiKey ?? process.env["OPEN-ROUTER_KEY"];
    if (!key) throw new AuthError("OPEN-ROUTER_KEY env var not set");
    this.apiKey = key;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
  }

  async chat(req: ChatRequest): Promise<any> {
    const body = {
      model: req.model,
      messages: [{ role: "user", content: req.prompt }],
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    };
    return this.requestJson("/chat/completions", body);
  }

  async generateImage(req: ImageRequest): Promise<Buffer> {
    const content: any[] = [{ type: "text", text: req.prompt }];
    if (req.referenceImage) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${req.referenceImage.toString("base64")}` },
      });
    }
    const body = {
      model: req.model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
      seed: req.seed,
    };
    const json = await this.requestJson("/chat/completions", body);
    const image = this.extractImage(json);
    if (!image) throw new ContentError("No image returned from model");
    return image;
  }

  async generateVideo(req: VideoRequest): Promise<Buffer> {
    const body = {
      model: req.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${req.referenceImage.toString("base64")}` },
            },
          ],
        },
      ],
      modalities: ["video", "text"],
      seed: req.seed,
    };
    const json = await this.requestJson("/chat/completions", body);
    const url = this.extractVideoUrl(json);
    if (!url) throw new ContentError("No video URL returned from model");
    const res = await fetch(url);
    if (!res.ok) throw new ContentError(`Failed to download video: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private extractImage(json: any): Buffer | null {
    const msg = json?.choices?.[0]?.message;
    if (!msg) return null;
    const url: string | undefined =
      msg.images?.[0]?.image_url?.url ?? msg.images?.[0]?.url ?? msg.image_url ?? undefined;
    if (!url) return null;
    if (url.startsWith("data:")) {
      const b64 = url.split(",")[1];
      return Buffer.from(b64, "base64");
    }
    return null;
  }

  private extractVideoUrl(json: any): string | null {
    const msg = json?.choices?.[0]?.message;
    return msg?.videos?.[0]?.video_url?.url ?? msg?.video_url ?? null;
  }

  private async requestJson(path: string, body: unknown): Promise<any> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const reqId = res.headers.get("x-request-id") ?? "unknown";
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`OpenRouter auth failed (${res.status}) req=${reqId}`);
      }
      if (res.status === 429) {
        lastErr = new RateLimitError(`Rate limited req=${reqId}`);
      } else if (res.status >= 500) {
        lastErr = new ServerError(`OpenRouter ${res.status} req=${reqId}`);
      } else if (!res.ok) {
        const txt = await res.text();
        throw new ContentError(`OpenRouter ${res.status} req=${reqId}: ${txt}`);
      } else {
        return res.json();
      }
      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.backoffBaseMs * Math.pow(2, attempt)));
      }
    }
    throw lastErr ?? new ServerError("Unknown OpenRouter failure");
  }
}
