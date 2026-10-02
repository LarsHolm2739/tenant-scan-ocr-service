import { z } from "zod";

export const onboardingBodySchema = z.object({
  tenantId: z.string().min(1),
  displayName: z.string().min(1),
  adminEmail: z.string().email()
}).strict();

export const documentBodySchema = z.object({
  documentId: z.string().min(1),
  pdf: z.string().min(1),
  lang: z.string().min(2).optional()
}).strict();

export const accountBodySchema = z.object({
  status: z.enum(["active", "suspended", "closed"])
}).strict();

type AccountStatus = z.infer<typeof accountBodySchema>["status"];
type Tenant = z.infer<typeof onboardingBodySchema> & { status: AccountStatus };
export type SearchableDocument = {
  tenantId: string;
  documentId: string;
  text: string;
  indexedAt: string;
};

export interface OcrPort {
  ocr(pdf: string, requestId: string, lang?: string): Promise<string>;
}

export class DomainError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class TenantDocumentService {
  private readonly tenants = new Map<string, Tenant>();
  private readonly documents = new Map<string, SearchableDocument>();
  private readonly ocrClient: OcrPort;

  constructor(ocrClient: OcrPort) {
    this.ocrClient = ocrClient;
  }

  onboard(input: z.infer<typeof onboardingBodySchema>): Tenant {
    if (this.tenants.has(input.tenantId)) throw new DomainError(409, "Tenant already exists");
    const tenant = { ...input, status: "active" as const };
    this.tenants.set(input.tenantId, tenant);
    return tenant;
  }

  setAccountStatus(tenantId: string, status: AccountStatus): Tenant {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new DomainError(404, "Tenant not found");
    const updated = { ...tenant, status };
    this.tenants.set(tenantId, updated);
    return updated;
  }

  async ingest(tenantId: string, input: z.infer<typeof documentBodySchema>): Promise<SearchableDocument> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new DomainError(404, "Tenant not found");
    if (tenant.status !== "active") throw new DomainError(409, "Tenant account is not active");

    const key = `${tenantId}:${input.documentId}`;
    const existing = this.documents.get(key);
    if (existing) return existing;

    const text = await this.ocrClient.ocr(input.pdf, key, input.lang);
    const document = { tenantId, documentId: input.documentId, text, indexedAt: new Date().toISOString() };
    this.documents.set(key, document);
    return document;
  }

  search(tenantId: string, query: string): SearchableDocument[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) throw new DomainError(400, "Search query is required");
    return [...this.documents.values()].filter((document) =>
      document.tenantId === tenantId && document.text.toLocaleLowerCase().includes(normalized)
    );
  }
}
