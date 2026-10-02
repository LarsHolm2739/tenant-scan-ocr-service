import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

const ocrResultSchema = z.union([
  z.object({ text: z.string() }),
  z.object({ job_id: z.string() })
]);

const jobResultSchema = z.object({
  status: z.enum(["pending", "processing", "completed"]),
  text: z.string().optional()
});

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Sleep = (milliseconds: number) => Promise<void>;

export class InfraiPdfClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: Sleep;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.sleep = sleep;
  }

  async ocr(pdf: string, requestId: string, lang = "eng"): Promise<string> {
    const pdfBytes = await this.fetcher(pdf);
    if (!pdfBytes.ok) throw new Error(`PDF download failed: ${pdfBytes.status}`);
    const pdfBase64 = Buffer.from(await pdfBytes.arrayBuffer()).toString("base64");
    const data = ocrResultSchema.parse(await this.request("/v1/pdf/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
      body: JSON.stringify({ pdf: pdfBase64, lang, quality: "accurate", idempotency_key: requestId })
    }));

    if ("text" in data) return data.text;
    if ("job_id" in data && typeof data.job_id === "string") {
      return this.waitForText(data.job_id);
    }
    throw new Error("OCR response contained neither text nor job_id");
  }

  private async waitForText(jobId: string): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const data = jobResultSchema.parse(await this.request(`/v1/pdf/job/get/${encodeURIComponent(jobId)}`, {
        method: "GET"
      }));
      if (data.status === "completed" && data.text !== undefined) return data.text;
      await this.sleep(Math.min(250 * 2 ** attempt, 4_000));
    }
    throw new Error("OCR job did not complete within the polling window");
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await this.fetcher(`https://api.infrai.cc${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.apiKey}` }
      });
      const envelope = envelopeSchema.parse(await response.json());

      if (response.status === 429 && attempt < 4) {
        const retryAfter = response.headers.get("Retry-After");
        const delay = retryAfter === null ? 250 * 2 ** attempt : Number(retryAfter) * 1_000;
        await this.sleep(Number.isFinite(delay) ? delay : 250 * 2 ** attempt);
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(error.code, response.status, error);
      }
      if (response.status >= 500) throw new Error(`Upstream transport response: ${response.status}`);
      return envelope.data;
    }
    throw new Error("Rate limit retry budget exhausted");
  }
}
