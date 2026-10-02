import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError, type ZodType } from "zod";
import { InfraiError, InfraiPdfClient } from "./infrai_pdf_client.js";
import {
  accountBodySchema,
  documentBodySchema,
  DomainError,
  onboardingBodySchema,
  TenantDocumentService
} from "./tenant_document_service.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const service = new TenantDocumentService(new InfraiPdfClient(apiKey));

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function body<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "POST" && url.pathname === "/tenants") {
      return send(response, 201, service.onboard(await body(request, onboardingBodySchema)));
    }

    const account = url.pathname.match(/^\/tenants\/([^/]+)\/account$/);
    if (request.method === "PATCH" && account) {
      const input = await body(request, accountBodySchema);
      return send(response, 200, service.setAccountStatus(decodeURIComponent(account[1]), input.status));
    }

    const documents = url.pathname.match(/^\/tenants\/([^/]+)\/documents$/);
    if (request.method === "POST" && documents) {
      const result = await service.ingest(decodeURIComponent(documents[1]), await body(request, documentBodySchema));
      return send(response, 201, result);
    }
    if (request.method === "GET" && documents) {
      return send(response, 200, { results: service.search(decodeURIComponent(documents[1]), url.searchParams.get("q") ?? "") });
    }
    return send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError) return send(response, 400, { error: "Invalid request body", issues: error.issues });
    if (error instanceof DomainError) return send(response, error.status, { error: error.message });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.message, code: error.code });
    }
    return send(response, 500, { error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Tenant document service listening on http://localhost:${port}`));
